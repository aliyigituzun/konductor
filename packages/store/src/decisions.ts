import type { Database } from "bun:sqlite";
import { repoLocal } from "./paths.js";
import { withDatabase, importOnce, legacyJson } from "./database.js";
import {
  DecisionSchema,
  DecisionNeededSchema,
  type Decision,
  type DecisionOutcome,
} from "@konductor/schema";

/**
 * Decisions live in the project database. The snapshot's `issues.decisions_needed`
 * is imported once as open decisions without options; the file is left untouched.
 */

const LEGACY_IMPORT_SUFFIX = "#decisions_needed";

export type CreateDecisionInput = Omit<Decision, "id" | "kind" | "status" | "created_at" | "updated_at" | "outcome"> & {
  id?: string;
  /** Defaults to "options". */
  kind?: Decision["kind"];
  created_at?: string;
};

export type DecisionPatch = Partial<Pick<Decision, "title" | "question" | "context" | "kind" | "problem" | "impact" | "owner" | "options" | "feature_item_ids">>;

export type ResolveDecisionInput = Omit<DecisionOutcome, "option_id" | "resolved_at" | "handoff_run_id" | "created_feature_item_ids"> & {
  option_id?: string | null;
  resolved_at?: string;
  handoff_run_id?: string | null;
  created_feature_item_ids?: string[];
};

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function rowToDecision(row: { body: string }): Decision {
  return DecisionSchema.parse(JSON.parse(row.body));
}

function insertDecision(db: Database, decision: Decision, ignoreExisting: boolean): boolean {
  const result = db
    .query(`INSERT ${ignoreExisting ? "OR IGNORE " : ""}INTO decisions (id, status, created_at, body) VALUES (?, ?, ?, ?)`)
    .run(decision.id, decision.status, Date.parse(decision.created_at), JSON.stringify(decision));
  return result.changes > 0;
}

function replaceDecision(db: Database, decision: Decision): void {
  db.query("UPDATE decisions SET status = ?, body = ? WHERE id = ?")
    .run(decision.status, JSON.stringify(decision), decision.id);
}

function selectDecision(db: Database, id: string): Decision | null {
  const row = db.query<{ body: string }, [string]>("SELECT body FROM decisions WHERE id = ?").get(id);
  return row ? rowToDecision(row) : null;
}

function importLegacyDecisions(db: Database, statusPath: string): void {
  importOnce(db, statusPath + LEGACY_IMPORT_SUFFIX, () => {
    const raw = legacyJson(statusPath) as { issues?: { decisions_needed?: unknown[] } } | undefined;
    const entries = (raw?.issues?.decisions_needed ?? []).map((entry) => DecisionNeededSchema.parse(entry));
    const now = new Date().toISOString();
    for (const entry of entries) {
      const decision = DecisionSchema.parse({
        id: entry.id,
        title: entry.summary.length > 80 ? `${entry.summary.slice(0, 77).trimEnd()}…` : entry.summary,
        question: entry.summary,
        impact: entry.impact,
        ...(entry.owner ? { owner: entry.owner } : {}),
        status: "open",
        options: [],
        feature_item_ids: [],
        source: "import",
        run_id: null,
        created_at: now,
        updated_at: now,
        outcome: null,
      });
      insertDecision(db, decision, true);
    }
  });
}

function withDecisions<T>(cwd: string, work: (db: Database) => T): T {
  const paths = repoLocal(cwd);
  return withDatabase(paths.database, (db) => {
    importLegacyDecisions(db, paths.currentStatus);
    return work(db);
  });
}

export async function listDecisions(cwd: string): Promise<Decision[]> {
  return withDecisions(cwd, (db) =>
    db.query<{ body: string }, []>("SELECT body FROM decisions ORDER BY created_at DESC, id").all().map(rowToDecision),
  );
}

export async function readDecision(cwd: string, id: string): Promise<Decision | null> {
  return withDecisions(cwd, (db) => selectDecision(db, id));
}

