import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoLocal } from "./paths.js";
import { StatusSnapshotSchema, type StatusSnapshot } from "@konductor/schema";
import { listTodos } from "./todos.js";

/**
 * To-dos are owned by the project database (see todos.ts). The snapshot file is
 * the interchange for everything else, so reads overlay the to-do table and the
 * feature → to-do links derived from it, and writes never persist `todos`.
 */
async function overlayTodos(cwd: string, snapshot: StatusSnapshot): Promise<StatusSnapshot> {
  const todos = await listTodos(cwd);
  const todoIdByFeature = new Map<string, string>();
  for (const todo of todos) {
    if (todo.feature_item_id && !todoIdByFeature.has(todo.feature_item_id)) todoIdByFeature.set(todo.feature_item_id, todo.id);
  }
  const features = snapshot.features?.map((category) => ({
    ...category,
    items: category.items.map(({ todo_id: _stale, ...item }) => {
      const todoId = todoIdByFeature.get(item.id);
      return todoId ? { ...item, todo_id: todoId } : item;
    }),
  }));
  return { ...snapshot, ...(features ? { features } : {}), todos };
}

export async function readStatus(cwd: string): Promise<StatusSnapshot | null> {
  const paths = repoLocal(cwd);
  if (!existsSync(paths.currentStatus)) return null;
  const raw = await readFile(paths.currentStatus, "utf-8");
  return overlayTodos(cwd, StatusSnapshotSchema.parse(JSON.parse(raw)));
}

export async function writeStatus(
  cwd: string,
  snapshot: StatusSnapshot
): Promise<void> {
  // Callers may originate outside TypeScript's type boundary (for example, MCP
  // and HTTP request handlers), so validate the complete snapshot before backing
  // up or replacing the current status file.
  const { todos: _ownedByDatabase, ...validatedSnapshot } = StatusSnapshotSchema.parse(snapshot);
  const paths = repoLocal(cwd);
  // Import any legacy `todos` still in the file before this write drops them.
  await listTodos(cwd);
  await mkdir(paths.statusDir, { recursive: true });
  await mkdir(paths.backupsDir, { recursive: true });

  if (existsSync(paths.currentStatus)) {
    const ts = new Date().toISOString().replace(/:/g, "-").replace(/\./g, "-");
    const backupFile = join(paths.backupsDir, `current-${ts}.json`);
    await copyFile(paths.currentStatus, backupFile);
  }

  await writeFile(paths.currentStatus, JSON.stringify(validatedSnapshot, null, 2), "utf-8");
}

export async function readRawStatus(cwd: string): Promise<string | null> {
  const paths = repoLocal(cwd);
  if (!existsSync(paths.currentStatus)) return null;
  return readFile(paths.currentStatus, "utf-8");
}
