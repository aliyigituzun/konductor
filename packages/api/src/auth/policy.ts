import type { AuthPermission, AuthPrincipal } from "@konductor/schema";

/**
 * Which dashboard permission a request needs, decided from its method and path.
 *
 * Rules are checked in order; the first match wins, and anything unmatched falls
 * back to the project read/write pair. Keeping the mapping in one table means a new
 * route is protected by default and only needs an entry here when it belongs to a
 * narrower capability.
 */
type Rule = {
  test: RegExp;
  read: AuthPermission;
  write: AuthPermission;
  /** Overrides for specific methods, e.g. DELETE is a distinct capability for projects. */
  methods?: Partial<Record<string, AuthPermission>>;
};

const RULES: Rule[] = [
  { test: /^\/api\/config\/[^/]+\/[^/]+\/auth\/users(\/|$)/, read: "config:read", write: "users:manage" },
  { test: /^\/api\/config\/[^/]+\/[^/]+\/tokens(\/|$)/, read: "config:read", write: "tokens:manage" },
  { test: /^\/api\/access-tokens\//, read: "config:read", write: "tokens:manage" },
  { test: /^\/api\/config\//, read: "config:read", write: "config:write" },
  { test: /^\/api\/host\//, read: "runs:read", write: "runs:manage" },
  { test: /^\/api\/(agents|agent|run)(\/|$)/, read: "runs:read", write: "runs:manage" },
  { test: /^\/api\/project\/[^/]+\/(runs|agents|adapters|skills|telemetry)(\/|$)/, read: "runs:read", write: "runs:manage" },
  { test: /^\/api\/project\/[^/]+\/(files|file|docs|doc)(\/|$)/, read: "files:read", write: "files:read" },
  { test: /^\/api\/project\/[^/]+\/assets(\/|$)/, read: "assets:read", write: "assets:write" },
  { test: /^\/api\/project\/[^/]+\/(reviews|previews|branches)(\/|$)/, read: "reviews:read", write: "reviews:manage" },
  { test: /^\/api\/project\/[^/]+$/, read: "projects:read", write: "projects:write", methods: { DELETE: "projects:delete" } },
];

const DEFAULT_RULE: Rule = { test: /./, read: "projects:read", write: "projects:write" };

/** Routes that never require a session: signing in, and customer review links. */
const PUBLIC_ROUTES: RegExp[] = [
  /^\/api\/auth\/(login|session)$/,
  /^\/api\/review\/[^/]+(\/requests)?$/,
  // `/api/root/*` is a separate, self-contained auth system (a single shared key,
  // not a dashboard session); each handler checks its own root cookie directly.
  /^\/api\/root\//,
];

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((pattern) => pattern.test(pathname));
}

/** Routes any signed-in user may call regardless of role: their own session. */
export function isSessionOnlyRoute(pathname: string): boolean {
  return /^\/api\/auth\//.test(pathname);
}

export function requiredPermission(method: string, pathname: string): AuthPermission {
  const rule = RULES.find((entry) => entry.test.test(pathname)) ?? DEFAULT_RULE;
  const override = rule.methods?.[method];
  if (override) return override;
  return method === "GET" || method === "HEAD" ? rule.read : rule.write;
}

export function hasPermission(principal: AuthPrincipal, permission: AuthPermission): boolean {
  return principal.permissions.includes(permission);
}
