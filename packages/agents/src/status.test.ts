import { describe, expect, test } from "bun:test";
import { AgentAdapterManifestSchema } from "@konductor/schema";
import { classifyScreen } from "./status.js";
import { builtinAdapters } from "./adapters/builtin.js";

const claude = builtinAdapters().find((a) => a.id === "claude_code")!;
const pi = builtinAdapters().find((a) => a.id === "pi")!;

// A real Claude Code permission prompt, as it renders at the bottom of the pane.
const BLOCKED_SCREEN = `
● I'll update the config file now.

╭──────────────────────────────────────────╮
│ Edit file                                │
│ konductor.config.json                    │
│                                          │
│ Do you want to make this edit?           │
│ ❯ 1. Yes                                 │
│   2. Yes, and don't ask again            │
│   3. No, tell Claude what to do instead  │
╰──────────────────────────────────────────╯
`.trim();

// Captured from a real Claude Code pane sitting at its input box.
const IDLE_SCREEN = `
● Done. The tests pass.

────────────────────────────────────────────────────────────────
❯
────────────────────────────────────────────────────────────────
  ⏵⏵ auto mode on (shift+tab to cycle) · ← 1 agent
`.trim();

const WORKING_SCREEN = `
● Reading packages/host/src/server.ts…
  Read 1082 lines
✻ Thinking… (esc to interrupt)
`.trim();

describe("classifyScreen", () => {
  test("reports done when the process has exited", () => {
    const result = classifyScreen(claude, {
      screen: WORKING_SCREEN,
      alive: false,
      exitCode: 0,
      changed: false,
    });
    expect(result.status).toBe("done");
    expect(result.reason).toContain("code 0");
  });

  test("detects a visible permission prompt as blocked", () => {
    const result = classifyScreen(claude, {
      screen: BLOCKED_SCREEN,
      alive: true,
      changed: false,
    });
    expect(result.status).toBe("blocked");
    expect(result.matched).not.toBeNull();
  });

  test("blocked wins even while the screen is still changing", () => {
    const result = classifyScreen(claude, {
      screen: BLOCKED_SCREEN,
      alive: true,
      changed: true,
    });
    expect(result.status).toBe("blocked");
  });

  test("reports working while output keeps changing", () => {
    const result = classifyScreen(claude, {
      screen: WORKING_SCREEN,
      alive: true,
      changed: true,
    });
    expect(result.status).toBe("working");
  });

  test("reports idle only when the screen is quiet and the prompt is visible", () => {
    const result = classifyScreen(claude, {
      screen: IDLE_SCREEN,
      alive: true,
      changed: false,
    });
    expect(result.status).toBe("idle");
  });

  test("a quiet screen with no prompt visible stays working, not idle", () => {
    // A long tool call produces no output for a while; calling that "idle" would
    // have the operator hand it a new task mid-run.
    const result = classifyScreen(claude, {
      screen: "  Running tests…",
      alive: true,
      changed: false,
    });
    expect(result.status).toBe("working");
  });

  test("only the tail of the screen is considered", () => {
    // A permission prompt that has scrolled far up is stale and must not fire.
    const scrolled = [BLOCKED_SCREEN, ...Array.from({ length: 40 }, (_, i) => `line ${i}`)].join("\n");
    const result = classifyScreen(claude, { screen: scrolled, alive: true, changed: false });
    expect(result.status).not.toBe("blocked");
  });

  test("a malformed pattern in a user manifest does not throw", () => {
    const broken = AgentAdapterManifestSchema.parse({
      id: "broken",
      title: "Broken",
      binary: "broken",
      providers: [{ id: "acme", title: "Acme" }],
      screen: { blocked: ["(unclosed"], idle: [], done: [] },
    });
    expect(() =>
      classifyScreen(broken, { screen: "anything", alive: true, changed: false }),
    ).not.toThrow();
  });
});

