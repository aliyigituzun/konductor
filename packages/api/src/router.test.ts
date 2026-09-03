import { describe, expect, test } from "bun:test";
import { ApiError, Router, errorResponse, json } from "./router.js";

const req = (method: string, path: string, body?: unknown) =>
  new Request(`http://localhost${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe("Router", () => {
  test("matches a literal path", async () => {
    const router = new Router().get("/api/registry", () => json({ ok: true }));
    const res = await router.handle(req("GET", "/api/registry"));
    expect(res?.status).toBe(200);
    expect(await res!.json()).toEqual({ ok: true });
  });

  test("captures and decodes params", async () => {
    const router = new Router().get("/api/agent/:slug/read", ({ params }) => json(params));
    const res = await router.handle(req("GET", "/api/agent/login%20fix/read"));
    expect(await res!.json()).toEqual({ slug: "login fix" });
  });

  test("returns null when nothing matches, so callers can fall through", async () => {
    const router = new Router().get("/api/registry", () => json({}));
    expect(await router.handle(req("GET", "/index.html"))).toBeNull();
  });

  test("distinguishes methods on the same path", async () => {
    const router = new Router()
      .get("/api/project/:id", () => json({ verb: "get" }))
      .delete("/api/project/:id", () => json({ verb: "delete" }));
    expect(await (await router.handle(req("DELETE", "/api/project/x")))!.json()).toEqual({
      verb: "delete",
    });
  });

  test("a shorter pattern never swallows a longer path", async () => {
    // /api/project/:id must not answer /api/project/x/agents.
    const router = new Router()
      .get("/api/project/:id/agents", () => json({ route: "agents" }))
      .get("/api/project/:id", () => json({ route: "detail" }));
    expect(await (await router.handle(req("GET", "/api/project/x/agents")))!.json()).toEqual({
      route: "agents",
    });
    expect(await (await router.handle(req("GET", "/api/project/x")))!.json()).toEqual({
      route: "detail",
    });
  });

  test("registration order does not decide which of the two wins", async () => {
    const router = new Router()
      .get("/api/project/:id", () => json({ route: "detail" }))
      .get("/api/project/:id/agents", () => json({ route: "agents" }));
    expect(await (await router.handle(req("GET", "/api/project/x/agents")))!.json()).toEqual({
      route: "agents",
    });
  });

  test("query strings are not part of matching", async () => {
    const router = new Router().get("/api/project/:id/doc", ({ url }) =>
      json({ file: url.searchParams.get("file") }),
    );
    const res = await router.handle(req("GET", "/api/project/x/doc?file=README.md"));
    expect(await res!.json()).toEqual({ file: "README.md" });
  });

  test("a thrown ApiError becomes its declared status and code", async () => {
    const router = new Router().get("/api/boom", () => {
      throw new ApiError("Nope.", { status: 404, code: "GONE", hint: "Try again." });
    });
    const res = await router.handle(req("GET", "/api/boom"));
    expect(res?.status).toBe(404);
    expect(await res!.json()).toEqual({
      error: "Nope.",
      code: "GONE",
      hint: "Try again.",
      details: [],
    });
  });

  test("an unexpected throw becomes a 500 rather than escaping the router", async () => {
    const router = new Router().get("/api/boom", () => {
      throw new TypeError("undefined is not a function");
    });
    const res = await router.handle(req("GET", "/api/boom"));
    expect(res?.status).toBe(500);
    expect(((await res!.json()) as { code: string }).code).toBe("API_ERROR");
  });
});

describe("errorResponse", () => {
  test("gives every failure the same shape", async () => {
    const fromApi = (await errorResponse(new ApiError("a")).json()) as Record<string, unknown>;
    const fromPlain = (await errorResponse(new Error("b")).json()) as Record<string, unknown>;
    expect(Object.keys(fromApi).sort()).toEqual(Object.keys(fromPlain).sort());
  });
});
