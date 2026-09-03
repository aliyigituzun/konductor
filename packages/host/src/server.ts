#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ServerWebSocket } from "bun";
import type { AgentProfile, PromptPack, RunSummary } from "@konductor/schema";
import {
  DEFAULT_OTEL_ENV,
  appendRunLog,
  appendUpdate,
  ensureProjectMcpConfig,
  findProjectToken,
  getProject,
  hostGlobal,
  importantProjectPaths,
  listProjectRuns,
  patchRunSummary,
  readConfig,
  readProjectTokens,
  readGlobalRunSummary,
  readRunLog,
  readStatus,
  upsertProject,
  validateTokenProvider,
  writeHostState,
  writeRunLog,
  writeRunSummary,
} from "@konductor/store";

type LaunchRunRequest = {
  profile_id?: string;
  prompt: string;
  prompt_packs?: string[];
  feature_item_id?: string | null;
  source?: "dashboard" | "cli";
};

type TerminalSocketData = { runId: string };
type RunningProcess = {
  proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  repoPath: string;
};

const PORT = parseInt(process.env["KONDUCTOR_HOST_PORT"] ?? "4096", 10);
// Loopback only. The host spawns processes on behalf of callers, so it must never
// be reachable from another machine.
const HOSTNAME = process.env["KONDUCTOR_HOST_HOSTNAME"] ?? "127.0.0.1";
const HOST_ID = process.env["KONDUCTOR_HOST_ID"] ?? "local-host";
const processes = new Map<string, RunningProcess>();
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

function providerName(profile: AgentProfile): string {
  switch (profile.runner) {
    case "claude_code":
      return "Claude Code";
    case "openai":
      return "OpenAI";
    case "minimax":
      return "Minimax";
  }
}

function providerCommandSummary(profile: AgentProfile, prompt: string): string {
  switch (profile.runner) {
    case "claude_code":
      return [
        profile.binary,
        ...(profile.model ? ["--model", profile.model] : []),
        ...profile.args,
        "-p",
        prompt,
      ]
        .map(shellQuote)
        .join(" ");
    case "openai":
    case "minimax":
      return `${providerName(profile)} ${profile.model} via ${profile.api_base ?? (profile.runner === "openai" ? "https://api.openai.com/v1/responses" : "https://api.minimax.com/v1/responses")}`;
  }
}

function providerNameFromRun(run: RunSummary): string {
  switch (run.agent_kind) {
    case "claude_code":
      return "Claude Code";
    case "openai":
      return "OpenAI";
    case "minimax":
      return "Minimax";
  }
}

function apiBaseUrl(profile: Extract<AgentProfile, { runner: "openai" | "minimax" }>): string {
  if (profile.api_base?.trim()) return profile.api_base.trim();
  return profile.runner === "openai" ? "https://api.openai.com" : "https://api.minimax.com";
}

async function apiKeyFromProfile(
  repoPath: string,
  profile: Extract<AgentProfile, { runner: "openai" | "minimax" }>,
): Promise<string | undefined> {
  if (profile.token_id) {
    const tokensFile = await readProjectTokens(repoPath);
    const token = findProjectToken(tokensFile, profile.token_id);
    const providerError = validateTokenProvider(token, profile.runner);
    if (providerError) {
      throw new HostApiError(providerError, {
        status: 400,
        code: "TOKEN_PROVIDER_MISMATCH",
        hint: "Choose a project token with the same provider as the selected agent profile.",
        details: [
          `Profile: ${profile.title}`,
          `Requested token id: ${profile.token_id}`,
        ],
      });
    }
    return token?.token;
  }
  return process.env[profile.api_key_env];
}

