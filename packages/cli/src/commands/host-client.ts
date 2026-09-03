import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readConfig, hostGlobal } from "@konductor/store";
import { DEFAULT_HOST_PORT, hostBaseUrl, HOST_SERVER_SCRIPT } from "@konductor/host";

export class HostRequestError extends Error {
  code: string;
  hint: string | null;
  details: string[];

  constructor(
    message: string,
    options: {
      code?: string;
      hint?: string | null;
      details?: string[];
    } = {},
  ) {
    super(message);
    this.name = "HostRequestError";
    this.code = options.code ?? "HOST_REQUEST_FAILED";
    this.hint = options.hint ?? null;
    this.details = options.details ?? [];
  }
}

export function parseFlag(args: string[], name: string, short?: string): string | undefined {
  const index = args.findIndex((arg) => arg === name || (short ? arg === short : false));
  if (index < 0) return undefined;
  return args[index + 1];
}

export async function resolvedHostPort(cwd: string): Promise<number> {
  const config = await readConfig(cwd);
  return config?.host?.port ?? DEFAULT_HOST_PORT;
}

export async function hostFetch(
  cwd: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const port = await resolvedHostPort(cwd);
  try {
    return await fetch(`${hostBaseUrl(port)}${path}`, init);
  } catch (error) {
    const host = hostGlobal();
    const pid = await readHostPid();
    const running = await isHostRunning();
    const details = [
      `Host URL: ${hostBaseUrl(port)}`,
      `Host log: ${host.logFile}`,
    ];
    if (pid !== null) {
      details.push(`Host pid: ${pid}${running ? "" : " (stale)"}`);
    }
    details.push(
      error instanceof Error ? `Fetch error: ${error.message}` : `Fetch error: ${String(error)}`,
    );
    throw new HostRequestError(
      running
        ? "Konductor host is running but did not answer the request."
        : "Konductor host is not running.",
      {
        code: "HOST_UNREACHABLE",
        hint: running
          ? "Inspect the host log and restart the daemon with `konductor host stop` then `konductor host start`."
          : "Start the daemon with `konductor host start` and try again.",
        details,
      },
    );
  }
}

export function formatHostRequestError(error: unknown): string {
  if (error instanceof HostRequestError) {
    return [
      error.message,
      error.hint ? `Hint: ${error.hint}` : null,
      ...error.details,
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function waitForHost(cwd: string, timeoutMs = 4000): Promise<void> {
  const started = Date.now();
  let lastError: unknown = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await hostFetch(cwd, "/health");
      if (res.ok) return;
      lastError = new Error(`Health check failed with HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(200);
  }
  throw lastError ?? new HostRequestError("Konductor host did not become ready in time.");
}

export async function readHostPid(): Promise<number | null> {
  const file = hostGlobal().pidFile;
  if (!existsSync(file)) return null;
  try {
    const raw = await readFile(file, "utf-8");
    const pid = parseInt(raw.trim(), 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export async function isHostRunning(): Promise<boolean> {
  const pid = await readHostPid();
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function startHostProcess(cwd: string): Promise<{ pid: number; port: number }> {
  const port = await resolvedHostPort(cwd);
  const host = hostGlobal();
  await mkdir(host.dir, { recursive: true });
  const proc = Bun.spawn(["bun", "run", HOST_SERVER_SCRIPT], {
    env: {
      ...process.env,
      KONDUCTOR_HOST_PORT: String(port),
    },
    cwd,
    stdout: Bun.file(host.logFile),
    stderr: Bun.file(host.logFile),
    detached: true,
  });
  await writeFile(host.pidFile, String(proc.pid), "utf-8");
  proc.unref();
  return { pid: proc.pid, port };
}