/**
 * Creates a decision. A caller-supplied id is idempotent: an existing record with that id
 * is returned unchanged, so seeds and agent retries never duplicate decisions.
 */
export async function createDecision(cwd: string, input: CreateDecisionInput): Promise<Decision> {
  const now = new Date().toISOString();
  const { id: requestedId, created_at, ...fields } = input;
  return withDecisions(cwd, (db) => db.transaction(() => {
    if (requestedId) {
      const existing = selectDecision(db, requestedId);
      if (existing) return existing;
    }
    const taken = new Set(db.query<{ id: string }, []>("SELECT id FROM decisions").all().map((row) => row.id));
    let id = requestedId;
    if (!id) {
      const root = slugify(fields.title) || "decision";
      id = root;
      for (let n = 2; taken.has(id); n += 1) id = `${root}-${n}`;
    }
    const decision = DecisionSchema.parse({
      ...fields,
      id,
      status: "open",
      created_at: created_at ?? now,
      updated_at: now,
      outcome: null,
    });
    insertDecision(db, decision, false);
    return decision;
  }).immediate());
}

export async function updateDecision(cwd: string, id: string, patch: DecisionPatch): Promise<Decision> {
  return withDecisions(cwd, (db) => db.transaction(() => {
    const current = selectDecision(db, id);
    if (!current) throw new Error(`Decision ${id} not found.`);
    const next = DecisionSchema.parse({ ...current, ...patch, updated_at: new Date().toISOString() });
    replaceDecision(db, next);
    return next;
  }).immediate());
}

export async function resolveDecision(cwd: string, id: string, input: ResolveDecisionInput): Promise<Decision> {
  return withDecisions(cwd, (db) => db.transaction(() => {
    const current = selectDecision(db, id);
    if (!current) throw new Error(`Decision ${id} not found.`);
    if (current.status === "resolved") throw new Error(`Decision ${id} is already resolved.`);
    if (current.kind === "open_ended") {
      if (!input.answer?.trim()) throw new Error(`Decision ${id} is open-ended and needs an answer.`);
    } else if (!current.options.some((option) => option.id === input.option_id)) {
      throw new Error(`Decision ${id} has no option ${input.option_id}.`);
    }
    const now = new Date().toISOString();
    const created = input.created_feature_item_ids ?? [];
    const next = DecisionSchema.parse({
      ...current,
      status: "resolved",
      updated_at: now,
      feature_item_ids: [...new Set([...current.feature_item_ids, ...created])],
      outcome: {
        option_id: current.kind === "open_ended" ? null : input.option_id,
        ...(current.kind === "open_ended" ? { answer: input.answer!.trim() } : {}),
        ...(input.rationale ? { rationale: input.rationale } : {}),
        resolved_at: input.resolved_at ?? now,
        resolved_by: input.resolved_by,
        handoff_run_id: input.handoff_run_id ?? null,
        created_feature_item_ids: created,
      },
    });
    replaceDecision(db, next);
    return next;
  }).immediate());
}

export async function setDecisionHandoffRun(cwd: string, id: string, runId: string | null): Promise<Decision> {
  return withDecisions(cwd, (db) => db.transaction(() => {
    const current = selectDecision(db, id);
    if (!current) throw new Error(`Decision ${id} not found.`);
    if (!current.outcome) throw new Error(`Decision ${id} is not resolved.`);
    const next = DecisionSchema.parse({
      ...current,
      updated_at: new Date().toISOString(),
      outcome: { ...current.outcome, handoff_run_id: runId },
    });
    replaceDecision(db, next);
    return next;
  }).immediate());
}

/** Decisions linked to a feature item, newest first. */
export async function listFeatureDecisions(cwd: string, featureItemId: string): Promise<Decision[]> {
  return (await listDecisions(cwd)).filter((decision) => decision.feature_item_ids.includes(featureItemId));
}