function extractProviderOutput(body: unknown): string {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (typeof body === "object") {
    const asObj = body as Record<string, unknown>;
    if (typeof asObj.output === "string") return asObj.output;
    if (Array.isArray(asObj.output) && asObj.output.length > 0) {
      const first = asObj.output[0];
      if (typeof first === "string") return first;
      if (first && typeof first === "object") {
        const content = (first as Record<string, unknown>).content;
        if (typeof content === "string") return content;
        if (Array.isArray(content)) {
          return content.map((item) => (typeof item === "string" ? item : typeof item === "object" && item ? ((item as Record<string, unknown>).text as string | undefined) ?? "" : "")).join("");
        }
      }
    }
    if (Array.isArray(asObj.choices) && asObj.choices.length > 0) {
      const first = asObj.choices[0] as Record<string, unknown>;
      const message = first["message"];
      if (message && typeof message === "object") {
        const content = (message as Record<string, unknown>)["content"];
        if (typeof content === "string") return content;
      }
      if (typeof first.text === "string") return first.text;
    }
  }
  return JSON.stringify(body, null, 2);
}

async function callApiProvider(
  repoPath: string,
  profile: Extract<AgentProfile, { runner: "openai" | "minimax" }>,
  prompt: string,
): Promise<{ responseText: string; responseBody: unknown }> {
  const apiKey = await apiKeyFromProfile(repoPath, profile);
  if (!apiKey) {
    throw new HostApiError(`${providerName(profile)} API key missing.`, {
      status: 400,
      code: "API_KEY_MISSING",
      hint: profile.token_id
        ? "Update the selected project token or choose a different token for this profile."
        : `Set ${profile.api_key_env} in your environment before starting this profile.`,
    });
  }

  const url = new URL("/v1/responses", apiBaseUrl(profile)).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: profile.model,
      input: prompt,
      temperature: profile.temperature,
    }),
  });

  const responseBody = await res.json().catch(() => null);
  if (!res.ok) {
    throw new HostApiError(`Provider request failed with status ${res.status}.`, {
      status: 502,
      code: "PROVIDER_REQUEST_FAILED",
      hint: `Verify ${providerName(profile)} credentials and ${profile.runner === "openai" ? "OpenAI" : "Minimax"} endpoint configuration.`,
      details: [JSON.stringify(responseBody ?? {}, null, 2)],
    });
  }

  return {
    responseText: extractProviderOutput(responseBody),
    responseBody,
  };
}

