import { readConfig } from "@konductor/store";
import { fmt, header } from "../ui/format.js";
import {
  formatHostRequestError,
  hostFetch,
  isHostRunning,
  readHostPid,
  startHostProcess,
  waitForHost,
} from "./host-client.js";
import { loadAdapters, tmuxVersion } from "@konductor/agents";

async function start(cwd: string): Promise<void> {
  console.log(header("konductor host start"));
  const config = await readConfig(cwd);
  const profile = config?.agents?.profiles.find((item) => item.id === config.agents?.default_profile);
  if (!profile) {
    console.error(`${fmt.red("✗")} No default agent profile found. Run ${fmt.bold("konductor init")} first.`);
    process.exit(1);
  }

  const registry = await loadAdapters(cwd);
  const adapter = registry.adapters.find((item) => item.manifest.id === profile.adapter);
  if (!adapter) {
    console.error(`${fmt.red("✗")} Default profile uses unknown adapter ${fmt.bold(profile.adapter)}.`);
    console.error(`  Run ${fmt.bold("konductor adapters list")} to see what is available.`);
    process.exit(1);
  }
  const binary = profile.binary ?? adapter.manifest.binary;
  if (!Bun.which(binary)) {
    console.error(`${fmt.red("✗")} ${adapter.manifest.title} binary not found on PATH: ${fmt.bold(binary)}`);
    process.exit(1);
  }
  if (profile.mode === "pane" && !(await tmuxVersion())) {
    console.error(`${fmt.red("✗")} tmux is not installed, but the default profile runs in a pane.`);
    console.error(`  Install tmux, or set the profile mode to ${fmt.bold("headless")}.`);
    process.exit(1);
  }

  if (await isHostRunning()) {
    const pid = await readHostPid();
    console.log(`${fmt.yellow("!")} Host already running${pid ? ` (pid ${pid})` : ""}.`);
    return;
  }

  const { pid, port } = await startHostProcess(cwd);
  try {
    await waitForHost(cwd);
    console.log(`${fmt.green("✓")} Host started`);
    console.log(`  ${fmt.dim("pid:")}   ${pid}`);
    console.log(`  ${fmt.dim("port:")}  ${port}`);
    console.log(`  ${fmt.dim("url:")}   http://127.0.0.1:${port}`);
    console.log();
  } catch (error) {
    console.error(`${fmt.red("✗")} Host process started but did not become ready.`);
    console.error(`  ${fmt.dim(formatHostRequestError(error).split("\n").join("\n  "))}`);
    process.exit(1);
  }
}

async function stop(): Promise<void> {
  console.log(header("konductor host stop"));
  const pid = await readHostPid();
  if (!pid) {
    console.log(`${fmt.yellow("!")} No host pid file found.`);
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
    console.log(`${fmt.green("✓")} Host stopped (pid ${pid})\n`);
  } catch {
    console.log(`${fmt.yellow("!")} Host pid ${pid} was not running.\n`);
  }
}

async function status(cwd: string): Promise<void> {
  console.log(header("konductor host status"));
  const pid = await readHostPid();
  if (!(await isHostRunning())) {
    console.log(`  ${fmt.dim("status:")} ${fmt.gray("stopped")}`);
    if (pid) console.log(`  ${fmt.dim("pid:")}    ${pid} ${fmt.gray("(stale)")}`);
    console.log();
    return;
  }

  try {
    const res = await hostFetch(cwd, "/health");
    const body = await res.json() as { host_id: string; pid: number; port: number; running_runs: string[] };
    console.log(`  ${fmt.dim("status:")} ${fmt.green("running")}`);
    console.log(`  ${fmt.dim("host:")}   ${body.host_id}`);
    console.log(`  ${fmt.dim("pid:")}    ${body.pid}`);
    console.log(`  ${fmt.dim("port:")}   ${body.port}`);
    console.log(`  ${fmt.dim("runs:")}   ${body.running_runs.length}`);
    console.log();
  } catch (error) {
    console.error(`${fmt.red("✗")} ${formatHostRequestError(error)}`);
    process.exit(1);
  }
}

export async function runHost(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const subcommand = args[0] ?? "status";

  switch (subcommand) {
    case "start":
      await start(cwd);
      break;
    case "stop":
      await stop();
      break;
    case "status":
      await status(cwd);
      break;
    default:
      console.error(`Unknown host subcommand: ${subcommand}`);
      console.error("Usage: konductor host [start | stop | status]");
      process.exit(1);
  }
}
