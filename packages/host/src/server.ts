#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ServerWebSocket } from "bun";
import type {
  AgentAdapterManifest,
  AgentHandle,
  AgentMode,
  AgentProfile,
  AgentStatus,
  PromptPack,
  RunSummary,
} from "@konductor/schema";
import {
  DEFAULT_OTEL_ENV,
  appendRunLog,
  appendUpdate,
  ensureProjectMcpConfig,
  getProject,
  hostGlobal,
  importantProjectPaths,
  listProjectRuns,
  patchRunSummary,
  readConfig,
  readGlobalRunSummary,
  readRunLog,
  readStatus,
  upsertProject,
  writeHostState,
  writeRunLog,
  writeRunSummary,
} from "@konductor/store";
import {
  HeadlessTransport,
  TmuxTransport,
  buildArgv,
  ensureWorktree,
  detectAdapter,
  loadAdapters,
  resolveAdapter,
  uniqueSlug,
  type AgentTransport,
} from "@konductor/agents";

type LaunchRunRequest = {
  profile_id?: string;
  prompt: string;
  prompt_packs?: string[];
  feature_item_id?: string | null;
  source?: "dashboard" | "cli";
  /** Preferred name for the agent; a suffix is added if it is taken. */
  slug?: string;
  /** Override the profile's pane/headless mode for this run. */
  mode?: AgentMode;
  /** Override the profile's worktree isolation for this run. */
  worktree?: boolean;
};

type TerminalSocketData = { runId: string };

/**
 * A live agent the host is supervising.
 *
 * Both transports produce one of these, so nothing downstream — completion,
 * stopping, streaming — has to branch on how the agent is being run.
 */
type LiveAgent = {
  handle: AgentHandle;
  transport: AgentTransport;
  manifest: AgentAdapterManifest;
  repoPath: string;
  projectId: string;
  /** Last screen sample, so the poller only emits what changed. */
  lastScreen: string;
  /** Interval driving status classification for pane agents. */
  poller: ReturnType<typeof setInterval> | null;
  /**
   * The kickoff message, held until the agent is ready to receive it.
   *
   * An agent TUI may open on a prompt of its own — Claude Code asks whether the
   * folder is trusted the first time it sees one. Typing into that prompt answers
   * it, so the kickoff waits for a real input box instead of firing on a timer.
   */
  pendingKickoff: string | null;
  /** Wall-clock deadline after which a never-ready agent stops being waited on. */
  kickoffDeadline: number;
};

const PORT = parseInt(process.env["KONDUCTOR_HOST_PORT"] ?? "4096", 10);
// Loopback only. The host spawns processes on behalf of callers, so it must never
// be reachable from another machine.
const HOSTNAME = process.env["KONDUCTOR_HOST_HOSTNAME"] ?? "127.0.0.1";
const HOST_ID = process.env["KONDUCTOR_HOST_ID"] ?? "local-host";
const agents = new Map<string, LiveAgent>();
const tmuxTransport = new TmuxTransport();
const headlessTransport = new HeadlessTransport();
/** How often a pane agent's screen is sampled and reclassified. */
const POLL_INTERVAL_MS = 1200;
/**
 * How long to wait for a pane agent to reach its input box before giving up on
 * handing it the task. Generous, because the agent may be sitting on a prompt only
 * the operator can answer.
 */
const KICKOFF_TIMEOUT_MS = 5 * 60 * 1000;
const sockets = new Map<string, Set<ServerWebSocket<TerminalSocketData>>>();
const stopRequested = new Set<string>();

class HostApiError extends Error {
  status: number;
  code: string;
  hint: string | null;
  details: string[];
  run_id: string | null;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      hint?: string | null;
      details?: string[];
      run_id?: string | null;
    } = {},
  ) {
    super(message);
    this.name = "HostApiError";
    this.status = options.status ?? 400;
    this.code = options.code ?? "HOST_ERROR";
    this.hint = options.hint ?? null;
    this.details = options.details ?? [];
    this.run_id = options.run_id ?? null;
  }
}

// Only a browser page served from loopback may call the host. Anything else gets no
// CORS headers, so the browser blocks it.
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

function allowedOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  return LOOPBACK_ORIGIN.test(origin) ? origin : null;
}

function withCors(req: Request, response: Response): Response {
  const origin = allowedOrigin(req);
  if (!origin) return response;
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Vary", "Origin");
  return response;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function jsonError(error: unknown): Response {
  if (error instanceof HostApiError) {
    return json(
      {
        error: error.message,
        code: error.code,
        hint: error.hint,
        details: error.details,
        run_id: error.run_id,
      },
      error.status,
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return json(
    {
      error: message,
      code: "HOST_ERROR",
      hint: `Inspect ${hostGlobal().logFile} for host-side details.`,
    },
    500,
  );
}

function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_./:=+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function redactEnvValue(key: string, value: string): string {
  if (/(token|secret|password|key)/i.test(key)) return "***";
  return value;
}

function sanitizeEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value === "") continue;
    out[key] = redactEnvValue(key, value);
  }
  return out;
}

function excerpt(text: string, limit = 140): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

function selectedPromptPacks(allPacks: PromptPack[], ids: string[]): PromptPack[] {
  const picks = ids
    .map((id) => allPacks.find((pack) => pack.id === id) ?? null)
    .filter((pack): pack is PromptPack => pack !== null);
  return picks;
}

