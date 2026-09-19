import type { Database } from "bun:sqlite";
import { PreviewInstanceSchema, type PreviewInstance, type PreviewStatus } from "@konductor/schema";
import { withDatabase } from "./database.js";
import { GLOBAL_DATABASE } from "./paths.js";

/**
 * Preview instances live in the host database, not the project's, because the port
 * they occupy is a machine-wide resource the allocator must see across projects.
 */

export const LIVE_PREVIEW_STATUSES: PreviewStatus[] = ["starting", "ready"];

function rowToPreview(row: { body: string }): PreviewInstance {
  return PreviewInstanceSchema.parse(JSON.parse(row.body));
}

function upsert(db: Database, preview: PreviewInstance): PreviewInstance {
  const parsed = PreviewInstanceSchema.parse(preview);
  db.query(`INSERT INTO preview_instances (id, project_id, port, status, created_at, body) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, port = excluded.port,
    status = excluded.status, created_at = excluded.created_at, body = excluded.body`)
    .run(parsed.id, parsed.project_id, parsed.port, parsed.status, Date.parse(parsed.created_at), JSON.stringify(parsed));
  return parsed;
}

export async function putPreview(preview: PreviewInstance): Promise<PreviewInstance> {
  return withDatabase(GLOBAL_DATABASE, (db) => upsert(db, preview));
}

export async function getPreview(id: string): Promise<PreviewInstance | null> {
  return withDatabase(GLOBAL_DATABASE, (db) => {
    const row = db.query<{ body: string }, [string]>("SELECT body FROM preview_instances WHERE id = ?").get(id);
    return row ? rowToPreview(row) : null;
  });
}

export async function patchPreview(id: string, patch: Partial<PreviewInstance>): Promise<PreviewInstance> {
  return withDatabase(GLOBAL_DATABASE, (db) => db.transaction(() => {
    const row = db.query<{ body: string }, [string]>("SELECT body FROM preview_instances WHERE id = ?").get(id);
    if (!row) throw new Error(`Preview ${id} was not found.`);
    return upsert(db, { ...rowToPreview(row), ...patch, id });
  }).immediate());
}

export async function listPreviews(filter: { project_id?: string; live?: boolean } = {}): Promise<PreviewInstance[]> {
  return withDatabase(GLOBAL_DATABASE, (db) => {
    const clauses: string[] = [];
    const args: string[] = [];
    if (filter.project_id) { clauses.push("project_id = ?"); args.push(filter.project_id); }
    if (filter.live) {
      clauses.push(`status IN (${LIVE_PREVIEW_STATUSES.map(() => "?").join(", ")})`);
      args.push(...LIVE_PREVIEW_STATUSES);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return db.query<{ body: string }, string[]>(`SELECT body FROM preview_instances ${where} ORDER BY created_at DESC`)
      .all(...args).map(rowToPreview);
  });
}
