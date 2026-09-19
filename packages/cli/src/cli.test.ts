import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * End-to-end coverage of the commands that need neither tmux nor a host daemon.
 *
 * Every command runs as a child process against a throwaway KONDUCTOR_HOME and
 * project directory, exactly as an operator would invoke it. Output is stripped of
 * ANSI styling before assertions so the checks read like the screen does.
 */

const CLI = fileURLToPath(new URL("./index.ts", import.meta.url));

let root: string;
let project: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "konductor-cli-"));
  project = join(root, "proj");
  await mkdir(project);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

type Result = { code: number; out: string; err: string };

async function konductor(args: string[], cwd = project): Promise<Result> {
  const child = Bun.spawn([process.execPath, "run", CLI, ...args], {
    cwd,
    env: { ...process.env, KONDUCTOR_HOME: join(root, "home"), NO_COLOR: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const strip = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "");
  return { code, out: strip(out), err: strip(err) };
}

async function init(): Promise<void> {
  const result = await konductor(["init", "--empty"]);
  expect(result.code, result.err).toBe(0);
}

describe("init", () => {
  test("creates config, status, runtime directories, and a registry entry", async () => {
    await init();
    expect(existsSync(join(project, "konductor.config.json"))).toBe(true);
    expect(existsSync(join(project, ".konductor", "status", "current.json"))).toBe(true);
    // MCP wiring is harness-scoped (`adapters setup`), so init leaves .mcp.json alone.
    expect(existsSync(join(project, ".mcp.json"))).toBe(false);

    const config = JSON.parse(await readFile(join(project, "konductor.config.json"), "utf-8"));
    expect(config).toMatchObject({ schema_version: "0.3.0", project_id: "proj", project_name: "proj" });
    expect(config.agents.profiles.map((p: { id: string }) => p.id)).toEqual(["claude-default"]);

    const projects = await konductor(["projects"]);
    expect(projects.out).toContain("proj");
    expect(projects.out).toContain("All 1 registered project reachable");

    // The registry lives in the isolated home, not the developer's.
    expect(existsSync(join(root, "home", "state.sqlite"))).toBe(true);
  });

  test("status shows the seeded snapshot", async () => {
    await init();
    const status = await konductor(["status"]);
    expect(status.code).toBe(0);
    expect(status.out).toContain("state:     todo");
    expect(status.out).toContain("Project initialized. Awaiting first status update.");
    expect(status.out).toContain("Next Actions");
  });

  test("commands that need a project explain when there is none", async () => {
    const status = await konductor(["status"]);
    expect(status.code).not.toBe(0);
    expect(status.out + status.err).toMatch(/init/i);
  });
});

describe("tokens", () => {
  test("create, list, revoke, and audit an external token", async () => {
    await init();
    const created = await konductor([
      "tokens", "create", "--name", "Review bot", "--role", "custom",
      "--permission", "status.read", "--permission", "files.read", "--expires-in", "7d",
    ]);
    expect(created.code, created.err).toBe(0);
    expect(created.out).toContain("External token created for proj");
    expect(created.out).toContain("role:    custom");
    const token = created.out.match(/^(knd_ext_[a-f0-9]{12}_[A-Za-z0-9_-]+)$/m)?.[1];
    expect(token).toBeDefined();
    const id = created.out.match(/id:\s+([0-9a-f-]{36})/)?.[1]!;

    const listed = await konductor(["tokens", "list"]);
    expect(listed.out).toContain(`${id}  external  active`);
    expect(listed.out).toContain("proj: custom [status.read, files.read]");
    // init already issued the internal identity for the default profile.
    expect(listed.out).toContain("internal  active");
    expect(listed.out).toContain("Claude Code (proj)");

    const revoked = await konductor(["tokens", "revoke", id, "--reason", "rotation"]);
    expect(revoked.code, revoked.err).toBe(0);
    expect(revoked.out).toContain(`Revoked ${id}`);
    expect((await konductor(["tokens", "list"])).out).toContain(`${id}  external  revoked`);

    const audit = await konductor(["tokens", "audit"]);
    expect(audit.out).toContain("token.revoked");
    expect(audit.out).toContain("token.created");
    expect(audit.out).toContain("target=" + id);

    const missing = await konductor(["tokens", "revoke", "nope"]);
    expect(missing.code).not.toBe(0);
    expect(missing.err).toContain("not found");
  });

  test("rejects inconsistent grant flags and bad expiry", async () => {
    await init();
    const cases: Array<[string[], string]> = [
      [["tokens", "create"], "--name"],
      [["tokens", "create", "--name", "x", "--role", "root"], "--role must be"],
      [["tokens", "create", "--name", "x", "--role", "custom"], "at least one --permission"],
      [["tokens", "create", "--name", "x", "--permission", "status.read"], "--role custom"],
      [["tokens", "create", "--name", "x", "--permission", "status.nuke", "--role", "custom"], "Unknown permission"],
      [["tokens", "create", "--name", "x", "--expires-in", "soon"], "--expires-in must look like"],
      [["tokens", "create", "--name", "x", "--expires-at", "2000-01-01T00:00:00Z"], "future"],
      [["tokens", "create", "--name", "x", "--project", "ghost"], "not registered"],
      [["tokens", "bogus"], "Unknown tokens subcommand"],
    ];
    for (const [args, message] of cases) {
      const result = await konductor(args);
      expect(result.code, args.join(" ")).not.toBe(0);
      expect(result.err, args.join(" ")).toContain(message);
    }
    expect((await konductor(["tokens", "list"])).out).not.toContain("external");
  });

  test("sync keeps one internal identity per configured profile", async () => {
    await init();
    const configPath = join(project, "konductor.config.json");
    const config = JSON.parse(await readFile(configPath, "utf-8"));
    config.agents.profiles.push({ ...config.agents.profiles[0], id: "reviewer", title: "Reviewer" });
    await writeFile(configPath, JSON.stringify(config, null, 2));

    const synced = await konductor(["tokens", "sync"]);
    expect(synced.code, synced.err).toBe(0);
    expect(synced.out).toContain("synchronized for 2 agent profile(s)");
    expect(synced.out).toMatch(/claude-default: [0-9a-f-]{36}/);
    expect(synced.out).toMatch(/reviewer: [0-9a-f-]{36}/);
    const again = await konductor(["tokens", "sync"]);
    expect(again.out.match(/[0-9a-f-]{36}/g)).toEqual(synced.out.match(/[0-9a-f-]{36}/g));
  });
});

describe("run", () => {
  test("lists nothing before any agent has run", async () => {
    await init();
    const runs = await konductor(["run", "list"]);
    expect(runs.code).toBe(0);
    expect(runs.out).toContain("No runs recorded yet.");
    const missing = await konductor(["run", "show", "nope"]);
    expect(missing.code).not.toBe(0);
  });
});

describe("delete", () => {
  test("dry run previews and force removes only Konductor files", async () => {
    await init();
    await writeFile(join(project, "src.ts"), "export {};");
    await mkdir(join(project, ".claude"));
    await writeFile(join(project, ".claude", "settings.local.json"), JSON.stringify({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318", KEEP: "1" },
    }));

    const dry = await konductor(["delete", "--force", "--dry-run"]);
    expect(dry.code, dry.err).toBe(0);
    expect(dry.out).toContain("Dry run — nothing was deleted.");
    expect(existsSync(join(project, "konductor.config.json"))).toBe(true);

    const removed = await konductor(["delete", "--force"]);
    expect(removed.code, removed.err).toBe(0);
    expect(removed.out).toContain("has been completely removed from Konductor");
    expect(existsSync(join(project, "konductor.config.json"))).toBe(false);
    expect(existsSync(join(project, ".konductor"))).toBe(false);
    expect(existsSync(join(project, "src.ts"))).toBe(true);
    const settings = JSON.parse(await readFile(join(project, ".claude", "settings.local.json"), "utf-8"));
    expect(settings.env).toEqual({ KEEP: "1" });
    expect((await konductor(["projects"])).out).toContain("No projects registered yet.");
  });

  test("--keep-local unregisters without touching the repo", async () => {
    await init();
    const kept = await konductor(["delete", "--force", "--keep-local"]);
    expect(kept.code, kept.err).toBe(0);
    expect(existsSync(join(project, "konductor.config.json"))).toBe(true);
    expect(existsSync(join(project, ".konductor"))).toBe(true);
    expect((await konductor(["projects"])).out).toContain("No projects registered yet.");
  });

  test("--project deletes by id from anywhere", async () => {
    await init();
    const elsewhere = join(root, "elsewhere");
    await mkdir(elsewhere);
    const removed = await konductor(["delete", "--force", "--project", "proj"], elsewhere);
    expect(removed.code, removed.err).toBe(0);
    expect(existsSync(join(project, "konductor.config.json"))).toBe(false);
    const unknown = await konductor(["delete", "--force", "--project", "ghost"], elsewhere);
    expect(unknown.code).not.toBe(0);
  });
});

describe("mcp serve", () => {
  test("write_status logs per-feature entries derived from the snapshot diff", async () => {
    await init();
    const created = await konductor(["tokens", "create", "--name", "Agent", "--role", "contributor", "--expires-in", "7d"]);
    expect(created.code, created.err).toBe(0);
    const token = created.out.match(/^(knd_ext_[a-f0-9]{12}_[A-Za-z0-9_-]+)$/m)?.[1]!;
    // A live pid in receiver.pid makes the server skip spawning a detached telemetry receiver.
    await writeFile(join(root, "home", "receiver.pid"), String(process.pid));

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["run", CLI, "mcp", "serve"],
      cwd: project,
      env: { ...process.env, KONDUCTOR_HOME: join(root, "home"), KONDUCTOR_ACCESS_TOKEN: token } as Record<string, string>,
      stderr: "pipe",
    });
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(transport);
    try {
      const snapshot = (features: unknown) => ({
        schema_version: "0.2.0",
        project: { id: "proj", name: "proj" },
        agent: { kind: "test", session_id: null },
        report: { reported_at: "2026-09-19T12:00:00.000Z" },
        status: { state: "in_progress", summary: "Working on login.", current_phase_id: null },
        phases: [],
        features,
        issues: { blockers: [], decisions_needed: [], external_dependencies: [], risks: [] },
        next_actions: [],
      });
      const first = await client.callTool({ name: "write_status", arguments: { payload: snapshot([
        { id: "core", title: "Core", items: [{ id: "login", title: "Login", status: "todo" }, { id: "signup", title: "Signup", status: "todo" }] },
      ]) } });
      expect(first.isError ?? false).toBe(false);
      const second = await client.callTool({ name: "write_status", arguments: { payload: snapshot([
        { id: "core", title: "Core", items: [{ id: "login", title: "Login", status: "done" }] },
      ]) } });
      expect(second.isError ?? false).toBe(false);
    } finally {
      await client.close();
    }

    const store = await import("@konductor/store");
    const updates = (await store.readUpdates(project)).map((u) => [u.subject, u.action, u.message, u.agent]);
    expect(updates).toEqual([
      ["feature", "created", 'Added feature category "Core".', "Agent"],
      ["feature", "created", 'Feature added "Login" to Core', "Agent"],
      ["feature", "created", 'Feature added "Signup" to Core', "Agent"],
      ["agent", "edited", "Working on login.", "Agent"],
      ["feature", "success", 'Feature "Login" marked done.', "Agent"],
      ["feature", "deleted", 'Feature removed "Signup" from Core', "Agent"],
      ["agent", "edited", "Working on login.", "Agent"],
    ]);
  });
});

test("an unknown command prints usage and fails", async () => {
  const result = await konductor(["frobnicate"]);
  expect(result.code).not.toBe(0);
  expect(result.out + result.err).toContain("Usage");
});
