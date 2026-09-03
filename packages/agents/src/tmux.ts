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
    super(`tmux ${argv.join(" ")} failed (exit ${code}): ${stderr.trim() || "no stderr"}`);
    this.name = "TmuxError";
    this.argv = argv;
    this.code = code;
    this.stderr = stderr;
  }
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
 * With no client attached tmux falls back to 80x24, which is too small to split into
 * anything an agent TUI can render in — every agent would land in its own window
 * instead of a grid. tmux resizes the session to the real terminal as soon as
 * someone attaches, so this only affects the headless case.
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

/**
 * Choose which way to cut a pane in half.
 *
 * A terminal cell is roughly twice as tall as it is wide, so a pane only *looks*
 * wide enough to split vertically when its column count is well past double its row
 * count. Splitting horizontally below that, or when either half would fall under a
 * readable 80 columns, produces sliver columns an agent TUI cannot render into.
 */
export function chooseSplitDirection(
  width: number,
  height: number,
  minColumns = 80,
): "horizontal" | "vertical" {
  const halfWidth = Math.floor((width - 1) / 2);
  if (width >= 2 * height && halfWidth >= minColumns) return "horizontal";
  return "vertical";
}

/** The pane with the most cells — the one to split so the grid stays balanced. */
export function pickLargestPane(panes: TmuxPane[]): TmuxPane | null {
  const live = panes.filter((pane) => !pane.dead);
  if (live.length === 0) return null;
  return live.reduce((largest, pane) =>
    pane.width * pane.height > largest.width * largest.height ? pane : largest,
  );
}

export type SpawnPaneOptions = {
  session: string;
  cwd: string;
  /** Window/pane label, shown in the tmux status bar. */
  name: string;
  env: Record<string, string>;
  /** argv of the agent process. */
  command: string[];
};

/** Build the tmux argv that opens a new window running `command`. Pure, for tests. */
export function newWindowArgs(options: SpawnPaneOptions): string[] {
  return [
    "new-window",
    "-t", `=${options.session}`,
    "-c", options.cwd,
    "-n", options.name,
    ...envArgs(options.env),
    "-P", "-F", "#{pane_id}",
    "--",
    ...options.command,
  ];
}

/** Build the tmux argv that splits `paneId` and runs `command` in the new half. */
export function splitWindowArgs(
  paneId: string,
  direction: "horizontal" | "vertical",
  options: SpawnPaneOptions,
): string[] {
  return [
    "split-window",
    "-t", paneId,
    direction === "horizontal" ? "-h" : "-v",
    "-c", options.cwd,
    ...envArgs(options.env),
    "-P", "-F", "#{pane_id}",
    "--",
    ...options.command,
  ];
}

function envArgs(env: Record<string, string>): string[] {
  return Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
}

/**
 * Open a pane running `command`, splitting the largest existing pane so a fleet
 * forms a readable grid instead of ever-narrowing columns. Falls back to a new
 * window when nothing is splittable or the split would be too cramped.
 */
export async function spawnPane(options: SpawnPaneOptions): Promise<string> {
  await ensureSession(options.session, options.cwd);

  const largest = pickLargestPane(await listPanes(options.session));
  if (largest) {
    const direction = chooseSplitDirection(largest.width, largest.height);
    const fitsVertically = Math.floor((largest.height - 1) / 2) >= 8;
    const fitsHorizontally = Math.floor((largest.width - 1) / 2) >= 80;
    if ((direction === "vertical" && fitsVertically) || (direction === "horizontal" && fitsHorizontally)) {
      const paneId = (await tmux(splitWindowArgs(largest.pane_id, direction, options))).trim();
      await keepPaneOnExit(paneId);
      await renamePane(paneId, options.name);
      return paneId;
    }
  }

  const paneId = (await tmux(newWindowArgs(options))).trim();
  await keepPaneOnExit(paneId);
  await renamePane(paneId, options.name);
  return paneId;
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
