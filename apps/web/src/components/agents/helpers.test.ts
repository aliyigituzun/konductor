import { describe, expect, test } from "bun:test";
import type { AgentProfile, KonductorConfig, PromptPack, RunSummary, SkillProfile } from "../../lib/types.js";
import {
  buildNextProfile,
  buildPromptPack,
  buildSkillProfile,
  defaultProfileDraft,
  defaultPromptPackDraft,
  filterPromptPacks,
  normalizeAgents,
  parseArgs,
  parseFileRefs,
  parseSkillLink,
  runToText,
  slugify,
  splitRuns,
  uniqueId,
} from "./helpers.js";

const run = (id: string, status: RunSummary["status"]): RunSummary =>
  ({ id, status } as RunSummary);

const profile = (id: string): AgentProfile =>
  ({ id, title: id, adapter: "claude_code", args: [], worktree: false, default_mcp: true, default_working_dir: "project_root", default_env: {} } as AgentProfile);

describe("splitRuns", () => {
  test("queued and running runs are active; everything else is history", () => {
    const runs = [run("a", "running"), run("b", "queued"), run("c", "succeeded"), run("d", "failed"), run("e", "stopped")];
    const { active_runs, past_runs } = splitRuns(runs);
    expect(active_runs.map((r) => r.id)).toEqual(["a", "b"]);
    expect(past_runs.map((r) => r.id)).toEqual(["c", "d", "e"]);
  });
});

describe("id helpers", () => {
  test("slugify normalizes titles", () => {
    expect(slugify(" Claude  Reviewer! ")).toBe("claude-reviewer");
    expect(slugify("###")).toBe("");
  });

  test("uniqueId falls back and increments past taken ids", () => {
    expect(uniqueId([], "Claude", "profile")).toBe("claude");
    expect(uniqueId(["claude"], "Claude", "profile")).toBe("claude-2");
    expect(uniqueId(["claude", "claude-2"], "Claude", "profile")).toBe("claude-3");
    expect(uniqueId(["profile"], "???", "profile")).toBe("profile-2");
  });
});

describe("text parsers", () => {
  test("parseArgs splits on whitespace and drops blanks", () => {
    expect(parseArgs("  --model  gpt-5\n--yes ")).toEqual(["--model", "gpt-5", "--yes"]);
    expect(parseArgs("   ")).toEqual([]);
  });

  test("parseFileRefs accepts newline or comma separated lists", () => {
    expect(parseFileRefs("README.md, docs/a.md\r\n\n docs/b.md ,")).toEqual(["README.md", "docs/a.md", "docs/b.md"]);
    expect(parseFileRefs("")).toEqual([]);
  });
});

describe("drafts", () => {
  test("defaults are empty except for the safe launch options", () => {
    expect(defaultProfileDraft()).toMatchObject({ adapter: "claude_code", provider: "", provider_connection_id: "", worktree: false, default_mcp: true, default_working_dir: "project_root" });
    expect(defaultProfileDraft("codex", "openai")).toMatchObject({ adapter: "codex", provider: "openai" });
    expect(defaultPromptPackDraft()).toEqual({ title: "", instructions: "", file_refs: "", mcp_reminder: "" });
  });
});

describe("normalizeAgents", () => {
  test("provides an empty workspace when there is no config", () => {
    expect(normalizeAgents(null)).toEqual({ default_profile: "default-profile", profiles: [], prompt_packs: [], skill_profiles: [], provider_connections: [] });
  });

  test("passes tasks through only when present", () => {
    const base = { default_profile: "claude", profiles: [profile("claude")], prompt_packs: [], skill_profiles: [], provider_connections: [] };
    expect(normalizeAgents({ agents: base } as unknown as KonductorConfig)).toEqual(base);
    const tasks = [{ id: "t", run_id: "r", status: "running" as const, started_at: "2026-09-17T10:00:00.000Z" }];
    expect(normalizeAgents({ agents: { ...base, tasks } } as unknown as KonductorConfig).tasks).toEqual(tasks);
  });
});

describe("buildNextProfile", () => {
  test("requires a title and an adapter", () => {
    expect(() => buildNextProfile(defaultProfileDraft(), [])).toThrow("title");
    expect(() => buildNextProfile({ ...defaultProfileDraft(""), title: "X" }, [])).toThrow("agent");
  });

  test("omits blank overrides so the manifest defaults win, and picks a unique id", () => {
    const draft = { ...defaultProfileDraft("codex"), title: "Codex", args: "--full-auto", model: "  " };
    const built = buildNextProfile(draft, [profile("codex")]);
    expect(built).toEqual({
      id: "codex-2",
      title: "Codex",
      adapter: "codex",
      args: ["--full-auto"],
      worktree: false,
      default_mcp: true,
      default_working_dir: "project_root",
      default_env: {},
    });
    expect("model" in built).toBe(false);
    expect("provider" in built).toBe(false);
    expect("binary" in built).toBe(false);
  });

  test("keeps explicit overrides", () => {
    const draft = { ...defaultProfileDraft("codex"), title: "Fast", provider: "openai", provider_connection_id: "openai-work", model: "gpt-5", binary: "/opt/codex", worktree: true };
    expect(buildNextProfile(draft, [])).toMatchObject({ provider: "openai", provider_connection_id: "openai-work", model: "gpt-5", binary: "/opt/codex", worktree: true });
  });
});

