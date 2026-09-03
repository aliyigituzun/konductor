import { z } from "zod";

/**
 * How an agent process is driven.
 *
 * - `pane`     the agent runs interactively in a tmux pane. Konductor can type into
 *              it, read its screen, and the operator can `tmux attach` to take over.
 * - `headless` the agent runs once, non-interactively, over pipes and exits.
 */
export const AgentModeSchema = z.enum(["pane", "headless"]);

/** The transport backing a live agent. Mirrors AgentMode, named for the mechanism. */
export const AgentTransportSchema = z.enum(["tmux", "headless"]);

/**
 * Lifecycle of a live agent, as observed from outside the process.
 *
 * `blocked` is deliberately narrow: it means a known approval/permission prompt is
 * visible right now, not merely that the agent is quiet.
 */
export const AgentStatusSchema = z.enum([
  "starting",
  "working",
  "idle",
  "blocked",
  "done",
  "dead",
]);

/**
 * Where an adapter's MCP servers are configured. Konductor writes its own MCP server
 * into this file so the agent can call write_update / write_status.
 */
export const AdapterMcpSchema = z.discriminatedUnion("kind", [
  /** `<repo>/.mcp.json` — the convention Claude Code reads. */
  z.object({ kind: z.literal("mcp_json") }),
  /** `~/.codex/config.toml`, `[mcp_servers.<name>]`. */
  z.object({ kind: z.literal("codex_toml") }),
  /** `<repo>/opencode.json`, `"mcp"` key. */
  z.object({ kind: z.literal("opencode_json") }),
  /** The agent has no MCP support, or Konductor should not touch its config. */
  z.object({ kind: z.literal("none") }),
]);

/** Whether Konductor can collect telemetry from this agent. */
export const AdapterTelemetrySchema = z.discriminatedUnion("kind", [
  /** Agent emits OpenTelemetry when the standard OTLP env vars are set. */
  z.object({ kind: z.literal("otel_env") }),
  z.object({ kind: z.literal("none") }),
]);

/**
 * One way of invoking the adapter's binary.
 *
 * `args` may contain placeholders, substituted at launch:
 *   {{prompt}}      the composed prompt text
 *   {{model}}       the resolved model id (the entry is dropped when no model is set)
 *   {{session_id}}  prior session to resume
 *   {{task_file}}   path to the brief written into the working directory
 */
export const AdapterInvocationSchema = z.object({
  args: z.array(z.string()).default([]),
});

export const AgentAdapterManifestSchema = z.object({
  schema_version: z.enum(["0.3.0"]).default("0.3.0"),
  /** Stable id referenced by an agent profile's `adapter` field. */
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, "adapter id must be kebab/snake case"),
  title: z.string(),
  /** Executable name resolved on PATH; a profile may override it. */
  binary: z.string(),
  homepage: z.string().url().optional(),
  /**
   * False when the invocation flags have not been checked against the real CLI.
   * `konductor doctor` and `konductor adapters list` surface this rather than
   * silently mis-invoking a binary.
   */
  verified: z.boolean().default(false),
  /** Argv that prints a version string, used for detection. */
  detect: z.array(z.string()).default(["--version"]),
  /** Interactive TUI invocation. Null when the agent has no interactive mode. */
  interactive: AdapterInvocationSchema.nullable().default(null),
  /** One-shot invocation. Null when the agent has no headless mode. */
  headless: AdapterInvocationSchema.nullable().default(null),
  /** Resume a previous session. Null when unsupported. */
  resume: AdapterInvocationSchema.nullable().default(null),
  mcp: AdapterMcpSchema.default({ kind: "none" }),
  telemetry: AdapterTelemetrySchema.default({ kind: "none" }),
  /**
   * Keys that submit the agent's input box. A bare Enter does not submit in every
   * TUI, so this is configurable; "\r" (carriage return) works for most.
   */
  submit_key: z.string().default("\r"),
  /** How long to wait after spawning before typing into the pane. */
  ready_delay_ms: z.number().int().nonnegative().default(2000),
  /**
   * Regex sources matched against the tail of the agent's screen to classify status.
   *
   * Precedence is blocked > done > working > idle. `working` exists because an
   * agent's input box stays on screen while it is mid-turn, so the presence of a
   * prompt is not evidence that it is free — a positive busy marker is.
   */
  screen: z
    .object({
      blocked: z.array(z.string()).default([]),
      working: z.array(z.string()).default([]),
      idle: z.array(z.string()).default([]),
      done: z.array(z.string()).default([]),
    })
    .default({ blocked: [], working: [], idle: [], done: [] }),
});

/** A live agent's addressable handle. */
export const AgentHandleSchema = z.object({
  slug: z.string(),
  run_id: z.string(),
  transport: AgentTransportSchema,
  /** tmux session holding the pane, when transport is "tmux". */
  session_name: z.string().nullable().default(null),
  /** Durable tmux pane id, e.g. "%12". */
  pane_id: z.string().nullable().default(null),
  /** OS pid, when transport is "headless". */
  pid: z.number().int().nullable().default(null),
});

export type AgentMode = z.infer<typeof AgentModeSchema>;
export type AgentTransport = z.infer<typeof AgentTransportSchema>;
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export type AdapterMcp = z.infer<typeof AdapterMcpSchema>;
export type AdapterTelemetry = z.infer<typeof AdapterTelemetrySchema>;
export type AdapterInvocation = z.infer<typeof AdapterInvocationSchema>;
export type AgentAdapterManifest = z.infer<typeof AgentAdapterManifestSchema>;
export type AgentHandle = z.infer<typeof AgentHandleSchema>;
