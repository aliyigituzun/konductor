import type { AgentAdapterManifest, AgentHandle } from "@konductor/schema";
import { classifyScreen, type Classification } from "../status.js";
import {
  attachCommand,
  capturePane,
  killPane,
  findPane,
  paneExists,
  sendKeys,
  sendLiteral,
  spawnPane,
  tmuxVersion,
} from "../tmux.js";

export type StartSpec = {
  slug: string;
  run_id: string;
  manifest: AgentAdapterManifest;
  /** Full argv, binary first. */
  command: string[];
  cwd: string;
  env: Record<string, string>;
  /** tmux session to open the agent's window in. */
  session: string;
};

export type ReadOptions = {
  source?: "visible" | "scrollback";
  lines?: number;
  ansi?: boolean;
};

/** Named tmux keys for the submit sequences an adapter can ask for. */
const SUBMIT_KEYS: Record<string, string> = {
  "\r": "C-m",
  "\n": "Enter",
};

export class TmuxUnavailableError extends Error {
  constructor() {
    super("tmux is not installed. Konductor runs every agent in a tmux pane; install it with `brew install tmux`.");
    this.name = "TmuxUnavailableError";
  }
}

/**
 * Drives every agent Konductor runs, each in its own tmux window.
 *
 * The window outlives the host daemon, so a host restart loses no agents — the ids
 * persisted on the run summary are enough to pick them back up. It also means the
 * operator can `tmux attach` and drive the agent by hand at any point.
 */
export class TmuxTransport {
  readonly kind = "tmux" as const;

  /** Last screen sample per pane, so status can tell "changed" from "quiet". */
  private readonly lastScreen = new Map<string, string>();

  static async available(): Promise<boolean> {
    return (await tmuxVersion()) !== null;
  }

  async start(spec: StartSpec): Promise<AgentHandle> {
    if (!(await TmuxTransport.available())) throw new TmuxUnavailableError();

    const spawned = await spawnPane({
      session: spec.session,
      cwd: spec.cwd,
      name: spec.slug,
      env: spec.env,
      command: spec.command,
    });

    return {
      slug: spec.slug,
      run_id: spec.run_id,
      session_name: spec.session,
      window_id: spawned.window_id,
      pane_id: spawned.pane_id,
    };
  }

  /** Type text into the agent without submitting it. */
  async send(handle: AgentHandle, text: string): Promise<void> {
    // A newline inside `send-keys -l` submits early, cutting the message in half.
    // Multi-line content belongs in a file the agent is told to read.
    if (text.includes("\n")) {
      throw new Error(
        "Refusing to send multi-line text to an agent pane: a newline submits the " +
          "input box early. Write the content to a file and send a one-line pointer to it.",
      );
    }
    await sendLiteral(handle.pane_id, text);
  }

  /** Submit whatever is in the agent's input box. */
  async submit(handle: AgentHandle, manifest: AgentAdapterManifest): Promise<void> {
    const named = SUBMIT_KEYS[manifest.submit_key];
    if (named) {
      await sendKeys(handle.pane_id, [named]);
      return;
    }
    await sendLiteral(handle.pane_id, manifest.submit_key);
  }

  /** Explicit operator response to a visible dialog; never used for auto-approval. */
  async cancelDialog(handle: AgentHandle): Promise<void> {
    await sendKeys(handle.pane_id, ["Escape"]);
  }

  async read(handle: AgentHandle, options: ReadOptions = {}): Promise<string> {
    return capturePane(handle.pane_id, options);
  }

  async status(handle: AgentHandle, manifest: AgentAdapterManifest): Promise<Classification> {
    const paneId = handle.pane_id;

    if (!(await paneExists(paneId))) {
      this.lastScreen.delete(paneId);
      return {
        status: "dead",
        reason: "The tmux pane no longer exists.",
        matched: null,
        exit_code: null,
      };
    }

    const pane = await findPane(handle.session_name, paneId);
    const screen = await capturePane(paneId);
    const previous = this.lastScreen.get(paneId);
    this.lastScreen.set(paneId, screen);

    return classifyScreen(manifest, {
      screen,
      alive: !(pane?.dead ?? false),
      exitCode: pane?.dead_status ?? null,
      // First sample has nothing to compare against; treat it as busy rather than
      // claiming the agent is already idle before it has drawn anything.
      changed: previous === undefined ? true : previous !== screen,
    });
  }

  async stop(handle: AgentHandle): Promise<void> {
    await killPane(handle.pane_id);
    this.lastScreen.delete(handle.pane_id);
  }

  /** Whether the pane is still there and its process has not exited. */
  async alive(handle: AgentHandle): Promise<boolean> {
    if (!(await paneExists(handle.pane_id))) return false;
    const pane = await findPane(handle.session_name, handle.pane_id);
    return !(pane?.dead ?? false);
  }

  /** The paste-ready command that puts an operator in front of this agent. */
  attachCommand(handle: AgentHandle): string {
    return attachCommand(handle.session_name, handle.window_id);
  }
}
