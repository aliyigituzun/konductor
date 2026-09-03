import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  KonductorConfigSchema,
  type KonductorConfig,
  type AgentProfile,
  type PromptPack,
  type ProjectTokensFile,
  type SkillProfile,
} from "@konductor/schema";
import { configPath } from "./paths.js";
import { findProjectToken, validateTokenProvider } from "./tokens.js";

export const DEFAULT_OTEL_ENV = {
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
  OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
  CLAUDE_CODE_ENABLE_TELEMETRY: "1",
  OTEL_METRICS_EXPORTER: "otlp",
  OTEL_LOGS_EXPORTER: "otlp",
  OTEL_METRIC_EXPORT_INTERVAL: "10000",
  OTEL_LOGS_EXPORT_INTERVAL: "5000",
};

export function defaultPromptPack(): PromptPack {
  return {
    id: "konductor-default",
    title: "Konductor Default",
    instructions:
      "Work as the active coding agent for this project. Start by understanding the assigned run context and the current project state before you edit code. Inspect the relevant code paths first, then implement the smallest correct change. If Konductor MCP is available, call get_run_context, get_project_context, and get_current_status at the start. Use write_update after repository inspection, after meaningful implementation steps, and whenever you hit a blocker or scope change. If you complete or materially change the selected feature, call write_status before you finish so the dashboard reflects the real outcome. Do not claim success unless the code changes landed and you either wrote status through MCP or explicitly explain why you could not.",
    file_refs: [],
    mcp_reminder:
      "Konductor MCP should be available in this repo. Use it early, keep updates flowing through write_update, and persist the final tracked state with write_status whenever the task outcome changes project status.",
  };
}

export function defaultClaudeProfile(): AgentProfile {
  return {
    id: "claude-default",
    title: "Claude Code",
    runner: "claude_code",
    binary: "claude",
    args: [],
    default_mcp: true,
    default_working_dir: "project_root",
    default_env: {},
    telemetry: {
      provider: "opentelemetry",
      mode: "collector",
    },
  };
}

export function normalizeConfig(raw: unknown): KonductorConfig {
  const data = (raw ?? {}) as Record<string, unknown>;
  const existingAgents = (data["agents"] ?? null) as
    | {
        default_profile?: string;
        profiles?: AgentProfile[];
        prompt_packs?: PromptPack[];
        skill_profiles?: SkillProfile[];
        tasks?: Array<{ id: string; run_id: string; status: "running" | "succeeded" | "failed" | "stopped"; started_at: string }>;
      }
    | null;

  const fallbackProfile = defaultClaudeProfile();
  const profiles = existingAgents?.profiles?.length
    ? existingAgents.profiles
    : [fallbackProfile];
  const promptPacks = existingAgents?.prompt_packs?.length
    ? existingAgents.prompt_packs
    : [defaultPromptPack()];
  const skillProfiles = existingAgents?.skill_profiles ?? [];

  const normalized: KonductorConfig = {
    schema_version: "0.2.0",
    project_id: String(data["project_id"] ?? ""),
    project_name: String(data["project_name"] ?? ""),
    repo_root: String(data["repo_root"] ?? "."),
    default_branch: String(data["default_branch"] ?? "main"),
    dashboard: ((data["dashboard"] ?? { mode: "local" }) as KonductorConfig["dashboard"]) ?? {
      mode: "local",
    },
    telemetry: ((data["telemetry"] ?? {
      provider: "opentelemetry",
      mode: "collector",
    }) as KonductorConfig["telemetry"]) ?? {
      provider: "opentelemetry",
      mode: "collector",
    },
    host: ((data["host"] ?? {
      port: 4096,
      log_retention: 50,
      auto_start: false,
    }) as KonductorConfig["host"]) ?? {
      port: 4096,
      log_retention: 50,
      auto_start: false,
    },
    agents: {
      default_profile:
        existingAgents?.default_profile ??
        (profiles[0]?.id ?? fallbackProfile.id),
      profiles,
      prompt_packs: promptPacks,
      skill_profiles: skillProfiles,
      tasks: existingAgents?.tasks,
    },
    agent: data["agent"] as KonductorConfig["agent"],
  };

  return KonductorConfigSchema.parse(normalized);
}

export async function readConfig(cwd: string): Promise<KonductorConfig | null> {
  const path = configPath(cwd);
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf-8");
  return normalizeConfig(JSON.parse(raw));
}

export async function writeConfig(cwd: string, config: KonductorConfig): Promise<void> {
  const path = configPath(cwd);
  await writeFile(path, JSON.stringify(KonductorConfigSchema.parse(config), null, 2), "utf-8");
}

export function validateAgentTokenBindings(
  config: KonductorConfig,
  tokensFile: ProjectTokensFile,
): string[] {
  const profiles = config.agents?.profiles ?? [];
  const errors: string[] = [];

  for (const profile of profiles) {
    if (profile.runner === "claude_code") continue;
    if (!profile.token_id) {
      errors.push(`Profile "${profile.title}" is missing a project token selection.`);
      continue;
    }
    const token = findProjectToken(tokensFile, profile.token_id);
    const providerError = validateTokenProvider(token, profile.runner);
    if (providerError) {
      errors.push(`Profile "${profile.title}": ${providerError}`);
    }
  }

  return errors;
}

export async function ensureProjectMcpConfig(cwd: string): Promise<boolean> {
  const mcpPath = join(cwd, ".mcp.json");
  let existing: Record<string, unknown> = {};
  if (existsSync(mcpPath)) {
    try {
      existing = JSON.parse(await readFile(mcpPath, "utf-8")) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }

  const mcpServers = ((existing["mcpServers"] ?? {}) as Record<string, unknown>) ?? {};
  const next = {
    ...existing,
    mcpServers: {
      ...mcpServers,
      konductor: {
        type: "stdio",
        command: "konductor",
        args: ["mcp", "serve"],
        env: {
          KONDUCTOR_RUN_ID: "${KONDUCTOR_RUN_ID:-}",
          KONDUCTOR_PROFILE_ID: "${KONDUCTOR_PROFILE_ID:-}",
          KONDUCTOR_FEATURE_ITEM_ID: "${KONDUCTOR_FEATURE_ITEM_ID:-}",
          KONDUCTOR_RUN_SOURCE: "${KONDUCTOR_RUN_SOURCE:-cli}",
        },
      },
    },
  };

  const existingJson = JSON.stringify(existing);
  const nextJson = JSON.stringify(next);
  if (existingJson === nextJson) return false;
  await mkdir(cwd, { recursive: true });
  await writeFile(mcpPath, JSON.stringify(next, null, 2), "utf-8");
  return true;
}
