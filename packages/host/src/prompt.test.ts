import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAssetBucket, createDecision, createManagedAsset, createTodo, resolveDecision, writeStatus } from "@konductor/store";
import type { AgentProfile } from "@konductor/schema";
import { composePrompt, resolveDecisionContext, resolveFeatureContext, resolveTodoContext } from "./prompt.js";

let repo: string;
beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "konductor-prompt-"));
  await writeStatus(repo, {
    schema_version: "0.2.0",
    project: { id: "demo", name: "Demo" },
    agent: { kind: "claude_code", session_id: null },
    report: { reported_at: new Date().toISOString() },
    status: { state: "todo", summary: "seed", current_phase_id: null },
    phases: [],
    issues: { blockers: [], decisions_needed: [], external_dependencies: [], risks: [] },
    next_actions: [],
    features: [{ id: "core", title: "Core", items: [
      { id: "login", title: "Login", status: "todo", description: "SSO" },
      { id: "refresh", title: "Token refresh", status: "todo" },
    ] }],
  });
  await createDecision(repo, {
    id: "session",
    title: "Session storage",
    question: "Cookies or tokens?",
    context: "Mobile clients exist.",
    impact: "high",
    options: [
      { id: "cookies", title: "Cookies", creates_features: [] },
      { id: "tokens", title: "Bearer tokens", description: "Short-lived JWTs", consequences: "Needs refresh flow", creates_features: [] },
    ],
    feature_item_ids: ["login"],
    source: "dashboard",
    run_id: null,
  });
  await createDecision(repo, {
    id: "later",
    title: "Rate limiting",
    question: "Per user or per token?",
    impact: "low",
    options: [{ id: "user", title: "Per user", creates_features: [] }],
    feature_item_ids: ["login"],
    source: "agent",
    run_id: null,
  });
});
afterEach(async () => { await rm(repo, { recursive: true, force: true }); });

const profile: AgentProfile = {
  id: "p", title: "P", adapter: "claude-code", args: [], worktree: false,
  default_mcp: true, default_working_dir: "project_root", default_env: {},
} as AgentProfile;

test("a feature brief lists its related decisions with outcomes", async () => {
  await resolveDecision(repo, "session", { option_id: "tokens", rationale: "Mobile.", resolved_by: "dashboard", created_feature_item_ids: ["refresh"] });
  const context = await resolveFeatureContext(repo, "login");
  expect(context.feature_item_title).toBe("Login");
  expect(context.feature_block).toContain("### Related decisions");
  expect(context.feature_block).toContain("- [resolved] Session storage → Bearer tokens (Mobile.)");
  expect(context.feature_block).toContain("- [open] Rate limiting: Per user or per token?");
});

test("a decision hand-off block names the chosen option, rejected options, and features", async () => {
  await resolveDecision(repo, "session", { option_id: "tokens", rationale: "Mobile.", resolved_by: "dashboard", created_feature_item_ids: ["refresh"] });
  const block = await resolveDecisionContext(repo, "session");
  expect(block).toContain("## Decision Hand-off");
  expect(block).toContain("Chosen option: Bearer tokens — Short-lived JWTs");
  expect(block).toContain("Consequences: Needs refresh flow");
  expect(block).toContain("Rationale: Mobile.");
  expect(block).toContain("Rejected options: Cookies");
  expect(block).toContain("Linked features: Login (Core); Token refresh (Core)");
  expect(block).toContain("Features created by this decision: Token refresh (Core)");
  expect(await resolveDecisionContext(repo, "ghost")).toContain("was not found");
  expect(await resolveDecisionContext(repo, null)).toBe("");
});

test("the composed brief carries feature, decision, and run metadata", async () => {
  await resolveDecision(repo, "session", { option_id: "cookies", resolved_by: "dashboard" });
  const { text, feature_item_title } = await composePrompt(repo, "Do it", [], "login", null, "session", "run-1", "demo", profile, "Claude Code", "dashboard", true);
  expect(feature_item_title).toBe("Login");
  const order = ["## Selected Feature Item", "## Decision Hand-off", "## Required Workflow", "## Operator Prompt", "Do it", "feature_item_id: login", "decision_id: session"]
    .map((marker) => text.indexOf(marker));
  expect(order.every((index) => index >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

test("a to-do brief includes its related feature and managed asset content routes", async () => {
  await createTodo(repo, { id: "review", title: "Review", status: "todo", related_feature_item_ids: ["login"], related_asset_ids: ["logo"], creates_feature: false, imminent: false });
  const bucket = await createAssetBucket(repo, { title: "Brand" });
  await createManagedAsset(repo, { bucket_id: bucket.id, name: "Logo", upload: { file_name: "logo.txt", content_base64: "eA==" } }, { kind: "user" });
  const block = await resolveTodoContext(repo, "demo", "review");
  expect(block).toContain("## Selected To-do");
  expect(block).toContain("Login (Core)");
  expect(block).toContain("Logo [logo]");
});