function startupLog(
  run: RunSummary,
  prompt: string,
  packs: PromptPack[],
  mcpStatus: string,
): string {
  const lines = [
    `[konductor host] Launch request accepted at ${run.started_at}`,
    `[konductor host] Run ID: ${run.id}`,
    `[konductor host] Project: ${run.project_id}`,
    `[konductor host] Profile: ${run.profile_id} (${run.profile_title})`,
    `[konductor host] Source: ${run.source}`,
    `[konductor host] Working directory: ${run.working_directory ?? run.repo_path}`,
    `[konductor host] Feature: ${run.feature_item_title ?? run.feature_item_id ?? "direct task"}`,
    `[konductor host] Prompt packs: ${packs.length > 0 ? packs.map((pack) => pack.id).join(", ") : "(none)"}`,
    `[konductor host] MCP: ${mcpStatus}`,
    `[konductor host] Command: ${run.command}`,
    `[konductor host] Prompt excerpt: ${excerpt(prompt, 220)}`,
    "[konductor host] Waiting for agent output...",
    "",
  ];
  return lines.join("\n");
}

/** Human label for an agent, preferring the project's own naming. */
function agentLabel(profile: AgentProfile, manifest: AgentAdapterManifest): string {
  return profile.title || manifest.title;
}

function agentLabelFromRun(run: RunSummary): string {
  return run.profile_title || run.adapter_id;
}

/** A copy-pasteable rendering of the argv actually launched. */
function commandSummary(argv: string[]): string {
  return argv.map(shellQuote).join(" ");
}

async function composePrompt(
  repoPath: string,
  prompt: string,
  packs: PromptPack[],
  featureItemId: string | null | undefined,
  runId: string,
  profile: AgentProfile,
  agentTitle: string,
  source: "dashboard" | "cli",
  mcpEnabled: boolean,
): Promise<{ text: string; feature_item_title: string | null }> {
  const featureContext = await resolveFeatureContext(repoPath, featureItemId);
  const packBlocks = await Promise.all(
    packs.map(async (pack) => {
      const refs = await fileRefBlock(repoPath, pack);
      return [
        `## Prompt Pack: ${pack.title}`,
        pack.instructions,
        pack.mcp_reminder ?? null,
        refs || null,
      ]
        .filter(Boolean)
        .join("\n\n");
    }),
  );

  const text = [
    `You are running inside a Konductor-managed ${agentTitle} session.`,
    featureContext.feature_block || null,
    ...packBlocks,
    "## Required Workflow",
    "1. Inspect the relevant code and understand the task before editing files.",
    mcpEnabled
      ? "2. Konductor MCP is expected to be available here. Start by calling get_run_context, get_project_context, and get_current_status."
      : "2. Konductor MCP may not be available. If you cannot use it, say so clearly in your updates and final output.",
    "3. Use write_update after repository inspection, after meaningful implementation steps, and whenever you hit a blocker, permission issue, or scope change.",
    featureItemId
      ? "4. If you complete or materially change the selected feature, call write_status before you finish so the dashboard reflects the outcome."
      : "4. If your work changes project state in a meaningful way, call write_status before you finish so the dashboard reflects the outcome.",
    "5. Do not report success unless the code changes actually landed and you either wrote status through MCP or explicitly explain why you could not.",
    "## Operator Prompt",
    prompt,
    "## Konductor Run Metadata",
    `run_id: ${runId}`,
    `profile_id: ${profile.id}`,
    `source: ${source}`,
    featureItemId ? `feature_item_id: ${featureItemId}` : null,
    "If the Konductor MCP server is available, use it to read project context, write incremental updates, and persist status updates with this run context.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    text,
    feature_item_title: featureContext.feature_item_title,
  };
}

async function fileRefBlock(repoPath: string, pack: PromptPack): Promise<string> {
  if (pack.file_refs.length === 0) return "";
  const parts: string[] = [];
  for (const fileRef of pack.file_refs) {
    const filePath = join(repoPath, fileRef);
    if (!existsSync(filePath)) continue;
    try {
      const content = await readFile(filePath, "utf-8");
      parts.push(`## File Reference: ${fileRef}\n${content}`);
    } catch {
      // Best effort only.
    }
  }
  return parts.join("\n\n");
}

