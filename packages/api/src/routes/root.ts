import {
  createAuthUser,
  createProjectSpace,
  listProjectSpaces,
  ROOT_SESSION_TTL_MS,
  resolveRootSession,
  sealRootSession,
  verifyRootKey,
} from "@konductor/store";
import type { RootStatus } from "@konductor/schema";
import { ApiError, json, readJsonBody, type Router } from "../router.js";
import { clearedRootSessionCookie, readCookie, ROOT_SESSION_COOKIE, rootSessionCookie } from "../auth/cookies.js";
import { clearLoginFailures, loginBlocked, recordLoginFailure } from "../auth/rate-limit.js";

/** All root throttling shares one bucket: the key is one shared secret, not per-user. */
const ROOT_THROTTLE_KEY = "root";

function requireRootSession(request: Request): void {
  if (!resolveRootSession(readCookie(request, ROOT_SESSION_COOKIE))) {
    throw new ApiError("Root sign-in required.", { status: 401, code: "ROOT_SESSION_REQUIRED" });
  }
}

/**
 * `/root`: the super-admin surface. A single 32-character key (generated once by
 * `konductor setup`, see `ensureRootKey`) unlocks a short-lived session cookie that
 * every other root route checks directly — this is intentionally outside the
 * dashboard's per-user auth system, since it exists to create the accounts that
 * system depends on.
 */
export function registerRootRoutes(router: Router): void {
  router.get("/api/root/session", ({ request }) => {
    const status: RootStatus = { authenticated: resolveRootSession(readCookie(request, ROOT_SESSION_COOKIE)) };
    return json(status);
  });

  router.post("/api/root/login", async ({ request }) => {
    const body = await readJsonBody<{ key?: unknown }>(request);
    const key = typeof body.key === "string" ? body.key : "";
    if (!key.trim()) {
      throw new ApiError("The root key is required.", { status: 400, code: "ROOT_KEY_REQUIRED" });
    }
    const throttle = loginBlocked(ROOT_THROTTLE_KEY);
    if (throttle.blocked) {
      throw new ApiError("Too many attempts. Try again later.", {
        status: 429,
        code: "ROOT_THROTTLED",
        hint: `Retry in about ${Math.ceil(throttle.retry_after_seconds / 60)} minute(s).`,
      });
    }
    if (!(await verifyRootKey(key))) {
      recordLoginFailure(ROOT_THROTTLE_KEY);
      throw new ApiError("Incorrect root key.", { status: 401, code: "ROOT_KEY_INVALID" });
    }
    clearLoginFailures(ROOT_THROTTLE_KEY);
    const status: RootStatus = { authenticated: true };
    return new Response(JSON.stringify(status), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": rootSessionCookie(request, sealRootSession(), ROOT_SESSION_TTL_MS / 1000),
      },
    });
  });

  router.post("/api/root/logout", ({ request }) => {
    const status: RootStatus = { authenticated: false };
    return new Response(JSON.stringify(status), {
      status: 200,
      headers: { "Content-Type": "application/json", "Set-Cookie": clearedRootSessionCookie(request) },
    });
  });

  router.get("/api/root/spaces", ({ request }) => {
    requireRootSession(request);
    return listProjectSpaces().then((spaces) => json({ spaces }));
  });

  router.post("/api/root/spaces", async ({ request }) => {
    requireRootSession(request);
    const body = await readJsonBody<{
      name?: unknown;
      admin?: { display_name?: unknown; email?: unknown; password?: unknown };
    }>(request);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const adminName = typeof body.admin?.display_name === "string" ? body.admin.display_name.trim() : "";
    const adminEmail = typeof body.admin?.email === "string" ? body.admin.email.trim() : "";
    const adminPassword = typeof body.admin?.password === "string" ? body.admin.password : "";
    if (!name) throw new ApiError("The space needs a name.", { status: 400, code: "SPACE_NAME_REQUIRED" });
    if (!adminName || !adminEmail || !adminPassword) {
      throw new ApiError("The space's admin needs a name, email, and password.", {
        status: 400,
        code: "SPACE_ADMIN_REQUIRED",
      });
    }
    const space = await createProjectSpace(name);
    await createAuthUser({
      scope_type: "project_space",
      scope_id: space.id,
      display_name: adminName,
      email: adminEmail,
      password: adminPassword,
      role: "admin",
    });
    const spaces = await listProjectSpaces();
    const created = spaces.find((entry) => entry.id === space.id) ?? { ...space, admin_count: 1, project_count: 0 };
    return json({ space: created }, 201);
  });
}