describe("buildPromptPack", () => {
  test("requires both title and instructions", () => {
    expect(() => buildPromptPack({ ...defaultPromptPackDraft(), title: "T" }, [])).toThrow();
    expect(() => buildPromptPack({ ...defaultPromptPackDraft(), instructions: "I" }, [])).toThrow();
  });

  test("parses refs, drops an empty reminder, and avoids id collisions", () => {
    const existing = [{ id: "review" } as PromptPack];
    const pack = buildPromptPack({ title: "Review", instructions: " Be strict. ", file_refs: "a.md,b.md", mcp_reminder: " " }, existing);
    expect(pack).toEqual({ id: "review-2", title: "Review", instructions: "Be strict.", file_refs: ["a.md", "b.md"], mcp_reminder: undefined });
  });
});

describe("parseSkillLink", () => {
  test("normalizes npm package links, including scoped names", () => {
    expect(parseSkillLink(" https://www.npmjs.com/package/left-pad ")).toEqual({ source: "npm", url: "https://www.npmjs.com/package/left-pad", name: "left-pad" });
    expect(parseSkillLink("https://npmjs.com/package/@scope/pkg")).toEqual({ source: "npm", url: "https://www.npmjs.com/package/%40scope%2Fpkg", name: "@scope/pkg" });
  });

  test("normalizes GitHub repository links and strips .git", () => {
    expect(parseSkillLink("https://github.com/acme/skills.git")).toEqual({ source: "github", url: "https://github.com/acme/skills", name: "acme/skills" });
  });

  test("rejects anything that is not an https npm or GitHub link", () => {
    for (const value of ["nonsense", "http://github.com/a/b", "https://github.com/only", "https://github.com/a/b/tree/main", "https://www.npmjs.com/left-pad", "https://gitlab.com/a/b"]) {
      expect(() => parseSkillLink(value)).toThrow("Enter an npm or GitHub URL.");
    }
  });
});

describe("buildSkillProfile", () => {
  test("builds an npm skill profile with an install command", () => {
    const link = parseSkillLink("https://www.npmjs.com/package/left-pad");
    expect(buildSkillProfile(link, [])).toEqual({
      id: "left-pad",
      title: "left-pad",
      source: "npm",
      package_name: "left-pad",
      homepage: link.url,
      registry_url: link.url,
      install_command: "npm install left-pad",
      keywords: [],
    });
  });

  test("builds a GitHub skill profile and avoids id collisions", () => {
    const link = parseSkillLink("https://github.com/acme/skills");
    const built = buildSkillProfile(link, [{ id: "acme-skills" } as SkillProfile]);
    expect(built.id).toBe("acme-skills-2");
    expect(built.package_name).toBe("github:acme/skills");
    expect(built.install_command).toBe("npm install https://github.com/acme/skills");
  });
});

describe("runToText", () => {
  test("renders the fields that exist and skips the rest", () => {
    const text = runToText({
      id: "r1",
      slug: "otter",
      status: "failed",
      adapter_id: "claude_code",
      model: "claude-opus-5",
      profile_id: "default-profile",
      profile_title: "Default",
      started_at: "2026-09-18T10:00:00.000Z",
      ended_at: "2026-09-18T10:05:00.000Z",
      exit_code: 1,
      branch: null,
      feature_item_id: null,
      log_path: "/tmp/otter.log",
      prompt_excerpt: "Fix the build",
      last_error: "boom",
    } as RunSummary);
    expect(text).toBe([
      "otter — failed",
      "adapter: claude_code · claude-opus-5",
      "profile: Default (default-profile)",
      "started: 2026-09-18T10:00:00.000Z",
      "ended: 2026-09-18T10:05:00.000Z",
      "exit code: 1",
      "log: /tmp/otter.log",
      "",
      "prompt:",
      "Fix the build",
      "",
      "error:",
      "boom",
    ].join("\n"));
  });
});

describe("filterPromptPacks", () => {
  const packs = [
    { id: "default", title: "Konductor Default", instructions: "Use the konductor MCP." },
    { id: "frontend", title: "Frontend Design", instructions: "Care about typography." },
  ] as PromptPack[];

  test("blank query keeps everything; otherwise matches title, id or instructions", () => {
    expect(filterPromptPacks(packs, "  ")).toEqual(packs);
    expect(filterPromptPacks(packs, "FRONT").map((p) => p.id)).toEqual(["frontend"]);
    expect(filterPromptPacks(packs, "mcp").map((p) => p.id)).toEqual(["default"]);
    expect(filterPromptPacks(packs, "nope")).toEqual([]);
  });
});
