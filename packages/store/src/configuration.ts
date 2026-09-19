import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Database } from "bun:sqlite";
import {
  AuthUserSchema,
  ConfigurationStateSchema,
  FeatureFlagsSchema,
  GitHubConnectionSchema,
  PortSettingsSchema,
  RemoteAccessSettingsSchema,
  ScopeConfigurationSchema,
  ThemePreferenceSchema,
  UserPermissionSetSchema,
  validatePermissionSets,
  type AuthUser,
  type AuthUserRole,
  type ConfigurationScopeType,
  type ConfigurationState,
  type FeatureFlags,
  type GitHubConnection,
  type PortSettings,
  type RemoteAccessSettings,
  type ScopeConfiguration,
  type ThemePreference,
  type UserPermissionSet,
} from "@konductor/schema";
import { withDatabase } from "./database.js";
import { GLOBAL_DATABASE } from "./paths.js";

const scryptAsync = promisify(scrypt);

function defaultConfiguration(
  scopeType: ConfigurationScopeType,
  scopeId: string,
): ScopeConfiguration {
  return ScopeConfigurationSchema.parse({
    schema_version: "0.1.0",
    scope_type: scopeType,
    scope_id: scopeId,
    general: { theme: "system" },
    remote: {
      enabled: false,
      transport: "ssh_reverse_tunnel",
      ssh_host: "",
      ssh_user: "",
      local_host: "127.0.0.1",
      local_port: 4096,
      remote_port: 4096,
    },
    auth: { enabled: false },
    integrations: { github: null },
    ports: { reserved: [], preview_range: { start: 4200, end: 4299 } },
    features: { asset_manager_enabled: true, docs_manager_enabled: true, customer_endpoint_enabled: true },
    updated_at: new Date().toISOString(),
  });
}

function readSettingsRow(
  db: Database,
  scopeType: ConfigurationScopeType,
  scopeId: string,
): ScopeConfiguration {
  const row = db.query<{ body: string }, [string, string]>(
    "SELECT body FROM configuration_scopes WHERE scope_type = ? AND scope_id = ?",
  ).get(scopeType, scopeId);
  return row
    ? ScopeConfigurationSchema.parse(JSON.parse(row.body))
    : defaultConfiguration(scopeType, scopeId);
}

function writeSettingsRow(db: Database, settings: ScopeConfiguration): void {
  db.query(`
    INSERT INTO configuration_scopes (scope_type, scope_id, body) VALUES (?, ?, ?)
    ON CONFLICT(scope_type, scope_id) DO UPDATE SET body = excluded.body
  `).run(settings.scope_type, settings.scope_id, JSON.stringify(settings));
}

function listUsersRow(
  db: Database,
  scopeType: ConfigurationScopeType,
  scopeId: string,
): AuthUser[] {
  return db.query<{ body: string }, [string, string]>(
    "SELECT body FROM auth_users WHERE scope_type = ? AND scope_id = ? ORDER BY rowid",
  ).all(scopeType, scopeId).map((row) => AuthUserSchema.parse(JSON.parse(row.body)));
}

async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) throw new Error("Passwords must contain at least 12 characters.");
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 64) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyAuthPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltText, hashText] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64url");
  const actual = await scryptAsync(password, Buffer.from(saltText, "base64url"), expected.length) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function readConfigurationState(
  scopeType: ConfigurationScopeType,
  scopeId: string,
): Promise<ConfigurationState> {
  return withDatabase(GLOBAL_DATABASE, (db) => ConfigurationStateSchema.parse({
    settings: readSettingsRow(db, scopeType, scopeId),
    users: listUsersRow(db, scopeType, scopeId),
  }));
}

export async function updateGeneralConfiguration(
  scopeType: ConfigurationScopeType,
  scopeId: string,
  theme: ThemePreference,
): Promise<ConfigurationState> {
  const parsedTheme = ThemePreferenceSchema.parse(theme);
  withDatabase(GLOBAL_DATABASE, (db) => db.transaction(() => {
    const current = readSettingsRow(db, scopeType, scopeId);
    writeSettingsRow(db, ScopeConfigurationSchema.parse({
      ...current,
      general: { theme: parsedTheme },
      updated_at: new Date().toISOString(),
    }));
  }).immediate());
  return readConfigurationState(scopeType, scopeId);
}