async function composePrompt(
  repoPath: string,
  prompt: string,
  packs: PromptPack[],
  featureItemId: string | null | undefined,
  runId: string,
  profile: AgentProfile,
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
    `You are running inside a Konductor-managed ${providerName(profile)} session.`,
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

async function finalizeRun(runId: string, repoPath: string, exitCode: number): Promise<void> {
  const current = await listProjectRunById(runId);
  if (!current) return;
  if (stopRequested.has(runId)) {
    stopRequested.delete(runId);
    await appendRunLog(repoPath, runId, `\n[konductor host] Run stopped by operator.\n`);
    await patchRunSummary(repoPath, runId, {
      status: "stopped",
      ended_at: current.ended_at ?? new Date().toISOString(),
      exit_code: null,
      last_error: null,
    });
    processes.delete(runId);
    emitTerminal(runId, { type: "status", status: "stopped" });
    return;
  }
  if (current.status === "stopped") {
    processes.delete(runId);
    emitTerminal(runId, { type: "status", status: "stopped" });
    return;
  }

  const updated = await patchRunSummary(repoPath, runId, {
    status: exitCode === 0 ? "succeeded" : "failed",
    ended_at: new Date().toISOString(),
    exit_code: exitCode,
    last_error: exitCode === 0 ? null : `${providerNameFromRun(current)} exited with code ${exitCode}.`,
  });
  if (!updated) return;

  await appendRunLog(
    repoPath,
    runId,
    `\n[konductor host] ${providerNameFromRun(updated)} exited with code ${exitCode}. Final status: ${updated.status}.\n`,
  );
  await appendUpdate(repoPath, {
    kind: "milestone",
    message:
      updated.status === "succeeded"
        ? `${providerNameFromRun(updated)} run ${runId} completed successfully.`
        : `${providerNameFromRun(updated)} run ${runId} failed with exit code ${exitCode}.`,
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
      `[konductor host] Warning: ${providerNameFromRun(updated)} exited successfully but did not write a Konductor status snapshot. Dashboard tracking may still be stale.\n`,
    );
    await appendUpdate(repoPath, {
      kind: "milestone",
      message:
        `${providerNameFromRun(updated)} run ${runId} exited successfully but did not write a Konductor status snapshot. ` +
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
  processes.delete(runId);
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

  if (profile.runner === "claude_code") {
    const binaryPath = Bun.which(profile.binary);
    if (!binaryPath) {
      throw new HostApiError(`Claude binary not found on PATH: ${profile.binary}`, {
        status: 400,
        code: "CLAUDE_BINARY_NOT_FOUND",
        hint: "Install Claude Code or update the profile binary path in `konductor.config.json`.",
        details: [`Configured binary: ${profile.binary}`],
      });
    }
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
  const mcpEnabled = profile.default_mcp !== false;
  let mcpStatus = "disabled by profile";
  if (mcpEnabled) {
    const wroteMcp = await ensureProjectMcpConfig(repoPath);
    mcpStatus = wroteMcp
      ? "enabled, wrote .mcp.json for Claude"
      : "enabled, using existing .mcp.json";
  }
  const promptPayload = await composePrompt(
    repoPath,
    body.prompt,
    packs,
    body.feature_item_id,
    runId,
    profile,
    source,
    mcpEnabled,
  );

  const envSummaryInput: Record<string, string | undefined> = {
    KONDUCTOR_RUN_ID: runId,
    KONDUCTOR_PROFILE_ID: profile.id,
    KONDUCTOR_FEATURE_ITEM_ID: body.feature_item_id ?? undefined,
    KONDUCTOR_RUN_SOURCE: source,
    ...(profile.runner === "claude_code" && profile.telemetry.mode === "collector" ? DEFAULT_OTEL_ENV : {}),
    ...profile.default_env,
  };

  const command = providerCommandSummary(profile, promptPayload.text);
  const workingDirectory = profile.default_working_dir === "current" ? process.cwd() : repoPath;
  const summary: RunSummary = {
    schema_version: "0.2.0",
    id: runId,
    project_id: projectId,
    repo_path: repoPath,
    profile_id: profile.id,
    profile_title: profile.title,
    agent_kind: profile.runner,
    feature_item_id: body.feature_item_id ?? null,
    feature_item_title: promptPayload.feature_item_title,
    prompt_excerpt: excerpt(body.prompt, 220),
    prompt_packs: packs.map((pack) => pack.id),
    source,
    command,
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
    message: `Queued ${providerName(profile)} run ${runId}${promptPayload.feature_item_title ? ` for feature "${promptPayload.feature_item_title}"` : ""}.`,
    agent: "konductor-host",
    run_id: runId,
    profile_id: profile.id,
    feature_item_id: body.feature_item_id ?? null,
    source,
    task_state: "started",
  });
  await patchRunSummary(repoPath, runId, { update_count: 1 });

  const env = {
    ...process.env,
    ...envSummaryInput,
  } as Record<string, string>;

  const commandArgs =
    profile.runner === "claude_code"
      ? [
          ...(profile.model ? ["--model", profile.model] : []),
          ...profile.args,
          "-p",
          promptPayload.text,
        ]
      : [];

  if (profile.runner === "claude_code") {
    let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
    try {
      proc = Bun.spawn([profile.binary, ...commandArgs], {
        cwd: workingDirectory,
        env,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = await patchRunSummary(repoPath, runId, {
        status: "failed",
        ended_at: new Date().toISOString(),
        exit_code: null,
        last_error: message,
      });
      await appendRunLog(repoPath, runId, `[konductor host] Failed to start ${providerName(profile)} process: ${message}\n`);
      await appendUpdate(repoPath, {
        kind: "milestone",
        message: `${providerName(profile)} run ${runId} failed before launch: ${message}.`,
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
      throw new HostApiError(`${providerName(profile)} process could not be started.`, {
        status: 500,
        code: "AGENT_LAUNCH_FAILED",
        hint: `Inspect ${summary.log_path} or the dashboard terminal panel for the launch trace.`,
        details: [
          `Run ID: ${runId}`,
          `Working directory: ${workingDirectory}`,
          `Launch error: ${message}`,
        ],
        run_id: runId,
      });
    }

    processes.set(runId, { proc, repoPath });
    const runningSummary = (await patchRunSummary(repoPath, runId, { status: "running" })) ?? summary;
    await appendRunLog(repoPath, runId, `[konductor host] ${providerName(profile)} process started successfully.\n`);
    void pumpStream(runId, repoPath, runningSummary, proc.stdout, "stdout");
    void pumpStream(runId, repoPath, runningSummary, proc.stderr, "stderr");
    void proc.exited.then((code) => finalizeRun(runId, repoPath, code));
    await syncProjectRegistry(repoPath, projectId, profile.id);
    return runningSummary;
  }

  const runningSummary = (await patchRunSummary(repoPath, runId, { status: "running" })) ?? summary;
  await appendRunLog(repoPath, runId, `[konductor host] ${providerName(profile)} request started.\n`);
  void (async () => {
    try {
      const { responseText } = await callApiProvider(repoPath, profile, promptPayload.text);
      await appendRunLog(repoPath, runId, `[konductor host] ${providerName(profile)} response received.\n`);
      if (responseText.trim()) {
        await appendRunLog(repoPath, runId, `${responseText.trim()}\n`);
      }
      const finalSummary = await patchRunSummary(repoPath, runId, {
        status: "succeeded",
        ended_at: new Date().toISOString(),
        exit_code: 0,
        last_error: null,
      });
      if (finalSummary) {
        await appendUpdate(repoPath, {
          kind: "milestone",
          message: `${providerName(profile)} run ${runId} completed successfully.`,
          agent: "konductor-host",
          run_id: runId,
          profile_id: finalSummary.profile_id,
          feature_item_id: finalSummary.feature_item_id,
          source: finalSummary.source,
          task_state: "completed",
        });
        await patchRunSummary(repoPath, runId, { update_count: finalSummary.update_count + 1 });
      }
      await syncProjectRegistry(repoPath, projectId, profile.id);
      emitTerminal(runId, { type: "status", status: "succeeded", exit_code: 0 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await patchRunSummary(repoPath, runId, {
        status: "failed",
        ended_at: new Date().toISOString(),
        exit_code: null,
        last_error: message,
      });
      await appendRunLog(repoPath, runId, `[konductor host] ${providerName(profile)} request failed: ${message}\n`);
      await appendUpdate(repoPath, {
        kind: "milestone",
        message: `${providerName(profile)} run ${runId} failed after launch: ${message}.`,
        agent: "konductor-host",
        run_id: runId,
        profile_id: profile.id,
        feature_item_id: body.feature_item_id ?? null,
        source,
        task_state: "failed",
      });
      await syncProjectRegistry(repoPath, projectId, profile.id);
      emitTerminal(runId, { type: "status", status: "failed", exit_code: null });
    }
  })();

  await syncProjectRegistry(repoPath, projectId, profile.id);
  return runningSummary;
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
  const running = processes.get(runId);
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

  running.proc.kill();
  await appendRunLog(running.repoPath, runId, `\n[konductor host] Stop requested at ${stoppedAt}.\n`);

  await appendUpdate(running.repoPath, {
    kind: "milestone",
    message: `Stopped ${providerNameFromRun(updated)} run ${runId}.`,
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
  processes.delete(runId);
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
        running_runs: Array.from(processes.keys()),
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
      socket.send(
        JSON.stringify({
          type: "snapshot",
          run,
          log,
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
  for (const runId of Array.from(processes.keys())) {
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
