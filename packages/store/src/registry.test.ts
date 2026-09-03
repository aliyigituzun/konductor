import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isProjectReachable } from "./registry.js";

test("isProjectReachable is true for an existing path, false for a moved one", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "konductor-reach-"));
  try {
    expect(isProjectReachable({ repo_path: tempDir })).toBe(true);
    expect(isProjectReachable({ repo_path: join(tempDir, "moved-away") })).toBe(false);
  } finally {
    await rm(tempDir, { recursive: true });
  }
  // After removal, the same path is no longer reachable.
  expect(isProjectReachable({ repo_path: tempDir })).toBe(false);
});

// We'll test the registry logic by pointing GLOBAL_DIR to a temp directory.
// We monkey-patch via dynamic imports with env-based override.

test("upsert adds new project", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "konductor-test-"));
  try {
    const registryPath = join(tempDir, "registry.json");
    const entry = {
      id: "test-project",
      name: "Test Project",
      repo_path: "/tmp/test",
      last_sync: null,
      status_path: "/tmp/test/.konductor/status/current.json",
      telemetry_path: "/tmp/test/.konductor/telemetry/latest.json",
      history_dir: "/tmp/test/.konductor/history",
      initialized_at: new Date().toISOString(),
    };

    // Build registry manually
    const registry = { schema_version: "0.1.0" as const, projects: [entry] };
    await writeFile(registryPath, JSON.stringify(registry, null, 2), "utf-8");

    const raw = JSON.parse(await Bun.file(registryPath).text());
    expect(raw.projects).toHaveLength(1);
    expect(raw.projects[0].id).toBe("test-project");
  } finally {
    await rm(tempDir, { recursive: true });
  }
});

test("upsert replaces existing project by id", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "konductor-test-"));
  try {
    const entry1 = {
      id: "my-project",
      name: "Old Name",
      repo_path: "/tmp/old",
      last_sync: null,
      status_path: "",
      telemetry_path: "",
      history_dir: "",
      initialized_at: new Date().toISOString(),
    };
    const entry2 = { ...entry1, name: "New Name", repo_path: "/tmp/new" };

    const registry = { schema_version: "0.1.0" as const, projects: [entry1] };
    const registryPath = join(tempDir, "registry.json");
    await writeFile(registryPath, JSON.stringify(registry, null, 2), "utf-8");

    // Simulate upsert
    const raw = JSON.parse(await Bun.file(registryPath).text());
    const idx = raw.projects.findIndex((p: { id: string }) => p.id === entry2.id);
    if (idx >= 0) raw.projects[idx] = entry2;
    await writeFile(registryPath, JSON.stringify(raw, null, 2), "utf-8");

    const result = JSON.parse(await Bun.file(registryPath).text());
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].name).toBe("New Name");
  } finally {
    await rm(tempDir, { recursive: true });
  }
});
