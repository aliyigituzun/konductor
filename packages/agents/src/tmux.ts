/**
 * Thin wrapper over the tmux CLI.
 *
 * tmux is the pane backend because it costs no native dependency, survives the host
 * daemon restarting, and lets the operator `tmux attach` to take an agent over by
 * hand — none of which a pipe or an in-process PTY gives us.
 *
 * Pane ids (`%12`) are durable for the life of the tmux server and are what we
 * persist as an agent's handle. The short display indexes are not: they renumber
 * when panes close.
 */

export type TmuxPane = {
  pane_id: string;
  window_id: string;
  width: number;
  height: number;
  /** True once the pane's command has exited (requires remain-on-exit). */
  dead: boolean;
  /** Exit status of the pane's command, available only while it is dead. */
  dead_status: number | null;
  cwd: string;
  title: string;
};

export class TmuxError extends Error {
  readonly argv: string[];
  readonly code: number;
  readonly stderr: string;

  constructor(argv: string[], code: number, stderr: string) {
    const safeArgv = redactTmuxArgs(argv);
    const safeStderr = redactAccessTokens(stderr);
    super(`tmux ${safeArgv.join(" ")} failed (exit ${code}): ${safeStderr.trim() || "no stderr"}`);
    this.name = "TmuxError";
    this.argv = safeArgv;
    this.code = code;
    this.stderr = safeStderr;
  }
}

function redactAccessTokens(value: string): string {
  return value.replace(/knd_(?:int|ext)_[A-Za-z0-9_-]+/g, "[redacted-access-token]");
}

/** Error messages need the operation shape, never the environment values. */
export function redactTmuxArgs(argv: string[]): string[] {
  const safe: string[] = [];
  let environmentCount = 0;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "-e" && index + 1 < argv.length) {
      environmentCount += 1;
      index += 1;
      continue;
    }
    const previous = argv[index - 1] ?? "";
    if (/^--?(?:token|secret|password|api-key)$/i.test(previous)) {
      safe.push("[redacted]");
      continue;
    }
    safe.push(redactAccessTokens(argument));
  }
  if (environmentCount > 0) {
    const commandBoundary = safe.indexOf("--");
    safe.splice(commandBoundary >= 0 ? commandBoundary : safe.length, 0, `[${environmentCount} environment variables redacted]`);
  }
  return safe;
}

export type TmuxResult = { code: number; stdout: string; stderr: string };

