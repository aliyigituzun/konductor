import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { GLOBAL_DIR, GLOBAL_REGISTRY } from "./paths.js";
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

async function ensureGlobalDir(): Promise<void> {
  if (!existsSync(GLOBAL_DIR)) {
    await mkdir(GLOBAL_DIR, { recursive: true });
  }
}

export async function readRegistry(): Promise<Registry> {
  await ensureGlobalDir();
  if (!existsSync(GLOBAL_REGISTRY)) {
    return { schema_version: "0.2.0", projects: [] };
  }
  const raw = await readFile(GLOBAL_REGISTRY, "utf-8");
  return normalizeRegistry(JSON.parse(raw));
}

export async function writeRegistry(registry: Registry): Promise<void> {
  await ensureGlobalDir();
  await writeFile(
    GLOBAL_REGISTRY,
    JSON.stringify(
      RegistrySchema.parse({
        ...registry,
        schema_version: "0.2.0",
      }),
      null,
      2,
    ),
    "utf-8",
  );
}

export async function upsertProject(entry: RegistryEntry): Promise<void> {
  const registry = await readRegistry();
  const idx = registry.projects.findIndex((p) => p.id === entry.id);
  if (idx >= 0) {
    registry.projects[idx] = entry;
  } else {
    registry.projects.push(entry);
  }
  await writeRegistry(registry);
}

export async function removeProject(id: string): Promise<void> {
  const registry = await readRegistry();
  registry.projects = registry.projects.filter((p) => p.id !== id);
  await writeRegistry(registry);
}

export async function getProject(id: string): Promise<RegistryEntry | undefined> {
  const registry = await readRegistry();
  return registry.projects.find((p) => p.id === id);
}

/**
 * A registered project is "reachable" when its repo_path still exists on disk.
 * If the directory was moved or removed, the registry entry is stale and the
 * project can no longer be found at the path Konductor recorded for it.
 */
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
