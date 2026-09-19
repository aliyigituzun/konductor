#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve, sep } from "node:path";
import type { ServerWebSocket } from "bun";
import type {
  AgentAdapterManifest,
  AgentHandle,
  AgentProfile,
  PromptPack,
  RunSummary,
} from "@konductor/schema";
import {
  DEFAULT_OTEL_ENV,
  appendRunLog,
  appendUpdate,
  getProject,
  hostGlobal,
  importantProjectPaths,
  incrementRunCounters,
  ensureInternalProfileToken,
  isAuthenticationRequired,
  resolveAuthSession,
  listGlobalRuns,
  listPreviews,
  listProjectRuns,
  patchRunSummary,
  readConfig,
  readProviderSecret,
  readGlobalRunSummary,
  readRunLog,
  readStatus,
  upsertProject,
  writeHostState,
  writeRunLog,
  writeRunSummary,
} from "@konductor/store";
import { SESSION_COOKIE, createApiRouter, readCookie } from "@konductor/api";
import { composePrompt } from "./prompt.js";
import { HostApiError } from "./errors.js";
import { createPreviewManager, type StartPreviewRequest } from "./previews.js";
import { proxyPreviewRequest, type PreviewSocketData, previewSocketHandlers } from "./preview-proxy.js";
import {
  TmuxTransport,
  adapterCatalog,
  buildArgv,
  buildHarnessEnv,
  ensureWorktree,
  resolveAdapter,
  resolveModel,
  uniqueSlug,
  classifyScreen,
  adapterRuntime,
  adapterSetupDir,
  resolveAdapterBinary,
} from "@konductor/agents";

type LaunchRunRequest = {
  profile_id?: string;
  prompt: string;
  prompt_packs?: string[];
  feature_item_id?: string | null;
  /** To-do whose linked feature and asset context is part of this hand-off. */
  todo_id?: string | null;
  /** Resolved decision this run carries out; the host adds its outcome to the brief. */
  decision_id?: string | null;
  source?: "dashboard" | "cli";
  slug?: string;
  /** Override the profile's provider and model for this run. */
  provider?: string;
  model?: string;
  worktree?: boolean;
};

type TerminalSocketData = { kind: "terminal"; runId: string };
type SocketData = TerminalSocketData | PreviewSocketData;

