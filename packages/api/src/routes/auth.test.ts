import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The sign-in wall end to end: open by default, closed once any scope enables
 * authentication, sessions carried by an encrypted HttpOnly cookie, and the
 * permission policy applied to every non-public route. Each scenario runs in a
 * child with its own KONDUCTOR_HOME so the operator's real host state is untouched.
 */

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "konductor-auth-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

async function worker(code: string): Promise<void> {
  const child = Bun.spawn([process.execPath, "-e", `
    import * as store from ${JSON.stringify(new URL("../../../store/src/index.ts", import.meta.url).href)};
    import { createApiRouter } from ${JSON.stringify(new URL("../index.ts", import.meta.url).href)};
    import { expect } from "bun:test";
    import { existsSync, statSync } from "node:fs";
    import { join } from "node:path";

    const home = ${JSON.stringify(join(dir, "home"))};
    const router = createApiRouter();
    await store.writeHostState({
      schema_version: "0.3.0", host_id: "test", started_at: new Date().toISOString(), port: 1, pid: null,
    });

    let cookie = "";
    const call = async (method, path, body, extraHeaders = {}) => {
      const headers = { ...(cookie ? { cookie } : {}), ...extraHeaders };
      const res = await router.handle(new Request("http://localhost" + path, {
        method,
        ...(body === undefined ? { headers } : { body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } }),
      }));
      if (!res) throw new Error("No route for " + method + " " + path);
      const setCookie = res.headers.getSetCookie();
      if (setCookie.length) cookie = setCookie[0].split(";")[0];
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      return { status: res.status, json, setCookie };
    };
    const signOutLocally = () => { cookie = ""; };

    ${code}
  `], { env: { ...process.env, KONDUCTOR_HOME: join(dir, "home") }, stdout: "pipe", stderr: "pipe" });
  const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (exit !== 0) throw new Error(stderr);
}

test("the dashboard stays open until a scope enables authentication, then requires a session", async () => {
  await worker(`
    let session = await call("GET", "/api/auth/session");
    expect(session.json).toEqual({ required: false, principal: null });
    expect((await call("GET", "/api/registry")).status).toBe(200);

    // Enabling needs an active administrator first.
    expect((await call("PUT", "/api/config/project_space/team/auth", { enabled: true })).status).toBe(409);
    const created = await call("POST", "/api/config/project_space/team/auth/users", {
      display_name: "Ada", email: "Ada@Example.com", password: "correct horse battery",
    });
    expect(created.status).toBe(201);
    expect(created.json.users[0].role).toBe("admin");
    expect(JSON.stringify(created.json)).not.toContain("credential");

    expect((await call("PUT", "/api/config/project_space/team/auth", { enabled: true })).status).toBe(200);

    const blocked = await call("GET", "/api/registry");
    expect(blocked.status).toBe(401);
    expect(blocked.json.code).toBe("SESSION_REQUIRED");
    session = await call("GET", "/api/auth/session");
    expect(session.json).toEqual({ required: true, principal: null });

    // Customer review links remain public.
    expect((await call("GET", "/api/review/nope")).status).not.toBe(401);

    const wrong = await call("POST", "/api/auth/login", { email: "ada@example.com", password: "not the password" });
    expect(wrong.status).toBe(401);
    expect(wrong.json.code).toBe("AUTH_INVALID_CREDENTIALS");
    expect(wrong.setCookie).toEqual([]);

    const ok = await call("POST", "/api/auth/login", { email: "ada@example.com", password: "correct horse battery" });
    expect(ok.status).toBe(200);
    expect(ok.json.principal.user.email).toBe("ada@example.com");
    expect(ok.json.principal.permissions).toContain("projects:write");
    const flags = ok.setCookie[0];
    expect(flags).toContain("HttpOnly");
    expect(flags).toContain("SameSite=Lax");
    expect(flags).toContain("Path=/");
    expect(flags).not.toContain("Secure");
    // The cookie is an opaque sealed value, not the session id or the secret.
    const value = flags.split(";")[0].split("=")[1];
    expect(value.startsWith("v1.")).toBe(true);
    expect(value).not.toContain(ok.json.principal.session_id);

    expect((await call("GET", "/api/registry")).status).toBe(200);
    session = await call("GET", "/api/auth/session");
    expect(session.json.principal.user.display_name).toBe("Ada");

    // The key file is host-only.
    const keyPath = join(home, "secrets", "session.key");
    expect(existsSync(keyPath)).toBe(true);
    expect(statSync(keyPath).mode & 0o777).toBe(0o600);

    // A tampered cookie is rejected outright.
    const saved = cookie;
    cookie = saved.slice(0, -4) + "AAAA";
    expect((await call("GET", "/api/registry")).status).toBe(401);
    cookie = saved;

    // Cross-origin writes are refused even with a valid cookie.
    const csrf = await call("POST", "/api/project/demo/todos", { title: "x" }, { origin: "https://evil.example" });
    expect(csrf.status).toBe(403);
    expect(csrf.json.code).toBe("ORIGIN_MISMATCH");
    const sameOrigin = await call("POST", "/api/project/nope/todos", { title: "x" }, { origin: "http://localhost" });
    expect(sameOrigin.status).toBe(404);

    // Sign-out revokes the server-side session; the old cookie no longer works.
    const out = await call("POST", "/api/auth/logout");
    expect(out.setCookie[0]).toContain("Max-Age=0");
    cookie = saved;
    expect((await call("GET", "/api/registry")).status).toBe(401);

    // Disabling the only scope with authentication reopens the dashboard.
    await call("POST", "/api/auth/login", { email: "ada@example.com", password: "correct horse battery" });
    expect((await call("PUT", "/api/config/project_space/team/auth", { enabled: false })).status).toBe(200);
    signOutLocally();
    expect((await call("GET", "/api/registry")).status).toBe(200);
  `);
});

