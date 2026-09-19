import { existsSync } from "node:fs";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { fmt, header } from "../ui/format.js";
import { RECEIVER_PID, RECEIVER_LOG, GLOBAL_DIR } from "@konductor/store";
import { RECEIVER_SCRIPT } from "@konductor/telemetry";

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readPid(): Promise<number | null> {
  try {
    const raw = await readFile(RECEIVER_PID, "utf-8");
    const pid = parseInt(raw.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

async function start(cwd: string): Promise<void> {
  if (!existsSync(join(cwd, ".konductor"))) {
    console.error(
      `${fmt.red("✗")} No .konductor/ found here. Run ${fmt.bold("konductor init")} first.`
    );
    process.exit(1);
  }

  const existing = await readPid();
  if (existing && isRunning(existing)) {
    console.log(
      `${fmt.yellow("!")} Receiver already running (pid ${existing})`
    );
    console.log(
      `  Set ${fmt.bold("OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318")} before starting Claude Code.\n`
    );
    return;
  }

  if (!existsSync(GLOBAL_DIR)) {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(GLOBAL_DIR, { recursive: true });
  }

  const proc = Bun.spawn(["bun", "run", RECEIVER_SCRIPT], {
    env: { ...process.env, KONDUCTOR_PROJECT_DIR: cwd },
    stdout: Bun.file(RECEIVER_LOG),
    stderr: Bun.file(RECEIVER_LOG),
    detached: true,
  });
  await writeFile(RECEIVER_PID, String(proc.pid), "utf-8");
  proc.unref();

  // Brief pause so the receiver can bind before we report success
  await Bun.sleep(300);

  console.log(`${fmt.green("✓")} Telemetry receiver started (pid ${proc.pid})`);
  console.log(`  ${fmt.dim("port:")}  4318`);
  console.log(`  ${fmt.dim("project:")}  ${cwd}`);
  console.log(`  ${fmt.dim("logs:")}  ${RECEIVER_LOG}`);
  console.log();
  console.log(
    `  Set ${fmt.bold("OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318")} before starting Claude Code.`
  );
  console.log(`  Run ${fmt.bold("konductor telemetry stop")} when done.\n`);
}

async function stop(): Promise<void> {
  const pid = await readPid();
  if (!pid || !isRunning(pid)) {
    console.log(`${fmt.yellow("!")} No receiver process found.`);
    try { await unlink(RECEIVER_PID); } catch { /* already gone */ }
    return;
  }
  process.kill(pid, "SIGTERM");
  await unlink(RECEIVER_PID).catch(() => {});
  console.log(`${fmt.green("✓")} Receiver stopped (pid ${pid})\n`);
}

async function status(): Promise<void> {
  const pid = await readPid();
  if (!pid || !isRunning(pid)) {
    console.log(`  receiver  ${fmt.gray("stopped")}`);
  } else {
    console.log(`  receiver  ${fmt.green("running")}  ${fmt.dim(`pid ${pid} · :4318`)}`);
  }
}

export async function runTelemetry(args: string[]): Promise<void> {
  const [subcommand] = args;
  const cwd = process.cwd();

  if (!subcommand || subcommand === "status") {
    console.log(header("konductor telemetry"));
    await status();
    console.log();
    return;
  }

  if (subcommand === "start") {
    console.log(header("konductor telemetry start"));
    await start(cwd);
    return;
  }

  if (subcommand === "stop") {
    console.log(header("konductor telemetry stop"));
    await stop();
    return;
  }

  console.error(`${fmt.red("✗")} Unknown telemetry subcommand: ${subcommand}`);
  console.error("Usage: konductor telemetry [start | stop | status]");
  process.exit(1);
}
