import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { hostGlobal, readHostState } from "@konductor/store";
import { ApiError } from "./router.js";

export const DEFAULT_HOST_PORT = 4096;

export type HostHealth = {
  ok: boolean;
  running: boolean;
  host_id: string | null;
  pid: number | null;
  port: number;
  running_runs: string[];
  state_path: string;
  log_path: string;
  /** True when a pid file points at a process that is no longer alive. */
  stale_pid: boolean;
  error?: string;
  code?: string;
  hint?: string;
};

function isPidAlive(pid: number | null): boolean {
  if (!pid) return false;
  try {
    // Signal 0 tests for existence without touching the process.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readHostPid(): Promise<number | null> {
  const { pidFile } = hostGlobal();
  if (!existsSync(pidFile)) return null;
  try {
    const pid = Number.parseInt((await readFile(pidFile, "utf-8")).trim(), 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export async function hostPort(): Promise<number> {
  const state = await readHostState().catch(() => null);
  return state?.port ?? DEFAULT_HOST_PORT;
}

export function hostBaseUrl(port: number): string {
  // The host binds loopback only, so this is the only address that can reach it.
  return `http://127.0.0.1:${port}`;
}

/**
 * Whether the host daemon is up, and if not, why.
 *
 * A stale pid file is called out separately from "never started": they need
 * different fixes, and conflating them sends people to the wrong one.
 */
export async function fetchHostHealth(): Promise<HostHealth> {
  const host = hostGlobal();
  const [pid, state] = await Promise.all([readHostPid(), readHostState().catch(() => null)]);
  const port = state?.port ?? DEFAULT_HOST_PORT;
  const alive = isPidAlive(pid ?? state?.pid ?? null);

  const base: HostHealth = {
    ok: false,
    running: false,
    host_id: state?.host_id ?? null,
    pid: pid ?? state?.pid ?? null,
    port,
    running_runs: [],
    state_path: host.stateFile,
    log_path: host.logFile,
    stale_pid: pid !== null && !alive,
  };

  try {
    const response = await fetch(`${hostBaseUrl(port)}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) {
      return { ...base, error: `Host responded with ${response.status}.`, code: "HOST_UNHEALTHY" };
    }
    const body = (await response.json()) as {
      host_id?: string;
      pid?: number;
      running_runs?: string[];
    };
    return {
      ...base,
      ok: true,
      running: true,
      host_id: body.host_id ?? base.host_id,
      pid: body.pid ?? base.pid,
      running_runs: body.running_runs ?? [],
      stale_pid: false,
    };
  } catch {
    return {
      ...base,
      error: base.stale_pid
        ? "The host pid file points at a process that is no longer running."
        : "Konductor host is not running.",
      code: "HOST_UNREACHABLE",
      hint: "Run `konductor host start` and try again.",
    };
  }
}

/**
 * Forward a request to the host daemon.
 *
 * When the host is down this reports why rather than surfacing a bare fetch
 * failure — the dashboard's most common error by far is "the daemon isn't up".
 */
export async function proxyToHost(pathname: string, init?: RequestInit): Promise<Response> {
  const port = await hostPort();
  try {
    const response = await fetch(`${hostBaseUrl(port)}${pathname}`, init);
    return new Response(await response.text(), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    const health = await fetchHostHealth();
    throw new ApiError(health.error ?? "Konductor host is not running.", {
      status: 503,
      code: health.code ?? "HOST_UNREACHABLE",
      hint: health.hint ?? "Run `konductor host start` and try again.",
    });
  }
}