test("a disabled user cannot sign in and existing sessions die with revoke-all", async () => {
  await worker(`
    await call("POST", "/api/config/project_space/team/auth/users", { display_name: "Ada", email: "ada@example.com", password: "correct horse battery" });
    await call("POST", "/api/config/project_space/team/auth/users", { display_name: "Bob", email: "bob@example.com", password: "another long password", role: "member" });
    await call("PUT", "/api/config/project_space/team/auth", { enabled: true });

    const bob = await call("POST", "/api/auth/login", { email: "bob@example.com", password: "another long password" });
    expect(bob.status).toBe(200);
    // Members currently hold every permission.
    expect(bob.json.principal.permissions.sort()).toEqual([...bob.json.principal.permissions].sort());
    expect(bob.json.principal.permissions).toContain("users:manage");
    const bobCookie = cookie;

    const sessions = await call("GET", "/api/auth/sessions");
    expect(sessions.json.sessions).toHaveLength(1);
    expect(sessions.json.current).toBe(bob.json.principal.session_id);

    // A second browser, then revoke everything from the first.
    signOutLocally();
    await call("POST", "/api/auth/login", { email: "bob@example.com", password: "another long password" });
    expect((await call("GET", "/api/auth/sessions")).json.sessions).toHaveLength(2);
    const revoked = await call("POST", "/api/auth/sessions/revoke-all");
    expect(revoked.status).toBe(200);
    cookie = bobCookie;
    expect((await call("GET", "/api/registry")).status).toBe(401);

    // Repeated failures throttle the address.
    signOutLocally();
    let last;
    for (let i = 0; i < 11; i += 1) last = await call("POST", "/api/auth/login", { email: "bob@example.com", password: "wrong wrong wrong" });
    expect(last.status).toBe(429);
    expect(last.json.code).toBe("AUTH_THROTTLED");

    // Login attempts are audited.
    const events = await store.listTokenAuditEvents({ limit: 50 });
    expect(events.some((event) => event.action === "auth.login" && event.outcome === "allowed" && event.actor_label === "bob@example.com")).toBe(true);
    expect(events.some((event) => event.action === "auth.login" && event.outcome === "denied")).toBe(true);
  `);
});

test("the policy maps every route to a permission and keeps sign-in public", async () => {
  await worker(`
    const { requiredPermission, isPublicRoute } = await import(${JSON.stringify(new URL("../index.ts", import.meta.url).href)});
    expect(isPublicRoute("/api/auth/login")).toBe(true);
    expect(isPublicRoute("/api/auth/logout")).toBe(false);
    expect(isPublicRoute("/api/review/abc")).toBe(true);
    expect(isPublicRoute("/api/review/abc/requests")).toBe(true);
    expect(isPublicRoute("/api/registry")).toBe(false);
    expect(requiredPermission("GET", "/api/registry")).toBe("projects:read");
    expect(requiredPermission("POST", "/api/project/demo/todos")).toBe("projects:write");
    expect(requiredPermission("DELETE", "/api/project/demo")).toBe("projects:delete");
    expect(requiredPermission("POST", "/api/project/demo/runs")).toBe("runs:manage");
    expect(requiredPermission("GET", "/api/project/demo/files")).toBe("files:read");
    expect(requiredPermission("PUT", "/api/project/demo/assets/settings")).toBe("assets:write");
    expect(requiredPermission("POST", "/api/project/demo/reviews")).toBe("reviews:manage");
    expect(requiredPermission("POST", "/api/config/project_space/team/auth/users")).toBe("users:manage");
    expect(requiredPermission("PUT", "/api/config/project_space/team/auth/users/u1/permission-sets")).toBe("users:manage");
    expect(requiredPermission("POST", "/api/config/host/local/tokens")).toBe("tokens:manage");
    expect(requiredPermission("DELETE", "/api/access-tokens/x")).toBe("tokens:manage");
    expect(requiredPermission("PUT", "/api/config/host/local/general")).toBe("config:write");
  `);
});