/** Run tmux, returning its result without throwing. */
export async function tmuxTry(args: string[]): Promise<TmuxResult> {
  const proc = Bun.spawn(["tmux", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

/** Run tmux, throwing TmuxError on a non-zero exit. */
export async function tmux(args: string[]): Promise<string> {
  const result = await tmuxTry(args);
  if (result.code !== 0) throw new TmuxError(args, result.code, result.stderr);
  return result.stdout;
}

export async function tmuxVersion(): Promise<string | null> {
  try {
    const result = await tmuxTry(["-V"]);
    if (result.code !== 0) return null;
    return result.stdout.trim() || null;
  } catch {
    // tmux is not installed; spawn itself throws.
    return null;
  }
}

export async function sessionExists(session: string): Promise<boolean> {
  const result = await tmuxTry(["has-session", "-t", `=${session}`]);
  return result.code === 0;
}

/**
 * Size a detached session generously.
 *
 * With no client attached tmux falls back to 80x24, which is too cramped for an
 * agent TUI to render in and would wrap its screen text — which is what the status
 * classifier reads. tmux resizes the session to the real terminal as soon as someone
 * attaches, so this only affects the time nobody is looking.
 */
export const DETACHED_WIDTH = 250;
export const DETACHED_HEIGHT = 64;

/**
 * Create the session if it is not already there.
 *
 * The session starts detached with a placeholder window; agent panes are added to it
 * afterwards, so that closing the last agent does not tear the session down.
 */
export async function ensureSession(session: string, cwd: string): Promise<void> {
  if (await sessionExists(session)) return;
  await tmux([
    "new-session", "-d",
    "-s", session,
    "-c", cwd,
    "-n", "konductor",
    "-x", String(DETACHED_WIDTH),
    "-y", String(DETACHED_HEIGHT),
  ]);
}

const PANE_FORMAT = [
  "#{pane_id}",
  "#{window_id}",
  "#{pane_width}",
  "#{pane_height}",
  "#{pane_dead}",
  "#{pane_dead_status}",
  "#{pane_current_path}",
  "#{pane_title}",
].join("\t");

/** Parse one `list-panes -F PANE_FORMAT` line. Exported for tests. */
export function parsePaneLine(line: string): TmuxPane | null {
  const parts = line.split("\t");
  if (parts.length < 8) return null;
  const [paneId, windowId, width, height, dead, deadStatus, cwd, title] = parts as [
    string, string, string, string, string, string, string, string,
  ];
  if (!paneId.startsWith("%")) return null;
  return {
    pane_id: paneId,
    window_id: windowId,
    width: Number.parseInt(width, 10) || 0,
    height: Number.parseInt(height, 10) || 0,
    dead: dead === "1",
    dead_status: deadStatus === "" ? null : Number.parseInt(deadStatus, 10),
    cwd,
    title,
  };
}

/** Every pane in a session. Returns [] when the session does not exist. */
export async function listPanes(session: string): Promise<TmuxPane[]> {
  const result = await tmuxTry(["list-panes", "-s", "-t", `=${session}`, "-F", PANE_FORMAT]);
  if (result.code !== 0) return [];
  return result.stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map(parsePaneLine)
    .filter((pane): pane is TmuxPane => pane !== null);
}

export async function findPane(session: string, paneId: string): Promise<TmuxPane | null> {
  const panes = await listPanes(session);
  return panes.find((pane) => pane.pane_id === paneId) ?? null;
}

export type SpawnPaneOptions = {
  session: string;
  cwd: string;
  /** Window name, shown in the tmux status bar; the agent's slug. */
  name: string;
  env: Record<string, string>;
  /** argv of the agent process. */
  command: string[];
};

export type SpawnedPane = { pane_id: string; window_id: string };

const SPAWN_FORMAT = "#{pane_id}\t#{window_id}";

/** Build the tmux argv that opens a new window running `command`. Pure, for tests. */
export function newWindowArgs(options: SpawnPaneOptions): string[] {
  return [
    "new-window",
    "-d",
    // new-window accepts a target-window, not merely a target-session. The trailing
    // colon says "this exact session, next free window index"; without it tmux
    // resolves the session's current window (usually index 0) and fails because that
    // index is already occupied by the placeholder window.
    "-t", `=${options.session}:`,
    "-c", options.cwd,
    "-n", options.name,
    ...envArgs(options.env),
    "-P", "-F", SPAWN_FORMAT,
    "--",
    ...options.command,
  ];
}

function envArgs(env: Record<string, string>): string[] {
  return Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
}

/** Parse the `-P -F SPAWN_FORMAT` line tmux prints for a new window. Exported for tests. */
export function parseSpawnLine(line: string): SpawnedPane | null {
  const [paneId, windowId] = line.trim().split("\t");
  if (!paneId?.startsWith("%") || !windowId?.startsWith("@")) return null;
  return { pane_id: paneId, window_id: windowId };
}

/**
 * Open a window running `command`.
 *
 * Each agent gets a whole window rather than a split of a shared one: an agent TUI
 * needs the full terminal to render, the operator attaches to one agent at a time,
 * and a window named after the slug is what `tmux attach` can be pointed at. The
 * window is created detached (`-d`) so opening an agent never yanks focus from
 * whatever an attached operator is looking at.
 */
export async function spawnPane(options: SpawnPaneOptions): Promise<SpawnedPane> {
  await ensureSession(options.session, options.cwd);
  const spawned = parseSpawnLine(await tmux(newWindowArgs(options)));
  if (!spawned) {
    throw new TmuxError(newWindowArgs(options), 0, "tmux did not report the new window's ids");
  }
  await keepPaneOnExit(spawned.pane_id);
  await renamePane(spawned.pane_id, options.name);
  return spawned;
}

/**
 * The shell command that puts an operator in front of one agent.
 *
 * `attach-session` then `select-window` are chained with `\;` so one paste lands on
 * the right window, whichever one the session last showed. The window id is
 * durable, so the command stays valid for the life of the agent.
 *
 * The exact-match target is always single-quoted: zsh expands a bare `=name` as a
 * command-path lookup, which would turn the paste into "konductor not found".
 */
export function attachCommand(session: string, windowId: string): string {
  return `tmux attach-session -t ${shellQuote(`=${session}`)} \\; select-window -t ${windowId}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function renamePane(paneId: string, title: string): Promise<void> {
  await tmuxTry(["select-pane", "-t", paneId, "-T", title]);
}

/**
 * Keep a pane around after its command exits, so the agent's final output and its
 * exit status stay readable. This is a per-pane option (`-p`) deliberately: setting
 * it globally would change the behaviour of every other tmux session on the machine.
 */
export async function keepPaneOnExit(paneId: string): Promise<void> {
  await tmuxTry(["set-option", "-p", "-t", paneId, "remain-on-exit", "on"]);
}

/**
 * Type text into a pane without submitting it.
 *
 * `-l` sends the string literally so an agent's input box receives it as typing.
 * `--` guards text that starts with a dash from being read as a flag.
 */
export async function sendLiteral(paneId: string, text: string): Promise<void> {
  await tmux(["send-keys", "-t", paneId, "-l", "--", text]);
}

/** Send named keys, e.g. ["C-m"] for Enter or ["C-c"] to interrupt. */
export async function sendKeys(paneId: string, keys: string[]): Promise<void> {
  await tmux(["send-keys", "-t", paneId, ...keys]);
}

export type CaptureOptions = {
  /**
   * "visible" reads only what is on screen right now; "scrollback" reaches back
   * through history. A freshly created pane has no scrollback yet, so status
   * detection reads the visible viewport.
   */
  source?: "visible" | "scrollback";
  lines?: number;
  /** Keep ANSI escapes, for rendering the TUI faithfully. */
  ansi?: boolean;
};

export function captureArgs(paneId: string, options: CaptureOptions = {}): string[] {
  const args = ["capture-pane", "-p", "-t", paneId];
  if (options.ansi) args.push("-e");
  if (options.source === "scrollback") {
    args.push("-S", `-${options.lines ?? 3000}`);
  }
  return args;
}

export async function capturePane(paneId: string, options: CaptureOptions = {}): Promise<string> {
  const result = await tmuxTry(captureArgs(paneId, options));
  if (result.code !== 0) return "";
  const text = result.stdout.replace(/\s+$/, "");
  if (options.source !== "scrollback" && options.lines) {
    return text.split("\n").slice(-options.lines).join("\n");
  }
  return text;
}

export async function killPane(paneId: string): Promise<void> {
  await tmuxTry(["kill-pane", "-t", paneId]);
}

export async function paneExists(paneId: string): Promise<boolean> {
  const result = await tmuxTry(["display-message", "-p", "-t", paneId, "#{pane_id}"]);
  return result.code === 0 && result.stdout.trim() === paneId;
}