/** Machine-wide port bookkeeping; callers pass the `host`/`local` scope. */
export async function updatePortSettings(
  scopeType: ConfigurationScopeType,
  scopeId: string,
  ports: PortSettings,
): Promise<ConfigurationState> {
  const parsedPorts = PortSettingsSchema.parse(ports);
  withDatabase(GLOBAL_DATABASE, (db) => db.transaction(() => {
    const current = readSettingsRow(db, scopeType, scopeId);
    writeSettingsRow(db, ScopeConfigurationSchema.parse({
      ...current,
      ports: parsedPorts,
      updated_at: new Date().toISOString(),
    }));
  }).immediate());
  return readConfigurationState(scopeType, scopeId);
}

export async function updateFeatureFlags(
  scopeType: ConfigurationScopeType,
  scopeId: string,
  features: FeatureFlags,
): Promise<ConfigurationState> {
  const parsedFeatures = FeatureFlagsSchema.parse(features);
  withDatabase(GLOBAL_DATABASE, (db) => db.transaction(() => {
    const current = readSettingsRow(db, scopeType, scopeId);
    writeSettingsRow(db, ScopeConfigurationSchema.parse({
      ...current,
      features: parsedFeatures,
      updated_at: new Date().toISOString(),
    }));
  }).immediate());
  return readConfigurationState(scopeType, scopeId);
}

export async function updateRemoteConfiguration(
  scopeType: ConfigurationScopeType,
  scopeId: string,
  remote: RemoteAccessSettings,
): Promise<ConfigurationState> {
  const parsedRemote = RemoteAccessSettingsSchema.parse(remote);
  withDatabase(GLOBAL_DATABASE, (db) => db.transaction(() => {
    const current = readSettingsRow(db, scopeType, scopeId);
    if (parsedRemote.enabled && !current.auth.enabled) {
      throw new Error("Enable authentication before preparing remote access.");
    }
    writeSettingsRow(db, ScopeConfigurationSchema.parse({
      ...current,
      remote: parsedRemote,
      updated_at: new Date().toISOString(),
    }));
  }).immediate());
  return readConfigurationState(scopeType, scopeId);
}

export async function setAuthenticationEnabled(
  scopeType: ConfigurationScopeType,
  scopeId: string,
  enabled: boolean,
): Promise<ConfigurationState> {
  withDatabase(GLOBAL_DATABASE, (db) => db.transaction(() => {
    const current = readSettingsRow(db, scopeType, scopeId);
    const users = listUsersRow(db, scopeType, scopeId);
    if (enabled && !users.some((user) => user.role === "admin" && user.status === "active")) {
      throw new Error("Create an active administrator before enabling authentication.");
    }
    writeSettingsRow(db, ScopeConfigurationSchema.parse({
      ...current,
      auth: { enabled },
      updated_at: new Date().toISOString(),
    }));
  }).immediate());
  return readConfigurationState(scopeType, scopeId);
}

export async function connectGitHub(
  scopeType: ConfigurationScopeType,
  scopeId: string,
  connection: GitHubConnection,
): Promise<ConfigurationState> {
  const parsedConnection = GitHubConnectionSchema.parse(connection);
  withDatabase(GLOBAL_DATABASE, (db) => db.transaction(() => {
    const current = readSettingsRow(db, scopeType, scopeId);
    writeSettingsRow(db, ScopeConfigurationSchema.parse({
      ...current,
      integrations: { ...current.integrations, github: parsedConnection },
      updated_at: new Date().toISOString(),
    }));
  }).immediate());
  return readConfigurationState(scopeType, scopeId);
}

export async function disconnectGitHub(
  scopeType: ConfigurationScopeType,
  scopeId: string,
): Promise<ConfigurationState> {
  withDatabase(GLOBAL_DATABASE, (db) => db.transaction(() => {
    const current = readSettingsRow(db, scopeType, scopeId);
    writeSettingsRow(db, ScopeConfigurationSchema.parse({
      ...current,
      integrations: { ...current.integrations, github: null },
      updated_at: new Date().toISOString(),
    }));
  }).immediate());
  return readConfigurationState(scopeType, scopeId);
}

