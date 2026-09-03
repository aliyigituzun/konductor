import { z } from "zod";
import { RunSourceSchema } from "./run.js";

export const SignalStatusSchema = z.enum(["verified", "best_effort", "unavailable"]);

export const TelemetrySnapshotSchema = z.object({
  schema_version: z.enum(["0.1.0", "0.2.0"]),
  captured_at: z.string().datetime(),
  session_id: z.string().nullable(),
  project_id: z.string(),
  profile_id: z.string().nullable().optional(),
  run_id: z.string().nullable().optional(),
  source: RunSourceSchema.optional(),
  input_tokens: z.number().int().nonnegative().nullable(),
  output_tokens: z.number().int().nonnegative().nullable(),
  cache_read_tokens: z.number().int().nonnegative().nullable(),
  cache_write_tokens: z.number().int().nonnegative().nullable(),
  request_count: z.number().int().nonnegative().nullable(),
  top_tools: z.array(
    z.object({
      name: z.string(),
      count: z.number().int().nonnegative(),
      signal_status: SignalStatusSchema,
    })
  ),
  top_files: z.array(
    z.object({
      path: z.string(),
      reads: z.number().int().nonnegative(),
      writes: z.number().int().nonnegative(),
      signal_status: SignalStatusSchema,
    })
  ),
  context_window: z.number().int().nonnegative().nullable(),
  peak_context_tokens: z.number().int().nonnegative().nullable(),
  peak_context_percent: z.number().min(0).max(1).nullable(),
  compact_count: z.number().int().nonnegative().nullable(),
  cost_usd: z.number().nonnegative().nullable(),
  signal_availability: z.record(z.string(), SignalStatusSchema),
});

export const SyncHistoryEntrySchema = z.object({
  schema_version: z.enum(["0.1.0", "0.2.0"]),
  synced_at: z.string().datetime(),
  project_id: z.string(),
  status_snapshot_path: z.string(),
  telemetry_snapshot_path: z.string().nullable(),
  summary: z.string().nullable(),
});

export type SignalStatus = z.infer<typeof SignalStatusSchema>;
export type TelemetrySnapshot = z.infer<typeof TelemetrySnapshotSchema>;
export type SyncHistoryEntry = z.infer<typeof SyncHistoryEntrySchema>;
