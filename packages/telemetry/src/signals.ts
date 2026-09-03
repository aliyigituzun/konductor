import type { SignalStatus } from "@konductor/schema";

/**
 * Signal availability map — updated after running the telemetry spike.
 * See TELEMETRY_SPIKE.md for the test procedure.
 *
 * Status values:
 *   verified      — confirmed present in Claude Code OTEL output
 *   best_effort   — may be present depending on Claude Code version/config
 *   unavailable   — not exposed via OTEL in current testing
 */
export const SIGNAL_STATUS: Record<string, SignalStatus> = {
  // Token usage
  input_tokens: "verified",
  output_tokens: "verified",
  cache_read_tokens: "verified",
  cache_write_tokens: "verified",
  request_count: "verified",

  // Cost
  cost_usd: "verified",

  // Tool usage — comes from spans; not seen in spike (no tool calls in test session)
  tool_name: "best_effort",
  tool_count: "best_effort",

  // File activity (reconstructed from tool parameters)
  file_paths: "best_effort",

  // Context usage
  context_window: "unavailable",
  peak_context_tokens: "unavailable",
  peak_context_percent: "unavailable",

  // Compact count
  compact_count: "unavailable",
} as const;
