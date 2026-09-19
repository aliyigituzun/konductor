import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createDecision,
  listDecisions,
  listFeatureDecisions,
  readDecision,
  resolveDecision,
  setDecisionHandoffRun,
  updateDecision,
} from "./decisions.js";
import { repoLocal } from "./paths.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "konductor-decisions-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const base = {
  title: "Runner transport",
  question: "API-call runner or tmux-backed fleet?",
  impact: "high" as const,
  options: [
    { id: "api", title: "API calls", creates_features: [] },
    { id: "tmux", title: "tmux fleet", consequences: "Needs tmux installed.", creates_features: [] },
  ],
  feature_item_ids: ["fleet"],
  source: "dashboard" as const,
  run_id: null,
};

test("decisions are created, listed, patched and resolved in SQLite", async () => {
  const created = await createDecision(dir, base);
  expect(created.id).toBe("runner-transport");
  expect(created.status).toBe("open");
  expect(created.outcome).toBeNull();

  const second = await createDecision(dir, base);
  expect(second.id).toBe("runner-transport-2");

  const patched = await updateDecision(dir, created.id, { owner: "ali", feature_item_ids: ["fleet", "attach"] });
  expect(patched.owner).toBe("ali");
  expect((await listFeatureDecisions(dir, "attach")).map((decision) => decision.id)).toEqual([created.id]);

  const resolved = await resolveDecision(dir, created.id, {
    option_id: "tmux",
    rationale: "Real TUIs and takeover.",
    resolved_by: "dashboard",
    created_feature_item_ids: ["tmux-adopt"],
  });
  expect(resolved.status).toBe("resolved");
  expect(resolved.outcome?.option_id).toBe("tmux");
  expect(resolved.feature_item_ids).toEqual(["fleet", "attach", "tmux-adopt"]);
  expect(resolved.outcome?.handoff_run_id).toBeNull();

  const withRun = await setDecisionHandoffRun(dir, created.id, "run-1");
  expect(withRun.outcome?.handoff_run_id).toBe("run-1");
  expect((await readDecision(dir, created.id))?.outcome?.handoff_run_id).toBe("run-1");

  await expect(resolveDecision(dir, created.id, { option_id: "api", resolved_by: "dashboard" }))
    .rejects.toThrow("already resolved");
  await expect(resolveDecision(dir, second.id, { option_id: "nope", resolved_by: "dashboard" }))
    .rejects.toThrow("has no option");
  await expect(updateDecision(dir, "missing", { owner: "x" })).rejects.toThrow("not found");

  expect((await listDecisions(dir)).length).toBe(2);
});

test("a caller-supplied id is idempotent", async () => {
  const first = await createDecision(dir, { ...base, id: "fixed" });
  const again = await createDecision(dir, { ...base, id: "fixed", title: "Changed" });
  expect(again).toEqual(first);
  expect((await listDecisions(dir)).length).toBe(1);
});

test("legacy decisions_needed entries are imported once and the file is left alone", async () => {
  const paths = repoLocal(dir);
  await mkdir(paths.statusDir, { recursive: true });
  const snapshot = {
    issues: {
      decisions_needed: [
        { id: "legacy-one", summary: "Pick a telemetry signal.", impact: "medium", owner: "ali" },
        { id: "legacy-two", summary: "x".repeat(120), impact: "low" },
      ],
    },
  };
  const raw = JSON.stringify(snapshot);
  await writeFile(paths.currentStatus, raw);

  const imported = await listDecisions(dir);
  expect(imported.map((decision) => decision.id).sort()).toEqual(["legacy-one", "legacy-two"]);
  const one = imported.find((decision) => decision.id === "legacy-one")!;
  expect(one.source).toBe("import");
  expect(one.owner).toBe("ali");
  expect(one.options).toEqual([]);
  expect(imported.find((decision) => decision.id === "legacy-two")!.title.length).toBeLessThanOrEqual(80);

  // Editing the file afterwards does not re-import, and existing rows are not overwritten.
  await updateDecision(dir, "legacy-one", { owner: "someone" });
  await writeFile(paths.currentStatus, JSON.stringify({
    issues: { decisions_needed: [{ id: "legacy-three", summary: "later", impact: "low" }] },
  }));
  expect((await listDecisions(dir)).map((decision) => decision.id).sort()).toEqual(["legacy-one", "legacy-two"]);
  expect((await readDecision(dir, "legacy-one"))?.owner).toBe("someone");
  expect(await readFile(paths.currentStatus, "utf-8")).not.toBe(raw);
});

test("open-ended decisions resolve with an answer instead of an option", async () => {
  const created = await createDecision(dir, {
    ...base,
    title: "Onboarding copy",
    kind: "open_ended",
    problem: "The first-run screen reads like a spec. What should it say?",
    options: [],
  });
  expect(created.kind).toBe("open_ended");
  expect(created.options).toEqual([]);

  await expect(resolveDecision(dir, created.id, { option_id: "api", resolved_by: "dashboard" })).rejects.toThrow("needs an answer");

  const resolved = await resolveDecision(dir, created.id, { answer: "  Lead with the outcome, then one command.  ", resolved_by: "dashboard" });
  expect(resolved.status).toBe("resolved");
  expect(resolved.outcome?.option_id).toBeNull();
  expect(resolved.outcome?.answer).toBe("Lead with the outcome, then one command.");

  // Options decisions default to kind "options" and still require an option.
  const plain = await createDecision(dir, base);
  expect(plain.kind).toBe("options");
  await expect(resolveDecision(dir, plain.id, { answer: "nope", resolved_by: "dashboard" })).rejects.toThrow("has no option");
});
