import type { AgentWorkspaceConfig, SkillLink } from "../../lib/registry.js";
import type {
  AgentProfile,
  KonductorConfig,
  PromptPack,
  RunSummary,
  SkillProfile,
  ProviderConnection,
} from "../../lib/types.js";

/**
 * Framework-free helpers for the agents surface.
 *
 * These live outside the components so they can be unit-tested without rendering.
 */

export type ProfileDraft = {
  title: string;
  adapter: string;
  /** Blank means the adapter's first (or only) provider. */
  provider: string;
  provider_connection_id: string;
  /** Blank means the harness's own default model. */
  model: string;
  binary: string;
  args: string;
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

export function defaultProfileDraft(adapter = "claude_code", provider = ""): ProfileDraft {
  return {
    title: "",
    adapter,
    provider,
    provider_connection_id: "",
    model: "",
    binary: "",
    args: "",
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
    provider_connections: config?.agents?.provider_connections ?? [],
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
    ...(draft.provider.trim() ? { provider: draft.provider.trim() } : {}),
    ...(draft.provider_connection_id ? { provider_connection_id: draft.provider_connection_id } : {}),
    ...(draft.model.trim() ? { model: draft.model.trim() } : {}),
    args: parseArgs(draft.args),
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

export function parseSkillLink(value: string): SkillLink {
  const invalidLinkMessage = "Enter an npm or GitHub URL.";
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(invalidLinkMessage);
  }
  if (url.protocol !== "https:") throw new Error(invalidLinkMessage);
  if (url.hostname === "www.npmjs.com" || url.hostname === "npmjs.com") {
    const match = url.pathname.match(/^\/package\/(.+)\/?$/);
    if (!match) throw new Error(invalidLinkMessage);
    const name = decodeURIComponent(match[1]!);
    return { source: "npm", url: `https://www.npmjs.com/package/${encodeURIComponent(name)}`, name };
  }
  if (url.hostname === "github.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 2) throw new Error(invalidLinkMessage);
    const name = `${parts[0]!}/${parts[1]!.replace(/\.git$/, "")}`;
    return { source: "github", url: `https://github.com/${name}`, name };
  }
  throw new Error(invalidLinkMessage);
}

export function buildSkillProfile(link: SkillLink, existing: SkillProfile[]): SkillProfile {
  const installTarget = link.source === "npm" ? link.name : `github:${link.name}`;
  return {
    id: uniqueId(existing.map((skill) => skill.id), link.name, "skill-profile"),
    title: link.name,
    source: link.source,
    package_name: installTarget,
    homepage: link.url,
    registry_url: link.url,
    install_command: `npm install ${link.source === "npm" ? link.name : link.url}`,
    keywords: [],
  };
}

/** Plain-text rendering of a finished run, used by the history Copy buttons. */
export function runToText(run: RunSummary): string {
  const lines = [
    `${run.slug} — ${run.status}`,
    `adapter: ${run.adapter_id}${run.model ? ` · ${run.model}` : ""}`,
    `profile: ${run.profile_title} (${run.profile_id})`,
    `started: ${run.started_at}`,
  ];
  if (run.ended_at) lines.push(`ended: ${run.ended_at}`);
  if (run.exit_code !== null && run.exit_code !== undefined) lines.push(`exit code: ${run.exit_code}`);
  if (run.branch) lines.push(`branch: ${run.branch}`);
  if (run.feature_item_title || run.feature_item_id) {
    lines.push(`feature item: ${run.feature_item_title ?? run.feature_item_id}`);
  }
  lines.push(`log: ${run.log_path}`);
  if (run.prompt_excerpt) lines.push("", "prompt:", run.prompt_excerpt);
  if (run.last_error) lines.push("", "error:", run.last_error);
  return lines.join("\n");
}

export function runsToText(runs: RunSummary[]): string {
  return runs.map(runToText).join("\n\n---\n\n");
}

/** Case-insensitive match on title, id or instructions; blank query keeps every pack. */
export function filterPromptPacks(packs: PromptPack[], query: string): PromptPack[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return packs;
  return packs.filter((pack) =>
    [pack.title, pack.id, pack.instructions].some((field) => field.toLowerCase().includes(needle)),
  );
}
