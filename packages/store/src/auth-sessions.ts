import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Database } from "bun:sqlite";
import {
  AUTH_ROLE_PERMISSIONS,
  AuthSessionSchema,
  AuthUserSchema,
  ScopeConfigurationSchema,
  type AuthPermission,
  type AuthPrincipal,
  type AuthSession,
  type AuthUser,
} from "@konductor/schema";
import { verifyAuthPassword } from "./configuration.js";
import { withDatabase } from "./database.js";
import { GLOBAL_DATABASE, SESSION_KEY_FILE } from "./paths.js";

/** Absolute lifetime of a dashboard session. There is no sliding renewal yet. */
export const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** `last_seen_at` is written at most this often, so reads stay cheap. */
const TOUCH_INTERVAL_MS = 60 * 1000;
const COOKIE_VERSION = "v1";

/**
 * Cookie layout: `v1.<iv>.<ciphertext>.<tag>` (base64url), AES-256-GCM under a
 * host-only key. The plaintext is `<session id>.<session secret>`; the database
 * keeps only the SHA-256 of the secret, so neither a copied database nor a copied
 * cookie alone is enough to resume a session.
 */
function sessionKey(): Buffer {
  if (existsSync(SESSION_KEY_FILE)) {
    const key = Buffer.from(readFileSync(SESSION_KEY_FILE, "utf-8").trim(), "base64url");
    if (key.length === 32) return key;
    throw new Error(`Session key at ${SESSION_KEY_FILE} is corrupt; delete it to sign everyone out and regenerate.`);
  }
  mkdirSync(dirname(SESSION_KEY_FILE), { recursive: true, mode: 0o700 });
  const key = randomBytes(32);
  writeFileSync(SESSION_KEY_FILE, `${key.toString("base64url")}\n`, { mode: 0o600 });
  chmodSync(SESSION_KEY_FILE, 0o600);
  return key;
}

function sealCookie(sessionId: string, secret: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sessionKey(), iv);
  const plaintext = Buffer.from(`${sessionId}.${secret.toString("base64url")}`, "utf-8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [COOKIE_VERSION, iv, ciphertext, cipher.getAuthTag()]
    .map((part) => typeof part === "string" ? part : part.toString("base64url"))
    .join(".");
}

function openCookie(value: string): { session_id: string; secret: Buffer } | null {
  const [version, ivText, cipherText, tagText] = value.split(".");
  if (version !== COOKIE_VERSION || !ivText || !cipherText || !tagText) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", sessionKey(), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(cipherText, "base64url")),
      decipher.final(),
    ]).toString("utf-8");
    const [sessionId, secretText] = plaintext.split(".");
    if (!sessionId || !secretText) return null;
    return { session_id: sessionId, secret: Buffer.from(secretText, "base64url") };
  } catch {
    return null;
  }
}

function hashSecret(secret: Buffer): string {
  return createHash("sha256").update(secret).digest("base64url");
}

function readSession(db: Database, id: string): { session: AuthSession; secret_hash: string } | null {
  const row = db.query<{ body: string; secret_hash: string }, [string]>(
    "SELECT body, secret_hash FROM auth_sessions WHERE id = ?",
  ).get(id);
  return row ? { session: AuthSessionSchema.parse(JSON.parse(row.body)), secret_hash: row.secret_hash } : null;
}

function writeSession(db: Database, session: AuthSession): void {
  db.query("UPDATE auth_sessions SET body = ?, expires_at = ? WHERE id = ?")
    .run(JSON.stringify(session), Date.parse(session.expires_at), session.id);
}

function readUserById(db: Database, id: string): AuthUser | null {
  const row = db.query<{ body: string }, [string]>("SELECT body FROM auth_users WHERE id = ?").get(id);
  return row ? AuthUserSchema.parse(JSON.parse(row.body)) : null;
}

export function permissionsForUser(user: AuthUser): AuthPermission[] {
  return [...AUTH_ROLE_PERMISSIONS[user.role]];
}

/** Authentication is required as soon as any configuration scope has enabled it:
 * the dashboard is one surface, so it cannot be half-protected. */
export async function isAuthenticationRequired(): Promise<boolean> {
  return withDatabase(GLOBAL_DATABASE, (db) =>
    db.query<{ body: string }, []>("SELECT body FROM configuration_scopes").all()
      .some((row) => ScopeConfigurationSchema.parse(JSON.parse(row.body)).auth.enabled));
}

export type LoginFailure = "invalid_credentials" | "user_disabled";

export class AuthLoginError extends Error {
  readonly reason: LoginFailure;
  constructor(reason: LoginFailure) {
    super(reason === "user_disabled" ? "This account is disabled." : "Email or password is incorrect.");
    this.name = "AuthLoginError";
    this.reason = reason;
  }
}

