import type { AgentAdapterManifest } from "@konductor/schema";
import { AgentAdapterManifestSchema } from "@konductor/schema";

/**
 * Adapters that ship with Konductor.
 *
 * These are plain data: adding an agent needs a manifest, not a code change. Drop a
 * JSON file into ~/.konductor/adapters/ or <repo>/.konductor/adapters/ and it is
 * picked up alongside these.
 *
 * `verified` records whether the invocation flags were checked against the real CLI.
 * Unverified adapters still run, but `konductor doctor` and `konductor adapters
 * list` flag them, so a wrong flag reads as a known gap rather than a mystery.
 *
 * On placeholders in `args`, see `resolveArgs` in ../invoke.ts.
 */
const MANIFESTS: unknown[] = [
  {
    id: "claude_code",
    title: "Claude Code",
    binary: "claude",
    homepage: "https://claude.com/claude-code",
    verified: true,
    detect: ["--version"],
    interactive: { args: ["--model", "{{model}}"] },
    headless: {
      args: ["--model", "{{model}}", "-p", "{{prompt}}", "--output-format", "json"],
    },
    resume: { args: ["--resume", "{{session_id}}"] },
    mcp: { kind: "mcp_json" },
    telemetry: { kind: "otel_env" },
    submit_key: "\r",
    ready_delay_ms: 2500,
    screen: {
      // Claude Code renders permission prompts as a bordered numbered choice list.
      blocked: [
        // Every Claude Code choice dialog ends with this footer, whatever it is
        // asking — permission, first-run trust, or MCP server approval. Matching the
        // footer rather than each question keeps this from going stale.
        "Enter to confirm",
        "Do you want to proceed\\?",
        "Do you want to make this edit",
        "Yes, and don't ask again",
        "Is this a project you created or one you trust",
      ],
      // Printed only while a turn is in flight, and it sits in the same footer as
      // the idle marker below — which is exactly why it has to win.
      working: ["esc to interrupt"],
      // The permission-mode footer sits under the input box when Claude Code is
      // waiting for you.
      idle: ["shift\\+tab to cycle", "\\? for shortcuts"],
      done: [],
    },
  },
  {
    id: "codex",
    title: "OpenAI Codex CLI",
    binary: "codex",
    homepage: "https://github.com/openai/codex",
    // Flags written from published docs; codex is not installed here.
    verified: false,
    detect: ["--version"],
    interactive: { args: ["--model", "{{model}}"] },
    headless: { args: ["exec", "--model", "{{model}}", "{{prompt}}"] },
    resume: { args: ["resume", "{{session_id}}"] },
    mcp: { kind: "codex_toml" },
    telemetry: { kind: "none" },
    submit_key: "\r",
    ready_delay_ms: 2500,
    screen: {
      blocked: ["Allow command\\?", "\\[y/n\\]", "Do you want to"],
      idle: ["send a message", "Ctrl\\+C to exit"],
      done: [],
    },
  },
  {
    id: "opencode",
    title: "OpenCode",
    binary: "opencode",
    homepage: "https://opencode.ai",
    // Flags written from published docs; opencode is not installed here.
    verified: false,
    detect: ["--version"],
    interactive: { args: ["--model", "{{model}}"] },
    headless: { args: ["run", "--model", "{{model}}", "{{prompt}}"] },
    resume: { args: ["run", "--session", "{{session_id}}"] },
    mcp: { kind: "opencode_json" },
    telemetry: { kind: "none" },
    submit_key: "\r",
    ready_delay_ms: 2500,
    screen: {
      blocked: ["permission", "Allow\\?", "\\[y/n\\]"],
      idle: ["ctrl\\+c", "/help"],
      done: [],
    },
  },
];

export function builtinAdapters(): AgentAdapterManifest[] {
  return MANIFESTS.map((raw) => AgentAdapterManifestSchema.parse(raw));
}
