import { describe, expect, test } from "bun:test";
import { AgentAdapterManifestSchema, AgentProfileSchema } from "@konductor/schema";
import {
  buildHarnessEnv,
  AdapterInvocationError,
  buildArgv,
  buildResumeArgv,
  resolveArgs,
  resolveModel,
} from "./invoke.js";
import { builtinAdapters } from "./adapters/builtin.js";

const manifest = (overrides: Record<string, unknown> = {}) =>
  AgentAdapterManifestSchema.parse({
    id: "demo",
    title: "Demo",
    binary: "demo",
    launch: { args: ["--model", "{{model}}"] },
    resume: { args: ["resume", "{{session_id}}"] },
    providers: [{ id: "acme", title: "Acme", models: [{ id: "acme-1" }] }],
    ...overrides,
  });

const multiProvider = () =>
  manifest({
    providers: [
      { id: "anthropic", title: "Anthropic", models: [{ id: "claude-opus-5" }] },
      { id: "openai", title: "OpenAI", models: [] },
    ],
    model_format: "provider/id",
  });

describe("buildHarnessEnv", () => {
  test("removes parent Claude session markers and undefined values", () => {
    expect(buildHarnessEnv(
      { id: "claude_code" },
      {
        PATH: "/usr/bin",
        CLAUDECODE: "1",
        CLAUDE_CODE_SESSION_ID: "parent-session",
        CLAUDE_CODE_MESSAGING_TOKEN: "secret",
        CLAUDE_CODE_ENABLE_TELEMETRY: "1",
      },
      {
        KONDUCTOR_RUN_ID: "run-1",
        KONDUCTOR_FEATURE_ITEM_ID: undefined,
        CLAUDE_CONFIG_DIR: "/tmp/konductor/claude",
      },
    )).toEqual({
      PATH: "/usr/bin",
      CLAUDE_CODE_ENABLE_TELEMETRY: "1",
      KONDUCTOR_RUN_ID: "run-1",
      CLAUDE_CONFIG_DIR: "/tmp/konductor/claude",
    });
  });

  test("preserves unrelated environment for other harnesses", () => {
    expect(buildHarnessEnv(
      { id: "codex" },
      { PATH: "/usr/bin", CLAUDECODE: "1" },
      { CODEX_HOME: "/tmp/konductor/codex" },
    )).toEqual({
      PATH: "/usr/bin",
      CLAUDECODE: "1",
      CODEX_HOME: "/tmp/konductor/codex",
    });
  });
});

const profile = (overrides: Record<string, unknown> = {}) =>
  AgentProfileSchema.parse({ id: "p", title: "P", adapter: "demo", ...overrides });

