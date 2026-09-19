import { expect, test } from "bun:test";
import type { StatusSnapshot } from "@konductor/schema";
import { diffStatusSnapshots } from "./status-diff.js";

function snapshot(overrides: Partial<StatusSnapshot>): StatusSnapshot {
  return {
    schema_version: "0.2.0",
    project: { id: "demo", name: "Demo" },
    agent: { kind: "test", session_id: null },
    report: { reported_at: "2026-09-19T12:00:00.000Z" },
    status: { state: "todo", summary: "seed", current_phase_id: null },
    phases: [],
    feature_phases: [{ id: "mvp", title: "MVP" }, { id: "v2", title: "V2" }],
    features: [
      { id: "core", title: "Core", items: [
        { id: "login", title: "Login", status: "todo", phase_ids: ["mvp"] },
        { id: "signup", title: "Signup", status: "in_progress" },
      ] },
    ],
    issues: { blockers: [], decisions_needed: [], external_dependencies: [], risks: [] },
    next_actions: [],
    ...overrides,
  };
}

const tags = (prev: StatusSnapshot | null, next: StatusSnapshot) =>
  diffStatusSnapshots(prev, next).map((draft) => [draft.action, draft.message, draft.feature_item_id ?? null]);

test("no previous snapshot is seeding, not an event", () => {
  expect(diffStatusSnapshots(null, snapshot({}))).toEqual([]);
  expect(diffStatusSnapshots(snapshot({}), snapshot({}))).toEqual([]);
});

test("item status, phase, and text changes", () => {
  const next = snapshot({
    features: [{ id: "core", title: "Core", items: [
      { id: "login", title: "Login", status: "done", phase_ids: ["mvp", "v2"] },
      { id: "signup", title: "Sign up", status: "blocked", description: "SSO" },
      { id: "reset", title: "Reset", status: "todo" },
    ] }],
  });
  expect(tags(snapshot({}), next)).toEqual([
    ["success", 'Feature "Login" marked done.', "login"],
    ["edited", 'Moved feature "Login" to MVP, V2.', "login"],
    ["failure", 'Feature "Sign up" blocked.', "signup"],
    ["edited", 'Feature "Sign up" updated.', "signup"],
    ["created", 'Feature added "Reset" to Core', "reset"],
  ]);
  expect(tags(next, snapshot({}))).toContainEqual(["deleted", 'Feature removed "Reset" from Core', "reset"]);
  expect(tags(next, snapshot({}))).toContainEqual(["edited", 'Feature "Login" marked to-do.', "login"]);
});

test("moving an item across categories is one edit", () => {
  const next = snapshot({ features: [
    { id: "core", title: "Core", items: [{ id: "signup", title: "Signup", status: "in_progress" }] },
    { id: "auth", title: "Auth", items: [{ id: "login", title: "Login", status: "todo", phase_ids: ["mvp"] }] },
  ] });
  expect(tags(snapshot({}), next)).toEqual([
    ["created", 'Added feature category "Auth".', null],
    ["edited", 'Feature "Login" updated.', "login"],
  ]);
});

test("categories and phases: add, rename, remove, reorder", () => {
  const next = snapshot({
    feature_phases: [{ id: "v2", title: "Version 2" }, { id: "mvp", title: "MVP" }, { id: "v3", title: "V3" }],
    features: [{ id: "platform", title: "Platform", items: [] }],
  });
  expect(tags(snapshot({}), next)).toEqual([
    ["edited", 'Renamed feature phase "V2" to "Version 2".', null],
    ["created", 'Added feature phase "V3".', null],
    ["edited", "Reordered feature phases.", null],
    ["created", 'Added feature category "Platform".', null],
    ["deleted", 'Removed feature category "Core".', null],
    ["deleted", 'Feature removed "Login" from Core', "login"],
    ["deleted", 'Feature removed "Signup" from Core', "signup"],
  ]);
});
