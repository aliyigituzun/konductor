import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import {
  AccessTokenRecordSchema,
  TOKEN_ROLE_PERMISSIONS,
  TokenAuditEventSchema,
  TokenProjectGrantSchema,
  type AccessTokenKind,
  type AccessTokenRecord,
  type AccessTokenSummary,
  type TokenAuditEvent,
  type TokenPermission,
  type TokenProjectGrant,
  type TokenRole,
} from "@konductor/schema";
import { withDatabase } from "./database.js";
import { GLOBAL_DATABASE, INTERNAL_TOKEN_SECRETS_DIR } from "./paths.js";

const INTERNAL_AGENT_PERMISSIONS: TokenPermission[] = [
  ...TOKEN_ROLE_PERMISSIONS.contributor,
  "assets.delete",
];
export const TOKEN_AUDIT_EVENT_LIMIT = 25_000;
const TOKEN_CREATE_ATTEMPTS = 5;

export type TokenGrantInput = {
  project_id: string;
  project_profile_id?: string | null;
  role: TokenRole;
  permissions?: TokenPermission[];
};

export type CreateAccessTokenInput = {
  kind: AccessTokenKind;
  name: string;
  agent_profile_id?: string | null;
  grants: TokenGrantInput[];
  created_by: string;
  expires_at?: string | null;
};

export type IssuedAccessToken = {
  token: string;
  record: AccessTokenSummary;
};

export type AuthenticatedToken = {
  token_id: string;
  kind: AccessTokenKind;
  label: string;
  agent_profile_id: string | null;
  project_id: string;
  permissions: TokenPermission[];
};

export type AccessTokenAuditActor = Pick<
  AuthenticatedToken,
  "token_id" | "kind" | "label" | "agent_profile_id"
>;

export type AccessTokenAuthenticationFailure =
  | "invalid_format"
  | "unrecognized"
  | "revoked"
  | "expired"
  | "wrong_project"
  | "permission_denied";

export class AccessTokenAuthenticationError extends Error {
  readonly reason: AccessTokenAuthenticationFailure;
  readonly actor: AccessTokenAuditActor | null;

