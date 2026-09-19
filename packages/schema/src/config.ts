import { z } from "zod";
import { AssetManagerConfigSchema } from "./assets.js";

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
  source: z.enum(["npm", "github", "manual"]).default("npm"),
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
 * A project-owned model-service connection. This is separate from an adapter:
 * an endpoint only becomes launchable when a harness explicitly supports its
 * provider id. Credentials never live here; `auth_env` is only a reference.
 */
export const ProviderConnectionSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, "provider id must be kebab/snake case"),
  title: z.string().min(1),
  description: z.string().optional(),
  kind: z.enum(["remote_api", "local_endpoint"]),
  endpoint: z.string().url(),
  /** Provider id understood by compatible harness manifests, e.g. `ollama`. */
  provider: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  compatible_adapters: z.array(z.string()).default([]),
  models: z.array(z.object({ id: z.string().min(1), title: z.string().optional() })).default([]),
  /** Never a secret value; the host resolves this only at launch time. */
  auth_env: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),
  enabled: z.boolean().default(true),
});

/**
 * A launchable agent configuration. `adapter` names an adapter manifest, which
 * supplies the binary and its invocation flags; everything here is a project-level
 * override of that.
 *
 * `provider` and `model` are validated against the manifest at launch: a harness
 * bound to one provider (Claude Code, Codex) rejects any other, and a multi-provider
 * harness (Pi, OpenCode) uses the selected provider when launching the model.
 */
export const AgentProfileSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Adapter manifest id, e.g. "claude_code", "codex", "pi", "opencode". */
  adapter: z.string(),
  /** Override the adapter's executable name. */
  binary: z.string().optional(),
  /** Provider id from the adapter's `providers`; defaults to its first (or only) one. */
  provider: z.string().optional(),
  /** Optional project connection supplying the endpoint and credential for this profile. */
  provider_connection_id: z.string().optional(),
  /** Model id as the harness accepts it; blank means the harness's own default. */
  model: z.string().optional(),
  /** Extra argv appended after the adapter's own arguments. */
  args: z.array(z.string()).default([]),
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

/**
 * How to run a browsable instance of this project for customer review. The host
 * substitutes `{port}` in both commands and also exports the port under `port_env`.
 */
export const PreviewConfigSchema = z.object({
  command: z.string().min(1),
  /** Runs before `command` inside a fresh worktree, e.g. `bun install`. */
  install_command: z.string().optional(),
  port_env: z.string().default("PORT"),
  /** Path polled until it answers 2xx/3xx; then the preview is `ready`. */
  ready_path: z.string().default("/"),
  ready_timeout_ms: z.number().int().positive().default(60_000),
  env: z.record(z.string(), z.string()).default({}),
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
    provider_connections: z.array(ProviderConnectionSchema).default([]).optional(),
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
  assets: AssetManagerConfigSchema.optional(),
  preview: PreviewConfigSchema.optional(),
});

export type KonductorConfig = z.infer<typeof KonductorConfigSchema>;
export type PromptPack = z.infer<typeof PromptPackSchema>;
export type AgentProfile = z.infer<typeof AgentProfileSchema>;
export type HostConfig = z.infer<typeof HostConfigSchema>;
export type SkillProfile = z.infer<typeof SkillProfileSchema>;
export type ProviderConnection = z.infer<typeof ProviderConnectionSchema>;
export type PreviewConfig = z.infer<typeof PreviewConfigSchema>;
