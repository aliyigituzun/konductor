import { z } from "zod";
import { AgentStatusSchema, AgentTransportSchema } from "./agent.js";

export const RunSourceSchema = z.enum(["dashboard", "cli"]);
export const RunStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "stopped"]);
export const RunTaskStateSchema = z.enum(["started", "completed", "failed", "stopped"]);

export const RunContextSchema = z.object({
  run_id: z.string(),
  profile_id: z.string(),
  feature_item_id: z.string().nullable().optional(),
  source: RunSourceSchema,
});

export const RunSummarySchema = z.object({
  schema_version: z.enum(["0.1.0", "0.2.0", "0.3.0"]),
  id: z.string(),
  project_id: z.string(),
  repo_path: z.string(),
  profile_id: z.string(),
  profile_title: z.string(),
  /** Adapter manifest that drove this run. */
  adapter_id: z.string(),
  /** Short human-addressable name, unique among live agents. */
  slug: z.string(),
  transport: AgentTransportSchema.default("headless"),
  /** tmux session and pane, when transport is "tmux". */
  session_name: z.string().nullable().default(null),
  pane_id: z.string().nullable().default(null),
  /** Last observed live status; null once the run is finalized. */
  agent_status: AgentStatusSchema.nullable().default(null),
  /** Isolated checkout this agent worked in, when the profile requested one. */
  worktree_path: z.string().nullable().default(null),
  branch: z.string().nullable().default(null),
  feature_item_id: z.string().nullable(),
  feature_item_title: z.string().nullable().optional(),
  prompt_excerpt: z.string(),
  prompt_packs: z.array(z.string()),
  source: RunSourceSchema,
  command: z.string(),
  env_summary: z.record(z.string(), z.string()),
  working_directory: z.string().optional(),
  status: RunStatusSchema,
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().nullable(),
  exit_code: z.number().int().nullable(),
  log_path: z.string(),
  repo_log_path: z.string().nullable(),
  status_write_count: z.number().int().nonnegative().default(0),
  update_count: z.number().int().nonnegative().default(0),
  last_status_at: z.string().datetime().nullable().optional(),
  last_error: z.string().nullable().optional(),
  terminal_preview: z.string().default(""),
});

export const HostStateSchema = z.object({
  schema_version: z.enum(["0.1.0", "0.2.0", "0.3.0"]),
  host_id: z.string(),
  started_at: z.string().datetime(),
  port: z.number().int().min(1).max(65535),
  pid: z.number().int().nullable(),
});

export const ProjectImportantPathsSchema = z.object({
  repo_root: z.string(),
  config_path: z.string(),
  konductor_dir: z.string(),
  status_path: z.string(),
  updates_path: z.string(),
  telemetry_path: z.string(),
  history_dir: z.string(),
  runs_dir: z.string(),
  registry_path: z.string(),
  host_dir: z.string(),
});

export type RunSource = z.infer<typeof RunSourceSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type RunTaskState = z.infer<typeof RunTaskStateSchema>;
export type RunContext = z.infer<typeof RunContextSchema>;
export type RunSummary = z.infer<typeof RunSummarySchema>;
export type HostState = z.infer<typeof HostStateSchema>;
export type ProjectImportantPaths = z.infer<typeof ProjectImportantPathsSchema>;
