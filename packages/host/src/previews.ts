import { randomUUID } from "node:crypto";
import type { GitBranch, PreviewInstance } from "@konductor/schema";
import {
  TmuxTransport,
  WorktreeError,
  capturePane,
  ensureBranchWorktree,
  findPane,
  killPane,
  listBranches,
  paneExists,
  removeWorktree,
  spawnPane,
} from "@konductor/agents";
import {
  appendUpdate,
  availablePreviewPorts,
  getPreview,
  getProject,
  listPreviews,
  patchPreview,
  putPreview,
  readConfig,
  readHostPortSettings,
} from "@konductor/store";
import { HostApiError } from "./errors.js";

/**
 * Preview instances: a project branch running its own dev server in a tmux window so a
 * customer can browse it. The host owns the port, the pane, and the ready/liveness
 * polling; the record itself lives in the host database (see store/previews.ts).
 */

export type StartPreviewRequest = {
  branch: string;
  source?: "dashboard" | "cli";
};

type LivePreview = {
  preview: PreviewInstance;
  poller: ReturnType<typeof setInterval> | null;
};

type PreviewManagerOptions = {
  /** The host's own port, never handed to a preview even when inside the range. */
  hostPort: number;
  /** Called whenever the number of live previews changes, so idle shutdown can re-evaluate. */
  onChange: () => void;
};

const READY_POLL_MS = 1000;
const LIVENESS_POLL_MS = 3000;
const PREVIEW_SESSION_FALLBACK = "konductor";

/** True when nothing is listening on 127.0.0.1:port right now. */
export async function portIsFree(port: number): Promise<boolean> {
  try {
    const probe = Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response("") });
    probe.stop(true);
    return true;
  } catch {
    return false;
  }
}

function substitutePort(command: string, port: number): string {
  return command.replaceAll("{port}", String(port));
}

function previewTail(screen: string, lines = 12): string {
  return screen.split("\n").slice(-lines).join("\n").trim();
}

