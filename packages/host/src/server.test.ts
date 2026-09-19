import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * HTTP-level coverage of the host daemon.
 *
 * One daemon is spawned for the whole file against an isolated KONDUCTOR_HOME with
 * a seeded project and one finished run. Nothing here launches an agent: those
 * paths need tmux and a real harness. What is covered is everything up to that
 * point: identity, adapter catalog, run history, launch validation, CORS, and the
 * terminal stream's initial snapshot.
 */

const SERVER = fileURLToPath(new URL("./server.ts", import.meta.url));

let root: string;
let repo: string;
let home: string;
let port: number;
let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
let base: string;

async function freePort(): Promise<number> {
  const server = Bun.serve({ port: 0, fetch: () => new Response("") });
  const found = server.port!;
  server.stop(true);
  return found;
}

// The store resolves KONDUCTOR_HOME at import time, so seeding goes through a
// child process too, sharing the daemon's home.
async function seed(code: string): Promise<void> {
  const child = Bun.spawn([process.execPath, "-e", `
    import * as store from ${JSON.stringify(new URL("../../store/src/index.ts", import.meta.url).href)};
    const repo = ${JSON.stringify(repo)};
    ${code}
  `], { env: { ...process.env, KONDUCTOR_HOME: home }, stdout: "pipe", stderr: "pipe" });
  const [code_, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (code_ !== 0) throw new Error(stderr);
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "konductor-host-"));
  repo = join(root, "repo");
  home = join(root, "home");
  await mkdir(repo);
  // A real git repo, so branch listing and preview worktrees have something to work on.
  await writeFile(join(repo, "README.md"), "# Demo\n");
  // A tiny HTTP server stands in for the project's dev command.
  await writeFile(join(repo, "serve.ts"), [
    "Bun.serve({ port: Number(process.env.PORT), hostname: \"127.0.0.1\",",
    "  fetch: (req) => new Response(`ok ${new URL(req.url).pathname} ${process.env.KONDUCTOR_PREVIEW_BRANCH}`) });",
    "setInterval(() => {}, 1000);",
  ].join("\n"));
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["-c", "user.email=t@example.com", "-c", "user.name=t", "add", "README.md", "serve.ts"],
    ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "seed"],
    ["branch", "feature/hero"],
  ]) {
    const proc = Bun.spawn(["git", "-C", repo, ...args], { stdout: "ignore", stderr: "pipe" });
    if ((await proc.exited) !== 0) throw new Error(`git ${args.join(" ")} failed: ${await new Response(proc.stderr).text()}`);
  }
  await seed(`
    const config = store.normalizeConfig({ project_id: "demo", project_name: "Demo" });
    const base = { id: "claude-default", title: "Claude Code", adapter: "claude_code", provider: "anthropic", args: [],
      worktree: false, default_mcp: true, default_working_dir: "project_root", default_env: {} };
    config.agents.default_profile = "claude-default";
    config.agents.profiles.push(base, { ...base, id: "ghost", title: "Ghost", binary: "konductor-no-such-binary" });
    config.preview = { command: "bun run serve.ts", port_env: "PORT", ready_path: "/", ready_timeout_ms: 20000, env: {} };
    await store.writeConfig(repo, config);
    await store.writeStatus(repo, {
      schema_version: "0.2.0", project: { id: "demo", name: "Demo" }, agent: { kind: "claude_code", session_id: null },
      report: { reported_at: new Date().toISOString() }, status: { state: "todo", summary: "seed", current_phase_id: null },
      phases: [], issues: { blockers: [], decisions_needed: [], external_dependencies: [], risks: [] }, next_actions: [],
    });
    const paths = store.repoLocal(repo);
    await store.upsertProject({
      id: "demo", name: "Demo", repo_path: repo, last_sync: null, status_path: paths.currentStatus,
      telemetry_path: paths.latestTelemetry, history_dir: paths.historyDir, initialized_at: new Date().toISOString(),
    });
    await store.writeRunSummary(repo, {
      schema_version: "0.3.0", id: "run-done", project_id: "demo", repo_path: repo, profile_id: "claude-default",
      profile_title: "Claude Code", adapter_id: "claude_code", slug: "old-task", feature_item_id: null,
      prompt_excerpt: "old", prompt_packs: [], source: "cli", command: "claude", env_summary: {}, status: "succeeded",
      started_at: "2026-09-17T10:00:00.000Z", ended_at: "2026-09-17T10:05:00.000Z", exit_code: 0,
      log_path: "run-done.log", repo_log_path: null,
    });
    await store.writeRunLog(repo, "run-done", "finished output");
    // A "running" run with no pane must be finalized on startup rather than believed.
    await store.writeRunSummary(repo, {
      schema_version: "0.3.0", id: "run-orphan", project_id: "demo", repo_path: repo, profile_id: "claude-default",
      profile_title: "Claude Code", adapter_id: "claude_code", slug: "orphan", feature_item_id: null,
      prompt_excerpt: "orphan", prompt_packs: [], source: "cli", command: "claude", env_summary: {}, status: "running",
      started_at: "2026-09-17T11:00:00.000Z", ended_at: null, exit_code: null, log_path: "run-orphan.log", repo_log_path: null,
    });
  `);

  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  proc = Bun.spawn([process.execPath, "run", SERVER], {
    env: { ...process.env, KONDUCTOR_HOME: home, KONDUCTOR_HOST_PORT: String(port), KONDUCTOR_HOST_ID: "test-host" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${base}/health`, { signal: AbortSignal.timeout(200) })).ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("host did not start: " + await new Response(proc.stderr).text());
});

afterAll(async () => {
  proc?.kill();
  await proc?.exited;
  await rm(root, { recursive: true, force: true });
});

// Responses are JSON of shapes the tests assert on; `any` keeps the assertions terse.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const get = (path: string, init?: RequestInit) => fetch(`${base}${path}`, init);
const body = async (res: Response): Promise<Json> => res.json();
const post = (path: string, body?: unknown) => fetch(`${base}${path}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body ?? {}),
});

