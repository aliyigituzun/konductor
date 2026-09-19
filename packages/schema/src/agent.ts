import { z } from "zod";

/**
 * What backs a live agent.
 *
 * Every agent Konductor starts runs interactively in a tmux pane: Konductor types
 * into it, reads its screen, and the operator can attach to take over. `headless`
 * survives only so run history recorded by the retired one-shot pipe mode still
 * parses; nothing launches that way any more.
 */
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
  /** `~/.gemini/settings.json`, `"mcpServers"` key. */
  z.object({ kind: z.literal("gemini_settings") }),
  /** Pi with the pi-mcp-adapter package, using `$PI_CODING_AGENT_DIR/mcp.json`. */
  z.object({ kind: z.literal("pi_mcp_json") }),
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
 *   {{provider}}    the resolved provider id (the entry, and the flag before it,
 *                   are dropped when no provider is supplied)
 *   {{model}}       the resolved model string (the entry, and the flag before it,
 *                   are dropped when the profile pins no model)
 *   {{session_id}}  prior session to resume
 *   {{task_file}}   path to the brief written into the working directory
 */
export const AdapterInvocationSchema = z.object({
  args: z.array(z.string()).default([]),
});

/** A model the operator can pick for a provider. Ids are what the CLI accepts. */
export const ModelOptionSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
});

/**
 * A model provider a harness can talk to, with the models it is known to accept.
 *
 * `models` is a catalog for the picker, not a whitelist: providers ship models
 * faster than a manifest can be updated, so a profile may name any model id and
 * the harness decides whether it exists.
 */
export const AdapterProviderSchema = z.object({
  /** Stable id referenced by a profile's `provider` field, e.g. "anthropic". */
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, "provider id must be kebab/snake case"),
  title: z.string(),
  models: z.array(ModelOptionSchema).default([]),
});

/**
 * How the chosen provider and model are turned into the `{{model}}` argument.
 *
 * - `id`            the bare model id; the harness already knows its provider or
 *                   receives it through a separate `{{provider}}` argument
 *                   (Claude Code, Codex, Gemini CLI, Pi).
 * - `provider/id`   the provider prefixed onto the model, which is how
 *                   multi-provider harnesses such as OpenCode address models.
 */
export const ModelFormatSchema = z.enum(["id", "provider/id"]);

const AgentAdapterManifestCurrentSchema = z.object({
  schema_version: z.enum(["0.4.0"]).default("0.4.0"),
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
  /** The interactive TUI invocation that opens in the agent's pane. */
  launch: AdapterInvocationSchema.default({ args: [] }),
  /** Resume a previous session. Null when unsupported. */
  resume: AdapterInvocationSchema.nullable().default(null),
  /**
   * Providers this harness can drive. A single entry means the harness is bound to
   * that provider — Claude Code only ever talks to Anthropic — and a profile that
   * names any other provider is rejected at launch.
   */
  providers: z.array(AdapterProviderSchema).min(1, "an adapter needs at least one provider"),
  model_format: ModelFormatSchema.default("id"),
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

/**
 * Keep project/user adapter manifests from the pane/headless era usable.
 *
 * Version 0.3 did not declare providers and named the interactive invocation
 * `interactive`. A neutral default provider preserves the old pass-through model
 * behavior until the operator chooses to enrich the manifest.
 */
export const AgentAdapterManifestSchema = z.preprocess((input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const value = input as Record<string, unknown>;
  if (value.schema_version !== "0.3.0") return input;
  return {
    ...value,
    schema_version: "0.4.0",
    launch: value.launch ?? value.interactive ?? value.headless ?? { args: [] },
    providers: value.providers ?? [{ id: "default", title: "Default", models: [] }],
  };
}, AgentAdapterManifestCurrentSchema);

/** A live agent's addressable handle: the tmux pane it runs in. */
export const AgentHandleSchema = z.object({
  slug: z.string(),
  run_id: z.string(),
  session_name: z.string(),
  window_id: z.string(),
  pane_id: z.string(),
});

export type AgentTransport = z.infer<typeof AgentTransportSchema>;
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export type AdapterMcp = z.infer<typeof AdapterMcpSchema>;
export type AdapterTelemetry = z.infer<typeof AdapterTelemetrySchema>;
export type AdapterInvocation = z.infer<typeof AdapterInvocationSchema>;
export type ModelOption = z.infer<typeof ModelOptionSchema>;
export type AdapterProvider = z.infer<typeof AdapterProviderSchema>;
export type ModelFormat = z.infer<typeof ModelFormatSchema>;
export type AgentAdapterManifest = z.infer<typeof AgentAdapterManifestSchema>;
export type AgentHandle = z.infer<typeof AgentHandleSchema>;
