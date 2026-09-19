import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtinAdapters } from "./builtin.js";
import { UnknownAdapterError, detectAdapter, projectAdaptersDir } from "./registry.js";

/**
 * User adapters live under KONDUCTOR_HOME, which the store resolves at import
 * time, so the layering tests run in a child process with an isolated home.
 */

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "konductor-adapters-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

async function worker(code: string): Promise<void> {
  const child = Bun.spawn([process.execPath, "-e", `
    import { loadAdapters, resolveAdapter, userAdaptersDir, UnknownAdapterError } from ${JSON.stringify(new URL("./registry.ts", import.meta.url).href)};
    import { builtinAdapters } from ${JSON.stringify(new URL("./builtin.ts", import.meta.url).href)};
    import { expect } from "bun:test";
    const repo = ${JSON.stringify(dir)};
    ${code}
  `], { env: { ...process.env, KONDUCTOR_HOME: join(dir, "home") }, stdout: "pipe", stderr: "pipe" });
  const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (exit !== 0) throw new Error(stderr);
}

function manifest(id: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    id,
    title: id,
    binary: id,
    providers: [{ id: "local", title: "Local" }],
    ...extra,
  });
}

describe("builtin adapters", () => {
  test("every built-in manifest is valid and ids are unique", () => {
    const adapters = builtinAdapters();
    expect(adapters.length).toBeGreaterThan(0);
    const ids = adapters.map((adapter) => adapter.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const adapter of adapters) {
      expect(adapter.providers.length).toBeGreaterThan(0);
      expect(adapter.binary.length).toBeGreaterThan(0);
    }
    expect(ids).toContain("claude_code");
  });
});

describe("loadAdapters", () => {
  test("returns only built-ins when no user or project manifests exist", async () => {
    await worker(`
      const registry = await loadAdapters(repo);
      expect(registry.issues).toEqual([]);
      expect(registry.adapters.every((a) => a.source === "builtin" && a.path === null)).toBe(true);
      expect(registry.adapters.map((a) => a.manifest.id)).toEqual(builtinAdapters().map((a) => a.id).sort());
    `);
  });

  test("user manifests override built-ins and project manifests override users", async () => {
    await mkdir(join(dir, "home", "adapters"), { recursive: true });
    await mkdir(projectAdaptersDir(dir), { recursive: true });
    await writeFile(join(dir, "home", "adapters", "claude_code.json"), manifest("claude_code", { title: "User Claude" }));
    await writeFile(join(dir, "home", "adapters", "aider.json"), manifest("aider", { title: "User Aider" }));
    await writeFile(join(projectAdaptersDir(dir), "aider.json"), manifest("aider", { title: "Project Aider" }));
    await writeFile(join(projectAdaptersDir(dir), "notes.txt"), "ignored");
    await worker(`
      expect(userAdaptersDir()).toBe(repo + "/home/adapters");
      const registry = await loadAdapters(repo);
      expect(registry.issues).toEqual([]);
      const byId = Object.fromEntries(registry.adapters.map((a) => [a.manifest.id, a]));
      expect(byId.claude_code.source).toBe("user");
      expect(byId.claude_code.manifest.title).toBe("User Claude");
      expect(byId.claude_code.path).toBe(repo + "/home/adapters/claude_code.json");
      expect(byId.aider.source).toBe("project");
      expect(byId.aider.manifest.title).toBe("Project Aider");
      // Defaults are filled in for sparse manifests.
      expect(byId.aider.manifest.detect).toEqual(["--version"]);
      expect(byId.aider.manifest.mcp).toEqual({ kind: "none" });
      // Sorted by id, each id exactly once.
      const ids = registry.adapters.map((a) => a.manifest.id);
      expect(ids).toEqual([...ids].sort());
      expect(new Set(ids).size).toBe(ids.length);

      // Without a repo the project layer is not consulted.
      const userOnly = await loadAdapters();
      expect(userOnly.adapters.find((a) => a.manifest.id === "aider").source).toBe("user");
    `);
  });

  test("broken manifests are reported as issues without hiding the good ones", async () => {
    await mkdir(join(dir, "home", "adapters"), { recursive: true });
    await mkdir(projectAdaptersDir(dir), { recursive: true });
    await writeFile(join(dir, "home", "adapters", "bad-json.json"), "{ not json");
    await writeFile(join(projectAdaptersDir(dir), "bad-schema.json"), JSON.stringify({ id: "Bad Id", title: "x", binary: "x", providers: [] }));
    await writeFile(join(projectAdaptersDir(dir), "good.json"), manifest("good"));
    await worker(`
      const registry = await loadAdapters(repo);
      expect(registry.adapters.some((a) => a.manifest.id === "good")).toBe(true);
      expect(registry.issues.map((i) => i.path.split("/").pop())).toEqual(["bad-json.json", "bad-schema.json"]);
      expect(registry.issues[1].message).toContain("provider");
    `);
  });

  test("normalizes version 0.3 manifests so existing custom adapters stay selectable", async () => {
    await mkdir(projectAdaptersDir(dir), { recursive: true });
    await writeFile(join(projectAdaptersDir(dir), "legacy.json"), JSON.stringify({
      schema_version: "0.3.0",
      id: "legacy",
      title: "Legacy adapter",
      binary: "legacy",
      interactive: { args: ["--model", "{{model}}"] },
    }));
    await worker(`
      const registry = await loadAdapters(repo);
      expect(registry.issues).toEqual([]);
      const legacy = registry.adapters.find((item) => item.manifest.id === "legacy").manifest;
      expect(legacy.schema_version).toBe("0.4.0");
      expect(legacy.launch.args).toEqual(["--model", "{{model}}"]);
      expect(legacy.providers).toEqual([{ id: "default", title: "Default", models: [] }]);
    `);
  });
});

describe("resolveAdapter", () => {
  test("returns the winning manifest or lists what is available", async () => {
    await mkdir(projectAdaptersDir(dir), { recursive: true });
    await writeFile(join(projectAdaptersDir(dir), "mine.json"), manifest("mine"));
    await worker(`
      expect((await resolveAdapter("mine", repo)).title).toBe("mine");
      expect((await resolveAdapter("claude_code")).id).toBe("claude_code");
      const attempt = resolveAdapter("nope", repo);
      await expect(attempt).rejects.toBeInstanceOf(UnknownAdapterError);
      await expect(attempt).rejects.toThrow('Unknown agent adapter "nope"');
      await expect(attempt).rejects.toThrow("mine");
      await expect(attempt).rejects.toThrow(userAdaptersDir());
    `);
  });
});

describe("detectAdapter", () => {
  test("reports a missing binary without running anything", async () => {
    const result = await detectAdapter({
      ...builtinAdapters()[0]!,
      binary: "konductor-definitely-not-installed",
    });
    expect(result).toEqual({ installed: false, path: null, version: null });
  });

  test("reports the resolved path and first line of version output", async () => {
    const result = await detectAdapter({
      ...builtinAdapters()[0]!,
      binary: "git",
      detect: ["--version"],
    });
    expect(result.installed).toBe(true);
    expect(result.path).toEndWith("/git");
    expect(result.version).toMatch(/^git version/);
  });

  test("leaves the version unknown when the probe exits non-zero", async () => {
    const result = await detectAdapter({
      ...builtinAdapters()[0]!,
      binary: "false",
      detect: [],
    });
    expect(result.installed).toBe(true);
    expect(result.version).toBeNull();
  });
});

test("UnknownAdapterError copes with an empty registry", () => {
  expect(new UnknownAdapterError("x", []).message).toContain("Available: none");
});
