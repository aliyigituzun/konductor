import { existsSync } from "node:fs";
import { GLOBAL_DATABASE, GLOBAL_REGISTRY } from "./paths.js";
import { withDatabase, importOnce, legacyJson } from "./database.js";
import type { Database } from "bun:sqlite";
import {
  RegistrySchema,
  type Registry,
  type RegistryEntry,
} from "@konductor/schema";

function normalizeRegistry(raw: unknown): Registry {
  const data = (raw ?? {}) as { schema_version?: string; projects?: Array<Record<string, unknown>> };
  return RegistrySchema.parse({
    schema_version: "0.2.0",
    projects: (data.projects ?? []).map((project) => ({
      active_run_count: 0,
      default_profile: null,
      last_agent_activity_at: null,
      ...project,
    })),
  });
}

function withRegistry<T>(work: (db: Database) => T): T {
  return withDatabase(GLOBAL_DATABASE, (db) => {
    importOnce(db, GLOBAL_REGISTRY, () => {
      const raw = legacyJson(GLOBAL_REGISTRY);
      if (raw === undefined) return;
      for (const project of normalizeRegistry(raw).projects) {
        db.query("INSERT OR IGNORE INTO projects VALUES (?, ?)").run(project.id, JSON.stringify(project));
      }
    });
    return work(db);
  });
}

export async function readRegistry(): Promise<Registry> {
  return withRegistry((db) => normalizeRegistry({
    projects: db.query<{ body: string }, []>("SELECT body FROM projects ORDER BY rowid").all()
      .map((row) => JSON.parse(row.body)),
  }));
}

export async function writeRegistry(registry: Registry): Promise<void> {
  const parsed = RegistrySchema.parse({ ...registry, schema_version: "0.2.0" });
  withRegistry((db) => db.transaction(() => {
    db.exec("DELETE FROM projects");
    for (const project of parsed.projects) {
      db.query("INSERT INTO projects VALUES (?, ?)").run(project.id, JSON.stringify(project));
    }
  }).immediate());
}

export async function upsertProject(entry: RegistryEntry): Promise<void> {
  const parsed = RegistrySchema.parse({ schema_version: "0.2.0", projects: [entry] }).projects[0]!;
  withRegistry((db) => db.query("INSERT INTO projects VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body")
    .run(parsed.id, JSON.stringify(parsed)));
}

export async function removeProject(id: string): Promise<void> {
  withRegistry((db) => db.query("DELETE FROM projects WHERE id = ?").run(id));
}

export async function getProject(id: string): Promise<RegistryEntry | undefined> {
  return withRegistry((db) => {
    const row = db.query<{ body: string }, [string]>("SELECT body FROM projects WHERE id = ?").get(id);
    return row ? normalizeRegistry({ projects: [JSON.parse(row.body)] }).projects[0] : undefined;
  });
}

export function isProjectReachable(entry: Pick<RegistryEntry, "repo_path">): boolean {
  return existsSync(entry.repo_path);
}

export type RegistryEntryWithReachability = RegistryEntry & { reachable: boolean };

/** Read the registry and annotate each entry with whether its repo_path exists. */
export async function readRegistryWithReachability(): Promise<{
  schema_version: Registry["schema_version"];
  projects: RegistryEntryWithReachability[];
}> {
  const registry = await readRegistry();
  return {
    schema_version: registry.schema_version,
    projects: registry.projects.map((entry) => ({
      ...entry,
      reachable: isProjectReachable(entry),
    })),
  };
}
