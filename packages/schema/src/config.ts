import { z } from "zod";
import { AgentModeSchema } from "./agent.js";

export const PromptPackSchema = z.object({
  id: z.string(),
  title: z.string(),
  instructions: z.string(),
  file_refs: z.array(z.string()).default([]),
  mcp_reminder: z.string().nullable().optional(),
});

export const SkillProfileSchema = z.object({
  id: z.string(),
  title: z.string(),
  source: z.enum(["npm", "manual"]).default("npm"),
  package_name: z.string(),
  description: z.string().optional(),
  homepage: z.string().url().optional(),
  registry_url: z.string().url().optional(),
  latest_version: z.string().optional(),
  install_command: z.string().optional(),
  keywords: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

/**
 * A launchable agent configuration. `adapter` names an adapter manifest, which
 * supplies the binary and its invocation flags; everything here is a project-level
 * override of that.
 */
export const AgentProfileSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Adapter manifest id, e.g. "claude_code", "codex", "opencode". */
  adapter: z.string(),
  /** Override the adapter's executable name. */
  binary: z.string().optional(),
  model: z.string().optional(),
  /** Extra argv appended after the adapter's own arguments. */
  args: z.array(z.string()).default([]),
  mode: AgentModeSchema.default("pane"),
  /** Run this agent in its own git worktree so parallel agents never collide. */
  worktree: z.boolean().default(false),
  default_mcp: z.boolean().default(true),
  default_working_dir: z.enum(["project_root", "current"]).default("project_root"),
  default_env: z.record(z.string(), z.string()).default({}),
  telemetry: z
    .object({
      provider: z.string(),
      mode: z.string(),
    })
    .optional(),
});

export const HostConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(4096),
  log_retention: z.number().int().positive().default(50),
  auto_start: z.boolean().default(false),
  /** tmux session that holds this project's agent panes. */
  tmux_session: z.string().default("konductor"),
});

export const KonductorConfigSchema = z.object({
  schema_version: z.enum(["0.1.0", "0.2.0", "0.3.0"]),
  project_id: z.string(),
  project_name: z.string(),
  repo_root: z.string(),
  default_branch: z.string(),
  agent: z.object({
    primary: z.string(),
  }).optional(),
  agents: z.object({
    default_profile: z.string(),
    profiles: z.array(AgentProfileSchema),
    prompt_packs: z.array(PromptPackSchema),
    skill_profiles: z.array(SkillProfileSchema).default([]).optional(),
    tasks: z.array(
      z.object({
        id: z.string(),
        run_id: z.string(),
        status: z.enum(["running", "succeeded", "failed", "stopped"]),
        started_at: z.string().datetime(),
      })
    ).optional(),
  }).optional(),
  dashboard: z.object({
    mode: z.enum(["local"]),
  }).optional(),
  telemetry: z.object({
    provider: z.string(),
    mode: z.string(),
  }).optional(),
  host: HostConfigSchema.optional(),
});

export type KonductorConfig = z.infer<typeof KonductorConfigSchema>;
export type PromptPack = z.infer<typeof PromptPackSchema>;
export type AgentProfile = z.infer<typeof AgentProfileSchema>;
export type HostConfig = z.infer<typeof HostConfigSchema>;
export type SkillProfile = z.infer<typeof SkillProfileSchema>;
