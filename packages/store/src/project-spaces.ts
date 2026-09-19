import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import { ProjectSpaceSchema, type ProjectSpace, type ProjectSpaceSummary } from "@konductor/schema";
import { withDatabase } from "./database.js";
import { GLOBAL_DATABASE } from "./paths.js";

function readSpaces(db: Database): ProjectSpace[] {
  return db.query<{ body: string }, []>("SELECT body FROM project_spaces ORDER BY created_at DESC").all()
    .map((row) => ProjectSpaceSchema.parse(JSON.parse(row.body)));
}

function countAdmins(db: Database, scopeId: string): number {
  const row = db.query<{ n: number }, [string]>(
    "SELECT COUNT(*) AS n FROM auth_users WHERE scope_type = 'project_space' AND scope_id = ?",
  ).get(scopeId);
  return row?.n ?? 0;
}

export async function listProjectSpaces(): Promise<ProjectSpaceSummary[]> {
  return withDatabase(GLOBAL_DATABASE, (db) =>
    readSpaces(db).map((space) => ({
      ...space,
      admin_count: countAdmins(db, space.id),
      // Project registration is not yet namespaced by space; see IMPLEMENTATION.md "Next Work".
      project_count: 0,
    })));
}

export async function getProjectSpace(id: string): Promise<ProjectSpace | null> {
  return withDatabase(GLOBAL_DATABASE, (db) => {
    const row = db.query<{ body: string }, [string]>("SELECT body FROM project_spaces WHERE id = ?").get(id);
    return row ? ProjectSpaceSchema.parse(JSON.parse(row.body)) : null;
  });
}

export async function createProjectSpace(name: string): Promise<ProjectSpace> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A project space needs a name.");
  const now = new Date().toISOString();
  const space = ProjectSpaceSchema.parse({
    schema_version: "0.1.0",
    id: randomUUID(),
    name: trimmed,
    created_at: now,
    updated_at: now,
  });
  withDatabase(GLOBAL_DATABASE, (db) => {
    db.query("INSERT INTO project_spaces (id, name, created_at, body) VALUES (?, ?, ?, ?)")
      .run(space.id, space.name, Date.parse(space.created_at), JSON.stringify(space));
  });
  return space;
}
