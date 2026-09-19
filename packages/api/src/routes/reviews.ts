import {
  ChangeRequestStatusSchema,
  ChangeRequestSubmitSchema,
  ReviewSessionCreateSchema,
  type PreviewInstance,
  type RegistryEntry,
  type ReviewSession,
} from "@konductor/schema";
import {
  ReviewError,
  appendUpdate,
  createChangeRequest,
  createReviewSession,
  findReviewSessionByToken,
  getPreview,
  listChangeRequests,
  listPreviews,
  listReviewSessions,
  publicReviewSession,
  readRegistry,
  revokeReviewSession,
  updateChangeRequestStatus,
} from "@konductor/store";
import { ApiError, json, readJsonBody, type Router } from "../router.js";
import { ensureHostRunning, proxyToHost } from "../host-client.js";
import { requireProject } from "./projects.js";

/**
 * Preview instances and customer reviews.
 *
 * Previews are live processes, so they go to the host. Review sessions and change
 * requests are project SQLite records served here; the customer routes are keyed by
 * the link token alone, which is the only guard on them.
 */

function reviewError(error: unknown, fallbackCode: string): never {
  if (error instanceof ReviewError) {
    throw new ApiError(error.message, { status: 400, code: fallbackCode });
  }
  throw error;
}

function invalid(message: string, code: string, issues: { errors: Array<{ path: PropertyKey[]; message: string }> }): never {
  throw new ApiError(message, {
    status: 400,
    code,
    details: issues.errors.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`),
  });
}

/** Tokens are not project-scoped, so the lookup walks every registered project. */
async function locateSession(token: string): Promise<{ entry: RegistryEntry; session: ReviewSession } | null> {
  if (!/^krv_[A-Za-z0-9_-]{16,}$/.test(token)) return null;
  const registry = await readRegistry();
  for (const entry of registry.projects) {
    try {
      const session = await findReviewSessionByToken(entry.repo_path, token);
      if (session) return { entry, session };
    } catch {
      // A missing or unreadable project database just means the token is not there.
    }
  }
  return null;
}

/** What the customer's browser needs to reach the preview; hostnames are filled in client side. */
function previewLocation(session: ReviewSession, preview: PreviewInstance | null) {
  if (!preview) return { status: "missing" as const, port: null, url: null };
  const url = session.access === "proxied" ? `/preview/${preview.id}/` : null;
  return { status: preview.status, port: preview.port, url, access: session.access };
}

export function registerReviewRoutes(router: Router): void {
  // ---- previews (host) ----------------------------------------------------

  router.get("/api/project/:id/branches", async ({ params }) => {
    const entry = await requireProject(params["id"]!);
    await ensureHostRunning(entry.repo_path);
    return proxyToHost(`/projects/${encodeURIComponent(entry.id)}/branches`);
  });

  router.get("/api/project/:id/previews", async ({ params }) => {
    const entry = await requireProject(params["id"]!);
    try {
      return await proxyToHost(`/projects/${encodeURIComponent(entry.id)}/previews`);
    } catch {
      return json({ previews: await listPreviews({ project_id: entry.id }) });
    }
  });

  router.post("/api/project/:id/previews", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    await ensureHostRunning(entry.repo_path);
    return proxyToHost(`/projects/${encodeURIComponent(entry.id)}/previews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await request.text(),
    });
  });

  router.post("/api/project/:id/previews/:previewId/stop", async ({ params, request }) => {
    await requireProject(params["id"]!);
    return proxyToHost(`/previews/${encodeURIComponent(params["previewId"]!)}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await request.text(),
    });
  });

  router.get("/api/project/:id/previews/:previewId/screen", async ({ params }) => {
    await requireProject(params["id"]!);
    return proxyToHost(`/previews/${encodeURIComponent(params["previewId"]!)}/screen`);
  });

  // ---- review sessions (operator) ------------------------------------------

  router.get("/api/project/:id/reviews", async ({ params }) => {
    const entry = await requireProject(params["id"]!);
    const [sessions, requests, previews] = await Promise.all([
      listReviewSessions(entry.repo_path),
      listChangeRequests(entry.repo_path),
      listPreviews({ project_id: entry.id }),
    ]);
    return json({ sessions: sessions.map(publicReviewSession), requests, previews });
  });

  router.post("/api/project/:id/reviews", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const parsed = ReviewSessionCreateSchema.safeParse(await readJsonBody<unknown>(request));
    if (!parsed.success) invalid("Review link details are invalid.", "REVIEW_INVALID", parsed.error);
    const body = parsed.data;
    if (body.preview_instance_id) {
      const preview = await getPreview(body.preview_instance_id);
      if (!preview || preview.project_id !== entry.id) {
        throw new ApiError("Preview instance was not found for this project.", { status: 404, code: "PREVIEW_NOT_FOUND" });
      }
    }
    const pages = body.pages.map((page, index) => ({
      id: page.id ?? `page-${index + 1}`,
      label: page.label.trim(),
      path: page.path,
    }));
    try {
      const { session, token } = await createReviewSession(entry.repo_path, {
        project_id: entry.id,
        title: body.title,
        preview_instance_id: body.preview_instance_id,
        access: body.access,
        pages,
        expires_in_days: body.expires_in_days,
      });
      await appendUpdate(entry.repo_path, {
        kind: "milestone",
        subject: "review",
        action: "created",
        message: `Review link "${session.title}" created with ${pages.length} page${pages.length === 1 ? "" : "s"}.`,
        agent: "konductor-dashboard",
      });
      return json({ session: publicReviewSession(session), token }, 201);
    } catch (error) {
      return reviewError(error, "REVIEW_INVALID");
    }
  });

  router.post("/api/project/:id/reviews/:sessionId/revoke", async ({ params }) => {
    const entry = await requireProject(params["id"]!);
    try {
      const session = await revokeReviewSession(entry.repo_path, params["sessionId"]!);
      await appendUpdate(entry.repo_path, {
        kind: "milestone",
        subject: "review",
        action: "deleted",
        message: `Review link "${session.title}" revoked.`,
        agent: "konductor-dashboard",
      });
      return json({ session: publicReviewSession(session) });
    } catch (error) {
      return reviewError(error, "REVIEW_NOT_FOUND");
    }
  });

  router.patch("/api/project/:id/reviews/requests/:requestId", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const body = await readJsonBody<{ status?: unknown }>(request);
    const status = ChangeRequestStatusSchema.safeParse(body.status);
    if (!status.success) {
      throw new ApiError("Change request status is invalid.", { status: 400, code: "CHANGE_REQUEST_STATUS_INVALID" });
    }
    try {
      const updated = await updateChangeRequestStatus(entry.repo_path, params["requestId"]!, status.data);
      const label = updated.summary.trim() || `${updated.pointers.length} pointer(s)`;
      await appendUpdate(entry.repo_path, {
        kind: "brief",
        subject: "review",
        action: status.data === "resolved" || status.data === "closed" ? "success" : "edited",
        message: `Change request "${label}" marked ${status.data.replace("_", " ")}.`.slice(0, 240),
        agent: "konductor-dashboard",
      });
      return json({ request: updated });
    } catch (error) {
      return reviewError(error, "CHANGE_REQUEST_NOT_FOUND");
    }
  });

  // ---- customer (token) -----------------------------------------------------

  router.get("/api/review/:token", async ({ params }) => {
    const located = await locateSession(params["token"]!);
    if (!located || located.session.state !== "active") {
      throw new ApiError("This review link is not available.", {
        status: 404,
        code: "REVIEW_LINK_INVALID",
        hint: "The link may have expired or been revoked. Ask for a new one.",
      });
    }
    const { entry, session } = located;
    const preview = session.preview_instance_id ? await getPreview(session.preview_instance_id) : null;
    const requests = await listChangeRequests(entry.repo_path, session.id);
    return json({
      session: publicReviewSession(session),
      project_name: entry.name,
      preview: previewLocation(session, preview),
      requests,
    });
  });

  router.post("/api/review/:token/requests", async ({ params, request }) => {
    const located = await locateSession(params["token"]!);
    if (!located || located.session.state !== "active") {
      throw new ApiError("This review link is not available.", { status: 404, code: "REVIEW_LINK_INVALID" });
    }
    const parsed = ChangeRequestSubmitSchema.safeParse(await readJsonBody<unknown>(request));
    if (!parsed.success) invalid("Change request is invalid.", "CHANGE_REQUEST_INVALID", parsed.error);
    const { entry, session } = located;
    if (!session.pages.some((page) => page.id === parsed.data.page_id)) {
      throw new ApiError("Unknown review page.", { status: 400, code: "REVIEW_PAGE_INVALID" });
    }
    try {
      const created = await createChangeRequest(entry.repo_path, {
        ...parsed.data,
        review_session_id: session.id,
        pointers: parsed.data.pointers.map((pointer) => ({ ...pointer, page_id: parsed.data.page_id })),
      });
      await appendUpdate(entry.repo_path, {
        kind: "brief",
        subject: "review",
        action: "created",
        message: `Customer change request on ${session.title}: ${created.summary.trim() || `${created.pointers.length} pointer(s)`}`.slice(0, 240),
        agent: "customer-review",
      });
      return json({ request: created }, 201);
    } catch (error) {
      return reviewError(error, "CHANGE_REQUEST_INVALID");
    }
  });
}