// A first-run trust prompt looks nothing like a permission prompt, but it blocks the
// agent just the same, and typing a task into it answers it.
const TRUST_SCREEN = `
 Accessing workspace:
 /tmp/demo

 Quick safety check: Is this a project you created or one you trust?
 ❯ No, exit
   Yes, I trust this folder
 Enter to confirm · Esc to cancel
`.trim();

describe("first-run trust prompt", () => {
  test("is classified as blocked, not idle", () => {
    const result = classifyScreen(claude, {
      screen: TRUST_SCREEN,
      alive: true,
      changed: false,
    });
    expect(result.status).toBe("blocked");
  });
});

describe("exit codes", () => {
  test("a non-zero exit is carried through, not flattened to success", () => {
    const result = classifyScreen(claude, {
      screen: TRUST_SCREEN,
      alive: false,
      exitCode: 1,
      changed: false,
    });
    expect(result.status).toBe("done");
    expect(result.exit_code).toBe(1);
  });

  test("a missing exit status stays null rather than becoming zero", () => {
    const result = classifyScreen(claude, {
      screen: "",
      alive: false,
      exitCode: null,
      changed: false,
    });
    expect(result.exit_code).toBeNull();
  });

  test("a running agent has no exit code", () => {
    expect(
      classifyScreen(claude, { screen: WORKING_SCREEN, alive: true, changed: true }).exit_code,
    ).toBeNull();
  });
});

// The MCP-approval prompt is worded nothing like a permission prompt, but it carries
// the same dialog footer, which is why the footer is what the adapter matches on.
const MCP_PROMPT_SCREEN = `
  New MCP server found in this project: konductor
  MCP servers may execute code or access system resources.
    Use this MCP server
    Use this and all future MCP servers in this project
  \u276f Continue without using this MCP server
  Enter to confirm \u00b7 Esc to cancel
`.trim();

describe("dialog footer detection", () => {
  test("an MCP approval prompt blocks, even though its wording is unique", () => {
    const result = classifyScreen(claude, {
      screen: MCP_PROMPT_SCREEN,
      alive: true,
      changed: false,
    });
    expect(result.status).toBe("blocked");
    expect(result.matched).toBe("Enter to confirm");
  });
});

describe("working vs idle", () => {
  test('"esc to interrupt" on a quiet screen is working, not idle', () => {
    // Claude Code prints this while a turn is in flight. A slow tool call leaves the
    // screen unchanged; calling that idle would hand a busy agent a second task.
    const result = classifyScreen(claude, {
      screen: "✻ Thinking… (esc to interrupt)",
      alive: true,
      changed: false,
    });
    expect(result.status).toBe("working");
  });

  test("a busy marker outranks the idle prompt sharing its footer", () => {
    // Captured from a real pane mid-turn: both markers are on screen at once.
    const busyWithPrompt = `
✽ Perambulating… (14s · ↓ 527 tokens)
────────────────────────────────────────────
❯
────────────────────────────────────────────
  ⏵⏵ auto mode on (shift+tab to cycle) · esc to interrupt · ← 1 agent
`.trim();
    const result = classifyScreen(claude, {
      screen: busyWithPrompt,
      alive: true,
      changed: false,
    });
    expect(result.status).toBe("working");
    expect(result.matched).toBe("esc to interrupt");
  });
});

describe("Pi screen detection", () => {
  const footer = `
~/work/konductor (main)
4.2%/200k (auto)                                      (openai) gpt-5
`.trim();

  test("recognizes Pi's stable context footer as ready for input", () => {
    const result = classifyScreen(pi, {
      screen: footer,
      alive: true,
      changed: false,
    });
    expect(result.status).toBe("idle");
  });

  test("Pi's working indicator outranks its always-visible footer", () => {
    const result = classifyScreen(pi, {
      screen: `Working\n${footer}`,
      alive: true,
      changed: false,
    });
    expect(result.status).toBe("working");
    expect(result.matched).toBe("\\bWorking\\b");
  });
});