/** A live agent the host is supervising: one tmux window, polled for status. */
type LiveAgent = {
  handle: AgentHandle;
  manifest: AgentAdapterManifest;
  repoPath: string;
  projectId: string;
  /** Last screen sample, so the poller only emits what changed. */
  lastScreen: string;
  /** Interval driving status classification. */
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
const tmux = new TmuxTransport();
const HOST_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
let idleShutdownTimer: ReturnType<typeof setTimeout> | null = null;
/** How often an agent's screen is sampled and reclassified. */
const POLL_INTERVAL_MS = 1200;
/**
 * How long to wait for an agent to reach its input box before giving up on
 * handing it the task. Generous, because the agent may be sitting on a prompt only
 * the operator can answer.
 */
const KICKOFF_TIMEOUT_MS = 5 * 60 * 1000;
const sockets = new Map<string, Set<ServerWebSocket<SocketData>>>();
const previewManager = createPreviewManager({ hostPort: PORT, onChange: () => scheduleIdleShutdown() });
const stopRequested = new Set<string>();

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
    `[konductor host] Harness: ${run.adapter_id} · ${run.provider ?? "default provider"} · ${run.model ?? "default model"}`,
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

/**
 * The single completion path.
 *
 * The poller lands here when an agent's process exits, and startup recovery lands
 * here for agents whose window vanished while the host was down, so the "succeeded
 * but never wrote status" warning and the registry sync happen exactly once.
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
    subject: "agent",
    action: updated.status === "succeeded" ? "success" : "failure",
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
      subject: "agent",
      action: "success",
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

  await incrementRunCounters(repoPath, runId, { updates: hostUpdates });
  await syncProjectRegistry(repoPath, updated.project_id, updated.profile_id);
  emitTerminal(runId, { type: "status", status: updated.status, exit_code: exitCode });
  releaseAgent(runId);
}

/** Drop a finished agent from the fleet, stopping its poller first. */
function releaseAgent(runId: string): void {
  stopPolling(runId);
  agents.delete(runId);
  scheduleIdleShutdown();
}

/** Keep a manually or automatically started host around briefly between tasks. */
function scheduleIdleShutdown(): void {
  if (idleShutdownTimer) clearTimeout(idleShutdownTimer);
  // A live preview keeps the host up too: its ready/liveness polling has no other home.
  if (agents.size > 0 || previewManager.liveCount() > 0) {
    idleShutdownTimer = null;
    return;
  }
  idleShutdownTimer = setTimeout(() => {
    idleShutdownTimer = null;
    if (agents.size === 0 && previewManager.liveCount() === 0) void shutdownHost();
  }, HOST_IDLE_TIMEOUT_MS);
}

/**
 * Hand an agent its task through a file.
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
 * Sample an agent's screen on an interval: push what changed to any dashboard
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
        const screen = await tmux.read(live.handle, { source: "visible" });
        if (screen !== live.lastScreen) {
          live.lastScreen = screen;
          emitTerminal(runId, { type: "screen", screen });
          await patchRunSummary(live.repoPath, runId, {
            terminal_preview: excerpt(screen.split("\n").slice(-6).join("\n"), 240),
          });
        }

        const classification = await tmux.status(live.handle, live.manifest);

        if (live.pendingKickoff) {
          // Readiness is different from status: a TUI can redraw or blink while its
          // input box is already available, which the classifier reports as "working".
          const inputReady = classifyScreen(live.manifest, {
            screen,
            alive: true,
            changed: false,
          }).status === "idle";
          if (inputReady) {
            const kickoff = live.pendingKickoff;
            live.pendingKickoff = null;
            await tmux.send(live.handle, kickoff);
            await tmux.submit(live.handle, live.manifest);
            await appendRunLog(live.repoPath, runId, `[konductor host] Sent kickoff: ${kickoff}\n`);
            await patchRunSummary(live.repoPath, runId, { bootstrap_state: "task_sent", bootstrap_reason: null });
          } else if (Date.now() > live.kickoffDeadline) {
            await appendRunLog(
              live.repoPath,
              runId,
              "[konductor host] Task delivery is waiting for an operator response to the visible dialog.\n",
            );
            // Keep the task queued. Clearing it here created a live run that could never
            // receive its task after a first-run trust or permission dialog was resolved.
            await patchRunSummary(live.repoPath, runId, {
              bootstrap_state: "awaiting_operator",
              bootstrap_reason: classification.reason,
            });
            live.kickoffDeadline = Number.POSITIVE_INFINITY;
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
  const binary = profile.binary ?? manifest.binary;
  const resolvedBinary = profile.binary ? Bun.which(profile.binary) : resolveAdapterBinary(manifest);

  if (!resolvedBinary) {
    throw new HostApiError(`${label} binary is not installed: ${binary}`, {
      status: 400,
      code: "AGENT_BINARY_NOT_FOUND",
      hint: `Run \`konductor adapters setup ${manifest.id}\`, or set "binary" on the profile.`,
      details: [`Configured binary: ${binary}`, `Adapter: ${manifest.id}`],
    });
  }

  if (!(await TmuxTransport.available())) {
    throw new HostApiError("tmux is required to run agents.", {
      status: 400,
      code: "TMUX_NOT_AVAILABLE",
      hint: "Install tmux (`brew install tmux`) and try again.",
    });
  }

  // The harness decides which providers it can reach; a profile that names another
  // is a misconfiguration, not something to paper over with a default.
  let selection: ReturnType<typeof resolveModel>;
  try {
    selection = resolveModel(manifest, profile, { provider: body.provider, model: body.model });
  } catch (error) {
    throw new HostApiError(error instanceof Error ? error.message : String(error), {
      status: 400,
      code: "MODEL_NOT_SUPPORTED",
      hint: `Edit the "${profile.title}" profile's provider and model in the agent configuration.`,
      details: [
        `Adapter: ${manifest.id}`,
        `Supported providers: ${manifest.providers.map((item) => item.id).join(", ")}`,
      ],
    });
  }

  // A saved connection is opt-in: it must name this provider and explicitly list
  // this harness. Its key is read from host-only storage just before launch.
  const providerConnections = config.agents.provider_connections ?? [];
  const providerConnection = profile.provider_connection_id
    ? providerConnections.find((connection) => connection.id === profile.provider_connection_id) ?? null
    : providerConnections.find((connection) =>
      connection.enabled && connection.provider === selection.provider.id && connection.compatible_adapters.includes(manifest.id),
    ) ?? null;
  if (profile.provider_connection_id && (!providerConnection || !providerConnection.enabled ||
    providerConnection.provider !== selection.provider.id || !providerConnection.compatible_adapters.includes(manifest.id))) {
    throw new HostApiError(`Provider connection "${profile.provider_connection_id}" is not compatible with ${label}.`, {
      code: "PROFILE_PROVIDER_CONNECTION_INVALID",
      hint: "Edit the profile's provider connection or its harness/provider selection.",
    });
  }
  const providerSecret = providerConnection
    ? await readProviderSecret(projectId, providerConnection.id)
    : null;

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
  let runtime: Awaited<ReturnType<typeof adapterRuntime>> = {
    binary: resolvedBinary,
    args: [],
    env: {},
  };
  let mcpStatus = "disabled by profile";
  if (profile.default_mcp !== false && manifest.mcp.kind === "none") {
    mcpStatus = `unsupported by the ${manifest.title} adapter`;
  } else if (mcpEnabled) {
    try {
      runtime = await adapterRuntime(manifest);
      mcpStatus = `enabled from ${adapterSetupDir(manifest)}`;
    } catch (error) {
      throw new HostApiError(error instanceof Error ? error.message : String(error), {
        status: 400,
        code: "ADAPTER_SETUP_REQUIRED",
        hint: `Run \`konductor adapters setup ${manifest.id}\`, then launch again.`,
      });
    }
  }

  const promptPayload = await composePrompt(
    repoPath,
    body.prompt,
    packs,
    body.feature_item_id,
    body.todo_id,
    body.decision_id,
    runId,
    projectId,
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

  // Every host-launched profile has one stable, Konductor-managed identity. The
  // cleartext credential lives in the protected host secret directory; run records
  // receive only a redacted environment summary.
  const internalToken = await ensureInternalProfileToken(projectId, profile.id, profile.title);

  const envSummaryInput: Record<string, string | undefined> = {
    KONDUCTOR_RUN_ID: runId,
    KONDUCTOR_PROFILE_ID: profile.id,
    KONDUCTOR_AGENT_SLUG: slug,
    KONDUCTOR_FEATURE_ITEM_ID: body.feature_item_id ?? undefined,
    KONDUCTOR_TODO_ID: body.todo_id ?? undefined,
    KONDUCTOR_DECISION_ID: body.decision_id ?? undefined,
    KONDUCTOR_RUN_SOURCE: source,
    KONDUCTOR_ACCESS_TOKEN: internalToken.token,
    ...(providerConnection ? { KONDUCTOR_PROVIDER_ENDPOINT: providerConnection.endpoint } : {}),
    ...(providerConnection?.auth_env && providerSecret ? { [providerConnection.auth_env]: providerSecret } : {}),
    ...(manifest.telemetry.kind === "otel_env" ? DEFAULT_OTEL_ENV : {}),
    ...profile.default_env,
    ...runtime.env,
  };

  // The agent is launched bare and told where its brief is once its input box is
  // up; the composed prompt never travels over argv or send-keys.
  const taskFile = await writeTaskFile(workingDirectory, runId, promptPayload.text);
  const runtimeManifest = runtime.binary ? { ...manifest, binary: runtime.binary } : manifest;
  const argv = buildArgv(runtimeManifest, profile, {
    provider: selection.provider.id,
    model: selection.argument ?? undefined,
    task_file: taskFile,
  }, runtime.args);

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
    provider: selection.provider.id,
    model: selection.model,
    transport: "tmux",
    session_name: session,
    window_id: null,
    pane_id: null,
    agent_status: "starting",
    worktree_path: worktreePath,
    branch,
    feature_item_id: body.feature_item_id ?? null,
    todo_id: body.todo_id ?? null,
    feature_item_title: promptPayload.feature_item_title,
    decision_id: body.decision_id ?? null,
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
    bootstrap_state: "starting",
    bootstrap_reason: null,
  };

  await writeRunSummary(repoPath, summary);
  await writeRunLog(repoPath, runId, startupLog(summary, body.prompt, packs, mcpStatus));
  await appendUpdate(repoPath, {
    kind: "milestone",
    subject: "agent",
    action: "created",
    message: `Queued ${label} agent "${slug}"${promptPayload.feature_item_title ? ` for feature "${promptPayload.feature_item_title}"` : ""}.`,
    agent: "konductor-host",
    run_id: runId,
    profile_id: profile.id,
    feature_item_id: body.feature_item_id ?? null,
    source,
    task_state: "started",
  });
  await incrementRunCounters(repoPath, runId, { updates: 1 });

  const env = buildHarnessEnv(manifest, process.env, envSummaryInput);

  let handle: AgentHandle;
  try {
    handle = await tmux.start({
      slug,
      run_id: runId,
      manifest,
      command: argv,
      cwd: workingDirectory,
      env,
      session,
    });
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
      subject: "agent",
      action: "failure",
      message: `${label} agent "${slug}" failed before launch: ${message}.`,
      agent: "konductor-host",
      run_id: runId,
      profile_id: profile.id,
      feature_item_id: body.feature_item_id ?? null,
      source,
      task_state: "failed",
    });
    if (failed) {
      await incrementRunCounters(repoPath, runId, { updates: 1 });
    }
    await syncProjectRegistry(repoPath, projectId, profile.id);
    throw new HostApiError(`${label} could not be started.`, {
      status: 500,
      code: "AGENT_LAUNCH_FAILED",
      hint: `Inspect ${summary.log_path}, or use \`konductor agent read ${slug}\` for the launch trace.`,
      details: [
        `Run ID: ${runId}`,
        `Working directory: ${workingDirectory}`,
        `Command: ${summary.command}`,
        `Launch error: ${message}`,
      ],
      run_id: runId,
    });
  }

  if (idleShutdownTimer) {
    clearTimeout(idleShutdownTimer);
    idleShutdownTimer = null;
  }
  agents.set(runId, {
    handle,
    manifest,
    repoPath,
    projectId,
    lastScreen: "",
    poller: null,
    pendingKickoff: kickoffMessage(taskFile, workingDirectory),
    kickoffDeadline: Date.now() + KICKOFF_TIMEOUT_MS,
  });

  const runningSummary =
    (await patchRunSummary(repoPath, runId, {
      status: "running",
      agent_status: "starting",
      pane_id: handle.pane_id,
      window_id: handle.window_id,
      session_name: handle.session_name,
    })) ?? summary;

  await appendRunLog(
    repoPath,
    runId,
    `[konductor host] ${label} started in tmux window ${handle.window_id} (pane ${handle.pane_id}).\n` +
      `[konductor host] Attach: ${tmux.attachCommand(handle)}\n`,
  );
  await appendUpdate(repoPath, {
    kind: "brief",
    subject: "agent",
    action: "edited",
    message: `${label} agent "${slug}" started.`,
    agent: "konductor-host",
    run_id: runId,
    profile_id: profile.id,
    feature_item_id: body.feature_item_id ?? null,
    source,
  });
  await incrementRunCounters(repoPath, runId, { updates: 1 });

  // Give the TUI a moment to draw before the first sample, so the very first
  // classification is not made against a blank screen.
  setTimeout(() => startPolling(runId), manifest.ready_delay_ms);

  await syncProjectRegistry(repoPath, projectId, profile.id);
  return runningSummary;
}

/**
 * Pick up agents that outlived a host restart.
 *
 * Their tmux windows carried on without us, so a run the store still calls
 * "running" is either alive — re-adopt it and resume polling — or its window is
 * gone, in which case it is finalized without an exit code rather than left as a
 * ghost that never completes. Kickoff is not re-sent: the brief was either already
 * delivered or timed out on the previous host, and repeating it would confuse an
 * agent mid-task.
 */
async function adoptSurvivingAgents(): Promise<void> {
  const runs = (await listGlobalRuns()).filter(
    (run) => run.status === "running" || run.status === "queued",
  );
  if (runs.length === 0) return;

  const tmuxUp = await TmuxTransport.available();
  for (const run of runs) {
    if (run.transport !== "tmux" || !run.pane_id || !run.window_id || !run.session_name) {
      await appendRunLog(run.repo_path, run.id, "[konductor host] Run had no live pane to recover after a host restart.\n");
      await finalizeRun(run.id, run.repo_path, null);
      continue;
    }

    const handle: AgentHandle = {
      slug: run.slug,
      run_id: run.id,
      session_name: run.session_name,
      window_id: run.window_id,
      pane_id: run.pane_id,
    };

    let manifest: AgentAdapterManifest | null = null;
    try {
      manifest = await resolveAdapter(run.adapter_id, run.repo_path);
    } catch {
      // Adapter removed while the host was down; the agent may still be running but
      // nothing here can classify it, so it is reported as lost.
    }

    if (!tmuxUp || !manifest || !(await tmux.alive(handle))) {
      await appendRunLog(run.repo_path, run.id, "[konductor host] Agent's tmux window was gone when the host restarted.\n");
      await finalizeRun(run.id, run.repo_path, null);
      continue;
    }

    agents.set(run.id, {
      handle,
      manifest,
      repoPath: run.repo_path,
      projectId: run.project_id,
      lastScreen: "",
      poller: null,
      pendingKickoff: null,
      kickoffDeadline: 0,
    });
    await appendRunLog(run.repo_path, run.id, "[konductor host] Re-adopted after a host restart.\n");
    startPolling(run.id);
  }
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
    await tmux.send(agent.handle, text);
    await tmux.submit(agent.handle, agent.manifest);
  } catch (error) {
    throw new HostApiError(error instanceof Error ? error.message : String(error), {
      status: 400,
      code: "AGENT_SEND_FAILED",
    });
  }
  await appendRunLog(agent.repoPath, agent.handle.run_id, `[konductor host] Operator sent: ${text}\n`);
  return { slug, sent: text };
}

