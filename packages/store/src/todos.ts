import type { Database } from "bun:sqlite";
import { repoLocal } from "./paths.js";
import { withDatabase, importOnce, legacyJson } from "./database.js";
import { TodoItemSchema, type TodoItem } from "@konductor/schema";

/**
 * To-dos live in the project database, not in the status snapshot. The snapshot
 * is replaced wholesale by several writers (MCP `write_status`, older dashboard
 * processes whose schema strips unknown keys), and any of them silently dropped
 * to-dos when they were part of the file. `readStatus` overlays this table onto
 * the snapshot, so API consumers still see `todos`; `writeStatus` never persists
 * them. A snapshot's legacy `todos` array is imported once and the file is left
 * untouched.
 */

const LEGACY_IMPORT_SUFFIX = "#todos";

export type CreateTodoInput = Omit<TodoItem, "id"> & { id?: string };

export type TodoPatch = Partial<Pick<TodoItem, "title" | "description" | "status" | "related_feature_item_ids" | "related_asset_ids" | "feature_item_id" | "creates_feature" | "imminent">>;

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function rowToTodo(row: { body: string }): TodoItem {
  return TodoItemSchema.parse(JSON.parse(row.body));
}

function insertTodo(db: Database, todo: TodoItem, ignoreExisting: boolean): boolean {
  const result = db
    .query(`INSERT ${ignoreExisting ? "OR IGNORE " : ""}INTO todos (id, status, body) VALUES (?, ?, ?)`)
    .run(todo.id, todo.status, JSON.stringify(todo));
  return result.changes > 0;
}

function replaceTodo(db: Database, todo: TodoItem): void {
  db.query("UPDATE todos SET status = ?, body = ? WHERE id = ?").run(todo.status, JSON.stringify(todo), todo.id);
}

function selectTodo(db: Database, id: string): TodoItem | null {
  const row = db.query<{ body: string }, [string]>("SELECT body FROM todos WHERE id = ?").get(id);
  return row ? rowToTodo(row) : null;
}

function selectTodos(db: Database): TodoItem[] {
  return db.query<{ body: string }, []>("SELECT body FROM todos ORDER BY sequence").all().map(rowToTodo);
}

function importLegacyTodos(db: Database, statusPath: string): void {
  importOnce(db, statusPath + LEGACY_IMPORT_SUFFIX, () => {
    const raw = legacyJson(statusPath) as { todos?: unknown[] } | undefined;
    for (const entry of raw?.todos ?? []) insertTodo(db, TodoItemSchema.parse(entry), true);
  });
}

function withTodos<T>(cwd: string, work: (db: Database) => T): T {
  const paths = repoLocal(cwd);
  return withDatabase(paths.database, (db) => {
    importLegacyTodos(db, paths.currentStatus);
    return work(db);
  });
}

/** To-dos in creation order. */
export async function listTodos(cwd: string): Promise<TodoItem[]> {
  return withTodos(cwd, selectTodos);
}

export async function readTodo(cwd: string, id: string): Promise<TodoItem | null> {
  return withTodos(cwd, (db) => selectTodo(db, id));
}

/**
 * Creates a to-do. Without an id, the title's slug is used and suffixed until
 * unique. A caller-supplied id must be free.
 */
export async function createTodo(cwd: string, input: CreateTodoInput): Promise<TodoItem> {
  const { id: requestedId, ...fields } = input;
  return withTodos(cwd, (db) => db.transaction(() => {
    const taken = new Set(db.query<{ id: string }, []>("SELECT id FROM todos").all().map((row) => row.id));
    let id = requestedId;
    if (id) {
      if (taken.has(id)) throw new Error(`To-do ${id} already exists.`);
    } else {
      const root = slugify(fields.title) || "todo";
      id = root;
      for (let n = 2; taken.has(id); n += 1) id = `${root}-${n}`;
    }
    const todo = TodoItemSchema.parse({ ...fields, id });
    insertTodo(db, todo, false);
    return todo;
  }).immediate());
}

export async function updateTodo(cwd: string, id: string, patch: TodoPatch): Promise<TodoItem> {
  return withTodos(cwd, (db) => db.transaction(() => {
    const current = selectTodo(db, id);
    if (!current) throw new Error(`To-do ${id} not found.`);
    const next = TodoItemSchema.parse({ ...current, ...patch });
    replaceTodo(db, next);
    return next;
  }).immediate());
}

export async function deleteTodo(cwd: string, id: string): Promise<boolean> {
  return withTodos(cwd, (db) => db.query("DELETE FROM todos WHERE id = ?").run(id).changes > 0);
}
