import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createChangeRequest,
  createReviewSession,
  findReviewSessionByToken,
  listChangeRequests,
  listReviewSessions,
  publicReviewSession,
  revokeReviewSession,
  updateChangeRequestStatus,
} from "./reviews.js";

/** Review sessions are repo-local, so no KONDUCTOR_HOME isolation is needed here. */

let repo: string;
beforeEach(async () => { repo = await mkdtemp(join(tmpdir(), "konductor-reviews-")); });
afterEach(async () => { await rm(repo, { recursive: true, force: true }); });

const pages = [{ id: "home", label: "Home", path: "/" }, { id: "pricing", label: "Pricing", path: "/pricing" }];

test("a session is found by its token, hides the hash, and accepts change requests", async () => {
  const { session, token } = await createReviewSession(repo, {
    project_id: "demo", title: "Website refresh", preview_instance_id: "prev-1", access: "direct", pages, expires_in_days: 7,
  });
  expect(token.startsWith("krv_")).toBe(true);
  expect(session.page_ids).toEqual(["home", "pricing"]);
  expect("token_hash" in publicReviewSession(session)).toBe(false);

  const found = await findReviewSessionByToken(repo, token);
  expect(found?.id).toBe(session.id);
  expect(await findReviewSessionByToken(repo, "krv_nope")).toBeNull();

  const request = await createChangeRequest(repo, {
    review_session_id: session.id, page_id: "home", summary: "Soften the hero", submitted_by: null, viewport: null,
    pointers: [{ id: "p1", page_id: "home", index: 1, x_ratio: 0.5, y_document_ratio: 0.2, viewport_width: 1200, viewport_height: 800, scroll_y: 0, note: "here" }],
  });
  expect(request.status).toBe("open");
  expect((await listChangeRequests(repo, session.id)).map((item) => item.id)).toEqual([request.id]);
  expect((await updateChangeRequestStatus(repo, request.id, "resolved")).status).toBe("resolved");

  await expect(createChangeRequest(repo, {
    review_session_id: session.id, page_id: "home", summary: "  ", pointers: [], submitted_by: null, viewport: null,
  })).rejects.toThrow("Describe the change");
});

test("revoked and expired sessions stop accepting requests", async () => {
  const { session, token } = await createReviewSession(repo, {
    project_id: "demo", title: "Old", preview_instance_id: null, access: "proxied", pages, expires_in_days: 0.00000001,
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect((await findReviewSessionByToken(repo, token))?.state).toBe("expired");
  expect((await listReviewSessions(repo))[0]?.state).toBe("expired");

  const fresh = await createReviewSession(repo, {
    project_id: "demo", title: "Fresh", preview_instance_id: null, access: "direct", pages, expires_in_days: 3,
  });
  expect((await revokeReviewSession(repo, fresh.session.id)).state).toBe("revoked");
  await expect(createChangeRequest(repo, {
    review_session_id: session.id, page_id: "home", summary: "late", pointers: [], submitted_by: null, viewport: null,
  })).rejects.toThrow("no longer active");
});
