import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import {
  ChangeRequestSchema,
  ReviewSessionSchema,
  type ChangeRequest,
  type ChangeRequestStatus,
  type ReviewSession,
} from "@konductor/schema";
import { withDatabase } from "./database.js";
import { repoLocal } from "./paths.js";

/**
 * Customer review sessions and their change requests live in the project database.
 * The link token is shown once at creation; only its hash is stored.
 */

export type CreateReviewSessionInput = Omit<ReviewSession, "id" | "token_hash" | "state" | "page_ids" | "created_at" | "expires_at"> & {
  expires_in_days: number;
};

export type CreateChangeRequestInput = Omit<ChangeRequest, "id" | "status" | "created_at">;

export class ReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewError";
  }
}

function withReviews<T>(repoPath: string, work: (db: Database) => T): T {
  return withDatabase(repoLocal(repoPath).database, work);
}

function hashReviewToken(token: string): string {
  return createHash("sha256").update(token, "utf-8").digest("hex");
}

function rowToSession(row: { body: string }): ReviewSession {
  return ReviewSessionSchema.parse(JSON.parse(row.body));
}

function rowToRequest(row: { body: string }): ChangeRequest {
  return ChangeRequestSchema.parse(JSON.parse(row.body));
}

function writeSession(db: Database, session: ReviewSession): void {
  db.query(`INSERT INTO review_sessions (id, token_hash, state, created_at, body) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET state = excluded.state, body = excluded.body`)
    .run(session.id, session.token_hash, session.state, Date.parse(session.created_at), JSON.stringify(session));
}

function selectSession(db: Database, id: string): ReviewSession | null {
  const row = db.query<{ body: string }, [string]>("SELECT body FROM review_sessions WHERE id = ?").get(id);
  return row ? rowToSession(row) : null;
}

/** Marks a stored `active` session `expired` once its deadline passed; persisted lazily on read. */
function settleExpiry(db: Database, session: ReviewSession): ReviewSession {
  if (session.state === "active" && Date.parse(session.expires_at) <= Date.now()) {
    const expired = { ...session, state: "expired" as const };
    writeSession(db, expired);
    return expired;
  }
  return session;
}

/** Hides the hash from anything leaving the store. */
export function publicReviewSession(session: ReviewSession): Omit<ReviewSession, "token_hash"> {
  const { token_hash: _hash, ...rest } = session;
  return rest;
}

export async function createReviewSession(
  repoPath: string,
  input: CreateReviewSessionInput,
): Promise<{ session: ReviewSession; token: string }> {
  if (!input.title.trim()) throw new ReviewError("A review needs a title.");
  if (input.pages.length === 0) throw new ReviewError("Add at least one page to review.");
  if (!Number.isFinite(input.expires_in_days) || input.expires_in_days <= 0) {
    throw new ReviewError("Expiry must be a positive number of days.");
  }
  const token = `krv_${randomBytes(24).toString("base64url")}`;
  const now = Date.now();
  const session = ReviewSessionSchema.parse({
    id: randomUUID(),
    project_id: input.project_id,
    title: input.title.trim(),
    token_hash: hashReviewToken(token),
    state: "active",
    preview_instance_id: input.preview_instance_id,
    access: input.access,
    pages: input.pages,
    page_ids: input.pages.map((page) => page.id),
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + input.expires_in_days * 86_400_000).toISOString(),
  });
  withReviews(repoPath, (db) => writeSession(db, session));
  return { session, token };
}

export async function listReviewSessions(repoPath: string): Promise<ReviewSession[]> {
  return withReviews(repoPath, (db) => db.transaction(() =>
    db.query<{ body: string }, []>("SELECT body FROM review_sessions ORDER BY created_at DESC").all()
      .map(rowToSession)
      .map((session) => settleExpiry(db, session)),
  ).immediate());
}

export async function readReviewSession(repoPath: string, id: string): Promise<ReviewSession | null> {
  return withReviews(repoPath, (db) => db.transaction(() => {
    const session = selectSession(db, id);
    return session ? settleExpiry(db, session) : null;
  }).immediate());
}

/** Resolves a customer link token; returns null for unknown tokens (state is not checked here). */
export async function findReviewSessionByToken(repoPath: string, token: string): Promise<ReviewSession | null> {
  const hash = hashReviewToken(token);
  return withReviews(repoPath, (db) => db.transaction(() => {
    const row = db.query<{ body: string }, [string]>("SELECT body FROM review_sessions WHERE token_hash = ?").get(hash);
    return row ? settleExpiry(db, rowToSession(row)) : null;
  }).immediate());
}

export async function revokeReviewSession(repoPath: string, id: string): Promise<ReviewSession> {
  return withReviews(repoPath, (db) => db.transaction(() => {
    const session = selectSession(db, id);
    if (!session) throw new ReviewError(`Review ${id} was not found.`);
    const revoked = { ...session, state: "revoked" as const };
    writeSession(db, revoked);
    return revoked;
  }).immediate());
}

export async function createChangeRequest(repoPath: string, input: CreateChangeRequestInput): Promise<ChangeRequest> {
  const request = ChangeRequestSchema.parse({
    ...input,
    id: randomUUID(),
    status: "open",
    created_at: new Date().toISOString(),
  });
  if (!request.summary.trim() && request.pointers.length === 0) {
    throw new ReviewError("Describe the change or add at least one pointer.");
  }
  withReviews(repoPath, (db) => db.transaction(() => {
    const session = selectSession(db, request.review_session_id);
    if (!session) throw new ReviewError("Review session was not found.");
    if (settleExpiry(db, session).state !== "active") throw new ReviewError("This review link is no longer active.");
    db.query("INSERT INTO change_requests (id, review_session_id, status, created_at, body) VALUES (?, ?, ?, ?, ?)")
      .run(request.id, request.review_session_id, request.status, Date.parse(request.created_at), JSON.stringify(request));
  }).immediate());
  return request;
}

export async function listChangeRequests(repoPath: string, sessionId?: string): Promise<ChangeRequest[]> {
  return withReviews(repoPath, (db) => sessionId
    ? db.query<{ body: string }, [string]>(
      "SELECT body FROM change_requests WHERE review_session_id = ? ORDER BY created_at DESC",
    ).all(sessionId).map(rowToRequest)
    : db.query<{ body: string }, []>("SELECT body FROM change_requests ORDER BY created_at DESC").all().map(rowToRequest));
}

export async function updateChangeRequestStatus(
  repoPath: string,
  id: string,
  status: ChangeRequestStatus,
): Promise<ChangeRequest> {
  return withReviews(repoPath, (db) => db.transaction(() => {
    const row = db.query<{ body: string }, [string]>("SELECT body FROM change_requests WHERE id = ?").get(id);
    if (!row) throw new ReviewError(`Change request ${id} was not found.`);
    const updated = ChangeRequestSchema.parse({ ...rowToRequest(row), status });
    db.query("UPDATE change_requests SET status = ?, body = ? WHERE id = ?").run(status, JSON.stringify(updated), id);
    return updated;
  }).immediate());
}