async function resolveFeatureContext(repoPath: string, featureItemId: string | null | undefined): Promise<{
  feature_item_title: string | null;
  feature_block: string;
}> {
  if (!featureItemId) {
    return { feature_item_title: null, feature_block: "" };
  }

  const snap = await readStatus(repoPath);
  const feature =
    snap?.features
      ?.flatMap((category) =>
        category.items.map((item) => ({
          category_id: category.id,
          category_title: category.title,
          ...item,
        })),
      )
      .find((item) => item.id === featureItemId) ?? null;

  if (!feature) {
    return {
      feature_item_title: null,
      feature_block: `## Selected Feature Item\nFeature item \`${featureItemId}\` was selected, but it was not found in the latest status snapshot.`,
    };
  }

  return {
    feature_item_title: feature.title,
    feature_block: [
      "## Selected Feature Item",
      `ID: ${feature.id}`,
      `Category: ${feature.category_title}`,
      `Title: ${feature.title}`,
      `Status: ${feature.status}`,
      feature.description ? `Description: ${feature.description}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

async function syncProjectRegistry(repoPath: string, projectId: string, defaultProfile: string): Promise<void> {
  const entry = await getProject(projectId);
  if (!entry) return;
  const runs = await listProjectRuns(repoPath);
  await upsertProject({
    ...entry,
    default_profile: defaultProfile,
    active_run_count: runs.filter((run) => run.status === "running" || run.status === "queued").length,
    last_agent_activity_at: runs[0]?.started_at ?? entry.last_agent_activity_at ?? null,
  });
}

function emitTerminal(runId: string, payload: unknown): void {
  const peers = sockets.get(runId);
  if (!peers) return;
  const message = JSON.stringify(payload);
  for (const socket of peers) {
    socket.send(message);
  }
}

async function appendTerminalChunk(repoPath: string, run: RunSummary, chunk: string, stream: "stdout" | "stderr"): Promise<void> {
  const prefix = stream === "stderr" ? "[stderr] " : "";
  const nextChunk = chunk
    .split("\n")
    .map((line, index, all) => {
      if (line.length === 0 && index === all.length - 1) return "";
      return `${prefix}${line}`;
    })
    .join("\n");
  await appendRunLog(repoPath, run.id, nextChunk);
  const current = await listProjectRunById(run.id);
  const nextPreview = excerpt(`${current?.terminal_preview ?? run.terminal_preview}${nextChunk}`, 240);
  await patchRunSummary(repoPath, run.id, { terminal_preview: nextPreview });
  emitTerminal(run.id, { type: "chunk", chunk: nextChunk });
}

/**
 * The single completion path.
 *
 * Both transports land here — the pane poller when its process exits, the headless
 * transport from its onExit callback — so the "succeeded but never wrote status"
 * warning and the registry sync happen exactly once, for every kind of agent.
 */
async function finalizeRun(runId: string, repoPath: string, exitCode: number | null): Promise<void> {
  const current = await listProjectRunById(runId);
  if (!current) return;
  // Already finalized: the poller can observe a dead pane more than once.
  if (current.status !== "running" && current.status !== "queued") {
    releaseAgent(runId);
    return;
  }
  if (stopRequested.has(runId)) {
    stopRequested.delete(runId);
    await appendRunLog(repoPath, runId, `\n[konductor host] Run stopped by operator.\n`);
    await patchRunSummary(repoPath, runId, {
      status: "stopped",
      ended_at: current.ended_at ?? new Date().toISOString(),
      exit_code: null,
      last_error: null,
    });
    releaseAgent(runId);
    emitTerminal(runId, { type: "status", status: "stopped" });
    return;
  }

  const succeeded = exitCode === 0;
  const updated = await patchRunSummary(repoPath, runId, {
    status: succeeded ? "succeeded" : "failed",
    agent_status: "done",
    ended_at: new Date().toISOString(),
    exit_code: exitCode,
    last_error: succeeded
      ? null
      : exitCode === null
        ? `${agentLabelFromRun(current)} disappeared before reporting an exit code.`
        : `${agentLabelFromRun(current)} exited with code ${exitCode}.`,
  });
  if (!updated) return;

  await appendRunLog(
    repoPath,
    runId,
    `\n[konductor host] ${agentLabelFromRun(updated)} finished (exit ${exitCode ?? "unknown"}). Final status: ${updated.status}.\n`,
  );
  await appendUpdate(repoPath, {
    kind: "milestone",
    message:
      updated.status === "succeeded"
        ? `${agentLabelFromRun(updated)} agent "${updated.slug}" completed successfully.`
        : `${agentLabelFromRun(updated)} agent "${updated.slug}" failed (exit ${exitCode ?? "unknown"}).`,
    agent: "konductor-host",
    run_id: runId,
    profile_id: updated.profile_id,
    feature_item_id: updated.feature_item_id,
    source: updated.source,
    task_state: updated.status === "succeeded" ? "completed" : "failed",
  });

  let hostUpdates = 1;
  if (updated.status === "succeeded" && updated.status_write_count === 0) {
    await appendRunLog(
      repoPath,
      runId,
      `[konductor host] Warning: ${agentLabelFromRun(updated)} exited successfully but did not write a Konductor status snapshot. Dashboard tracking may still be stale.\n`,
    );
    await appendUpdate(repoPath, {
      kind: "milestone",
      message:
        `${agentLabelFromRun(updated)} run ${runId} exited successfully but did not write a Konductor status snapshot. ` +
        "Code may have changed while dashboard tracking stayed stale.",
      agent: "konductor-host",
      run_id: runId,
      profile_id: updated.profile_id,
      feature_item_id: updated.feature_item_id,
      source: updated.source,
      task_state: "completed",
    });
    hostUpdates += 1;
  }

  await patchRunSummary(repoPath, runId, {
    update_count: updated.update_count + hostUpdates,
  });
  await syncProjectRegistry(repoPath, updated.project_id, updated.profile_id);
  emitTerminal(runId, { type: "status", status: updated.status, exit_code: exitCode });
  releaseAgent(runId);
}

/** Drop a finished agent from the fleet, stopping its poller first. */
function releaseAgent(runId: string): void {
  stopPolling(runId);
  if (agents.get(runId)?.transport === headlessTransport) headlessTransport.forget(runId);
  agents.delete(runId);
}

async function pumpStream(
  runId: string,
  repoPath: string,
  run: RunSummary,
  stream: ReadableStream<Uint8Array> | null,
  label: "stdout" | "stderr",
): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    if (!chunk) continue;
    await appendTerminalChunk(repoPath, run, chunk, label);
  }
}

/**
 * Hand a pane agent its task through a file.
 *
 * A newline sent to an agent TUI submits the input box early, cutting the prompt in
 * half, so the composed prompt never travels over send-keys. The agent gets a
 * one-line pointer to this file instead.
 */
async function writeTaskFile(workingDirectory: string, runId: string, text: string): Promise<string> {
  const dir = join(workingDirectory, ".konductor", "tasks");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${runId}.md`);
  await writeFile(path, text, "utf-8");

  // Keep Konductor's scratch state out of the user's diffs without editing their
  // .gitignore, which is their file, not ours.
  try {
    const excludePath = join(workingDirectory, ".git", "info", "exclude");
    if (existsSync(excludePath)) {
      const current = await readFile(excludePath, "utf-8");
      if (!current.includes(".konductor/")) {
        await appendFile(excludePath, `${current.endsWith("\n") ? "" : "\n"}.konductor/\n`);
      }
    }
  } catch {
    // Best effort; a missing or read-only exclude file must not fail a launch.
  }

  return path;
}

/** Slugs currently taken by live agents, so a new one stays addressable. */
function liveSlugs(): string[] {
  return [...agents.values()].map((agent) => agent.handle.slug);
}

export function findAgentBySlug(slug: string): LiveAgent | null {
  for (const agent of agents.values()) {
    if (agent.handle.slug === slug) return agent;
  }
  return null;
}

/**
 * Sample a pane agent's screen on an interval: push what changed to any dashboard
 * watching, keep a short preview on the run summary, and finalize the run once the
 * pane's process exits.
 *
 * A TUI redraws its whole screen constantly, so screens are broadcast as snapshots
 * rather than appended to the run log — the log stays a record of lifecycle events,
 * not a transcript of cursor movements.
 */
function startPolling(runId: string): void {
  const agent = agents.get(runId);
  if (!agent || agent.poller) return;

  agent.poller = setInterval(() => {
    void (async () => {
      const live = agents.get(runId);
      if (!live) return;
      try {
        const screen = await live.transport.read(live.handle, { source: "visible" });
        if (screen !== live.lastScreen) {
          live.lastScreen = screen;
          emitTerminal(runId, { type: "screen", screen });
          await patchRunSummary(live.repoPath, runId, {
            terminal_preview: excerpt(screen.split("\n").slice(-6).join("\n"), 240),
          });
        }

        const classification = await live.transport.status(live.handle, live.manifest);

        if (live.pendingKickoff) {
          if (classification.status === "idle") {
            const kickoff = live.pendingKickoff;
            live.pendingKickoff = null;
            await live.transport.send(live.handle, kickoff);
            await live.transport.submit(live.handle, live.manifest);
            await appendRunLog(live.repoPath, runId, `[konductor host] Sent kickoff: ${kickoff}\n`);
          } else if (Date.now() > live.kickoffDeadline) {
            live.pendingKickoff = null;
            await appendRunLog(
              live.repoPath,
              runId,
              "[konductor host] Gave up waiting for the agent's input box; the task was " +
                "never sent. Attach to the pane to see what it is showing.\n",
            );
          }
        }

        const current = await listProjectRunById(runId);
        if (current && current.agent_status !== classification.status) {
          await patchRunSummary(live.repoPath, runId, { agent_status: classification.status });
          emitTerminal(runId, {
            type: "agent_status",
            agent_status: classification.status,
            reason: classification.reason,
          });
        }

        if (classification.status === "done" || classification.status === "dead") {
          // Report what the process actually exited with. Assuming zero here would
          // turn every crashed agent into a success.
          await finalizeRun(runId, live.repoPath, classification.exit_code);
        }
      } catch (error) {
        // A transient tmux failure must not kill the poller; the next tick retries.
        process.stderr.write(
          `[konductor host] poll failed for ${runId}: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    })();
  }, POLL_INTERVAL_MS);
}

function stopPolling(runId: string): void {
  const agent = agents.get(runId);
  if (agent?.poller) {
    clearInterval(agent.poller);
    agent.poller = null;
  }
}

async function launchRun(projectId: string, body: LaunchRunRequest): Promise<RunSummary> {
  const entry = await getProject(projectId);
  if (!entry) {
    throw new HostApiError(`Project ${projectId} not found.`, {
      status: 404,
      code: "PROJECT_NOT_FOUND",
      hint: "Re-run `konductor init` in the repo or refresh the dashboard registry.",
    });
  }

  const repoPath = entry.repo_path;
  const config = await readConfig(repoPath);
  if (!config?.agents) {
    throw new HostApiError("Project has no configured agent profiles.", {
      status: 400,
      code: "AGENT_CONFIG_MISSING",
      hint: "Add an `agents` section to `konductor.config.json` or re-run `konductor init`.",
    });
  }

  if (!body.prompt?.trim()) {
    throw new HostApiError("Prompt is required before a run can start.", {
      status: 400,
      code: "PROMPT_REQUIRED",
      hint: "Enter a task prompt in the dashboard or pass `--prompt` on the CLI.",
    });
  }

  const profileId = body.profile_id ?? config.agents.default_profile;
  const profile = config.agents.profiles.find((item) => item.id === profileId);
  if (!profile) {
    throw new HostApiError(`Profile ${profileId} was not found.`, {
      status: 400,
      code: "PROFILE_NOT_FOUND",
      hint: "Select a valid profile or update `konductor.config.json`.",
      details: [`Requested profile: ${profileId}`],
    });
  }

  let manifest: AgentAdapterManifest;
  try {
    manifest = await resolveAdapter(profile.adapter, repoPath);
  } catch (error) {
    throw new HostApiError(error instanceof Error ? error.message : String(error), {
      status: 400,
      code: "ADAPTER_NOT_FOUND",
      hint: "Run `konductor adapters list` to see what is available.",
    });
  }

  const label = agentLabel(profile, manifest);
  const mode: AgentMode = body.mode ?? profile.mode;
  const binary = profile.binary ?? manifest.binary;

  if (!Bun.which(binary)) {
    throw new HostApiError(`${label} binary not found on PATH: ${binary}`, {
      status: 400,
      code: "AGENT_BINARY_NOT_FOUND",
      hint: `Install ${manifest.title}${manifest.homepage ? ` (${manifest.homepage})` : ""}, or set "binary" on the profile.`,
      details: [`Configured binary: ${binary}`, `Adapter: ${manifest.id}`],
    });
  }

  if (mode === "pane" && !(await TmuxTransport.available())) {
    throw new HostApiError("tmux is required to run an agent in a pane.", {
      status: 400,
      code: "TMUX_NOT_AVAILABLE",
      hint: 'Install tmux (`brew install tmux`), or set the profile mode to "headless".',
    });
  }

  const runId = randomUUID();
  const source = body.source ?? "dashboard";

  if (config.agents.prompt_packs.length === 0) {
    throw new HostApiError("No prompt packs are configured for this project.", {
      status: 400,
      code: "PROMPT_PACKS_MISSING",
      hint: "Add at least one prompt pack to `konductor.config.json`.",
    });
  }
  const packIds = body.prompt_packs?.length ? body.prompt_packs : [config.agents.prompt_packs[0]!.id];
  const packs = selectedPromptPacks(config.agents.prompt_packs, packIds);
  const missingPackIds = packIds.filter((id) => !packs.some((pack) => pack.id === id));
  if (missingPackIds.length > 0) {
    throw new HostApiError("One or more selected prompt packs do not exist.", {
      status: 400,
      code: "PROMPT_PACK_NOT_FOUND",
      hint: "Pick a configured prompt pack or update `konductor.config.json`.",
      details: missingPackIds.map((id) => `Missing prompt pack: ${id}`),
    });
  }

  const mcpEnabled = profile.default_mcp !== false && manifest.mcp.kind !== "none";
  let mcpStatus = "disabled by profile";
  if (profile.default_mcp !== false && manifest.mcp.kind === "none") {
    mcpStatus = `unsupported by the ${manifest.title} adapter`;
  } else if (mcpEnabled && manifest.mcp.kind === "mcp_json") {
    const wroteMcp = await ensureProjectMcpConfig(repoPath);
    mcpStatus = wroteMcp ? "enabled, wrote .mcp.json" : "enabled, using existing .mcp.json";
  } else if (mcpEnabled) {
    // The adapter keeps MCP servers somewhere Konductor does not manage yet.
    mcpStatus = `enabled, expects Konductor MCP in the ${manifest.mcp.kind} config`;
  }

  const promptPayload = await composePrompt(
    repoPath,
    body.prompt,
    packs,
    body.feature_item_id,
    runId,
    profile,
    label,
    source,
    mcpEnabled,
  );

  const slug = uniqueSlug(
    body.slug ?? promptPayload.feature_item_title ?? profile.id,
    liveSlugs(),
  );

  let worktreePath: string | null = null;
  let branch: string | null = null;
  if (body.worktree ?? profile.worktree) {
    try {
      const worktree = await ensureWorktree(repoPath, slug);
      worktreePath = worktree.path;
      branch = worktree.branch;
    } catch (error) {
      throw new HostApiError(error instanceof Error ? error.message : String(error), {
        status: 400,
        code: "WORKTREE_FAILED",
      });
    }
  }

  const workingDirectory =
    worktreePath ?? (profile.default_working_dir === "current" ? process.cwd() : repoPath);

  const envSummaryInput: Record<string, string | undefined> = {
    KONDUCTOR_RUN_ID: runId,
    KONDUCTOR_PROFILE_ID: profile.id,
    KONDUCTOR_AGENT_SLUG: slug,
    KONDUCTOR_FEATURE_ITEM_ID: body.feature_item_id ?? undefined,
    KONDUCTOR_RUN_SOURCE: source,
    ...(manifest.telemetry.kind === "otel_env" ? DEFAULT_OTEL_ENV : {}),
    ...profile.default_env,
  };

  // A pane agent is launched bare and told where its brief is; a headless agent gets
  // the whole prompt in argv because it has no input box to type into.
  const taskFile =
    mode === "pane" ? await writeTaskFile(workingDirectory, runId, promptPayload.text) : null;
  let argv: string[];
  try {
    argv = buildArgv(manifest, profile, mode, {
      prompt: mode === "headless" ? promptPayload.text : undefined,
      task_file: taskFile ?? undefined,
    });
  } catch (error) {
    throw new HostApiError(error instanceof Error ? error.message : String(error), {
      status: 400,
      code: "ADAPTER_INVOCATION_INVALID",
    });
  }

  const session = config.host?.tmux_session ?? "konductor";
  const summary: RunSummary = {
    schema_version: "0.3.0",
    id: runId,
    project_id: projectId,
    repo_path: repoPath,
    profile_id: profile.id,
    profile_title: profile.title,
    adapter_id: manifest.id,
    slug,
    transport: mode === "pane" ? "tmux" : "headless",
    session_name: mode === "pane" ? session : null,
    pane_id: null,
    agent_status: "starting",
    worktree_path: worktreePath,
    branch,
    feature_item_id: body.feature_item_id ?? null,
    feature_item_title: promptPayload.feature_item_title,
    prompt_excerpt: excerpt(body.prompt, 220),
    prompt_packs: packs.map((pack) => pack.id),
    source,
    command: commandSummary(argv),
    env_summary: sanitizeEnv(envSummaryInput),
    working_directory: workingDirectory,
    status: "queued",
    started_at: new Date().toISOString(),
    ended_at: null,
    exit_code: null,
    log_path: join(hostGlobal().logsDir, `${runId}.log`),
    repo_log_path: join(repoPath, ".konductor", "runs", `${runId}.log`),
    status_write_count: 0,
    update_count: 0,
    last_status_at: null,
    last_error: null,
    terminal_preview: "",
  };

  await writeRunSummary(repoPath, summary);
  await writeRunLog(repoPath, runId, startupLog(summary, body.prompt, packs, mcpStatus));
  await appendUpdate(repoPath, {
    kind: "milestone",
    message: `Queued ${label} agent "${slug}"${promptPayload.feature_item_title ? ` for feature "${promptPayload.feature_item_title}"` : ""}.`,
    agent: "konductor-host",
    run_id: runId,
    profile_id: profile.id,
    feature_item_id: body.feature_item_id ?? null,
    source,
    task_state: "started",
  });
  await patchRunSummary(repoPath, runId, { update_count: 1 });

  const env = { ...process.env, ...envSummaryInput } as Record<string, string>;
  const transport: AgentTransport = mode === "pane" ? tmuxTransport : headlessTransport;

  let handle: AgentHandle;
  try {
    handle = await transport.start(
      {
        slug,
        run_id: runId,
        manifest,
        command: argv,
        cwd: workingDirectory,
        env,
        session,
      },
      {
        onChunk: (chunk) => {
          void appendTerminalChunk(repoPath, summary, chunk, "stdout");
        },
        onExit: (code) => {
          void finalizeRun(runId, repoPath, code);
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await patchRunSummary(repoPath, runId, {
      status: "failed",
      agent_status: "dead",
      ended_at: new Date().toISOString(),
      exit_code: null,
      last_error: message,
    });
    await appendRunLog(repoPath, runId, `[konductor host] Failed to start ${label}: ${message}\n`);
    await appendUpdate(repoPath, {
      kind: "milestone",
      message: `${label} agent "${slug}" failed before launch: ${message}.`,
      agent: "konductor-host",
      run_id: runId,
      profile_id: profile.id,
      feature_item_id: body.feature_item_id ?? null,
      source,
      task_state: "failed",
    });
    if (failed) {
      await patchRunSummary(repoPath, runId, { update_count: failed.update_count + 1 });
    }
    await syncProjectRegistry(repoPath, projectId, profile.id);
    throw new HostApiError(`${label} could not be started.`, {
      status: 500,
      code: "AGENT_LAUNCH_FAILED",
      hint: `Inspect ${summary.log_path} or the dashboard terminal panel for the launch trace.`,
      details: [
        `Run ID: ${runId}`,
        `Working directory: ${workingDirectory}`,
        `Command: ${summary.command}`,
        `Launch error: ${message}`,
      ],
      run_id: runId,
    });
  }

  agents.set(runId, {
    handle,
    transport,
    manifest,
    repoPath,
    projectId,
    lastScreen: "",
    poller: null,
    pendingKickoff: null,
    kickoffDeadline: 0,
  });

  const runningSummary =
    (await patchRunSummary(repoPath, runId, {
      status: "running",
      agent_status: mode === "pane" ? "starting" : "working",
      pane_id: handle.pane_id,
      session_name: handle.session_name,
    })) ?? summary;

  await appendRunLog(repoPath, runId, `[konductor host] ${label} started (${mode}).\n`);

  if (mode === "pane" && taskFile) {
    const live = agents.get(runId);
    if (live) {
      live.pendingKickoff = kickoffMessage(taskFile, workingDirectory);
      live.kickoffDeadline = Date.now() + KICKOFF_TIMEOUT_MS;
    }
    // Give the TUI a moment to draw before the first sample, so the very first
    // classification is not made against a blank screen.
    setTimeout(() => startPolling(runId), manifest.ready_delay_ms);
  }

  await syncProjectRegistry(repoPath, projectId, profile.id);
  return runningSummary;
}

/** The one-line pointer to the brief that starts a pane agent working. */
function kickoffMessage(taskFile: string, workingDirectory: string): string {
  const relative = taskFile.startsWith(workingDirectory)
    ? taskFile.slice(workingDirectory.length + 1)
    : taskFile;
  return `Read ${relative} and carry out the task described in it, following the workflow that file specifies.`;
}

/** Send a follow-up message to a live agent, as `konductor agent send` does. */
async function sendToAgent(slug: string, text: string): Promise<{ slug: string; sent: string }> {
  const agent = findAgentBySlug(slug);
  if (!agent) {
    throw new HostApiError(`No live agent named "${slug}".`, {
      status: 404,
      code: "AGENT_NOT_FOUND",
      hint: "Run `konductor agent list` to see live agents.",
    });
  }
  try {
    await agent.transport.send(agent.handle, text);
    await agent.transport.submit(agent.handle, agent.manifest);
  } catch (error) {
    throw new HostApiError(error instanceof Error ? error.message : String(error), {
      status: 400,
      code: "AGENT_SEND_FAILED",
    });
  }
  await appendRunLog(agent.repoPath, agent.handle.run_id, `[konductor host] Operator sent: ${text}\n`);
  return { slug, sent: text };
}

async function readAgent(
  slug: string,
  options: { source?: "visible" | "scrollback"; lines?: number; ansi?: boolean },
): Promise<{ slug: string; text: string }> {
  const agent = findAgentBySlug(slug);
  if (!agent) {
    throw new HostApiError(`No live agent named "${slug}".`, {
      status: 404,
      code: "AGENT_NOT_FOUND",
    });
  }
  return { slug, text: await agent.transport.read(agent.handle, options) };
}

async function explainAgent(slug: string): Promise<unknown> {
  const agent = findAgentBySlug(slug);
  if (!agent) {
    throw new HostApiError(`No live agent named "${slug}".`, {
      status: 404,
      code: "AGENT_NOT_FOUND",
    });
  }
  const classification = await agent.transport.status(agent.handle, agent.manifest);
  const screen = await agent.transport.read(agent.handle, { source: "visible" });
  return {
    slug,
    run_id: agent.handle.run_id,
    adapter_id: agent.manifest.id,
    transport: agent.handle.transport,
    pane_id: agent.handle.pane_id,
    status: classification.status,
    reason: classification.reason,
    matched_pattern: classification.matched,
    screen_tail: screen.split("\n").slice(-12).join("\n"),
  };
}

/** Every adapter available to a project, with whether its binary is installed. */
async function adapterCatalog(repoPath: string | null): Promise<unknown> {
  const registry = await loadAdapters(repoPath ?? undefined);
  const adapters = await Promise.all(
    registry.adapters.map(async ({ manifest, source, path }) => ({
      id: manifest.id,
      title: manifest.title,
      binary: manifest.binary,
      homepage: manifest.homepage ?? null,
      verified: manifest.verified,
      source,
      // Where the manifest came from; `path` below is the resolved binary.
      manifest_path: path,
      modes: [manifest.interactive ? "pane" : null, manifest.headless ? "headless" : null].filter(
        Boolean,
      ),
      mcp: manifest.mcp.kind,
      telemetry: manifest.telemetry.kind,
      ...(await detectAdapter(manifest)),
    })),
  );
  return { adapters, issues: registry.issues };
}

/** The fleet: every agent this host is currently supervising. */
async function fleet(): Promise<unknown> {
  const rows = await Promise.all(
    [...agents.values()].map(async (agent) => {
      const classification = await agent.transport.status(agent.handle, agent.manifest);
      const run = await listProjectRunById(agent.handle.run_id);
      return {
        slug: agent.handle.slug,
        run_id: agent.handle.run_id,
        project_id: agent.projectId,
        adapter_id: agent.manifest.id,
        adapter_title: agent.manifest.title,
        transport: agent.handle.transport,
        session_name: agent.handle.session_name,
        pane_id: agent.handle.pane_id,
        pid: agent.handle.pid,
        agent_status: classification.status,
        reason: classification.reason,
        cwd: run?.working_directory ?? null,
        worktree_path: run?.worktree_path ?? null,
        branch: run?.branch ?? null,
        feature_item_title: run?.feature_item_title ?? null,
        started_at: run?.started_at ?? null,
      };
    }),
  );
  rows.sort((a, b) => a.slug.localeCompare(b.slug));
  return { agents: rows };
}

async function projectAgents(projectId: string): Promise<unknown> {
  const entry = await getProject(projectId);
  if (!entry) {
    throw new HostApiError(`Project ${projectId} not found.`, {
      status: 404,
      code: "PROJECT_NOT_FOUND",
    });
  }

  const [config, runs] = await Promise.all([
    readConfig(entry.repo_path),
    listProjectRuns(entry.repo_path),
  ]);

  return {
    config,
    active_runs: runs.filter((run) => run.status === "running" || run.status === "queued"),
    past_runs: runs.filter((run) => run.status !== "running" && run.status !== "queued"),
  };
}

async function stopRun(runId: string): Promise<RunSummary> {
  const running = agents.get(runId);
  if (!running) {
    const existing = await patchRunSummaryByStopped(runId);
    if (!existing) {
      throw new HostApiError(`Run ${runId} not found.`, {
        status: 404,
        code: "RUN_NOT_FOUND",
      });
    }
    return existing;
  }

  stopRequested.add(runId);
  const stoppedAt = new Date().toISOString();
  const updated = await patchRunSummary(running.repoPath, runId, {
    status: "stopped",
    agent_status: "dead",
    ended_at: stoppedAt,
    exit_code: null,
    last_error: null,
  });
  if (!updated) {
    stopRequested.delete(runId);
    throw new HostApiError(`Run ${runId} not found.`, {
      status: 404,
      code: "RUN_NOT_FOUND",
    });
  }

  // Kills the tmux pane or the headless process, whichever backs this agent.
  await running.transport.stop(running.handle);
  await appendRunLog(running.repoPath, runId, `\n[konductor host] Stop requested at ${stoppedAt}.\n`);

  await appendUpdate(running.repoPath, {
    kind: "milestone",
    message: `Stopped ${agentLabelFromRun(updated)} run ${runId}.`,
    agent: "konductor-host",
    run_id: runId,
    profile_id: updated.profile_id,
    feature_item_id: updated.feature_item_id,
    source: updated.source,
    task_state: "stopped",
  });
  await patchRunSummary(running.repoPath, runId, { update_count: updated.update_count + 1 });
  await syncProjectRegistry(running.repoPath, updated.project_id, updated.profile_id);
  emitTerminal(runId, { type: "status", status: "stopped" });
  releaseAgent(runId);
  return updated;
}

async function patchRunSummaryByStopped(runId: string): Promise<RunSummary | null> {
  const hostRun = (await listProjectRunById(runId)) ?? null;
  if (!hostRun || hostRun.status === "stopped") return hostRun;
  return patchRunSummary(hostRun.repo_path, runId, {
    status: "stopped",
    ended_at: new Date().toISOString(),
  });
}

async function listProjectRunById(runId: string): Promise<RunSummary | null> {
  return readGlobalRunSummary(runId);
}

await writeHostState({
  schema_version: "0.2.0",
  host_id: HOST_ID,
  started_at: new Date().toISOString(),
  port: PORT,
  pid: process.pid,
});

function handleRequest(
  req: Request,
  serverRef: Bun.Server<TerminalSocketData>,
): Response | Promise<Response> | undefined {
  {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const wsMatch = url.pathname.match(/^\/runs\/([^/]+)\/stream$/);
    if (wsMatch) {
      const runId = wsMatch[1]!;
      if (serverRef.upgrade(req, { data: { runId } })) {
        return undefined;
      }
      return json({ error: "WebSocket upgrade failed" }, 400);
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        host_id: HOST_ID,
        pid: process.pid,
        port: PORT,
        running_runs: Array.from(agents.keys()),
        tmux_session: [...agents.values()][0]?.handle.session_name ?? null,
      });
    }

    const infoMatch = url.pathname.match(/^\/projects\/([^/]+)\/info$/);
    if (req.method === "GET" && infoMatch) {
      return Promise.resolve()
        .then(async () => {
          const projectId = infoMatch[1]!;
          const entry = await getProject(projectId);
          if (!entry) {
            throw new HostApiError("Project not found.", {
              status: 404,
              code: "PROJECT_NOT_FOUND",
            });
          }
          return json(importantProjectPaths(entry.repo_path));
        })
        .catch((error) => jsonError(error));
    }

    const agentsMatch = url.pathname.match(/^\/projects\/([^/]+)\/agents$/);
    if (req.method === "GET" && agentsMatch) {
      return Promise.resolve()
        .then(() => projectAgents(agentsMatch[1]!))
        .then((data) => json(data))
        .catch((error) => jsonError(error));
    }

    const createMatch = url.pathname.match(/^\/projects\/([^/]+)\/runs$/);
    if (req.method === "POST" && createMatch) {
      return Promise.resolve(req.json() as Promise<LaunchRunRequest>)
        .then((body) => launchRun(createMatch[1]!, body))
        .then((summary) => json(summary, 201))
        .catch((error) => jsonError(error));
    }

    const runMatch = url.pathname.match(/^\/runs\/([^/]+)$/);
    if (req.method === "GET" && runMatch) {
      return Promise.resolve()
        .then(() => listProjectRunById(runMatch[1]!))
        .then((run) =>
          run
            ? json(run)
            : jsonError(new HostApiError("Run not found.", { status: 404, code: "RUN_NOT_FOUND" })),
        )
        .catch((error) => jsonError(error));
    }

    const stopMatch = url.pathname.match(/^\/runs\/([^/]+)\/stop$/);
    if (req.method === "POST" && stopMatch) {
      return Promise.resolve()
        .then(() => stopRun(stopMatch[1]!))
        .then((summary) => json(summary))
        .catch((error) => jsonError(error));
    }

    const terminalMatch = url.pathname.match(/^\/runs\/([^/]+)\/terminal$/);
    if (req.method === "GET" && terminalMatch) {
      return Promise.resolve()
        .then(async () => {
          const run = await listProjectRunById(terminalMatch[1]!);
          if (!run) {
            throw new HostApiError("Run not found.", {
              status: 404,
              code: "RUN_NOT_FOUND",
            });
          }
          const log = await readRunLog(run.id);
          return json({ run, log });
        })
        .catch((error) => jsonError(error));
    }

    // ---- fleet: live agents, addressed by slug ----------------------------

    if (req.method === "GET" && url.pathname === "/agents") {
      return Promise.resolve().then(fleet).then((data) => json(data)).catch(jsonError);
    }

    if (req.method === "GET" && url.pathname === "/adapters") {
      return Promise.resolve()
        .then(() => adapterCatalog(url.searchParams.get("repo")))
        .then((data) => json(data))
        .catch(jsonError);
    }

    const sendMatch = url.pathname.match(/^\/agents\/([^/]+)\/send$/);
    if (req.method === "POST" && sendMatch) {
      return Promise.resolve(req.json() as Promise<{ text?: string }>)
        .then((body) => {
          if (!body.text?.trim()) {
            throw new HostApiError("A message is required.", {
              status: 400,
              code: "MESSAGE_REQUIRED",
            });
          }
          return sendToAgent(decodeURIComponent(sendMatch[1]!), body.text);
        })
        .then((data) => json(data))
        .catch(jsonError);
    }

    const readMatch = url.pathname.match(/^\/agents\/([^/]+)\/read$/);
    if (req.method === "GET" && readMatch) {
      const source = url.searchParams.get("source") === "scrollback" ? "scrollback" : "visible";
      const linesParam = Number.parseInt(url.searchParams.get("lines") ?? "", 10);
      return Promise.resolve()
        .then(() =>
          readAgent(decodeURIComponent(readMatch[1]!), {
            source,
            ...(Number.isFinite(linesParam) ? { lines: linesParam } : {}),
            ansi: url.searchParams.get("ansi") === "1",
          }),
        )
        .then((data) => json(data))
        .catch(jsonError);
    }

    const explainMatch = url.pathname.match(/^\/agents\/([^/]+)\/explain$/);
    if (req.method === "GET" && explainMatch) {
      return Promise.resolve()
        .then(() => explainAgent(decodeURIComponent(explainMatch[1]!)))
        .then((data) => json(data))
        .catch(jsonError);
    }

    const agentStopMatch = url.pathname.match(/^\/agents\/([^/]+)\/stop$/);
    if (req.method === "POST" && agentStopMatch) {
      return Promise.resolve()
        .then(() => {
          const agent = findAgentBySlug(decodeURIComponent(agentStopMatch[1]!));
          if (!agent) {
            throw new HostApiError(`No live agent named "${agentStopMatch[1]}".`, {
              status: 404,
              code: "AGENT_NOT_FOUND",
            });
          }
          return stopRun(agent.handle.run_id);
        })
        .then((data) => json(data))
        .catch(jsonError);
    }

    const agentMatch = url.pathname.match(/^\/agents\/([^/]+)$/);
    if (req.method === "GET" && agentMatch) {
      return Promise.resolve()
        .then(async () => {
          const slug = decodeURIComponent(agentMatch[1]!);
          const all = (await fleet()) as { agents: Array<{ slug: string }> };
          const found = all.agents.find((agent) => agent.slug === slug);
          if (!found) {
            throw new HostApiError(`No live agent named "${slug}".`, {
              status: 404,
              code: "AGENT_NOT_FOUND",
            });
          }
          return found;
        })
        .then((data) => json(data))
        .catch(jsonError);
    }

    return json({ error: "Not found" }, 404);
  }
}

const server = Bun.serve<TerminalSocketData>({
  port: PORT,
  hostname: HOSTNAME,
  async fetch(req, serverRef) {
    const response = await handleRequest(req, serverRef);
    // undefined means the request was consumed by a WebSocket upgrade.
    if (!response) return undefined;
    return withCors(req, response);
  },
  websocket: {
    async open(socket) {
      const runId = socket.data.runId;
      const peers = sockets.get(runId) ?? new Set<ServerWebSocket<TerminalSocketData>>();
      peers.add(socket);
      sockets.set(runId, peers);
      const run = await listProjectRunById(runId);
      const log = await readRunLog(runId);
      // A pane agent's output lives on its screen, not in the log, so a fresh
      // subscriber gets the current screen alongside the lifecycle log.
      const agent = agents.get(runId);
      const screen = agent ? await agent.transport.read(agent.handle, { source: "visible" }) : null;
      socket.send(
        JSON.stringify({
          type: "snapshot",
          run,
          log,
          screen,
        }),
      );
    },
    message() {
      // Read-only terminal stream for dashboard debugging.
    },
    close(socket) {
      const runId = socket.data.runId;
      const peers = sockets.get(runId);
      if (!peers) return;
      peers.delete(socket);
      if (peers.size === 0) sockets.delete(runId);
    },
  },
});

async function shutdownHost(): Promise<void> {
  for (const runId of Array.from(agents.keys())) {
    try {
      await stopRun(runId);
    } catch {
      // Best effort during shutdown.
    }
  }
  server.stop(true);
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdownHost();
});

process.on("SIGINT", () => {
  void shutdownHost();
});

process.stderr.write(`[konductor host] listening on ${HOSTNAME}:${PORT}\n`);
