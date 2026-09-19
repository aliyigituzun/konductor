import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { GLOBAL_DIR } from "@konductor/store";
import type { AgentAdapterManifest } from "@konductor/schema";
import { AgentAdapterManifestSchema } from "@konductor/schema";
import { builtinAdapters } from "./builtin.js";
import { adapterSetupStatus, resolveAdapterBinary } from "../setup.js";

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
  return join(GLOBAL_DIR, "adapters");
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

export type AdapterCatalogEntry = {
  id: string;
  title: string;
  binary: string;
  homepage: string | null;
  verified: boolean;
  source: AdapterSource;
  manifest_path: string | null;
  launch: string;
  providers: AgentAdapterManifest["providers"];
  model_format: AgentAdapterManifest["model_format"];
  mcp: AgentAdapterManifest["mcp"]["kind"];
  telemetry: AgentAdapterManifest["telemetry"]["kind"];
  setup: Awaited<ReturnType<typeof adapterSetupStatus>>;
  installed: boolean;
  path: string | null;
  version: string | null;
};

export type AdapterCatalog = {
  adapters: AdapterCatalogEntry[];
  issues: AdapterLoadIssue[];
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

/**
 * Describe every harness available to a project without requiring the agent host.
 * Profile editing is configuration and must keep working while no agent is running.
 */
export async function adapterCatalog(repoPath?: string): Promise<AdapterCatalog> {
  const registry = await loadAdapters(repoPath);
  const adapters = await Promise.all(
    registry.adapters.map(async ({ manifest, source, path: manifestPath }) => {
      const [detection, setup] = await Promise.all([
        detectAdapter(manifest),
        adapterSetupStatus(manifest),
      ]);
      const effectiveBinary = resolveAdapterBinary(manifest);
      return {
        id: manifest.id,
        title: manifest.title,
        binary: manifest.binary,
        homepage: manifest.homepage ?? null,
        verified: manifest.verified,
        source,
        manifest_path: manifestPath,
        launch: [manifest.binary, ...manifest.launch.args].join(" "),
        providers: manifest.providers,
        model_format: manifest.model_format,
        mcp: manifest.mcp.kind,
        telemetry: manifest.telemetry.kind,
        setup,
        ...detection,
        installed: effectiveBinary !== null,
        path: effectiveBinary,
      } satisfies AdapterCatalogEntry;
    }),
  );
  return { adapters, issues: registry.issues };
}
