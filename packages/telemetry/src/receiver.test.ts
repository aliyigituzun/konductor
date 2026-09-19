import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readTelemetry } from "@konductor/store";
import { SignalStatusSchema } from "@konductor/schema";
import { SIGNAL_STATUS } from "./signals.js";
import { mergeSnapshot, type OtlpData } from "./adapter.js";

// fileURLToPath, not .pathname: the checkout path may contain spaces.
const RECEIVER = fileURLToPath(new URL("./receiver.ts", import.meta.url));

const metrics = (input: number, output: number): OtlpData => ({
  resourceMetrics: [{
    scopeMetrics: [{
      metrics: [
        { name: "claude_code.tokens.input", sum: { dataPoints: [{ attributes: [], asInt: input }] } },
        { name: "claude_code.tokens.output", sum: { dataPoints: [{ attributes: [], asInt: output }] } },
      ],
    }],
  }],
  resourceSpans: [{
    scopeSpans: [{
      spans: [{
        name: "tool.Read",
        attributes: [
          { key: "tool.name", value: { stringValue: "Read" } },
          { key: "tool.input", value: { stringValue: JSON.stringify({ file_path: "src/a.ts" }) } },
        ],
      }],
    }],
  }],
});

describe("signal map", () => {
  test("every documented signal carries a valid availability status", () => {
    for (const [signal, status] of Object.entries(SIGNAL_STATUS)) {
      expect(SignalStatusSchema.safeParse(status).success, `${signal} has invalid status ${status}`).toBe(true);
    }
    expect(SIGNAL_STATUS["input_tokens"]).toBe("verified");
    expect(SIGNAL_STATUS["context_window"]).toBe("unavailable");
  });
});

describe("mergeSnapshot", () => {
  test("accumulates counters and activity across pushes and keeps the first session", () => {
    const first = mergeSnapshot(null, { ...metrics(100, 10) }, "demo");
    const merged = mergeSnapshot({ ...first, session_id: "s1" }, metrics(50, 5), "demo");
    expect(merged.input_tokens).toBe(150);
    expect(merged.output_tokens).toBe(15);
    expect(merged.session_id).toBe("s1");
    expect(merged.top_tools).toEqual([{ name: "Read", count: 2, signal_status: "best_effort" }]);
    expect(merged.top_files[0]).toMatchObject({ path: "src/a.ts", reads: 2, writes: 0 });
  });

  test("a value seen on either side replaces null instead of poisoning the sum", () => {
    const base = mergeSnapshot(null, {}, "demo");
    expect(base.input_tokens).toBeNull();
    const merged = mergeSnapshot(base, metrics(7, 3), "demo");
    expect(merged.input_tokens).toBe(7);
    expect(mergeSnapshot(merged, {}, "demo").input_tokens).toBe(7);
    // Signals nobody has reported stay null rather than becoming fake zeros.
    expect(mergeSnapshot(base, {}, "demo").cost_usd).toBeNull();
  });
});

describe("receiver daemon", () => {
  let project: string;
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe"> | null = null;

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "konductor-receiver-"));
  });

  afterEach(async () => {
    if (proc) {
      proc.kill();
      await proc.exited;
      proc = null;
    }
    await rm(project, { recursive: true, force: true });
  });

  async function freePort(): Promise<number> {
    const server = Bun.serve({ port: 0, fetch: () => new Response("") });
    const port = server.port!;
    server.stop(true);
    return port;
  }

  async function startReceiver(env: Record<string, string>): Promise<{ port: number; stderr: () => Promise<string> }> {
    const port = await freePort();
    proc = Bun.spawn([process.execPath, "run", RECEIVER], {
      env: { ...process.env, KONDUCTOR_HOME: join(project, "home"), OTEL_RECEIVER_PORT: String(port), ...env },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = new Response(proc.stderr).text();
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(200) });
        if (res.ok) break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    return { port, stderr: () => stderr };
  }

  test("refuses to start outside an initialized project", async () => {
    const child = Bun.spawn([process.execPath, "run", RECEIVER], {
      env: { ...process.env, KONDUCTOR_PROJECT_DIR: project, OTEL_RECEIVER_PORT: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(code).toBe(1);
    expect(stderr).toContain("No .konductor/");

    const noDir = Bun.spawn([process.execPath, "run", RECEIVER], {
      env: { ...process.env, KONDUCTOR_PROJECT_DIR: "", OTEL_RECEIVER_PORT: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await noDir.exited).toBe(1);
    expect(await new Response(noDir.stderr).text()).toContain("KONDUCTOR_PROJECT_DIR");
  });

  test("accumulates OTLP pushes into the project's telemetry and tags the run", async () => {
    await mkdir(join(project, ".konductor"), { recursive: true });
    await writeFile(join(project, "konductor.config.json"), JSON.stringify({ project_id: "demo" }));
    const { port } = await startReceiver({
      KONDUCTOR_PROJECT_DIR: project,
      KONDUCTOR_RUN_ID: "run-9",
      KONDUCTOR_PROFILE_ID: "claude-default",
      KONDUCTOR_RUN_SOURCE: "dashboard",
    });

    // Health-style GETs are acknowledged without touching state.
    const probe = await fetch(`http://127.0.0.1:${port}/v1/metrics`);
    expect(await probe.json()).toEqual({ partialSuccess: {} });
    expect(await readTelemetry(project)).toBeNull();

    for (const payload of [metrics(100, 10), metrics(50, 5)]) {
      const res = await fetch(`http://127.0.0.1:${port}/v1/metrics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(200);
    }

    const snapshot = await readTelemetry(project);
    expect(snapshot).toMatchObject({
      project_id: "demo",
      run_id: "run-9",
      profile_id: "claude-default",
      source: "dashboard",
      input_tokens: 150,
      output_tokens: 15,
    });
    expect(snapshot?.top_tools).toEqual([{ name: "Read", count: 2, signal_status: "best_effort" }]);

    const bad = await fetch(`http://127.0.0.1:${port}/v1/metrics`, { method: "POST", body: "not json" });
    expect(bad.status).toBe(503);
    expect((await readTelemetry(project))?.input_tokens).toBe(150);
  });

  test("falls back to an unknown project id when the config is unreadable", async () => {
    await mkdir(join(project, ".konductor"), { recursive: true });
    const { port, stderr } = await startReceiver({ KONDUCTOR_PROJECT_DIR: project });
    await fetch(`http://127.0.0.1:${port}/v1/metrics`, { method: "POST", body: JSON.stringify(metrics(1, 1)) });
    expect((await readTelemetry(project))?.project_id).toBe("unknown");
    proc!.kill();
    await proc!.exited;
    expect(await stderr()).toContain("Could not read config");
  });
});