export async function createAuthUser(input: {
  scope_type: ConfigurationScopeType;
  scope_id: string;
  display_name: string;
  email: string;
  password: string;
  role?: AuthUserRole;
  permission_sets?: UserPermissionSet[];
}): Promise<ConfigurationState> {
  const now = new Date().toISOString();
  const state = await readConfigurationState(input.scope_type, input.scope_id);
  const firstUser = state.users.length === 0;
  const role: AuthUserRole = firstUser ? "admin" : (input.role ?? "member");
  const user = AuthUserSchema.parse({
    schema_version: "0.1.0",
    id: randomUUID(),
    scope_type: input.scope_type,
    scope_id: input.scope_id,
    display_name: input.display_name.trim(),
    email: input.email.trim().toLowerCase(),
    role,
    // Administrators have full access, so any sets sent with that role are dropped.
    permission_sets: role === "admin" ? [] : parsePermissionSets(input.permission_sets ?? []),
    pinned_todo_phase_ids: [],
    status: "active",
    created_at: now,
    updated_at: now,
  });
  const credentialHash = await hashPassword(input.password);
  try {
    withDatabase(GLOBAL_DATABASE, (db) => {
      db.query(`
        INSERT INTO auth_users (id, scope_type, scope_id, email, credential_hash, body)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        user.id,
        user.scope_type,
        user.scope_id,
        user.email,
        credentialHash,
        JSON.stringify(user),
      );
    });
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      throw new Error(`A user with ${user.email} already exists in this configuration scope.`);
    }
    throw error;
  }
  return readConfigurationState(input.scope_type, input.scope_id);
}

/** Applies both the per-set schema and the cross-set rules before anything is stored. */
function parsePermissionSets(sets: UserPermissionSet[]): UserPermissionSet[] {
  const parsed = sets.map((set) => UserPermissionSetSchema.parse(set));
  const errors = validatePermissionSets(parsed);
  if (errors.length > 0) throw new Error(errors.join(" "));
  return parsed;
}

export async function updateAuthUserPermissionSets(input: {
  scope_type: ConfigurationScopeType;
  scope_id: string;
  user_id: string;
  permission_sets: UserPermissionSet[];
}): Promise<ConfigurationState> {
  const permissionSets = parsePermissionSets(input.permission_sets);
  withDatabase(GLOBAL_DATABASE, (db) => db.transaction(() => {
    const row = db.query<{ body: string }, [string, string, string]>(`
      SELECT body FROM auth_users WHERE id = ? AND scope_type = ? AND scope_id = ?
    `).get(input.user_id, input.scope_type, input.scope_id);
    if (!row) throw new Error("User not found in this configuration scope.");
    const user = AuthUserSchema.parse(JSON.parse(row.body));
    if (user.role === "admin") throw new Error("Administrators have full access; permission sets apply to members only.");
    const next = AuthUserSchema.parse({
      ...user,
      permission_sets: permissionSets,
      updated_at: new Date().toISOString(),
    });
    db.query("UPDATE auth_users SET body = ? WHERE id = ?").run(JSON.stringify(next), input.user_id);
  }).immediate());
  return readConfigurationState(input.scope_type, input.scope_id);
}

export async function updateAuthUserTodoPins(input: {
  scope_type: ConfigurationScopeType;
  scope_id: string;
  user_id: string;
  pinned_todo_phase_ids: string[];
}): Promise<ConfigurationState> {
  const pinned = [...new Set(input.pinned_todo_phase_ids.map((id) => id.trim()).filter(Boolean))];
  withDatabase(GLOBAL_DATABASE, (db) => db.transaction(() => {
    const row = db.query<{ body: string }, [string, string, string]>(`
      SELECT body FROM auth_users WHERE id = ? AND scope_type = ? AND scope_id = ?
    `).get(input.user_id, input.scope_type, input.scope_id);
    if (!row) throw new Error("User not found in this configuration scope.");
    const user = AuthUserSchema.parse(JSON.parse(row.body));
    const next = AuthUserSchema.parse({
      ...user,
      pinned_todo_phase_ids: pinned,
      updated_at: new Date().toISOString(),
    });
    db.query("UPDATE auth_users SET body = ? WHERE id = ?").run(JSON.stringify(next), input.user_id);
  }).immediate());
  return readConfigurationState(input.scope_type, input.scope_id);
}

export async function findAuthCredential(
  scopeType: ConfigurationScopeType,
  scopeId: string,
  email: string,
): Promise<{ user: AuthUser; credential_hash: string } | null> {
  return withDatabase(GLOBAL_DATABASE, (db) => {
    const row = db.query<{ body: string; credential_hash: string }, [string, string, string]>(`
      SELECT body, credential_hash FROM auth_users
      WHERE scope_type = ? AND scope_id = ? AND email = ?
    `).get(scopeType, scopeId, email.trim().toLowerCase());
    return row ? { user: AuthUserSchema.parse(JSON.parse(row.body)), credential_hash: row.credential_hash } : null;
  });
}
