import { listProjectRuns, readGlobalRunSummary, readRunLog } from "@konductor/store";
import { ApiError, json, readJsonBody, type Router } from "../router.js";
import { proxyToHost, ensureHostRunning, fetchHostHealth } from "../host-client.js";
import { requireProject } from "./projects.js";
import { adapterCatalog, resolveAdapter, setupAdapter } from "@konductor/agents";

/**
 * Run and fleet routes.
 *
 * Anything that touches a live process is forwarded to the host daemon, which owns
 * that state. Read-only history falls back to the store so past runs stay browsable
 * with the daemon stopped.
 */
export function registerRunRoutes(router: Router): void {
  router.get("/api/host/health", async () => json(await fetchHostHealth()));

  router.post("/api/project/:id/runs", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    await ensureHostRunning(entry.repo_path);
    return proxyToHost(`/projects/${encodeURIComponent(entry.id)}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await request.text(),
    });
  });

  router.get("/api/run/:runId", async ({ params }) => {
    const runId = params["runId"]!;
    try {
      return await proxyToHost(`/runs/${encodeURIComponent(runId)}`);
    } catch {
      const run = await readGlobalRunSummary(runId);
      if (!run) throw new ApiError(`Run ${runId} not found.`, { status: 404, code: "RUN_NOT_FOUND" });
      return json(run);
    }
  });

  router.get("/api/run/:runId/terminal", async ({ params }) => {
    const runId = params["runId"]!;
    try {
      return await proxyToHost(`/runs/${encodeURIComponent(runId)}/terminal`);
    } catch {
      const run = await readGlobalRunSummary(runId);
      if (!run) throw new ApiError(`Run ${runId} not found.`, { status: 404, code: "RUN_NOT_FOUND" });
      return json({ run, log: await readRunLog(runId) });
    }
  });

  router.post("/api/run/:runId/stop", async ({ params }) =>
    proxyToHost(`/runs/${encodeURIComponent(params["runId"]!)}/stop`, { method: "POST" }),
  );

  // ---- live fleet ---------------------------------------------------------

  router.get("/api/agents", async () => proxyToHost("/agents"));

  router.get("/api/project/:id/adapters", async ({ params }) => {
    const entry = await requireProject(params["id"]!);
    return json(await adapterCatalog(entry.repo_path));
  });

  router.post("/api/project/:id/adapters/:adapterId/setup", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    let manifest;
    try {
      manifest = await resolveAdapter(params["adapterId"]!, entry.repo_path);
    } catch (error) {
      throw new ApiError(error instanceof Error ? error.message : String(error), {
        status: 404,
        code: "ADAPTER_NOT_FOUND",
      });
    }
    try {
      const body = await readJsonBody<{ install_missing_binary?: boolean }>(request);
      return json(await setupAdapter(manifest, {
        installMissingBinary: body.install_missing_binary === true,
      }));
    } catch (error) {
      throw new ApiError(error instanceof Error ? error.message : String(error), {
        status: 400,
        code: "ADAPTER_SETUP_FAILED",
      });
    }
  });

  router.post("/api/agent/:slug/send", async ({ params, request }) => {
    const body = await readJsonBody<{ text?: string }>(request);
    if (!body.text?.trim()) {
      throw new ApiError("A message is required.", { status: 400, code: "MESSAGE_REQUIRED" });
    }
    return proxyToHost(`/agents/${encodeURIComponent(params["slug"]!)}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: body.text }),
    });
  });

  router.post("/api/agent/:slug/respond", async ({ params, request }) => {
    const body = await readJsonBody<{ action?: "accept" | "cancel" }>(request);
    if (body.action !== "accept" && body.action !== "cancel") {
      throw new ApiError("Response action must be accept or cancel.", { status: 400, code: "INVALID_DIALOG_ACTION" });
    }
    return proxyToHost(`/agents/${encodeURIComponent(params["slug"]!)}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  });

  router.get("/api/agent/:slug/read", async ({ params, url }) =>
    proxyToHost(
      `/agents/${encodeURIComponent(params["slug"]!)}/read?${url.searchParams.toString()}`,
    ),
  );

  router.get("/api/agent/:slug/explain", async ({ params }) =>
    proxyToHost(`/agents/${encodeURIComponent(params["slug"]!)}/explain`),
  );

  router.post("/api/agent/:slug/stop", async ({ params }) =>
    proxyToHost(`/agents/${encodeURIComponent(params["slug"]!)}/stop`, { method: "POST" }),
  );

  router.get("/api/project/:id/runs", async ({ params }) => {
    const entry = await requireProject(params["id"]!);
    return json({ runs: await listProjectRuns(entry.repo_path) });
  });
}
