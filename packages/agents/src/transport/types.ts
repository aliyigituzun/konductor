import type { AgentAdapterManifest, AgentHandle, AgentStatus } from "@konductor/schema";
import type { Classification } from "../status.js";

export type StartSpec = {
  slug: string;
  run_id: string;
  manifest: AgentAdapterManifest;
  /** Full argv, binary first. */
  command: string[];
  cwd: string;
  env: Record<string, string>;
  /** tmux session to open the pane in. Ignored by the headless transport. */
  session: string;
};

export type ReadOptions = {
  source?: "visible" | "scrollback";
  lines?: number;
  ansi?: boolean;
};

export type TransportEvents = {
  /** Incremental output, for transports that stream (headless pipes). */
  onChunk?: (chunk: string) => void;
  onExit?: (exitCode: number | null) => void;
};

/**
 * How Konductor drives one agent process.
 *
 * Both implementations satisfy the same contract so the host does not branch on
 * transport, which is what the previous design got wrong: its API-call path
 * hand-duplicated the subprocess path's completion handling, incompletely.
 */
export interface AgentTransport {
  readonly kind: "tmux" | "headless";

  start(spec: StartSpec, events?: TransportEvents): Promise<AgentHandle>;

  /** Type text into the agent without submitting it. */
  send(handle: AgentHandle, text: string): Promise<void>;

  /** Submit whatever is in the agent's input box. */
  submit(handle: AgentHandle, manifest: AgentAdapterManifest): Promise<void>;

  read(handle: AgentHandle, options?: ReadOptions): Promise<string>;

  status(handle: AgentHandle, manifest: AgentAdapterManifest): Promise<Classification>;

  stop(handle: AgentHandle): Promise<void>;

  /** Whether the underlying process is still there. */
  alive(handle: AgentHandle): Promise<boolean>;
}

export function unsupported(kind: string, operation: string): Error {
  return new Error(`The ${kind} transport does not support "${operation}".`);
}

export type { AgentStatus };
