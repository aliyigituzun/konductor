import { afterEach, describe, expect, test } from "bun:test";
import { ApiError, fetchHostHealth, fetchProject, formatApiError, projectFileUrl } from "./registry.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stubFetch(status: number, body: string) {
  globalThis.fetch = (async () => new Response(body, { status })) as unknown as typeof fetch;
}

describe("formatApiError", () => {
  test("lays out message, hint, code, run id, and details one per line", () => {
    const error = new ApiError("Launch failed.", {
      status: 500,
      code: "LAUNCH_FAILED",
      hint: "Check the host log.",
      runId: "run-1",
      details: ["tmux exited 1"],
    });
    expect(formatApiError(error)).toBe(
      "Launch failed.\nHint: Check the host log.\nCode: LAUNCH_FAILED\nRun ID: run-1\ntmux exited 1",
    );
  });

  test("omits the optional parts that are missing", () => {
    expect(formatApiError(new ApiError("Nope.", { status: 404 }))).toBe("Nope.");
  });

  test("handles plain errors and non-errors", () => {
    expect(formatApiError(new Error("boom"))).toBe("boom");
    expect(formatApiError("string failure")).toBe("string failure");
    expect(formatApiError(42)).toBe("42");
  });
});

describe("request handling", () => {
  test("turns the API's error envelope into an ApiError", async () => {
    stubFetch(410, JSON.stringify({ error: "Gone.", code: "PROJECT_UNREACHABLE", hint: "Re-init.", details: ["a", 1] }));
    const attempt = fetchProject("demo");
    await expect(attempt).rejects.toBeInstanceOf(ApiError);
    await expect(attempt).rejects.toMatchObject({
      message: "Gone.",
      status: 410,
      code: "PROJECT_UNREACHABLE",
      hint: "Re-init.",
      details: ["a", "1"],
      runId: null,
    });
  });

  test("falls back to a readable message when the failure body is not JSON", async () => {
    stubFetch(502, "<html>Bad Gateway</html>");
    await expect(fetchHostHealth()).rejects.toMatchObject({ status: 502, code: null, message: expect.stringContaining("host") });
  });

  test("an OK response without a JSON body is still an error", async () => {
    stubFetch(200, "");
    await expect(fetchHostHealth()).rejects.toBeInstanceOf(ApiError);
  });

  test("parses a successful JSON body", async () => {
    stubFetch(200, JSON.stringify({ ok: true, running: true }));
    expect(await fetchHostHealth()).toMatchObject({ ok: true, running: true });
  });
});

describe("projectFileUrl", () => {
  test("encodes the path as a query parameter (ids are already slugs)", () => {
    expect(projectFileUrl("demo", "docs/a b.md")).toBe("/api/project/demo/file?path=docs%2Fa%20b.md");
  });
});