/**
 * Verify a password against every user record with that email. Users are scoped,
 * so one address may exist in several scopes; the first record whose credential
 * matches signs in. Verification always runs at least once so timing does not
 * reveal whether the address exists.
 */
export async function authenticateAuthUser(email: string, password: string): Promise<AuthUser> {
  const normalized = email.trim().toLowerCase();
  const rows = withDatabase(GLOBAL_DATABASE, (db) =>
    db.query<{ body: string; credential_hash: string }, [string]>(
      "SELECT body, credential_hash FROM auth_users WHERE email = ? ORDER BY rowid",
    ).all(normalized));
  if (rows.length === 0) {
    await verifyAuthPassword(password, DUMMY_CREDENTIAL);
    throw new AuthLoginError("invalid_credentials");
  }
  let disabled = false;
  for (const row of rows) {
    if (!(await verifyAuthPassword(password, row.credential_hash))) continue;
    const user = AuthUserSchema.parse(JSON.parse(row.body));
    if (user.status !== "active") { disabled = true; continue; }
    return user;
  }
  throw new AuthLoginError(disabled ? "user_disabled" : "invalid_credentials");
}

// A real scrypt hash of a throwaway password, so unknown emails cost the same time.
const DUMMY_CREDENTIAL = "scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function createAuthSession(
  user: AuthUser,
  options: { user_agent?: string | null } = {},
): Promise<{ session: AuthSession; cookie_value: string }> {
  const now = Date.now();
  const secret = randomBytes(32);
  const session = AuthSessionSchema.parse({
    schema_version: "0.1.0",
    id: randomUUID(),
    user_id: user.id,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + AUTH_SESSION_TTL_MS).toISOString(),
    last_seen_at: new Date(now).toISOString(),
    revoked_at: null,
    user_agent: options.user_agent?.slice(0, 256) ?? null,
  });
  withDatabase(GLOBAL_DATABASE, (db) => {
    db.query(`
      INSERT INTO auth_sessions (id, user_id, secret_hash, expires_at, body) VALUES (?, ?, ?, ?, ?)
    `).run(session.id, session.user_id, hashSecret(secret), Date.parse(session.expires_at), JSON.stringify(session));
    // Expired rows are only ever dead weight; clear them while we hold the connection.
    db.query("DELETE FROM auth_sessions WHERE expires_at < ?").run(now - AUTH_SESSION_TTL_MS);
  });
  return { session, cookie_value: sealCookie(session.id, secret) };
}

/** Resolve a cookie to its principal, or null for anything invalid, expired, revoked, or disabled. */
export async function resolveAuthSession(cookieValue: string | null | undefined): Promise<AuthPrincipal | null> {
  if (!cookieValue) return null;
  const opened = openCookie(cookieValue);
  if (!opened) return null;
  return withDatabase(GLOBAL_DATABASE, (db) => {
    const found = readSession(db, opened.session_id);
    if (!found) return null;
    const expected = Buffer.from(found.secret_hash, "base64url");
    const actual = Buffer.from(hashSecret(opened.secret), "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const { session } = found;
    const now = Date.now();
    if (session.revoked_at || Date.parse(session.expires_at) <= now) return null;
    const user = readUserById(db, session.user_id);
    if (!user || user.status !== "active") return null;
    if (now - Date.parse(session.last_seen_at) > TOUCH_INTERVAL_MS) {
      writeSession(db, { ...session, last_seen_at: new Date(now).toISOString() });
    }
    return { user, session_id: session.id, permissions: permissionsForUser(user) };
  });
}

export async function revokeAuthSession(sessionId: string): Promise<boolean> {
  return withDatabase(GLOBAL_DATABASE, (db) => {
    const found = readSession(db, sessionId);
    if (!found || found.session.revoked_at) return false;
    writeSession(db, { ...found.session, revoked_at: new Date().toISOString() });
    return true;
  });
}

/** Sign a user out everywhere, e.g. after a password change or disablement. */
export async function revokeAuthSessionsForUser(userId: string): Promise<number> {
  return withDatabase(GLOBAL_DATABASE, (db) => {
    const rows = db.query<{ body: string }, [string]>("SELECT body FROM auth_sessions WHERE user_id = ?").all(userId);
    let count = 0;
    for (const row of rows) {
      const session = AuthSessionSchema.parse(JSON.parse(row.body));
      if (session.revoked_at) continue;
      writeSession(db, { ...session, revoked_at: new Date().toISOString() });
      count += 1;
    }
    return count;
  });
}

export async function listAuthSessionsForUser(userId: string): Promise<AuthSession[]> {
  return withDatabase(GLOBAL_DATABASE, (db) =>
    db.query<{ body: string }, [string]>("SELECT body FROM auth_sessions WHERE user_id = ? ORDER BY rowid DESC").all(userId)
      .map((row) => AuthSessionSchema.parse(JSON.parse(row.body)))
      .filter((session) => !session.revoked_at && Date.parse(session.expires_at) > Date.now()));
}
