import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTodo, deleteTodo, listTodos, readTodo, updateTodo } from "./todos.js";
import { readStatus, writeStatus } from "./status.js";
import { repoLocal } from "./paths.js";
import type { StatusSnapshot } from "@konductor/schema";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "konductor-todos-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const snapshot: StatusSnapshot = {
  schema_version: "0.2.0",
  project: { id: "demo", name: "Demo" },
  agent: { kind: "test", session_id: null },
  report: { reported_at: "2026-09-19T12:00:00.000Z" },
  status: { state: "todo", summary: "seed", current_phase_id: null },
  phases: [],
  features: [{ id: "core", title: "Core", items: [{ id: "login", title: "Login", status: "todo" }] }],
  issues: { blockers: [], decisions_needed: [], external_dependencies: [], risks: [] },
  next_actions: [],
};

const base = {
  title: "Ship login",
  status: "todo" as const,
  related_feature_item_ids: ["login"],
  related_asset_ids: [],
  feature_item_id: "login",
  creates_feature: false,
  imminent: false,
};

test("to-dos are created, listed, patched and deleted in SQLite", async () => {
  const created = await createTodo(dir, base);
  expect(created.id).toBe("ship-login");
  expect((await createTodo(dir, base)).id).toBe("ship-login-2");
  await expect(createTodo(dir, { ...base, id: "ship-login" })).rejects.toThrow("already exists");

  const updated = await updateTodo(dir, "ship-login", { status: "done", imminent: true });
  expect(updated).toMatchObject({ status: "done", imminent: true, title: "Ship login" });
  expect(await readTodo(dir, "ship-login")).toEqual(updated);
  expect((await listTodos(dir)).map((todo) => todo.id)).toEqual(["ship-login", "ship-login-2"]);

  expect(await deleteTodo(dir, "ship-login-2")).toBe(true);
  expect(await deleteTodo(dir, "ship-login-2")).toBe(false);
  expect((await listTodos(dir)).map((todo) => todo.id)).toEqual(["ship-login"]);
});

test("status reads overlay to-dos and derived feature links; writes never persist them", async () => {
  await writeStatus(dir, snapshot);
  await createTodo(dir, base);

  const read = (await readStatus(dir))!;
  expect(read.todos?.map((todo) => todo.id)).toEqual(["ship-login"]);
  expect(read.features?.[0]?.items[0]).toMatchObject({ id: "login", todo_id: "ship-login" });

  // A whole-snapshot writer without `todos` (an agent's write_status, a stale
  // process) must not affect the to-do list.
  await writeStatus(dir, { ...read, todos: [], features: snapshot.features });
  const file = JSON.parse(await readFile(repoLocal(dir).currentStatus, "utf-8"));
  expect(file.todos).toBeUndefined();
  expect((await readStatus(dir))!.todos?.map((todo) => todo.id)).toEqual(["ship-login"]);
});

test("legacy snapshot to-dos import once, even when the first operation is a write", async () => {
  const paths = repoLocal(dir);
  await mkdir(paths.statusDir, { recursive: true });
  const legacy = { ...snapshot, todos: [{ ...base, id: "legacy" }, { ...base, id: "legacy-2", title: "Second" }] };
  await writeFile(paths.currentStatus, JSON.stringify(legacy), "utf-8");

  await writeStatus(dir, snapshot);
  expect((await listTodos(dir)).map((todo) => todo.id)).toEqual(["legacy", "legacy-2"]);

  // The file is not re-imported after the marker commits.
  await writeFile(paths.currentStatus, JSON.stringify({ ...legacy, todos: [{ ...base, id: "late" }] }), "utf-8");
  expect((await listTodos(dir)).map((todo) => todo.id)).toEqual(["legacy", "legacy-2"]);
});
