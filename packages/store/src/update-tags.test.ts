import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendUpdate, readUpdates } from "./updates.js";
import { repoLocal } from "./paths.js";
import { inferUpdateTags } from "./update-tags.js";
import type { UpdateAction, UpdateSubject } from "@konductor/schema";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "konductor-update-tags-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const base = { id: "", at: "2026-09-19T12:00:00.000Z", kind: "milestone" as const, agent: "dashboard" };

test("infers subject and action from legacy message shapes", () => {
  const cases: [string, UpdateSubject | undefined, UpdateAction | undefined][] = [
    ['Feature added "Login" to Core → To-do added "Login"', "feature", "created"],
    ['To-do added "Login" → Feature added "Login"', "todo", "created"],
    ['Added feature phase "MVP".', "feature", "created"],
    ['Recorded decision "DB".', "decision", "created"],
    ['Decided "DB": Postgres.', "decision", "success"],
    ['Review link "Homepage" created with 2 pages.', "review", "created"],
    ["Preview of main failed to start on :4100.", "preview", "failure"],
    ["Stopped preview of main on :4100.", "preview", "deleted"],
    ['Queued Claude Code agent "fix-login".', "agent", "created"],
    ['Claude Code agent "fix-login" failed (exit 1).', "agent", "failure"],
    ["Refactored the auth module.", undefined, undefined],
    // Shapes found untagged in a real project database.
    ['Added feature "Agent Tokens" to Auth & Token.', "feature", "created"],
    ['Feature removed "Login" from Core', "feature", "deleted"],
    ['Feature "Login" marked done.', "feature", "success"],
    ['Feature "Login" blocked.', "feature", "failure"],
    ['Feature "Login" marked in progress.', "feature", "edited"],
    ['Renamed feature phase "V2" to "Version 2".', "feature", "edited"],
    ['Review link "Homepage" revoked.', "review", "deleted"],
    ['Change request "Move the CTA" marked resolved.', "review", "success"],
    ['Change request "Move the CTA" marked in progress.', "review", "edited"],
    ['Claude Code agent "fix-login" started.', "agent", "edited"],
    ["Stopped Claude Code run r1 (no live agent).", "agent", "deleted"],
    ["Preview of main on :4100 exited.", "preview", "failure"],
    ["Preview of main ready on :4100.", "preview", "success"],
    ["Preview of main on :4100 died while the host was down.", "preview", "failure"],
  ];
  for (const [message, subject, action] of cases) {
    expect(inferUpdateTags({ ...base, message }), message).toEqual({ ...(subject ? { subject } : {}), ...(action ? { action } : {}) });
  }
  expect(inferUpdateTags({ ...base, message: "Reading files.", run_id: "r1" })).toEqual({ subject: "agent" });
  // Older CLI sessions wrote without a run context; a non-system author is still an agent.
  expect(inferUpdateTags({ ...base, agent: "claude-code", message: "Verified appendUpdate writes correctly." })).toEqual({ subject: "agent" });
  expect(inferUpdateTags({ ...base, agent: "konductor-host", message: "Some host note." })).toEqual({});
  expect(inferUpdateTags({ ...base, message: "Done.", run_id: "r1", task_state: "completed" })).toEqual({ subject: "agent", action: "success" });
  expect(inferUpdateTags({ ...base, message: 'Decided "X": y.', subject: "todo", action: "edited" })).toEqual({});
});

test("migration backfills tags on existing rows and reconstructs feature history", async () => {
  const paths = repoLocal(dir);
  await mkdir(join(paths.database, ".."), { recursive: true });
  const db = new Database(paths.database, { create: true, strict: true });
  db.exec(`
    CREATE TABLE imports (source TEXT PRIMARY KEY);
    CREATE TABLE updates (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, body TEXT NOT NULL CHECK(json_valid(body)));
    PRAGMA user_version = 6;
  `);
  const insert = db.query("INSERT INTO updates (id, body) VALUES (?, ?)");
  insert.run("a", JSON.stringify({ ...base, id: "a", message: 'To-do added "Ship"' }));
  insert.run("b", JSON.stringify({ ...base, id: "b", kind: "brief", message: "Looked at the router.", run_id: "run-1", agent: "Claude Code" }));
  insert.run("c", JSON.stringify({ ...base, id: "c", message: "Free-form note." }));
  db.close();

  const rows = await readUpdates(dir);
  expect(rows.map((row) => [row.id, row.subject, row.action])).toEqual([
    ["a", "todo", "created"],
    ["b", "agent", undefined],
    ["c", undefined, undefined],
  ]);
  expect(new Database(paths.database).query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version).toBe(8);
});

test("appendUpdate tags untagged agent notes at write time", async () => {
  const entry = await appendUpdate(dir, { kind: "brief", message: "Reading the schema.", agent: "Claude Code", run_id: "run-2" });
  expect(entry.subject).toBe("agent");
  const explicit = await appendUpdate(dir, { kind: "brief", message: "Reading the schema.", agent: "Claude Code", run_id: "run-2", subject: "todo", action: "edited" });
  expect([explicit.subject, explicit.action]).toEqual(["todo", "edited"]);
});
