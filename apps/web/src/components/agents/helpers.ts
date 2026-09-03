import type { AgentWorkspaceConfig, NpmSkillSearchResult } from "../../lib/registry.js";
import type {
  AgentProfile,
  KonductorConfig,
  PromptPack,
  RunSummary,
  SkillProfile,
} from "../../lib/types.js";

/**
 * Framework-free helpers for the agents surface.
 *
 * These live outside the components so they can be unit-tested without rendering.
 */

export type ProfileDraft = {
  title: string;
  adapter: string;
  model: string;
  binary: string;
  args: string;
  mode: "pane" | "headless";
  worktree: boolean;
  default_mcp: boolean;
  default_working_dir: "project_root" | "current";
};

export type PromptPackDraft = {
  title: string;
  instructions: string;
  file_refs: string;
  mcp_reminder: string;
};

export function splitRuns(runs: RunSummary[]): {
  active_runs: RunSummary[];
  past_runs: RunSummary[];
} {
  const isActive = (run: RunSummary) => run.status === "running" || run.status === "queued";
  return {
    active_runs: runs.filter(isActive),
    past_runs: runs.filter((run) => !isActive(run)),
  };
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function uniqueId(existing: Iterable<string>, base: string, fallback: string): string {
  const taken = new Set(existing);
  const root = slugify(base) || fallback;
  let candidate = root;
  let index = 2;
  while (taken.has(candidate)) {
    candidate = `${root}-${index}`;
    index += 1;
  }
  return candidate;
}

export function parseArgs(value: string): string[] {
  return value
    .trim()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseFileRefs(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function defaultProfileDraft(adapter = "claude_code"): ProfileDraft {
  return {
    title: "",
    adapter,
    model: "",
    binary: "",
    args: "",
    mode: "pane",
    worktree: false,
    default_mcp: true,
    default_working_dir: "project_root",
  };
}

export function defaultPromptPackDraft(): PromptPackDraft {
  return { title: "", instructions: "", file_refs: "", mcp_reminder: "" };
}

export function normalizeAgents(config: KonductorConfig | null): AgentWorkspaceConfig {
  const tasks = config?.agents?.tasks;
  return {
    default_profile: config?.agents?.default_profile ?? "default-profile",
    profiles: config?.agents?.profiles ?? [],
    prompt_packs: config?.agents?.prompt_packs ?? [],
    skill_profiles: config?.agents?.skill_profiles ?? [],
    ...(tasks ? { tasks } : {}),
  };
}

export function buildNextProfile(draft: ProfileDraft, profiles: AgentProfile[]): AgentProfile {
  const title = draft.title.trim();
  if (!title) throw new Error("Profile title is required.");
  if (!draft.adapter.trim()) throw new Error("Choose which agent this profile launches.");

  const id = uniqueId(profiles.map((profile) => profile.id), title, `${draft.adapter}-profile`);

  // Blank overrides are omitted so the adapter manifest's own defaults win.
  return {
    id,
    title,
    adapter: draft.adapter,
    ...(draft.binary.trim() ? { binary: draft.binary.trim() } : {}),
    ...(draft.model.trim() ? { model: draft.model.trim() } : {}),
    args: parseArgs(draft.args),
    mode: draft.mode,
    worktree: draft.worktree,
    default_mcp: draft.default_mcp,
    default_working_dir: draft.default_working_dir,
    default_env: {},
  };
}

export function buildPromptPack(draft: PromptPackDraft, promptPacks: PromptPack[]): PromptPack {
  const title = draft.title.trim();
  const instructions = draft.instructions.trim();
  if (!title || !instructions) {
    throw new Error("Prompt pack title and instructions are required.");
  }
  return {
    id: uniqueId(promptPacks.map((pack) => pack.id), title, "prompt-pack"),
    title,
    instructions,
    file_refs: parseFileRefs(draft.file_refs),
    mcp_reminder: draft.mcp_reminder.trim() || undefined,
  };
}

export function buildSkillProfile(
  result: NpmSkillSearchResult,
  existing: SkillProfile[],
): SkillProfile {
  const pkg = result.package;
  const homepage = pkg.links?.homepage ?? pkg.links?.repository ?? pkg.links?.npm;
  return {
    id: uniqueId(existing.map((skill) => skill.id), pkg.name, "skill-profile"),
    title: pkg.name,
    source: "npm",
    package_name: pkg.name,
    description: pkg.description,
    homepage,
    registry_url: pkg.links?.npm,
    latest_version: pkg.version,
    install_command: `npm install ${pkg.name}@${pkg.version}`,
    keywords: pkg.keywords ?? [],
  };
}