  constructor(
    message: string,
    reason: AccessTokenAuthenticationFailure,
    actor: AccessTokenAuditActor | null = null,
  ) {
    super(message);
    this.name = "AccessTokenAuthenticationError";
    this.reason = reason;
    this.actor = actor;
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf-8").digest("hex");
}

function tokenPrefix(kind: AccessTokenKind, id: string): string {
  return `knd_${kind === "internal" ? "int" : "ext"}_${id.replace(/-/g, "").slice(0, 12)}`;
}

function prefixFromToken(token: string): string | null {
  return token.match(/^(knd_(?:int|ext)_[a-f0-9]{12})_[A-Za-z0-9_-]{40,}$/)?.[1] ?? null;
}

function summarize(record: AccessTokenRecord): AccessTokenSummary {
  const { token_hash: _hash, ...summary } = record;
  return summary;
}

function normalizeGrant(input: TokenGrantInput): TokenProjectGrant {
  const permissions = input.role === "custom"
    ? [...new Set(input.permissions ?? [])]
    : [...TOKEN_ROLE_PERMISSIONS[input.role]];
  if (permissions.length === 0) {
    throw new Error("A custom token grant needs at least one permission.");
  }
  return TokenProjectGrantSchema.parse({
    project_id: input.project_id,
    project_profile_id: input.project_profile_id ?? null,
    role: input.role,
    permissions,
  });
}

function readTokenRow(db: Database, id: string): AccessTokenRecord | null {
  const row = db.query<{ body: string }, [string]>("SELECT body FROM access_tokens WHERE id = ?").get(id);
  return row ? AccessTokenRecordSchema.parse(JSON.parse(row.body)) : null;
}

function writeTokenRow(db: Database, record: AccessTokenRecord): void {
  db.query(`
    INSERT INTO access_tokens (id, token_prefix, token_hash, body) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      token_prefix = excluded.token_prefix,
      token_hash = excluded.token_hash,
      body = excluded.body
  `).run(record.id, record.prefix, record.token_hash, JSON.stringify(record));
}

function insertTokenRow(db: Database, record: AccessTokenRecord): void {
  db.query(`
    INSERT INTO access_tokens (id, token_prefix, token_hash, body) VALUES (?, ?, ?, ?)
  `).run(record.id, record.prefix, record.token_hash, JSON.stringify(record));
}

function auditActor(record: AccessTokenRecord): AccessTokenAuditActor {
  return {
    token_id: record.id,
    kind: record.kind,
    label: record.name,
    agent_profile_id: record.agent_profile_id,
  };
}

function isTokenCollision(error: unknown): boolean {
  const text = String(error);
  return text.includes("UNIQUE constraint failed: access_tokens.token_prefix") ||
    text.includes("UNIQUE constraint failed: access_tokens.token_hash") ||
    text.includes("UNIQUE constraint failed: access_tokens.id");
}

function internalSecretPath(tokenId: string): string {
  return join(INTERNAL_TOKEN_SECRETS_DIR, tokenId);
}

async function persistInternalSecret(tokenId: string, token: string): Promise<void> {
  await mkdir(INTERNAL_TOKEN_SECRETS_DIR, { recursive: true, mode: 0o700 });
  await chmod(INTERNAL_TOKEN_SECRETS_DIR, 0o700);
  const path = internalSecretPath(tokenId);
  await writeFile(path, `${token}\n`, { encoding: "utf-8", mode: 0o600, flag: "wx" });
  await chmod(path, 0o600);
}

async function readInternalSecret(tokenId: string): Promise<string | null> {
  try {
    return (await readFile(internalSecretPath(tokenId), "utf-8")).trim() || null;
  } catch {
    return null;
  }
}

export async function recordTokenAuditEvent(
  input: Omit<TokenAuditEvent, "schema_version" | "id" | "at"> & { at?: string },
): Promise<TokenAuditEvent> {
  const event = TokenAuditEventSchema.parse({
    schema_version: "0.1.0",
    id: randomUUID(),
    at: input.at ?? new Date().toISOString(),
    ...input,
  });
  withDatabase(GLOBAL_DATABASE, (db) => db.transaction(() => {
    db.query(`
      INSERT INTO token_audit_events
        (id, occurred_at, actor_token_id, project_id, action, outcome, body)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      Date.parse(event.at),
      event.actor_token_id,
      event.project_id,
      event.action,
      event.outcome,
      JSON.stringify(event),
    );
    pruneTokenAuditRows(db, TOKEN_AUDIT_EVENT_LIMIT);
  }).immediate());
  return event;
}

function pruneTokenAuditRows(db: Database, retain: number): void {
  db.query(`
    DELETE FROM token_audit_events
    WHERE sequence NOT IN (
      SELECT sequence
      FROM token_audit_events
      ORDER BY occurred_at DESC, sequence DESC
      LIMIT ?
    )
  `).run(retain);
}

export async function pruneTokenAuditEvents(retain = TOKEN_AUDIT_EVENT_LIMIT): Promise<void> {
  const normalized = Math.max(1, Math.floor(retain));
  withDatabase(GLOBAL_DATABASE, (db) => db.transaction(() => {
    pruneTokenAuditRows(db, normalized);
  }).immediate());
}

export async function createAccessToken(input: CreateAccessTokenInput): Promise<IssuedAccessToken> {
  if (input.kind === "internal" && !input.agent_profile_id) {
    throw new Error("Internal tokens must identify an agent profile.");
  }
  if (input.kind === "external" && input.agent_profile_id) {
    throw new Error("External tokens cannot impersonate an internal agent profile.");
  }
  const now = new Date().toISOString();
  const grants = input.grants.map(normalizeGrant);
  let issued: { token: string; record: AccessTokenRecord } | null = null;
  let collision: unknown = null;
  for (let attempt = 0; attempt < TOKEN_CREATE_ATTEMPTS; attempt += 1) {
    const id = randomUUID();
    const prefix = tokenPrefix(input.kind, id);
    const token = `${prefix}_${randomBytes(32).toString("base64url")}`;
    const record = AccessTokenRecordSchema.parse({
      schema_version: "0.1.0",
      id,
      prefix,
      token_hash: hashToken(token),
      kind: input.kind,
      name: input.name,
      agent_profile_id: input.agent_profile_id ?? null,
      grants,
      created_at: now,
      created_by: input.created_by,
      expires_at: input.expires_at ?? null,
      last_used_at: null,
      use_count: 0,
      revoked_at: null,
      revoked_by: null,
      revoke_reason: null,
    });
    try {
      withDatabase(GLOBAL_DATABASE, (db) => insertTokenRow(db, record));
      issued = { token, record };
      break;
    } catch (error) {
      if (!isTokenCollision(error)) throw error;
      collision = error;
    }
  }
  if (!issued) {
    throw new Error(
      `Unable to issue a unique access token after ${TOKEN_CREATE_ATTEMPTS} attempts.`,
      { cause: collision },
    );
  }
  const { token, record } = issued;
  try {
    if (record.kind === "internal") await persistInternalSecret(record.id, token);
  } catch (error) {
    withDatabase(GLOBAL_DATABASE, (db) => db.query("DELETE FROM access_tokens WHERE id = ?").run(record.id));
    throw error;
  }

  await recordTokenAuditEvent({
    actor_token_id: null,
    actor_kind: "system",
    actor_label: input.created_by,
    project_id: record.grants.length === 1 ? record.grants[0]!.project_id : null,
    agent_profile_id: record.agent_profile_id,
    action: "token.created",
    permission: "tokens.manage",
    outcome: "allowed",
    target: record.id,
    metadata: { kind: record.kind, name: record.name, projects: record.grants.map((grant) => grant.project_id) },
  });
  return { token, record: summarize(record) };
}

export async function listAccessTokens(projectId?: string): Promise<AccessTokenSummary[]> {
  return withDatabase(GLOBAL_DATABASE, (db) => db
    .query<{ body: string }, []>("SELECT body FROM access_tokens ORDER BY rowid DESC")
    .all()
    .map((row) => AccessTokenRecordSchema.parse(JSON.parse(row.body)))
    .filter((record) => !projectId || record.grants.some((grant) => grant.project_id === projectId))
    .map(summarize));
}

export async function revokeAccessToken(
  tokenId: string,
  options: { revoked_by: string; reason?: string | null } = { revoked_by: "local-operator" },
): Promise<AccessTokenSummary | null> {
  const result = withDatabase(GLOBAL_DATABASE, (db) => db.transaction(() => {
    const current = readTokenRow(db, tokenId);
    if (!current) return null;
    if (current.revoked_at) return { record: current, changed: false };
    const next = AccessTokenRecordSchema.parse({
      ...current,
      revoked_at: new Date().toISOString(),
      revoked_by: options.revoked_by,
      revoke_reason: options.reason ?? null,
    });
    writeTokenRow(db, next);
    return { record: next, changed: true };
  }).immediate());
  if (!result) return null;
  const updated = result.record;
  if (!result.changed) return summarize(updated);
  if (updated.kind === "internal") await unlink(internalSecretPath(updated.id)).catch(() => {});
  await recordTokenAuditEvent({
    actor_token_id: null,
    actor_kind: "system",
    actor_label: options.revoked_by,
    project_id: updated.grants.length === 1 ? updated.grants[0]!.project_id : null,
    agent_profile_id: updated.agent_profile_id,
    action: "token.revoked",
    permission: "tokens.manage",
    outcome: "allowed",
    target: updated.id,
    metadata: { reason: options.reason ?? null },
  });
  return summarize(updated);
}

export async function authenticateAccessToken(
  token: string,
  projectId: string,
  permission?: TokenPermission,
  options: { record_use?: boolean } = {},
): Promise<AuthenticatedToken> {
  const prefix = prefixFromToken(token);
  if (!prefix) {
    throw new AccessTokenAuthenticationError(
      "The access token format is invalid.",
      "invalid_format",
    );
  }
  const now = new Date();
  const authenticated = withDatabase(GLOBAL_DATABASE, (db) => db.transaction(() => {
    const row = db.query<{ body: string }, [string]>(
      "SELECT body FROM access_tokens WHERE token_prefix = ?",
    ).get(prefix);
    if (!row) {
      throw new AccessTokenAuthenticationError(
        "The access token is not recognized.",
        "unrecognized",
      );
    }
    const record = AccessTokenRecordSchema.parse(JSON.parse(row.body));
    const actual = Buffer.from(hashToken(token), "hex");
    const expected = Buffer.from(record.token_hash, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new AccessTokenAuthenticationError(
        "The access token is not recognized.",
        "unrecognized",
      );
    }
    const actor = auditActor(record);
    if (record.revoked_at) {
      throw new AccessTokenAuthenticationError(
        "The access token has been revoked.",
        "revoked",
        actor,
      );
    }
    if (record.expires_at && Date.parse(record.expires_at) <= now.getTime()) {
      throw new AccessTokenAuthenticationError(
        "The access token has expired.",
        "expired",
        actor,
      );
    }
    const grant = record.grants.find((item) => item.project_id === projectId);
    if (!grant) {
      throw new AccessTokenAuthenticationError(
        `The access token does not grant access to project ${projectId}.`,
        "wrong_project",
        actor,
      );
    }
    if (permission && !grant.permissions.includes(permission)) {
      throw new AccessTokenAuthenticationError(
        `The access token does not grant ${permission}.`,
        "permission_denied",
        actor,
      );
    }
    if (options.record_use === false) {
      return { record, grant };
    }
    const next = AccessTokenRecordSchema.parse({
      ...record,
      last_used_at: now.toISOString(),
      use_count: record.use_count + 1,
    });
    writeTokenRow(db, next);
    return { record: next, grant };
  }).immediate());
  return {
    token_id: authenticated.record.id,
    kind: authenticated.record.kind,
    label: authenticated.record.name,
    agent_profile_id: authenticated.record.agent_profile_id,
    project_id: projectId,
    permissions: authenticated.grant.permissions,
  };
}

export async function listTokenAuditEvents(options: {
  project_id?: string;
  token_id?: string;
  limit?: number;
} = {}): Promise<TokenAuditEvent[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 100, 1000));
  return withDatabase(GLOBAL_DATABASE, (db) => {
    const rows = options.project_id && options.token_id
      ? db.query<{ body: string }, [string, string, number]>(
          "SELECT body FROM token_audit_events WHERE project_id = ? AND actor_token_id = ? ORDER BY occurred_at DESC, sequence DESC LIMIT ?",
        ).all(options.project_id, options.token_id, limit)
      : options.project_id
      ? db.query<{ body: string }, [string, number]>(
          "SELECT body FROM token_audit_events WHERE project_id = ? ORDER BY occurred_at DESC, sequence DESC LIMIT ?",
        ).all(options.project_id, limit)
      : options.token_id
        ? db.query<{ body: string }, [string, number]>(
            "SELECT body FROM token_audit_events WHERE actor_token_id = ? ORDER BY occurred_at DESC, sequence DESC LIMIT ?",
          ).all(options.token_id, limit)
        : db.query<{ body: string }, [number]>(
            "SELECT body FROM token_audit_events ORDER BY occurred_at DESC, sequence DESC LIMIT ?",
          ).all(limit);
    return rows.map((row) => TokenAuditEventSchema.parse(JSON.parse(row.body)));
  });
}

function hasInternalPermissions(record: AccessTokenSummary): boolean {
  const granted = new Set(record.grants.flatMap((grant) => grant.permissions));
  return INTERNAL_AGENT_PERMISSIONS.every((permission) => granted.has(permission));
}

async function usableInternalToken(record: AccessTokenSummary): Promise<string | null> {
  const token = await readInternalSecret(record.id);
  return token && hashToken(token) === withDatabase(GLOBAL_DATABASE, (db) => readTokenRow(db, record.id)?.token_hash ?? "")
    ? token
    : null;
}

export async function ensureInternalProfileToken(
  projectId: string,
  profileId: string,
  profileTitle = profileId,
): Promise<IssuedAccessToken> {
  const candidates = (await listAccessTokens(projectId)).filter((record) =>
    record.kind === "internal" &&
    record.agent_profile_id === profileId &&
    !record.revoked_at &&
    (!record.expires_at || Date.parse(record.expires_at) > Date.now()),
  );
  for (const candidate of candidates) {
    // Permissions are frozen at issuance, so a Konductor-managed identity must be
    // reissued when Konductor itself learns a new capability.
    if (!hasInternalPermissions(candidate)) {
      await revokeAccessToken(candidate.id, {
        revoked_by: "konductor-internal-token-manager",
        reason: "Internal agent permissions changed; rotating credential.",
      });
      continue;
    }
    const token = await usableInternalToken(candidate);
    if (token) {
      for (const duplicate of candidates.filter((item) => item.id !== candidate.id)) {
        await revokeAccessToken(duplicate.id, {
          revoked_by: "konductor-internal-token-manager",
          reason: "Superseded duplicate internal profile token.",
        });
      }
      return { token, record: candidate };
    }
    await revokeAccessToken(candidate.id, {
      revoked_by: "konductor-internal-token-manager",
      reason: "Internal token secret was missing or invalid; rotating credential.",
    });
  }
  return createAccessToken({
    kind: "internal",
    name: `${profileTitle} (${projectId})`,
    agent_profile_id: profileId,
    grants: [{
      project_id: projectId,
      role: "custom",
      permissions: INTERNAL_AGENT_PERMISSIONS,
    }],
    created_by: "konductor-internal-token-manager",
  });
}

export async function reconcileInternalProfileTokens(
  projectId: string,
  profiles: Array<{ id: string; title: string }>,
): Promise<Map<string, IssuedAccessToken>> {
  const wanted = new Set(profiles.map((profile) => profile.id));
  for (const token of await listAccessTokens(projectId)) {
    if (
      token.kind === "internal" &&
      token.agent_profile_id &&
      !wanted.has(token.agent_profile_id) &&
      !token.revoked_at
    ) {
      await revokeAccessToken(token.id, {
        revoked_by: "konductor-internal-token-manager",
        reason: "Agent profile was removed from the project.",
      });
    }
  }
  const issued = new Map<string, IssuedAccessToken>();
  for (const profile of profiles) {
    issued.set(profile.id, await ensureInternalProfileToken(projectId, profile.id, profile.title));
  }
  return issued;
}
