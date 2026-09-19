import { z } from "zod";
import { AuthUserRoleSchema, AuthUserSchema } from "./configuration.js";

/**
 * Dashboard permissions. These govern what a signed-in operator may do through the
 * dashboard API; they are separate from agent access-token capabilities, which
 * govern what an agent may do through MCP.
 */
export const AuthPermissionSchema = z.enum([
  "projects:read",
  "projects:write",
  "projects:delete",
  "runs:read",
  "runs:manage",
  "files:read",
  "assets:read",
  "assets:write",
  "reviews:read",
  "reviews:manage",
  "config:read",
  "config:write",
  "users:manage",
  "tokens:manage",
]);

/**
 * Role expansion for dashboard sessions. Every role currently expands to the full
 * permission set: the policy model is in place, but no permission is withheld from
 * members yet. Narrow `member` here when that changes.
 */
export const AUTH_ROLE_PERMISSIONS = {
  admin: AuthPermissionSchema.options,
  member: AuthPermissionSchema.options,
} as const satisfies Record<z.infer<typeof AuthUserRoleSchema>, readonly z.infer<typeof AuthPermissionSchema>[]>;

/** Stored per session; the browser only ever holds an encrypted, opaque cookie. */
export const AuthSessionSchema = z.object({
  schema_version: z.literal("0.1.0"),
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  created_at: z.string().datetime(),
  expires_at: z.string().datetime(),
  last_seen_at: z.string().datetime(),
  revoked_at: z.string().datetime().nullable().default(null),
  user_agent: z.string().nullable().default(null),
});

/** What the dashboard learns about the current session. */
export const AuthPrincipalSchema = z.object({
  user: AuthUserSchema,
  session_id: z.string().uuid(),
  permissions: z.array(AuthPermissionSchema),
});

export const AuthStatusSchema = z.object({
  /** False while no scope has authentication enabled: the dashboard stays open. */
  required: z.boolean(),
  principal: AuthPrincipalSchema.nullable(),
});

export type AuthPermission = z.infer<typeof AuthPermissionSchema>;
export type AuthSession = z.infer<typeof AuthSessionSchema>;
export type AuthPrincipal = z.infer<typeof AuthPrincipalSchema>;
export type AuthStatus = z.infer<typeof AuthStatusSchema>;
