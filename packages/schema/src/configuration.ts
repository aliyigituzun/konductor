import { z } from "zod";
import { UserPermissionSetSchema } from "./permissions.js";

/** `host` has exactly one scope id, `local`: settings for this machine rather than a project. */
export const ConfigurationScopeTypeSchema = z.enum(["project_space", "project", "host"]);
export const HOST_SCOPE_ID = "local";
export const ThemePreferenceSchema = z.enum(["system", "light", "dark"]);

export const RemoteAccessSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  transport: z.literal("ssh_reverse_tunnel").default("ssh_reverse_tunnel"),
  ssh_host: z.string().default(""),
  ssh_user: z.string().default(""),
  local_host: z.literal("127.0.0.1").default("127.0.0.1"),
  local_port: z.number().int().min(1).max(65535).default(4096),
  remote_port: z.number().int().min(1).max(65535).default(4096),
});

export const AuthenticationSettingsSchema = z.object({
  enabled: z.boolean().default(false),
});

/** Public account data only. The GitHub token remains in host-only secret storage. */
export const GitHubConnectionSchema = z.object({
  login: z.string().min(1),
  name: z.string().nullable().default(null),
  avatar_url: z.string().url().nullable().default(null),
  connected_at: z.string().datetime(),
});

export const PortRangeSchema = z.object({
  start: z.number().int().min(1).max(65535),
  end: z.number().int().min(1).max(65535),
});

/** Ports the host may never hand to a preview, plus the pool previews are drawn from. */
export const PortSettingsSchema = z.object({
  reserved: z.array(PortRangeSchema.extend({ label: z.string().default("") })).default([]),
  preview_range: PortRangeSchema.default({ start: 4200, end: 4299 }),
});

export const IntegrationSettingsSchema = z.object({
  github: GitHubConnectionSchema.nullable().default(null),
});

/**
 * Which optional surfaces show up as dashboard tabs. Defaults to enabled so
 * existing configuration rows (parsed before this field existed) keep every
 * tab visible; onboarding is the only flow that turns one off.
 */
export const FeatureFlagsSchema = z.object({
  asset_manager_enabled: z.boolean().default(true),
  docs_manager_enabled: z.boolean().default(true),
  customer_endpoint_enabled: z.boolean().default(true),
});

export const ScopeConfigurationSchema = z.object({
  schema_version: z.literal("0.1.0"),
  scope_type: ConfigurationScopeTypeSchema,
  scope_id: z.string().min(1),
  general: z.object({
    theme: ThemePreferenceSchema.default("system"),
  }),
  remote: RemoteAccessSettingsSchema,
  auth: AuthenticationSettingsSchema,
  integrations: IntegrationSettingsSchema.default({ github: null }),
  ports: PortSettingsSchema.default({ reserved: [], preview_range: { start: 4200, end: 4299 } }),
  features: FeatureFlagsSchema.default({
    asset_manager_enabled: true,
    docs_manager_enabled: true,
    customer_endpoint_enabled: true,
  }),
  updated_at: z.string().datetime(),
});

export const AuthUserRoleSchema = z.enum(["admin", "member"]);

/**
 * Members carry per-project permission sets; administrators have full access and
 * keep the list empty. Sets are stored but not enforced yet (see permissions.ts).
 */
export const AuthUserSchema = z.object({
  schema_version: z.literal("0.1.0"),
  id: z.string().uuid(),
  scope_type: ConfigurationScopeTypeSchema,
  scope_id: z.string().min(1),
  display_name: z.string().min(1),
  email: z.string().email(),
  role: AuthUserRoleSchema,
  permission_sets: z.array(UserPermissionSetSchema).default([]),
  /** Personal phase shortcuts used by the to-do workspace. */
  pinned_todo_phase_ids: z.array(z.string()).default([]),
  status: z.enum(["active", "disabled"]).default("active"),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const ConfigurationStateSchema = z.object({
  settings: ScopeConfigurationSchema,
  users: z.array(AuthUserSchema),
});

export type ConfigurationScopeType = z.infer<typeof ConfigurationScopeTypeSchema>;
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>;
export type RemoteAccessSettings = z.infer<typeof RemoteAccessSettingsSchema>;
export type AuthenticationSettings = z.infer<typeof AuthenticationSettingsSchema>;
export type GitHubConnection = z.infer<typeof GitHubConnectionSchema>;
export type IntegrationSettings = z.infer<typeof IntegrationSettingsSchema>;
export type FeatureFlags = z.infer<typeof FeatureFlagsSchema>;
export type PortRange = z.infer<typeof PortRangeSchema>;
export type PortSettings = z.infer<typeof PortSettingsSchema>;
export type ScopeConfiguration = z.infer<typeof ScopeConfigurationSchema>;
export type AuthUserRole = z.infer<typeof AuthUserRoleSchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;
export type ConfigurationState = z.infer<typeof ConfigurationStateSchema>;
