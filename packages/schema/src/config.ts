import { z } from "zod";

export const PromptPackSchema = z.object({
  id: z.string(),
  title: z.string(),
  instructions: z.string(),
  file_refs: z.array(z.string()).default([]),
  mcp_reminder: z.string().nullable().optional(),
});

export const TokenProviderSchema = z.enum(["openai", "minimax"]);

export const ProjectTokenSchema = z.object({
  id: z.string(),
  title: z.string(),
  provider: TokenProviderSchema,
  token: z.string().min(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const ProjectTokensFileSchema = z.object({
  schema_version: z.enum(["0.2.0"]),
  tokens: z.array(ProjectTokenSchema).default([]),
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

const ClaudeAgentProfileSchema = z.object({
  id: z.string(),
  title: z.string(),
  runner: z.literal("claude_code"),
  model: z.string().optional(),
  binary: z.string(),
  args: z.array(z.string()).default([]),
  default_mcp: z.boolean().default(true),
  default_working_dir: z.enum(["project_root", "current"]).default("project_root"),
  default_env: z.record(z.string(), z.string()).default({}),
  telemetry: z.object({
    provider: z.string(),
    mode: z.string(),
  }),
});

const OpenAIAgentProfileSchema = z.object({
  id: z.string(),
  title: z.string(),
  runner: z.literal("openai"),
  model: z.string().default("gpt-4.1-mini"),
  api_base: z.string().url().optional(),
  api_key_env: z.string().default("OPENAI_API_KEY"),
  token_id: z.string().optional(),
  temperature: z.number().min(0).max(2).default(0.2),
  default_mcp: z.boolean().default(false),
  default_working_dir: z.enum(["project_root", "current"]).default("project_root"),
  default_env: z.record(z.string(), z.string()).default({}),
  telemetry: z.object({
    provider: z.string(),
    mode: z.string(),
  }),
});

const MinimaxAgentProfileSchema = z.object({
  id: z.string(),
  title: z.string(),
  runner: z.literal("minimax"),
  model: z.string().default("minimax-1"),
  api_base: z.string().url().optional(),
  api_key_env: z.string().default("MINIMAX_API_KEY"),
  token_id: z.string().optional(),
  temperature: z.number().min(0).max(2).default(0.2),
  default_mcp: z.boolean().default(false),
  default_working_dir: z.enum(["project_root", "current"]).default("project_root"),
  default_env: z.record(z.string(), z.string()).default({}),
  telemetry: z.object({
    provider: z.string(),
    mode: z.string(),
  }),
});

export const AgentProfileSchema = z.discriminatedUnion("runner", [
  ClaudeAgentProfileSchema,
  OpenAIAgentProfileSchema,
  MinimaxAgentProfileSchema,
]);

export const HostConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(4096),
  log_retention: z.number().int().positive().default(50),
  auto_start: z.boolean().default(false),
});

export const KonductorConfigSchema = z.object({
  schema_version: z.enum(["0.1.0", "0.2.0"]),
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
export type TokenProvider = z.infer<typeof TokenProviderSchema>;
export type ProjectToken = z.infer<typeof ProjectTokenSchema>;
export type ProjectTokensFile = z.infer<typeof ProjectTokensFileSchema>;
export type SkillProfile = z.infer<typeof SkillProfileSchema>;
