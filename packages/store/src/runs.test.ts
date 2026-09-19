import { describe, expect, test } from "bun:test";
import { migrateRunSummary } from "./runs.js";

const legacy = {
  schema_version: "0.2.0",
  id: "0f3a9c2e-legacy-run",
  project_id: "demo",
  repo_path: "/repo",
  profile_id: "openai-fast",
  profile_title: "OpenAI",
  agent_kind: "openai",
  feature_item_id: null,
  prompt_excerpt: "hello",
  prompt_packs: [],
  source: "cli",
  command: "curl",
  env_summary: {},
  status: "succeeded",
  started_at: "2026-09-17T10:00:00.000Z",
  ended_at: "2026-09-17T10:01:00.000Z",
  exit_code: 0,
  log_path: "legacy.log",
  repo_log_path: null,
};

describe("migrateRunSummary", () => {
  test("keeps historical HTTP-runner runs, renaming agent_kind to adapter_id", () => {
    const run = migrateRunSummary(legacy);
    expect(run.adapter_id).toBe("openai");
    expect("agent_kind" in run).toBe(false);
    expect(run.status).toBe("succeeded");
  });

  test("derives an addressable slug and the headless transport for old runs", () => {
    const run = migrateRunSummary(legacy);
    expect(run.slug).toBe("run-0f3a9c2e");
    expect(run.transport).toBe("headless");
    expect(run.session_name).toBeNull();
    expect(run.pane_id).toBeNull();
    expect(run.agent_status).toBeNull();
    expect(run.provider).toBeNull();
    expect(run.terminal_preview).toBe("");
    expect(run.update_count).toBe(0);
  });

  test("assumes claude_code when the legacy kind is missing entirely", () => {
    const { agent_kind: _kind, ...withoutKind } = legacy;
    expect(migrateRunSummary(withoutKind).adapter_id).toBe("claude_code");
  });

  test("is a no-op for current records", () => {
    const current = {
      ...legacy,
      schema_version: "0.3.0",
      agent_kind: undefined,
      adapter_id: "codex",
      slug: "fix-login",
      transport: "tmux",
      session_name: "konductor",
      window_id: "@1",
      pane_id: "%1",
      agent_status: "working",
      provider: "openai",
      model: "gpt-5",
    };
    delete (current as Record<string, unknown>)["agent_kind"];
    const run = migrateRunSummary(current);
    expect(run).toMatchObject({
      adapter_id: "codex",
      slug: "fix-login",
      transport: "tmux",
      pane_id: "%1",
      agent_status: "working",
      model: "gpt-5",
    });
    // A legacy agent_kind never overrides an explicit adapter_id.
    expect(migrateRunSummary({ ...current, agent_kind: "openai" }).adapter_id).toBe("codex");
  });

  test("rejects records that are not runs at all", () => {
    expect(() => migrateRunSummary({})).toThrow();
    expect(() => migrateRunSummary(null)).toThrow();
    expect(() => migrateRunSummary({ ...legacy, status: "exploded" })).toThrow();
  });
});
