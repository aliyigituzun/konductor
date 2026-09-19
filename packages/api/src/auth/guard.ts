import { isAuthenticationRequired, resolveAuthSession } from "@konductor/store";
import { ApiError, errorResponse, type RouteGuard } from "../router.js";
import { SESSION_COOKIE, readCookie } from "./cookies.js";
import { hasPermission, isPublicRoute, isSessionOnlyRoute, requiredPermission } from "./policy.js";

/**
 * Cookie-authenticated writes must come from the dashboard's own origin. SameSite=Lax
 * already blocks cross-site POSTs in current browsers; this check refuses them in
 * older ones too, and refuses a stray Origin on any state-changing request.
 */
function originMismatch(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD") return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch {
    return true;
  }
}

/**
 * The dashboard's authorization guard.
 *
 * While no scope has enabled authentication the dashboard stays open, exactly as
 * before: every request runs with a null principal. Once enabled, every non-public
 * route needs a live session and the permission the policy table assigns to it.
 * A session that happens to be present is honoured either way, so the UI can show
 * who is signed in.
 */
export const authorizeRequest: RouteGuard = async ({ request, url }) => {
  const principal = await resolveAuthSession(readCookie(request, SESSION_COOKIE));
  if (isPublicRoute(url.pathname)) return principal;
  if (!(await isAuthenticationRequired())) return principal;
  if (!principal) {
    return errorResponse(new ApiError("Sign in to continue.", {
      status: 401,
      code: "SESSION_REQUIRED",
    }));
  }
  if (originMismatch(request)) {
    return errorResponse(new ApiError("Cross-origin request refused.", { status: 403, code: "ORIGIN_MISMATCH" }));
  }
  if (isSessionOnlyRoute(url.pathname)) return principal;
  const permission = requiredPermission(request.method, url.pathname);
  if (!hasPermission(principal, permission)) {
    return errorResponse(new ApiError(`This action needs the ${permission} permission.`, {
      status: 403,
      code: "PERMISSION_DENIED",
      details: [permission],
    }));
  }
  return principal;
};