export function createPreviewManager(options: PreviewManagerOptions) {
  const live = new Map<string, LivePreview>();

  function liveCount(): number {
    return live.size;
  }

  function stopPolling(id: string): void {
    const entry = live.get(id);
    if (entry?.poller) clearInterval(entry.poller);
  }

  function release(id: string): void {
    stopPolling(id);
    live.delete(id);
    options.onChange();
  }

  async function persist(id: string, patch: Partial<PreviewInstance>): Promise<PreviewInstance> {
    const updated = await patchPreview(id, patch);
    const entry = live.get(id);
    if (entry) entry.preview = updated;
    return updated;
  }

  async function paneAlive(preview: PreviewInstance): Promise<{ alive: boolean; exit_code: number | null }> {
    if (!preview.pane_id || !preview.session_name) return { alive: false, exit_code: null };
    if (!(await paneExists(preview.pane_id))) return { alive: false, exit_code: null };
    const pane = await findPane(preview.session_name, preview.pane_id);
    if (!pane) return { alive: false, exit_code: null };
    return { alive: !pane.dead, exit_code: pane.dead ? pane.dead_status : null };
  }

  async function screenOf(preview: PreviewInstance): Promise<string> {
    if (!preview.pane_id) return "";
    return capturePane(preview.pane_id, { source: "visible" });
  }

  async function markEnded(id: string, status: "failed" | "dead", exitCode: number | null, error: string | null): Promise<void> {
    const entry = live.get(id);
    const preview = entry?.preview ?? (await getPreview(id));
    if (!preview) return;
    const lastError = error ?? (previewTail(await screenOf(preview)) || null);
    // Leave the window around for a crash so the operator can read the screen, but
    // free the port: a dead pane with remain-on-exit still counts as occupying it.
    await persist(id, { status, exit_code: exitCode, last_error: lastError, stopped_at: new Date().toISOString() });
    release(id);
    await appendUpdate(preview.repo_path, {
      kind: "brief",
      subject: "preview",
      // A preview that exits on its own after being ready is a failure too; only
      // an operator stop (handled in stop()) is a clean end.
      action: "failure",
      message: status === "failed"
        ? `Preview of ${preview.branch} failed to start on :${preview.port}.`
        : `Preview of ${preview.branch} on :${preview.port} exited.`,
      agent: "konductor-host",
    }).catch(() => undefined);
  }

  async function answers(preview: PreviewInstance, readyPath: string): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${preview.port}${readyPath}`, {
        signal: AbortSignal.timeout(900),
        redirect: "manual",
      });
      return response.status < 400;
    } catch {
      return false;
    }
  }

  /** Once ready, only pane liveness is watched; the dev server may legitimately 500 while rebuilding. */
  function watchLiveness(id: string): void {
    const entry = live.get(id);
    if (!entry) return;
    stopPolling(id);
    entry.poller = setInterval(() => {
      void (async () => {
        const state = await paneAlive(entry.preview);
        if (state.alive) return;
        await markEnded(id, "dead", state.exit_code, null);
      })().catch(() => undefined);
    }, LIVENESS_POLL_MS);
  }

  function watchReady(id: string, readyPath: string, deadline: number): void {
    const entry = live.get(id);
    if (!entry) return;
    stopPolling(id);
    let busy = false;
    entry.poller = setInterval(() => {
      if (busy) return;
      busy = true;
      void (async () => {
        const state = await paneAlive(entry.preview);
        if (!state.alive) {
          await markEnded(id, "failed", state.exit_code, null);
          return;
        }
        if (await answers(entry.preview, readyPath)) {
          await persist(id, { status: "ready", ready_at: new Date().toISOString(), last_error: null });
          await appendUpdate(entry.preview.repo_path, {
            kind: "brief",
            subject: "preview",
            action: "success",
            message: `Preview of ${entry.preview.branch} ready on :${entry.preview.port}.`,
            agent: "konductor-host",
          }).catch(() => undefined);
          watchLiveness(id);
          return;
        }
        if (Date.now() > deadline) {
          const screen = previewTail(await screenOf(entry.preview));
          if (entry.preview.pane_id) await killPane(entry.preview.pane_id);
          await markEnded(id, "failed", null,
            `Nothing answered on :${entry.preview.port}${readyPath} in time.${screen ? `\n${screen}` : ""}`);
        }
      })().catch(() => undefined).finally(() => { busy = false; });
    }, READY_POLL_MS);
  }

  async function allocatePort(): Promise<number> {
    const settings = await readHostPortSettings();
    const occupied = new Set<number>([options.hostPort]);
    for (const preview of await listPreviews({ live: true })) occupied.add(preview.port);
    for (const port of availablePreviewPorts(settings)) {
      if (occupied.has(port)) continue;
      if (await portIsFree(port)) return port;
    }
    throw new HostApiError("No free port is left in the preview range.", {
      status: 409,
      code: "NO_FREE_PORT",
      hint: "Stop a preview, or widen the preview range / release a reserved port under Configuration › Ports.",
    });
  }

  async function start(projectId: string, body: StartPreviewRequest): Promise<PreviewInstance> {
    const entry = await getProject(projectId);
    if (!entry) {
      throw new HostApiError(`Project ${projectId} not found.`, { status: 404, code: "PROJECT_NOT_FOUND" });
    }
    const repoPath = entry.repo_path;
    const config = await readConfig(repoPath);
    if (!config) {
      throw new HostApiError("This project has no konductor.config.json.", { status: 400, code: "CONFIG_MISSING" });
    }
    const previewConfig = config.preview;
    if (!previewConfig?.command) {
      throw new HostApiError("This project has no preview command.", {
        status: 400,
        code: "PREVIEW_NOT_CONFIGURED",
        hint: "Add `preview.command` to `konductor.config.json`, e.g. `bun run dev -- --port {port}`.",
      });
    }
    const branch = body.branch?.trim();
    if (!branch) {
      throw new HostApiError("Choose a branch to preview.", { status: 400, code: "BRANCH_REQUIRED" });
    }
    if (!(await TmuxTransport.available())) {
      throw new HostApiError("tmux is not installed; previews run in tmux windows.", {
        status: 503,
        code: "TMUX_UNAVAILABLE",
        hint: "Install tmux (`brew install tmux`) and try again.",
      });
    }

    let checkout;
    try {
      checkout = await ensureBranchWorktree(repoPath, branch);
    } catch (error) {
      throw new HostApiError(error instanceof Error ? error.message : String(error), {
        status: error instanceof WorktreeError ? 400 : 500,
        code: "WORKTREE_FAILED",
      });
    }

    const port = await allocatePort();
    const id = randomUUID();
    const install = previewConfig.install_command ? `${substitutePort(previewConfig.install_command, port)} && ` : "";
    const script = `${install}${substitutePort(previewConfig.command, port)}`;
    const session = config.host?.tmux_session ?? PREVIEW_SESSION_FALLBACK;

    const preview: PreviewInstance = {
      id,
      project_id: projectId,
      repo_path: repoPath,
      branch: checkout.branch,
      worktree_path: checkout.path,
      worktree_created: checkout.created,
      port,
      command: script,
      status: "starting",
      transport: "tmux",
      session_name: session,
      window_id: null,
      pane_id: null,
      exit_code: null,
      last_error: null,
      created_at: new Date().toISOString(),
      ready_at: null,
      stopped_at: null,
    };
    await putPreview(preview);

    try {
      const spawned = await spawnPane({
        session,
        cwd: checkout.path,
        name: `preview-${id.slice(0, 8)}`,
        env: {
          ...previewConfig.env,
          [previewConfig.port_env]: String(port),
          KONDUCTOR_PREVIEW_ID: id,
          KONDUCTOR_PREVIEW_BRANCH: checkout.branch,
        },
        command: ["sh", "-lc", script],
      });
      preview.window_id = spawned.window_id;
      preview.pane_id = spawned.pane_id;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await putPreview({ ...preview, status: "failed", last_error: message, stopped_at: new Date().toISOString() });
      await appendUpdate(repoPath, {
        kind: "brief",
        subject: "preview",
        action: "failure",
        message: `Preview of ${checkout.branch} failed to launch on :${port}: ${message}.`,
        agent: "konductor-host",
      }).catch(() => undefined);
      throw new HostApiError(`Could not open a tmux window for the preview: ${message}`, {
        status: 500,
        code: "PREVIEW_SPAWN_FAILED",
      });
    }

    await putPreview(preview);
    live.set(id, { preview, poller: null });
    options.onChange();
    watchReady(id, previewConfig.ready_path, Date.now() + previewConfig.ready_timeout_ms);

    await appendUpdate(repoPath, {
      kind: "milestone",
      subject: "preview",
      action: "created",
      message: `Preview of ${checkout.branch} starting on :${port}${checkout.created ? ` (new worktree ${checkout.path})` : ""}.`,
      agent: "konductor-host",
    }).catch(() => undefined);
    return preview;
  }

  async function stop(id: string, removeCheckout = false): Promise<PreviewInstance> {
    const existing = live.get(id)?.preview ?? (await getPreview(id));
    if (!existing) throw new HostApiError(`Preview ${id} not found.`, { status: 404, code: "PREVIEW_NOT_FOUND" });

    if (existing.pane_id && (await paneExists(existing.pane_id))) await killPane(existing.pane_id);
    const stopped = existing.status === "starting" || existing.status === "ready"
      ? await patchPreview(id, { status: "stopped", stopped_at: new Date().toISOString() })
      : existing;
    release(id);

    if (removeCheckout && existing.worktree_created) {
      try {
        await removeWorktree(existing.repo_path, existing.worktree_path);
      } catch (error) {
        throw new HostApiError(error instanceof Error ? error.message : String(error), {
          status: 409,
          code: "WORKTREE_REMOVE_FAILED",
          hint: "The preview is stopped; remove the worktree by hand once its changes are safe.",
        });
      }
    }
    if (stopped !== existing) {
      await appendUpdate(existing.repo_path, {
        kind: "milestone",
        subject: "preview",
        action: "deleted",
        message: `Stopped preview of ${existing.branch} on :${existing.port}.`,
        agent: "konductor-host",
      }).catch(() => undefined);
    }
    return stopped;
  }

  async function screen(id: string): Promise<{ id: string; screen: string }> {
    const preview = live.get(id)?.preview ?? (await getPreview(id));
    if (!preview) throw new HostApiError(`Preview ${id} not found.`, { status: 404, code: "PREVIEW_NOT_FOUND" });
    return { id, screen: await screenOf(preview) };
  }

  async function get(id: string): Promise<PreviewInstance> {
    const preview = live.get(id)?.preview ?? (await getPreview(id));
    if (!preview) throw new HostApiError(`Preview ${id} not found.`, { status: 404, code: "PREVIEW_NOT_FOUND" });
    return preview;
  }

  /** Where the proxy should forward for this preview; null when it is not running. */
  async function proxyTarget(id: string): Promise<{ port: number; status: PreviewInstance["status"] } | null> {
    const preview = live.get(id)?.preview ?? (await getPreview(id));
    if (!preview) return null;
    return { port: preview.port, status: preview.status };
  }

  async function branches(projectId: string): Promise<GitBranch[]> {
    const entry = await getProject(projectId);
    if (!entry) throw new HostApiError(`Project ${projectId} not found.`, { status: 404, code: "PROJECT_NOT_FOUND" });
    try {
      return await listBranches(entry.repo_path);
    } catch (error) {
      throw new HostApiError(error instanceof Error ? error.message : String(error), {
        status: 400,
        code: "GIT_UNAVAILABLE",
      });
    }
  }

  /** Same idea as run adoption: surviving panes keep their record, missing ones are closed out. */
  async function adopt(): Promise<void> {
    const rows = await listPreviews({ live: true });
    if (rows.length === 0) return;
    const tmuxUp = await TmuxTransport.available();
    for (const preview of rows) {
      const state = tmuxUp ? await paneAlive(preview) : { alive: false, exit_code: null };
      if (!state.alive) {
        await patchPreview(preview.id, {
          status: "dead",
          exit_code: state.exit_code,
          last_error: preview.last_error ?? "The preview's tmux window was gone when the host restarted.",
          stopped_at: new Date().toISOString(),
        });
        await appendUpdate(preview.repo_path, {
          kind: "brief",
          subject: "preview",
          action: "failure",
          message: `Preview of ${preview.branch} on :${preview.port} died while the host was down.`,
          agent: "konductor-host",
        }).catch(() => undefined);
        continue;
      }
      live.set(preview.id, { preview, poller: null });
      if (preview.status === "ready") {
        watchLiveness(preview.id);
      } else {
        const config = await readConfig(preview.repo_path).catch(() => null);
        watchReady(preview.id, config?.preview?.ready_path ?? "/", Date.now() + (config?.preview?.ready_timeout_ms ?? 60_000));
      }
    }
    options.onChange();
  }

  return { start, stop, get, screen, branches, adopt, liveCount, proxyTarget };
}

export type PreviewManager = ReturnType<typeof createPreviewManager>;