describe("identity", () => {
  test("health reports the host id, pid, port, and an empty fleet", async () => {
    const health = await body(await get("/health"));
    expect(health).toMatchObject({ ok: true, host_id: "test-host", port, running_runs: [], tmux_session: null });
    expect(health.pid).toBe(proc.pid);
  });

  test("records its state file under the isolated home", async () => {
    const child = Bun.spawn([process.execPath, "-e", `
      import { readHostState } from ${JSON.stringify(new URL("../../store/src/index.ts", import.meta.url).href)};
      process.stdout.write(JSON.stringify(await readHostState()));
    `], { env: { ...process.env, KONDUCTOR_HOME: home }, stdout: "pipe", stderr: "pipe" });
    const state = JSON.parse(await new Response(child.stdout).text());
    expect(state).toMatchObject({ host_id: "test-host", port, pid: proc.pid });
  });

  test("only loopback origins receive CORS headers", async () => {
    const allowed = await get("/health", { headers: { Origin: "http://localhost:5173" } });
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    expect(allowed.headers.get("Vary")).toBe("Origin");
    const denied = await get("/health", { headers: { Origin: "https://evil.example" } });
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const preflight = await get("/agents", { method: "OPTIONS", headers: { Origin: "http://127.0.0.1:5173" } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });
});

describe("catalog and fleet", () => {
  test("the adapter catalog reports built-ins with detection and setup state", async () => {
    const catalog = await body(await get(`/adapters?repo=${encodeURIComponent(repo)}`));
    expect(catalog.issues).toEqual([]);
    const claude = catalog.adapters.find((a: { id: string }) => a.id === "claude_code");
    expect(claude).toMatchObject({ source: "builtin", manifest_path: null, mcp: "mcp_json" });
    expect(typeof claude.installed).toBe("boolean");
    expect(claude.setup).toBeDefined();
    expect(claude.providers.length).toBeGreaterThan(0);
  });

  test("the fleet is empty and unknown agents are 404", async () => {
    expect(await body(await get("/agents"))).toEqual({ agents: [] });
    const missing = await get("/agents/nobody");
    expect(missing.status).toBe(404);
    expect((await body(missing)).code).toBe("AGENT_NOT_FOUND");
    expect((await post("/agents/nobody/stop")).status).toBe(404);
    expect((await body(await post("/agents/nobody/send", { text: " " }))).code).toBe("MESSAGE_REQUIRED");
    expect((await get("/agents/nobody/read")).status).toBe(404);
    expect((await get("/agents/nobody/explain")).status).toBe(404);
  });
});

describe("runs", () => {
  test("history is served from the store and orphaned live runs were finalized on startup", async () => {
    const done = await body(await get("/runs/run-done"));
    expect(done).toMatchObject({ id: "run-done", status: "succeeded", slug: "old-task" });
    const terminal = await body(await get("/runs/run-done/terminal"));
    expect(terminal.log).toBe("finished output");

    const orphan = await body(await get("/runs/run-orphan"));
    expect(orphan.status).not.toBe("running");
    expect(orphan.ended_at).not.toBeNull();
    expect((await body(await get("/runs/run-orphan/terminal"))).log).toContain("no live pane to recover");

    const agents = await body(await get("/projects/demo/agents"));
    expect(agents.active_runs).toEqual([]);
    expect(agents.past_runs.map((r: { id: string }) => r.id).sort()).toEqual(["run-done", "run-orphan"]);

    expect((await get("/runs/nope")).status).toBe(404);
    expect((await get("/runs/nope/terminal")).status).toBe(404);
    expect((await post("/runs/nope/stop")).status).toBe(404);
  });

  test("stopping a finished run keeps its outcome; a stale live record becomes stopped", async () => {
    const finished = await post("/runs/run-done/stop");
    expect(finished.status).toBe(200);
    expect(await finished.json()).toMatchObject({ status: "succeeded", ended_at: "2026-09-17T10:05:00.000Z" });

    // A record still marked running with no agent behind it (written after startup
    // adoption) is the case the fallback exists for.
    await seed(`
      await store.writeRunSummary(repo, {
        schema_version: "0.3.0", id: "run-stale", project_id: "demo", repo_path: repo, profile_id: "claude-default",
        profile_title: "Claude Code", adapter_id: "claude_code", slug: "stale", feature_item_id: null,
        prompt_excerpt: "stale", prompt_packs: [], source: "cli", command: "claude", env_summary: {}, status: "running",
        started_at: "2026-09-17T12:00:00.000Z", ended_at: null, exit_code: null, log_path: "run-stale.log", repo_log_path: null,
      });
    `);
    const stale = await body(await post("/runs/run-stale/stop"));
    expect(stale.status).toBe("stopped");
    expect(stale.ended_at).not.toBeNull();
    expect((await body(await post("/runs/run-stale/stop"))).ended_at).toBe(stale.ended_at);
  });

  test("project info resolves paths and unknown projects are 404", async () => {
    const info = await body(await get("/projects/demo/info"));
    expect(info.repo_root).toBe(repo);
    expect(info.config_path).toBe(join(repo, "konductor.config.json"));
    expect((await get("/projects/nope/info")).status).toBe(404);
  });

  test("launch validation stops before any process is spawned", async () => {
    const cases: Array<[string, unknown, number, string]> = [
      ["/projects/nope/runs", { prompt: "x" }, 404, "PROJECT_NOT_FOUND"],
      ["/projects/demo/runs", { prompt: "  " }, 400, "PROMPT_REQUIRED"],
      ["/projects/demo/runs", { prompt: "x", profile_id: "missing" }, 400, "PROFILE_NOT_FOUND"],
      ["/projects/demo/runs", { prompt: "x", profile_id: "ghost" }, 400, "AGENT_BINARY_NOT_FOUND"],
    ];
    for (const [path, request, status, code] of cases) {
      const res = await post(path, request);
      expect(res.status, code).toBe(status);
      const payload = await body(res);
      expect(payload.code).toBe(code);
      expect(typeof payload.hint).toBe("string");
    }
    const binary = await body(await post("/projects/demo/runs", { prompt: "x", profile_id: "ghost" }));
    expect(binary.details).toContain("Configured binary: konductor-no-such-binary");
    expect(await body(await get("/agents"))).toEqual({ agents: [] });
  });
});

describe("shared dashboard API", () => {
  test("the host mounts the same /api route table as the dev server", async () => {
    const registry = await body(await get("/api/registry"));
    expect(registry.projects.map((p: { id: string }) => p.id)).toEqual(["demo"]);
    const project = await body(await get("/api/project/demo"));
    expect(project.status.project.name).toBe("Demo");
    expect((await get("/api/nothing/here")).status).toBe(404);
    const health = await body(await get("/api/host/health"));
    expect(health).toMatchObject({ running: true, host_id: "test-host", port });
  });
});

describe("terminal stream", () => {
  test("a websocket subscriber receives the run and its log as a snapshot", async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/runs/run-done/stream`);
    const snapshot = await new Promise<Record<string, unknown>>((resolve, reject) => {
      socket.onmessage = (event) => resolve(JSON.parse(String(event.data)));
      socket.onerror = () => reject(new Error("socket error"));
      setTimeout(() => reject(new Error("no snapshot")), 3000);
    });
    socket.close();
    expect(snapshot).toMatchObject({ type: "snapshot", log: "finished output", screen: null });
    expect((snapshot["run"] as { id: string }).id).toBe("run-done");
  });
});

describe("previews", () => {
  test("port settings are honoured and a preview runs a branch in its own worktree", async () => {
    const branches = await body(await get("/projects/demo/branches"));
    expect(branches.branches.map((b: { name: string }) => b.name).sort()).toEqual(["feature/hero", "main"]);
    expect(branches.branches.find((b: { name: string }) => b.name === "main").current).toBe(true);
    expect((await get("/projects/nope/branches")).status).toBe(404);

    // Carve out a two-port pool so allocation is deterministic.
    const poolStart = await freePort();
    await seed(`
      await store.saveHostPortSettings({ reserved: [{ start: ${poolStart}, end: ${poolStart}, label: "taken" }], preview_range: { start: ${poolStart}, end: ${poolStart + 1} } });
    `);

    expect((await body(await post("/projects/demo/previews", { branch: "" }))).code).toBe("BRANCH_REQUIRED");
    expect((await body(await post("/projects/demo/previews", { branch: "does-not-exist" }))).code).toBe("WORKTREE_FAILED");

    const started = await post("/projects/demo/previews", { branch: "feature/hero" });
    expect(started.status, await started.clone().text()).toBe(201);
    const preview = await body(started);
    expect(preview).toMatchObject({ status: "starting", branch: "feature/hero", port: poolStart + 1, worktree_created: true });
    expect(preview.worktree_path).toBe(`${repo}-preview-feature-hero`);

    let ready: Json = null;
    for (let attempt = 0; attempt < 100 && !ready; attempt += 1) {
      const current = await body(await get(`/previews/${preview.id}`));
      if (current.status === "ready") ready = current;
      else if (current.status !== "starting") throw new Error(`preview ${current.status}: ${current.last_error}`);
      else await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(ready?.status).toBe("ready");
    expect((await body(await get("/health"))).running_previews).toBe(1);

    // The proxy reaches the dev server and strips its own prefix.
    const proxied = await get(`/preview/${preview.id}/pricing?x=1`);
    expect(proxied.status).toBe(200);
    expect(await proxied.text()).toBe("ok /pricing feature/hero");
    expect((await get("/preview/nope/")).status).toBe(404);

    // The pool is exhausted: one port reserved, one in use.
    const exhausted = await body(await post("/projects/demo/previews", { branch: "main" }));
    expect(exhausted.code).toBe("NO_FREE_PORT");

    const listed = await body(await get("/projects/demo/previews"));
    expect(listed.previews.map((p: { id: string }) => p.id)).toEqual([preview.id]);
    const screen = await body(await get(`/previews/${preview.id}/screen`));
    expect(typeof screen.screen).toBe("string");

    const stopped = await body(await post(`/previews/${preview.id}/stop`, { remove_worktree: true }));
    expect(stopped.status).toBe("stopped");
    expect((await get(`/preview/${preview.id}/`)).status).toBe(503);
    expect((await body(await get("/health"))).running_previews).toBe(0);
    expect((await post("/previews/nope/stop")).status).toBe(404);
  }, 30_000);
});
