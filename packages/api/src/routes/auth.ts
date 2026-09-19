import {
  AUTH_SESSION_TTL_MS,
  AuthLoginError,
  authenticateAuthUser,
  createAuthSession,
  isAuthenticationRequired,
  listAuthSessionsForUser,
  recordTokenAuditEvent,
  resolveAuthSession,
  revokeAuthSession,
  revokeAuthSessionsForUser,
  updateAuthUserTodoPins,
} from "@konductor/store";
import type { AuthStatus } from "@konductor/schema";
import { ApiError, json, readJsonBody, type Router } from "../router.js";
import { clearedSessionCookie, sessionCookie } from "../auth/cookies.js";
import { clearLoginFailures, loginBlocked, recordLoginFailure } from "../auth/rate-limit.js";

function withCookie(response: Response, cookie: string): Response {
  response.headers.append("Set-Cookie", cookie);
  return response;
}

async function audit(action: string, outcome: "allowed" | "denied", label: string, metadata: Record<string, unknown> = {}) {
  await recordTokenAuditEvent({
    actor_token_id: null,
    actor_kind: "local_operator",
    actor_label: label,
    project_id: null,
    agent_profile_id: null,
    action,
    permission: null,
    outcome,
    target: null,
    metadata,
  });
}

/**
 * Sign-in, sign-out, and "who am I". `login` and `session` are public; `logout`
 * and the session list need a live session but no particular permission.
 */
export function registerAuthRoutes(router: Router): void {
  router.get("/api/auth/session", async ({ principal }) => {
    const status: AuthStatus = { required: await isAuthenticationRequired(), principal };
    return json(status);
  });

  router.post("/api/auth/login", async ({ request }) => {
    const body = await readJsonBody<{ email?: unknown; password?: unknown }>(request);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) {
      throw new ApiError("Email and password are required.", { status: 400, code: "AUTH_FIELDS_REQUIRED" });
    }
    const throttle = loginBlocked(email);
    if (throttle.blocked) {
      await audit("auth.login", "denied", email, { reason: "throttled" });
      throw new ApiError("Too many sign-in attempts. Try again later.", {
        status: 429,
        code: "AUTH_THROTTLED",
        hint: `Retry in about ${Math.ceil(throttle.retry_after_seconds / 60)} minute(s).`,
      });
    }
    let user;
    try {
      user = await authenticateAuthUser(email, password);
    } catch (error) {
      if (!(error instanceof AuthLoginError)) throw error;
      recordLoginFailure(email);
      await audit("auth.login", "denied", email, { reason: error.reason });
      throw new ApiError(error.message, { status: 401, code: "AUTH_INVALID_CREDENTIALS" });
    }
    clearLoginFailures(email);
    const { cookie_value } = await createAuthSession(user, { user_agent: request.headers.get("user-agent") });
    await audit("auth.login", "allowed", user.email, { user_id: user.id });
    const status: AuthStatus = {
      required: await isAuthenticationRequired(),
      principal: await resolveAuthSession(cookie_value),
    };
    return withCookie(json(status), sessionCookie(request, cookie_value, AUTH_SESSION_TTL_MS / 1000));
  });

  router.post("/api/auth/logout", async ({ request, principal }) => {
    if (principal) {
      await revokeAuthSession(principal.session_id);
      await audit("auth.logout", "allowed", principal.user.email, { user_id: principal.user.id });
    }
    const status: AuthStatus = { required: await isAuthenticationRequired(), principal: null };
    return withCookie(json(status), clearedSessionCookie(request));
  });

  /** The signed-in user's own to-do pins, whichever scope their record lives in. */
  router.put("/api/auth/me/todo-pins", async ({ request, principal }) => {
    if (!principal) throw new ApiError("Sign in to continue.", { status: 401, code: "SESSION_REQUIRED" });
    const body = await readJsonBody<{ pinned_todo_phase_ids?: unknown }>(request);
    if (!Array.isArray(body.pinned_todo_phase_ids) || body.pinned_todo_phase_ids.some((id) => typeof id !== "string")) {
      throw new ApiError("Pinned to-do phases must be a list of phase IDs.", { status: 400, code: "TODO_PINS_INVALID" });
    }
    const state = await updateAuthUserTodoPins({
      scope_type: principal.user.scope_type,
      scope_id: principal.user.scope_id,
      user_id: principal.user.id,
      pinned_todo_phase_ids: body.pinned_todo_phase_ids,
    });
    const user = state.users.find((entry) => entry.id === principal.user.id) ?? principal.user;
    return json({ user });
  });

  router.get("/api/auth/sessions", async ({ principal }) => {
    if (!principal) throw new ApiError("Sign in to continue.", { status: 401, code: "SESSION_REQUIRED" });
    return json({ sessions: await listAuthSessionsForUser(principal.user.id), current: principal.session_id });
  });

  /** Sign this user out of every browser, including this one. */
  router.post("/api/auth/sessions/revoke-all", async ({ request, principal }) => {
    if (!principal) throw new ApiError("Sign in to continue.", { status: 401, code: "SESSION_REQUIRED" });
    const revoked = await revokeAuthSessionsForUser(principal.user.id);
    await audit("auth.logout_all", "allowed", principal.user.email, { user_id: principal.user.id, revoked });
    const status: AuthStatus = { required: await isAuthenticationRequired(), principal: null };
    return withCookie(json(status), clearedSessionCookie(request));
  });
}
