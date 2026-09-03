import type { AgentAdapterManifest, AgentHandle } from "@konductor/schema";
import { classifyScreen, type Classification } from "../status.js";
import {
  capturePane,
  killPane,
  findPane,
  paneExists,
  sendKeys,
  sendLiteral,
  spawnPane,
  tmuxVersion,
} from "../tmux.js";
import type { AgentTransport, ReadOptions, StartSpec, TransportEvents } from "./types.js";

/** Named tmux keys for the submit sequences an adapter can ask for. */
const SUBMIT_KEYS: Record<string, string> = {
  "\r": "C-m",
  "\n": "Enter",
};

export class TmuxUnavailableError extends Error {
  constructor() {
    super(
      "tmux is not installed, but this agent profile runs in a pane. " +
        "Install tmux (`brew install tmux`), or set the profile's mode to \"headless\".",
    );
    this.name = "TmuxUnavailableError";
  }
}

/**
 * Runs each agent in a tmux pane.
 *
 * The pane outlives the host daemon, so a host restart loses no agents — the pane id
 * persisted on the run summary is enough to reattach. It also means the operator can
 * `tmux attach` and drive the agent by hand at any point.
 */
export class TmuxTransport implements AgentTransport {
  readonly kind = "tmux" as const;

  /** Last screen sample per pane, so status can tell "changed" from "quiet". */
  private readonly lastScreen = new Map<string, string>();

  static async available(): Promise<boolean> {
    return (await tmuxVersion()) !== null;
  }

  async start(spec: StartSpec, events: TransportEvents = {}): Promise<AgentHandle> {
    if (!(await TmuxTransport.available())) throw new TmuxUnavailableError();

    const paneId = await spawnPane({
      session: spec.session,
      cwd: spec.cwd,
      name: spec.slug,
      env: spec.env,
      command: spec.command,
    });

    events.onChunk?.(`[konductor] pane ${paneId} opened in tmux session "${spec.session}".\n`);

    return {
      slug: spec.slug,
      run_id: spec.run_id,
      transport: "tmux",
      session_name: spec.session,
      pane_id: paneId,
      pid: null,
    };
  }

  async send(handle: AgentHandle, text: string): Promise<void> {
    const paneId = requirePane(handle);
    // A newline inside `send-keys -l` submits early, cutting the message in half.
    // Multi-line content belongs in a file the agent is told to read.
    if (text.includes("\n")) {
      throw new Error(
        "Refusing to send multi-line text to an agent pane: a newline submits the " +
          "input box early. Write the content to a file and send a one-line pointer to it.",
      );
    }
    await sendLiteral(paneId, text);
  }

  async submit(handle: AgentHandle, manifest: AgentAdapterManifest): Promise<void> {
    const paneId = requirePane(handle);
    const named = SUBMIT_KEYS[manifest.submit_key];
    if (named) {
      await sendKeys(paneId, [named]);
      return;
    }
    await sendLiteral(paneId, manifest.submit_key);
  }

  async read(handle: AgentHandle, options: ReadOptions = {}): Promise<string> {
    const paneId = requirePane(handle);
    return capturePane(paneId, options);
  }

  async status(handle: AgentHandle, manifest: AgentAdapterManifest): Promise<Classification> {
    const paneId = requirePane(handle);

    if (!(await paneExists(paneId))) {
      this.lastScreen.delete(paneId);
      return {
        status: "dead",
        reason: "The tmux pane no longer exists.",
        matched: null,
        exit_code: null,
      };
    }

    const pane = handle.session_name ? await findPane(handle.session_name, paneId) : null;
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
    const paneId = handle.pane_id;
    if (!paneId) return;
    await killPane(paneId);
    this.lastScreen.delete(paneId);
  }

  async alive(handle: AgentHandle): Promise<boolean> {
    if (!handle.pane_id) return false;
    if (!(await paneExists(handle.pane_id))) return false;
    const pane = handle.session_name ? await findPane(handle.session_name, handle.pane_id) : null;
    return !(pane?.dead ?? false);
  }
}

function requirePane(handle: AgentHandle): string {
  if (!handle.pane_id) {
    throw new Error(`Agent "${handle.slug}" has no tmux pane recorded.`);
  }
  return handle.pane_id;
}
