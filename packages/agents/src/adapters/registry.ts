import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AgentAdapterManifest } from "@konductor/schema";
import { AgentAdapterManifestSchema } from "@konductor/schema";
import { builtinAdapters } from "./builtin.js";

export type AdapterSource = "builtin" | "user" | "project";

export type LoadedAdapter = {
  manifest: AgentAdapterManifest;
  source: AdapterSource;
  /** File the manifest came from, for user and project adapters. */
  path: string | null;
};

export type AdapterLoadIssue = { path: string; message: string };

export type AdapterRegistry = {
  adapters: LoadedAdapter[];
  /** Manifests that failed to parse. Surfaced by `konductor doctor`. */
  issues: AdapterLoadIssue[];
};

export function userAdaptersDir(): string {
  return join(homedir(), ".konductor", "adapters");
}

export function projectAdaptersDir(repoPath: string): string {
  return join(repoPath, ".konductor", "adapters");
}

async function loadDir(dir: string, source: AdapterSource): Promise<AdapterRegistry> {
  const adapters: LoadedAdapter[] = [];
  const issues: AdapterLoadIssue[] = [];
  if (!existsSync(dir)) return { adapters, issues };

  const entries = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  for (const entry of entries) {
    const path = join(dir, entry);
    try {
      const manifest = AgentAdapterManifestSchema.parse(JSON.parse(await readFile(path, "utf-8")));
      adapters.push({ manifest, source, path });
    } catch (error) {
      issues.push({ path, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { adapters, issues };
}

/**
 * Load every adapter available to a project.
 *
 * Later sources win on id collision, so a project can override a user adapter and a
 * user can override a built-in without editing Konductor.
 */
export async function loadAdapters(repoPath?: string): Promise<AdapterRegistry> {
  const builtin: LoadedAdapter[] = builtinAdapters().map((manifest) => ({
    manifest,
    source: "builtin" as const,
    path: null,
  }));

  const user = await loadDir(userAdaptersDir(), "user");
  const project = repoPath
    ? await loadDir(projectAdaptersDir(repoPath), "project")
    : { adapters: [], issues: [] };

  const byId = new Map<string, LoadedAdapter>();
  for (const adapter of [...builtin, ...user.adapters, ...project.adapters]) {
    byId.set(adapter.manifest.id, adapter);
  }

  return {
    adapters: [...byId.values()].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id)),
    issues: [...user.issues, ...project.issues],
  };
}

export class UnknownAdapterError extends Error {
  constructor(id: string, known: string[]) {
    super(
      `Unknown agent adapter "${id}". Available: ${known.join(", ") || "none"}. ` +
        `Add one as JSON in ${userAdaptersDir()}.`,
    );
    this.name = "UnknownAdapterError";
  }
}

export async function resolveAdapter(
  id: string,
  repoPath?: string,
): Promise<AgentAdapterManifest> {
  const registry = await loadAdapters(repoPath);
  const found = registry.adapters.find((adapter) => adapter.manifest.id === id);
  if (!found) {
    throw new UnknownAdapterError(
      id,
      registry.adapters.map((adapter) => adapter.manifest.id),
    );
  }
  return found.manifest;
}

export type AdapterDetection = {
  installed: boolean;
  /** Absolute path of the resolved binary. */
  path: string | null;
  version: string | null;
};

/** Check whether an adapter's binary is on PATH, and what version it reports. */
export async function detectAdapter(manifest: AgentAdapterManifest): Promise<AdapterDetection> {
  const path = Bun.which(manifest.binary);
  if (!path) return { installed: false, path: null, version: null };

  try {
    const proc = Bun.spawn([manifest.binary, ...manifest.detect], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return {
      installed: true,
      path,
      version: code === 0 ? stdout.trim().split("\n")[0]?.trim() || null : null,
    };
  } catch {
    // The binary exists but would not run; still installed, version unknown.
    return { installed: true, path, version: null };
  }
}