/**
 * Respond to a currently visible non-benign dialog. This endpoint deliberately has
 * only two fixed operations: accept the harness's highlighted choice or cancel.
 * It never reads arbitrary key sequences from the client and never auto-responds.
 */
async function respondToBlockedAgent(slug: string, action: "accept" | "cancel"): Promise<{ slug: string; action: string }> {
  const agent = findAgentBySlug(slug);
  if (!agent) throw new HostApiError(`No live agent named "${slug}".`, { status: 404, code: "AGENT_NOT_FOUND" });
  const status = await tmux.status(agent.handle, agent.manifest);
  if (status.status !== "blocked") {
    throw new HostApiError("The agent is not waiting on a recognized dialog.", { code: "AGENT_NOT_BLOCKED" });
  }
  if (action === "accept") await tmux.submit(agent.handle, agent.manifest);
  else await tmux.cancelDialog(agent.handle);
  await appendRunLog(agent.repoPath, agent.handle.run_id, `[konductor host] Operator ${action}ed visible dialog.\n`);
  return { slug, action };
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
  return { slug, text: await tmux.read(agent.handle, options) };
}

async function explainAgent(slug: string): Promise<unknown> {
  const agent = findAgentBySlug(slug);
  if (!agent) {
    throw new HostApiError(`No live agent named "${slug}".`, {
      status: 404,
      code: "AGENT_NOT_FOUND",
    });
  }
  const classification = await tmux.status(agent.handle, agent.manifest);
  const screen = await tmux.read(agent.handle, { source: "visible" });
  return {
    slug,
    run_id: agent.handle.run_id,
    adapter_id: agent.manifest.id,
    pane_id: agent.handle.pane_id,
    window_id: agent.handle.window_id,
    attach_command: tmux.attachCommand(agent.handle),
    status: classification.status,
    reason: classification.reason,
    matched_pattern: classification.matched,
    screen_tail: screen.split("\n").slice(-12).join("\n"),
  };
}

