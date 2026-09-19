import { z } from "zod";

/**
 * Capabilities are intentionally explicit. Avoid broad read/write booleans: new
 * surfaces should add a new capability so existing tokens never gain authority
 * merely because Konductor learned a feature.
 */
export const TokenPermissionSchema = z.enum([
  "project.read",
  "project.configure",
  "status.read",
  "status.write",
  "decisions.read",
  "decisions.write",
  "updates.read",
  "updates.write",
  "runs.read",
  "runs.launch",
  "runs.message",
  "runs.stop",
  "assets.read",
  "assets.write",
  "assets.delete",
  "files.read",
  "files.write",
  "tokens.read",
  "tokens.manage",
  "audit.read",
]);

export const TOKEN_PERMISSIONS = TokenPermissionSchema.options;

export const TokenRoleSchema = z.enum([
  "observer",
  "contributor",
  "operator",
  "administrator",
  "custom",
]);

export const TOKEN_ROLE_PERMISSIONS = {
  observer: [
    "project.read",
    "status.read",
    "decisions.read",
    "updates.read",
    "runs.read",
    "assets.read",
    "files.read",
  ],
  contributor: [
    "project.read",
    "status.read",
    "status.write",
    "decisions.read",
    "decisions.write",
    "updates.read",
    "updates.write",
    "runs.read",
    "assets.read",
    "assets.write",
    "files.read",
  ],
  operator: [
    "project.read",
    "project.configure",
    "status.read",
    "status.write",
    "decisions.read",
    "decisions.write",
    "updates.read",
    "updates.write",
    "runs.read",
    "runs.launch",
    "runs.message",
    "runs.stop",
    "assets.read",
    "assets.write",
    "assets.delete",
    "files.read",
    "files.write",
    "tokens.read",
    "audit.read",
  ],
  administrator: TokenPermissionSchema.options,
} as const satisfies Record<Exclude<z.infer<typeof TokenRoleSchema>, "custom">, readonly z.infer<typeof TokenPermissionSchema>[]>;

export const TokenProjectGrantSchema = z.object({
  /** Stable project id from konductor.config.json / the machine registry. */
  project_id: z.string().min(1),
  /** Reserved namespace link for persisted Project Profiles. */
  project_profile_id: z.string().min(1).nullable().default(null),
  role: TokenRoleSchema,
  /** Expanded and persisted so authorization never depends on changing role definitions. */
  permissions: z.array(TokenPermissionSchema),
});

export const AccessTokenKindSchema = z.enum(["internal", "external"]);

export const AccessTokenRecordSchema = z.object({
  schema_version: z.literal("0.1.0"),
  id: z.string().uuid(),
  prefix: z.string().min(1),
  token_hash: z.string().regex(/^[a-f0-9]{64}$/),
  kind: AccessTokenKindSchema,
  name: z.string().min(1),
  /** Set only for Konductor-managed internal agent identities. */
  agent_profile_id: z.string().min(1).nullable(),
  grants: z.array(TokenProjectGrantSchema).min(1),
  created_at: z.string().datetime(),
  created_by: z.string().min(1),
  expires_at: z.string().datetime().nullable(),
  last_used_at: z.string().datetime().nullable(),
  use_count: z.number().int().nonnegative(),
  revoked_at: z.string().datetime().nullable(),
  revoked_by: z.string().nullable(),
  revoke_reason: z.string().nullable(),
});

export const AccessTokenSummarySchema = AccessTokenRecordSchema.omit({ token_hash: true });

export const TokenAuditOutcomeSchema = z.enum(["allowed", "denied", "error"]);

export const TokenAuditEventSchema = z.object({
  schema_version: z.literal("0.1.0"),
  id: z.string().uuid(),
  at: z.string().datetime(),
  actor_token_id: z.string().uuid().nullable(),
  actor_kind: z.enum(["internal", "external", "local_operator", "system"]),
  actor_label: z.string().min(1),
  project_id: z.string().nullable(),
  agent_profile_id: z.string().nullable(),
  action: z.string().min(1),
  permission: TokenPermissionSchema.nullable(),
  outcome: TokenAuditOutcomeSchema,
  target: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type TokenPermission = z.infer<typeof TokenPermissionSchema>;
export type TokenRole = z.infer<typeof TokenRoleSchema>;
export type TokenProjectGrant = z.infer<typeof TokenProjectGrantSchema>;
export type AccessTokenKind = z.infer<typeof AccessTokenKindSchema>;
export type AccessTokenRecord = z.infer<typeof AccessTokenRecordSchema>;
export type AccessTokenSummary = z.infer<typeof AccessTokenSummarySchema>;
export type TokenAuditEvent = z.infer<typeof TokenAuditEventSchema>;
