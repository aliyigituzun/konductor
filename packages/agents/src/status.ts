import type { AgentAdapterManifest, AgentStatus } from "@konductor/schema";

/** How many trailing lines of the screen the classifier looks at. */
export const SCREEN_TAIL_LINES = 12;

export type ClassifyInput = {
  screen: string;
  alive: boolean;
  exitCode?: number | null;
  changed: boolean;
};

export type Classification = {
  status: AgentStatus;
  /** Why the classifier landed here — surfaced by `konductor agent explain`. */
  reason: string;
  /** The pattern that matched, when one did. */
  matched: string | null;
  /**
   * Exit status of the agent's process, once it has exited. Null while running, and
   * null when the process vanished without one being recorded — which is not the
   * same as zero, and must never be reported as success.
   */
  exit_code: number | null;
};

function tail(screen: string, lines = SCREEN_TAIL_LINES): string {
  return screen.split("\n").slice(-lines).join("\n");
}

function firstMatch(patterns: string[], text: string): string | null {
  for (const source of patterns) {
    try {
      if (new RegExp(source, "i").test(text)) return source;
    } catch {
      // A malformed pattern in a user manifest must not take the classifier down.
    }
  }
  return null;
}

/**
 * Classify a live agent from its screen.
 *
 * Precedence is blocked > done > working > idle, and anything else still running
 * reads as working. `blocked` is deliberately narrow — it fires only when a known approval or
 * permission prompt is visible in the tail of the screen right now, never merely
 * because the agent went quiet. A false `blocked` would have an operator answering
 * prompts that do not exist; a false `idle` only costs one wasted poll.
 */
export function classifyScreen(
  manifest: AgentAdapterManifest,
  input: ClassifyInput,
): Classification {
  if (!input.alive) {
    return {
      status: "done",
      reason:
        input.exitCode === null || input.exitCode === undefined
          ? "Pane process exited without recording a status."
          : `Pane process exited with code ${input.exitCode}.`,
      matched: null,
      exit_code: input.exitCode ?? null,
    };
  }

  const visible = tail(input.screen);

  const blocked = firstMatch(manifest.screen.blocked, visible);
  if (blocked) {
    return {
      status: "blocked",
      reason: "An approval or permission prompt is visible on screen.",
      matched: blocked,
      exit_code: null,
    };
  }

  // A busy marker outranks the idle prompt: agents keep their input box drawn while
  // they work, so "a prompt is visible" alone never means the agent is free.
  const working = firstMatch(manifest.screen.working, visible);
  if (working) {
    return {
      status: "working",
      reason: "The agent is showing a busy indicator.",
      matched: working,
      exit_code: null,
    };
  }

  const done = firstMatch(manifest.screen.done, visible);
  if (done) {
    return {
      status: "done",
      reason: "Adapter reported a completion marker.",
      matched: done,
      exit_code: null,
    };
  }

  if (input.changed) {
    return {
      status: "working",
      reason: "Screen changed since the last sample.",
      matched: null,
      exit_code: null,
    };
  }

  const idle = firstMatch(manifest.screen.idle, visible);
  if (idle) {
    return {
      status: "idle",
      reason: "Screen is unchanged and the agent's input prompt is visible.",
      matched: idle,
      exit_code: null,
    };
  }

  return {
    status: "working",
    reason: "Screen is unchanged but no idle prompt is visible; assuming still busy.",
    matched: null,
    exit_code: null,
  };
}
