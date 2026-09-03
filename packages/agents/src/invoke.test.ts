import { describe, expect, test } from "bun:test";
import { AgentAdapterManifestSchema, AgentProfileSchema } from "@konductor/schema";
import { AdapterInvocationError, buildArgv, buildResumeArgv, resolveArgs } from "./invoke.js";
import { builtinAdapters } from "./adapters/builtin.js";

const manifest = (overrides: Record<string, unknown> = {}) =>
  AgentAdapterManifestSchema.parse({
    id: "demo",
    title: "Demo",
    binary: "demo",
    interactive: { args: ["--model", "{{model}}"] },
    headless: { args: ["exec", "--model", "{{model}}", "{{prompt}}"] },
    resume: { args: ["resume", "{{session_id}}"] },
    ...overrides,
  });

const profile = (overrides: Record<string, unknown> = {}) =>
  AgentProfileSchema.parse({ id: "p", title: "P", adapter: "demo", ...overrides });

describe("resolveArgs", () => {
  test("substitutes values for placeholders", () => {
    expect(resolveArgs(["-p", "{{prompt}}"], { prompt: "do the thing" })).toEqual([
      "-p",
      "do the thing",
    ]);
  });

  test("drops an unfilled placeholder together with the flag it belonged to", () => {
    expect(resolveArgs(["exec", "--model", "{{model}}", "{{prompt}}"], { prompt: "go" })).toEqual([
      "exec",
      "go",
    ]);
  });

  test("keeps a preceding positional argument when dropping a placeholder", () => {
    // "exec" is not a flag, so it must survive even though the placeholder after it went.
    expect(resolveArgs(["exec", "{{session_id}}"], {})).toEqual(["exec"]);
  });

  test("treats an empty string as absent", () => {
    expect(resolveArgs(["--model", "{{model}}"], { model: "" })).toEqual([]);
  });

  test("leaves literal arguments untouched", () => {
    expect(resolveArgs(["--output-format", "json"], {})).toEqual(["--output-format", "json"]);
  });
});

describe("buildArgv", () => {
  test("builds an interactive invocation with the profile's model", () => {
    expect(buildArgv(manifest(), profile({ model: "opus" }), "pane")).toEqual([
      "demo",
      "--model",
      "opus",
    ]);
  });

  test("omits the model flag entirely when no model is pinned", () => {
    expect(buildArgv(manifest(), profile(), "pane")).toEqual(["demo"]);
  });

  test("passes the prompt as one argv entry, never shell-quoted", () => {
    const argv = buildArgv(manifest(), profile(), "headless", {
      prompt: "fix 'quotes' and $VARS; rm -rf /",
    });
    expect(argv).toEqual(["demo", "exec", "fix 'quotes' and $VARS; rm -rf /"]);
  });

  test("appends the profile's extra args last", () => {
    expect(buildArgv(manifest(), profile({ args: ["--verbose"] }), "pane")).toEqual([
      "demo",
      "--verbose",
    ]);
  });

  test("lets a profile override the adapter's binary", () => {
    expect(buildArgv(manifest(), profile({ binary: "/opt/demo" }), "pane")).toEqual(["/opt/demo"]);
  });

  test("explicit call values win over the profile's model", () => {
    expect(buildArgv(manifest(), profile({ model: "opus" }), "pane", { model: "haiku" })).toEqual([
      "demo",
      "--model",
      "haiku",
    ]);
  });

  test("rejects a mode the adapter does not support", () => {
    expect(() => buildArgv(manifest({ interactive: null }), profile(), "pane")).toThrow(
      AdapterInvocationError,
    );
  });

  test("rejects a headless run with no prompt", () => {
    expect(() => buildArgv(manifest(), profile(), "headless")).toThrow(AdapterInvocationError);
  });
});

describe("buildResumeArgv", () => {
  test("builds a resume invocation", () => {
    expect(buildResumeArgv(manifest(), profile(), "sess-1")).toEqual(["demo", "resume", "sess-1"]);
  });

  test("returns null when the adapter cannot resume", () => {
    expect(buildResumeArgv(manifest({ resume: null }), profile(), "sess-1")).toBeNull();
  });
});

describe("builtin adapters", () => {
  const adapters = builtinAdapters();

  test("ships claude_code, codex and opencode", () => {
    expect(adapters.map((a) => a.id).sort()).toEqual(["claude_code", "codex", "opencode"]);
  });

  test("every built-in declares both an interactive and a headless mode", () => {
    for (const adapter of adapters) {
      expect(adapter.interactive).not.toBeNull();
      expect(adapter.headless).not.toBeNull();
    }
  });

  test("only adapters checked against the real CLI are marked verified", () => {
    const verified = adapters.filter((a) => a.verified).map((a) => a.id);
    expect(verified).toEqual(["claude_code"]);
  });

  test("claude_code produces the documented headless invocation", () => {
    const claude = adapters.find((a) => a.id === "claude_code")!;
    const argv = buildArgv(
      claude,
      profile({ adapter: "claude_code" }),
      "headless",
      { prompt: "ship it" },
    );
    expect(argv).toEqual(["claude", "-p", "ship it", "--output-format", "json"]);
  });

  test("every built-in screen pattern is a valid regex", () => {
    for (const adapter of adapters) {
      const all = [...adapter.screen.blocked, ...adapter.screen.idle, ...adapter.screen.done];
      for (const source of all) {
        expect(() => new RegExp(source, "i")).not.toThrow();
      }
    }
  });
});