/** The fleet: every agent this host is currently supervising. */
async function fleet(): Promise<unknown> {
  const rows = await Promise.all(
    [...agents.values()].map(async (agent) => {
      const classification = await tmux.status(agent.handle, agent.manifest);
      const run = await listProjectRunById(agent.handle.run_id);
      return {
        slug: agent.handle.slug,
        run_id: agent.handle.run_id,
        project_id: agent.projectId,
        profile_id: run?.profile_id ?? null,
        profile_title: run?.profile_title ?? null,
        adapter_id: agent.manifest.id,
        adapter_title: agent.manifest.title,
        provider: run?.provider ?? null,
        model: run?.model ?? null,
        transport: "tmux" as const,
        session_name: agent.handle.session_name,
        window_id: agent.handle.window_id,
        pane_id: agent.handle.pane_id,
        attach_command: tmux.attachCommand(agent.handle),
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

  await tmux.stop(running.handle);
  await appendRunLog(running.repoPath, runId, `\n[konductor host] Stop requested at ${stoppedAt}.\n`);

  await appendUpdate(running.repoPath, {
    kind: "milestone",
    subject: "agent",
    action: "deleted",
    message: `Stopped ${agentLabelFromRun(updated)} run ${runId}.`,
    agent: "konductor-host",
    run_id: runId,
    profile_id: updated.profile_id,
    feature_item_id: updated.feature_item_id,
    source: updated.source,
    task_state: "stopped",
  });
  await incrementRunCounters(running.repoPath, runId, { updates: 1 });
  await syncProjectRegistry(running.repoPath, updated.project_id, updated.profile_id);
  emitTerminal(runId, { type: "status", status: "stopped" });
  releaseAgent(runId);
  return updated;
}

async function patchRunSummaryByStopped(runId: string): Promise<RunSummary | null> {
  const hostRun = (await listProjectRunById(runId)) ?? null;
  // Only a stale live record is worth rewriting; a finished run keeps its outcome.
  if (!hostRun || (hostRun.status !== "running" && hostRun.status !== "queued")) return hostRun;
  const stopped = await patchRunSummary(hostRun.repo_path, runId, {
    status: "stopped",
    ended_at: new Date().toISOString(),
  });
  await appendUpdate(hostRun.repo_path, {
    kind: "milestone",
    subject: "agent",
    action: "deleted",
    message: `Stopped ${agentLabelFromRun(hostRun)} run ${runId} (no live agent).`,
    agent: "konductor-host",
    run_id: runId,
    profile_id: hostRun.profile_id,
    feature_item_id: hostRun.feature_item_id,
    source: hostRun.source,
    task_state: "stopped",
  });
  await incrementRunCounters(hostRun.repo_path, runId, { updates: 1 });
  return stopped;
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
  serverRef: Bun.Server<SocketData>,
): Response | Promise<Response | undefined> | undefined {
  {
    const url = new URL(req.url);

    // Anything under /preview/:id/ is the customer's view of a running dev server.
    const previewProxyMatch = url.pathname.match(/^\/preview\/([^/]+)(\/.*)?$/);
    if (previewProxyMatch) {
      return proxyPreviewRequest(req, serverRef, previewManager, {
        id: previewProxyMatch[1]!,
        rest: previewProxyMatch[2] ?? "/",
        search: url.search,
        method: req.method,
      });
    }

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
      // The terminal stream carries agent output, so it honours the dashboard's
      // session once authentication is enabled, like the /api routes do.
      return (async () => {
        if (await isAuthenticationRequired() && !(await resolveAuthSession(readCookie(req, SESSION_COOKIE)))) {
          return json({ error: "Sign in to continue.", code: "SESSION_REQUIRED" }, 401);
        }
        if (serverRef.upgrade(req, { data: { kind: "terminal", runId } satisfies TerminalSocketData })) {
          return undefined;
        }
        return json({ error: "WebSocket upgrade failed" }, 400);
      })();
    }

    if (req.method === "GET" && url.pathname === "/previews") {
      return Promise.resolve()
        .then(() => listPreviews())
        .then((data) => json({ previews: data }))
        .catch(jsonError);
    }

    const projectPreviewsMatch = url.pathname.match(/^\/projects\/([^/]+)\/previews$/);
    if (projectPreviewsMatch) {
      const projectId = decodeURIComponent(projectPreviewsMatch[1]!);
      if (req.method === "GET") {
        return Promise.resolve()
          .then(() => listPreviews({ project_id: projectId }))
          .then((data) => json({ previews: data }))
          .catch(jsonError);
      }
      if (req.method === "POST") {
        return Promise.resolve(req.json() as Promise<StartPreviewRequest>)
          .then((body) => previewManager.start(projectId, body))
          .then((preview) => json(preview, 201))
          .catch(jsonError);
      }
    }

    const projectBranchesMatch = url.pathname.match(/^\/projects\/([^/]+)\/branches$/);
    if (req.method === "GET" && projectBranchesMatch) {
      return Promise.resolve()
        .then(() => previewManager.branches(decodeURIComponent(projectBranchesMatch[1]!)))
        .then((data) => json({ branches: data }))
        .catch(jsonError);
    }

    const previewStopMatch = url.pathname.match(/^\/previews\/([^/]+)\/stop$/);
    if (req.method === "POST" && previewStopMatch) {
      return Promise.resolve(req.text())
        .then((text) => (text ? (JSON.parse(text) as { remove_worktree?: boolean }) : {}))
        .then((body) => previewManager.stop(previewStopMatch[1]!, body.remove_worktree ?? false))
        .then((data) => json(data))
        .catch(jsonError);
    }

    const previewScreenMatch = url.pathname.match(/^\/previews\/([^/]+)\/screen$/);
    if (req.method === "GET" && previewScreenMatch) {
      return Promise.resolve()
        .then(() => previewManager.screen(previewScreenMatch[1]!))
        .then((data) => json(data))
        .catch(jsonError);
    }

    const previewMatch = url.pathname.match(/^\/previews\/([^/]+)$/);
    if (req.method === "GET" && previewMatch) {
      return Promise.resolve()
        .then(() => previewManager.get(previewMatch[1]!))
        .then((data) => json(data))
        .catch(jsonError);
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        host_id: HOST_ID,
        pid: process.pid,
        port: PORT,
        running_runs: Array.from(agents.keys()),
        running_previews: previewManager.liveCount(),
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
        .then(() => adapterCatalog(url.searchParams.get("repo") ?? undefined))
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

    const respondMatch = url.pathname.match(/^\/agents\/([^/]+)\/respond$/);
    if (req.method === "POST" && respondMatch) {
      return Promise.resolve(req.json() as Promise<{ action?: unknown }>)
        .then((body) => {
          if (body.action !== "accept" && body.action !== "cancel") {
            throw new HostApiError("Response action must be accept or cancel.", { code: "INVALID_DIALOG_ACTION" });
          }
          return respondToBlockedAgent(decodeURIComponent(respondMatch[1]!), body.action);
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

    // The dashboard's own API, shared verbatim with the Vite dev server.
    if (url.pathname.startsWith("/api/")) {
      return apiRouter.handle(req).then((response) => response ?? json({ error: "Not found" }, 404));
    }

    if (req.method === "GET") {
      return serveDashboard(url.pathname).then(
        (response) => response ?? json({ error: "Not found" }, 404),
      );
    }

    return json({ error: "Not found" }, 404);
  }
}

/**
 * The dashboard's API and static build, served by the host itself.
 *
 * This is what lets Konductor be installed rather than cloned: with the API and the
 * built assets both served here, the dashboard no longer needs a Vite dev server at
 * runtime.
 */
const apiRouter = createApiRouter();

/** Where the built dashboard lives. Overridable so a packaged build can relocate it. */
const DASHBOARD_DIR =
  process.env["KONDUCTOR_DASHBOARD_DIR"] ?? join(import.meta.dir, "../../../apps/web/dist");

async function serveDashboard(pathname: string): Promise<Response | null> {
  if (!existsSync(DASHBOARD_DIR)) return null;

  // Resolve inside the build directory only; a request path must never escape it.
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = resolve(DASHBOARD_DIR, relative);
  const root = resolve(DASHBOARD_DIR);
  if (target !== root && !target.startsWith(root + sep)) return null;

  const file = Bun.file(target);
  if (await file.exists()) return new Response(file);

  // Unknown paths fall back to index.html so client-side routes deep-link.
  const index = Bun.file(join(root, "index.html"));
  return (await index.exists()) ? new Response(index) : null;
}

const server = Bun.serve<SocketData>({
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
      if (socket.data.kind === "preview") {
        previewSocketHandlers.open(socket as ServerWebSocket<PreviewSocketData>);
        return;
      }
      const runId = socket.data.runId;
      const peers = sockets.get(runId) ?? new Set<ServerWebSocket<SocketData>>();
      peers.add(socket);
      sockets.set(runId, peers);
      const run = await listProjectRunById(runId);
      const log = await readRunLog(runId);
      // A pane agent's output lives on its screen, not in the log, so a fresh
      // subscriber gets the current screen alongside the lifecycle log.
      const agent = agents.get(runId);
      const screen = agent ? await tmux.read(agent.handle, { source: "visible" }) : null;
      socket.send(
        JSON.stringify({
          type: "snapshot",
          run,
          log,
          screen,
        }),
      );
    },
    message(socket, message) {
      // The terminal stream is read-only; only preview sockets carry client frames upstream.
      if (socket.data.kind === "preview") previewSocketHandlers.message(socket as ServerWebSocket<PreviewSocketData>, message);
    },
    close(socket, code, reason) {
      if (socket.data.kind === "preview") {
        previewSocketHandlers.close(socket as ServerWebSocket<PreviewSocketData>, code, reason);
        return;
      }
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

await adoptSurvivingAgents();
await previewManager.adopt();
scheduleIdleShutdown();
process.stderr.write(`[konductor host] listening on ${HOSTNAME}:${PORT}\n`);
