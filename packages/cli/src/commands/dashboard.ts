import { join } from "node:path";
import { existsSync } from "node:fs";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { fmt, header } from "../ui/format.js";
import { GLOBAL_DIR, globalRegistry } from "@konductor/store";
import { ensureHostRunning } from "./host-client.js";
import { withOpenFileLimit } from "./process-limits.js";

const WEB_DIR = join(import.meta.dir, "../../../../apps/web");
const PID_FILE = join(GLOBAL_DIR, "dashboard.pid");

async function readPid(): Promise<number | null> {
  try {
    const raw = await readFile(PID_FILE, "utf-8");
    const pid = parseInt(raw.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function runDashboard(args: string[]): Promise<void> {
  const background = args.includes("--background") || args.includes("-b");
  const stop = args.includes("--stop");

  if (stop) {
    const pid = await readPid();
    if (!pid || !isRunning(pid)) {
      console.log(`${fmt.yellow("!")} No dashboard process found.`);
      try { await unlink(PID_FILE); } catch { /* already gone */ }
      return;
    }
    process.kill(pid, "SIGTERM");
    await unlink(PID_FILE).catch(() => {});
    console.log(`${fmt.green("✓")} Dashboard stopped (pid ${pid})\n`);
    return;
  }

  console.log(header("konductor dashboard"));

  try {
    await ensureHostRunning(process.cwd());
  } catch (error) {
    console.error(`${fmt.red("✗")} Could not start Konductor host.`);
    console.error(`  ${fmt.dim(error instanceof Error ? error.message : String(error))}`);
    process.exit(1);
  }

  if (!existsSync(WEB_DIR)) {
    console.error(
      `${fmt.red("✗")} Dashboard app not found at ${WEB_DIR}.\n` +
        `  Run ${fmt.bold("bun install")} from the repo root first.`
    );
    process.exit(1);
  }

  // Warn if already running in background
  const existingPid = await readPid();
  if (existingPid && isRunning(existingPid)) {
    console.log(`${fmt.yellow("!")} Dashboard already running (pid ${existingPid}) at http://localhost:5173`);
    console.log(`  Run ${fmt.bold("konductor dashboard --stop")} to stop it.\n`);
    return;
  }

  const registryPath = globalRegistry();
  console.log(`${fmt.dim("registry:")}  ${registryPath}`);

  const spawnEnv = { ...process.env, KONDUCTOR_REGISTRY: registryPath };

  if (background) {
    // Detach the Vite process so it outlives this CLI invocation
    const proc = Bun.spawn(withOpenFileLimit(["bun", "run", "dev"]), {
      cwd: WEB_DIR,
      env: spawnEnv,
      stdout: Bun.file(join(process.env["HOME"] ?? "~", ".konductor", "dashboard.log")),
      stderr: Bun.file(join(process.env["HOME"] ?? "~", ".konductor", "dashboard.log")),
      detached: true,
    });
    await writeFile(PID_FILE, String(proc.pid), "utf-8");
    proc.unref();

    // Give Vite a moment to bind before opening the browser
    await Bun.sleep(1500);
    const url = "http://localhost:5173";
    console.log(`${fmt.green("✓")} Dashboard started in background (pid ${proc.pid})`);
    console.log(`  ${fmt.cyan(url)}`);
    console.log(`  logs: ~/.konductor/dashboard.log`);
    console.log(`  stop: ${fmt.bold("konductor dashboard --stop")}\n`);
    Bun.spawn(["open", url], { stdout: "ignore", stderr: "ignore" });
  } else {
    console.log(`${fmt.dim("starting Vite dev server...")}\n`);
    const proc = Bun.spawn(withOpenFileLimit(["bun", "run", "dev"]), {
      cwd: WEB_DIR,
      env: spawnEnv,
      stdout: "inherit",
      stderr: "inherit",
    });

    setTimeout(() => {
      const url = "http://localhost:5173";
      console.log(`\n${fmt.green("✓")} Opening ${fmt.cyan(url)}\n`);
      const opener =
        process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      Bun.spawn([opener, url], { stdout: "ignore", stderr: "ignore" });
    }, 2000);

    await proc.exited;
  }
}