describe("resolveArgs", () => {
  test("substitutes values for placeholders", () => {
    expect(resolveArgs(["--task", "{{task_file}}"], { task_file: "/tmp/brief.md" })).toEqual([
      "--task",
      "/tmp/brief.md",
    ]);
  });

  test("drops an unfilled placeholder together with the flag it belonged to", () => {
    expect(resolveArgs(["exec", "--model", "{{model}}", "--verbose"], {})).toEqual([
      "exec",
      "--verbose",
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

describe("resolveModel", () => {
  test("defaults to the adapter's only provider and the harness's default model", () => {
    const selection = resolveModel(manifest(), profile());
    expect(selection.provider.id).toBe("acme");
    expect(selection.model).toBeNull();
    expect(selection.argument).toBeNull();
  });

  test("passes the profile's model through for a single-provider harness", () => {
    expect(resolveModel(manifest(), profile({ model: "acme-1" })).argument).toBe("acme-1");
  });

  test("accepts a model that is not in the catalog", () => {
    // Providers ship models faster than manifests are updated.
    expect(resolveModel(manifest(), profile({ model: "acme-9-preview" })).argument).toBe(
      "acme-9-preview",
    );
  });

  test("rejects another provider on a harness bound to one", () => {
    expect(() => resolveModel(manifest(), profile({ provider: "openai" }))).toThrow(
      /only runs on Acme/,
    );
    expect(() => resolveModel(manifest(), profile({ provider: "openai" }))).toThrow(
      AdapterInvocationError,
    );
  });

  test("rejects an unknown provider on a multi-provider harness", () => {
    expect(() => resolveModel(multiProvider(), profile({ provider: "mistral" }))).toThrow(
      /Choose one of: anthropic, openai/,
    );
  });

  test("prefixes the provider when the harness addresses models that way", () => {
    const selection = resolveModel(
      multiProvider(),
      profile({ provider: "openai", model: "gpt-5" }),
    );
    expect(selection.provider.id).toBe("openai");
    expect(selection.argument).toBe("openai/gpt-5");
  });

  test("explicit overrides win over the profile", () => {
    const selection = resolveModel(
      multiProvider(),
      profile({ provider: "anthropic", model: "claude-opus-5" }),
      { provider: "openai", model: "gpt-5" },
    );
    expect(selection.argument).toBe("openai/gpt-5");
  });
});

describe("buildArgv", () => {
  test("builds the launch invocation with the resolved model", () => {
    expect(buildArgv(manifest(), profile(), { model: "acme-1" })).toEqual([
      "demo",
      "--model",
      "acme-1",
    ]);
  });

  test("substitutes a provider independently of the model", () => {
    expect(
      buildArgv(
        manifest({ launch: { args: ["--provider", "{{provider}}", "--model", "{{model}}"] } }),
        profile(),
        { provider: "acme" },
      ),
    ).toEqual(["demo", "--provider", "acme"]);
  });

  test("omits the model flag entirely when no model is pinned", () => {
    expect(buildArgv(manifest(), profile())).toEqual(["demo"]);
  });

  test("appends the profile's extra args last", () => {
    expect(buildArgv(manifest(), profile({ args: ["--verbose"] }))).toEqual([
      "demo",
      "--verbose",
    ]);
  });

  test("inserts Konductor runtime flags before profile arguments", () => {
    expect(
      buildArgv(
        manifest(),
        profile({ args: ["--verbose"] }),
        { model: "acme-1" },
        ["--mcp-config", "/tmp/konductor/mcp.json"],
      ),
    ).toEqual([
      "demo",
      "--model",
      "acme-1",
      "--mcp-config",
      "/tmp/konductor/mcp.json",
      "--verbose",
    ]);
  });

  test("lets a profile override the adapter's binary", () => {
    expect(buildArgv(manifest(), profile({ binary: "/opt/demo" }))).toEqual(["/opt/demo"]);
  });

  test("passes the task file as one argv entry when the launch args ask for it", () => {
    const argv = buildArgv(
      manifest({ launch: { args: ["--brief", "{{task_file}}"] } }),
      profile(),
      { task_file: "/repo/.konductor/tasks/r1.md" },
    );
    expect(argv).toEqual(["demo", "--brief", "/repo/.konductor/tasks/r1.md"]);
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
  const byId = (id: string) => adapters.find((a) => a.id === id)!;

  test("ships claude_code, codex, gemini_cli, opencode and pi", () => {
    expect(adapters.map((a) => a.id).sort()).toEqual([
      "claude_code",
      "codex",
      "gemini_cli",
      "opencode",
      "pi",
    ]);
  });

  test("only adapters checked against the real CLI are marked verified", () => {
    const verified = adapters.filter((a) => a.verified).map((a) => a.id);
    expect(verified).toEqual(["claude_code"]);
  });

  test("vendor CLIs are bound to their own provider", () => {
    expect(byId("claude_code").providers.map((p) => p.id)).toEqual(["anthropic"]);
    expect(byId("codex").providers.map((p) => p.id)).toEqual(["openai"]);
    expect(byId("gemini_cli").providers.map((p) => p.id)).toEqual(["google"]);
  });

  test("claude_code refuses to run on another provider", () => {
    expect(() =>
      resolveModel(byId("claude_code"), profile({ adapter: "claude_code", provider: "openai" })),
    ).toThrow(/only runs on Anthropic/);
  });

  test("opencode routes to several providers and prefixes the model", () => {
    const opencode = byId("opencode");
    expect(opencode.providers.length).toBeGreaterThan(1);
    const selection = resolveModel(
      opencode,
      profile({ adapter: "opencode", provider: "google", model: "gemini-2.5-pro" }),
    );
    expect(selection.argument).toBe("google/gemini-2.5-pro");
    expect(buildArgv(opencode, profile(), { model: selection.argument! })).toEqual([
      "opencode",
      "--model",
      "google/gemini-2.5-pro",
    ]);
  });

  test("pi passes provider and model as separate documented flags", () => {
    const pi = byId("pi");
    const selection = resolveModel(
      pi,
      profile({ adapter: "pi", provider: "openai", model: "gpt-5" }),
    );
    expect(selection.argument).toBe("gpt-5");
    expect(buildArgv(pi, profile(), {
      provider: selection.provider.id,
      model: selection.argument!,
    })).toEqual(["pi", "--provider", "openai", "--model", "gpt-5"]);
    expect(buildArgv(pi, profile(), { provider: "openai" })).toEqual([
      "pi",
      "--provider",
      "openai",
    ]);
    expect(buildResumeArgv(pi, profile(), "session-123")).toEqual([
      "pi",
      "--session",
      "session-123",
    ]);
  });

  test("claude_code launches the TUI with the pinned model", () => {
    const claude = byId("claude_code");
    const selection = resolveModel(claude, profile({ model: "claude-opus-5" }));
    expect(buildArgv(claude, profile(), { model: selection.argument! })).toEqual([
      "claude",
      "--model",
      "claude-opus-5",
    ]);
  });

  test("every catalog model has a non-empty id", () => {
    for (const adapter of adapters) {
      for (const provider of adapter.providers) {
        for (const model of provider.models) expect(model.id.length).toBeGreaterThan(0);
      }
    }
  });

  test("every built-in screen pattern is a valid regex", () => {
    for (const adapter of adapters) {
      const all = [
        ...adapter.screen.blocked,
        ...adapter.screen.working,
        ...adapter.screen.idle,
        ...adapter.screen.done,
      ];
      for (const source of all) {
        expect(() => new RegExp(source, "i")).not.toThrow();
      }
    }
  });
});
