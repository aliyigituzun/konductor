import type { AgentAdapterManifest, AgentHandle } from "@konductor/schema";
import type { Classification } from "../status.js";
import type { AgentTransport, ReadOptions, StartSpec, TransportEvents } from "./types.js";

type Running = {
  proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  /** Everything the process has written, for `read`. */
  output: string;
  exitCode: number | null;
  exited: boolean;
};

/**
 * Runs an agent once, non-interactively, over pipes.
 *
 * This is the right shape for `claude -p`, `codex exec`, and `opencode run`: the
 * agent gets its whole task up front, streams output, and exits. It cannot be typed
 * into, which is the honest limitation of a one-shot invocation — `send` says so
 * rather than silently dropping the message.
 */
export class HeadlessTransport implements AgentTransport {
  readonly kind = "headless" as const;

  private readonly running = new Map<string, Running>();

  async start(spec: StartSpec, events: TransportEvents = {}): Promise<AgentHandle> {
    const [binary, ...args] = spec.command as [string, ...string[]];
    const proc = Bun.spawn([binary, ...args], {
      cwd: spec.cwd,
      env: spec.env,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });

    const state: Running = { proc, output: "", exitCode: null, exited: false };
    this.running.set(spec.run_id, state);

    const pump = async (stream: ReadableStream<Uint8Array>, isStderr: boolean) => {
      const decoder = new TextDecoder();
      for await (const bytes of stream) {
        const text = decoder.decode(bytes, { stream: true });
        const chunk = isStderr ? prefixLines(text, "[stderr] ") : text;
        state.output += chunk;
        events.onChunk?.(chunk);
      }
    };

    void pump(proc.stdout, false);
    void pump(proc.stderr, true);
    void proc.exited.then((code) => {
      state.exited = true;
      state.exitCode = code;
      events.onExit?.(code);
    });

    return {
      slug: spec.slug,
      run_id: spec.run_id,
      transport: "headless",
      session_name: null,
      pane_id: null,
      pid: proc.pid,
    };
  }

  async send(handle: AgentHandle, _text: string): Promise<void> {
    throw new Error(
      `Agent "${handle.slug}" runs headless and cannot be sent follow-up messages. ` +
        `Start it with a pane profile to interact with it.`,
    );
  }

  async submit(handle: AgentHandle, _manifest: AgentAdapterManifest): Promise<void> {
    return this.send(handle, "");
  }

  async read(handle: AgentHandle, options: ReadOptions = {}): Promise<string> {
    const state = this.running.get(handle.run_id);
    if (!state) return "";
    if (!options.lines) return state.output;
    return state.output.split("\n").slice(-options.lines).join("\n");
  }

  async status(handle: AgentHandle, _manifest: AgentAdapterManifest): Promise<Classification> {
    const state = this.running.get(handle.run_id);
    if (!state) {
      return {
        status: "dead",
        reason: "No running process is tracked for this agent.",
        matched: null,
        exit_code: null,
      };
    }
    if (state.exited) {
      return {
        status: "done",
        reason: `Process exited with code ${state.exitCode}.`,
        matched: null,
        exit_code: state.exitCode,
      };
    }
    return {
      status: "working",
      reason: "Process is still running.",
      matched: null,
      exit_code: null,
    };
  }

  async stop(handle: AgentHandle): Promise<void> {
    const state = this.running.get(handle.run_id);
    if (!state || state.exited) return;
    state.proc.kill();
  }

  async alive(handle: AgentHandle): Promise<boolean> {
    const state = this.running.get(handle.run_id);
    return state ? !state.exited : false;
  }

  exitCode(runId: string): number | null {
    return this.running.get(runId)?.exitCode ?? null;
  }

  forget(runId: string): void {
    this.running.delete(runId);
  }
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line, index, all) => (line === "" && index === all.length - 1 ? line : prefix + line))
    .join("\n");
}
