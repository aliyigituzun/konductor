import {
  appendUpdate,
  createDecision,
  listDecisions,
  readDecision,
  readStatus,
  resolveDecision,
  setDecisionHandoffRun,
  updateDecision,
} from "@konductor/store";
import {
  DecisionFeatureDraftSchema,
  DecisionImpactSchema,
  DecisionKindSchema,
  DecisionOptionSchema,
  type Decision,
  type DecisionFeatureDraft,
  type DecisionOption,
  type RunSummary,
  type StatusSnapshot,
} from "@konductor/schema";
import { ApiError, json, readJsonBody, type Router } from "../router.js";
import { ensureHostRunning, proxyToHost } from "../host-client.js";
import { requireProject } from "./projects.js";
import { createFeatureItem, uniqueId } from "./features.js";

/**
 * Decision routes.
 *
 * Decisions are SQLite records; only feature creation and the update feed touch the
 * status snapshot. Resolving is not transactional across the run launch: a failed
 * hand-off leaves the decision resolved and reports the launch error alongside it.
 */

export type DecisionBody = {
  title?: string;
  question?: string;
  context?: string;
  kind?: string;
  problem?: string;
  impact?: string;
  owner?: string | null;
  options?: Array<Partial<DecisionOption>>;
  feature_item_ids?: string[];
};

export type ResolveDecisionBody = {
  option_id?: string;
  /** Free-text resolution for open-ended decisions. */
  answer?: string;
  rationale?: string;
  create_features?: DecisionFeatureDraft[];
  handoff?: {
    profile_id?: string;
    prompt?: string;
    prompt_packs?: string[];
    feature_item_id?: string | null;
    worktree?: boolean;
  };
};

const OptionInputSchema = DecisionOptionSchema.partial({ id: true });

async function requireStatus(repoPath: string): Promise<StatusSnapshot> {
  const status = await readStatus(repoPath);
  if (!status) {
    throw new ApiError("Project has no status snapshot yet.", { status: 400, code: "STATUS_MISSING" });
  }
  return status;
}

function knownFeatureIds(status: StatusSnapshot): Set<string> {
  return new Set((status.features ?? []).flatMap((category) => category.items.map((item) => item.id)));
}

function validateFeatureIds(status: StatusSnapshot, ids: unknown): string[] {
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    throw new ApiError("Linked features must be a list of feature IDs.", { status: 400, code: "INVALID_FEATURE_IDS" });
  }
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const known = knownFeatureIds(status);
  const unknown = unique.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new ApiError(`Unknown feature: ${unknown.join(", ")}.`, { status: 400, code: "FEATURE_NOT_FOUND" });
  }
  return unique;
}

function validateDrafts(status: StatusSnapshot, drafts: unknown): DecisionFeatureDraft[] {
  if (drafts === undefined) return [];
  if (!Array.isArray(drafts)) {
    throw new ApiError("Feature drafts must be a list.", { status: 400, code: "INVALID_FEATURE_DRAFTS" });
  }
  const parsed: DecisionFeatureDraft[] = drafts.map((raw) => {
    const result = DecisionFeatureDraftSchema.safeParse(raw);
    if (!result.success) {
      throw new ApiError("Feature drafts need a title and a category.", { status: 400, code: "INVALID_FEATURE_DRAFTS" });
    }
    return result.data;
  });
  const categories = new Set((status.features ?? []).map((category) => category.id));
  const phases = new Set((status.feature_phases ?? []).map((phase) => phase.id));
  for (const draft of parsed) {
    if (!categories.has(draft.category_id)) {
      throw new ApiError(`Unknown feature category: ${draft.category_id}.`, { status: 400, code: "CATEGORY_REQUIRED" });
    }
    const unknownPhase = draft.phase_ids.find((id: string) => !phases.has(id));
    if (unknownPhase) {
      throw new ApiError(`Unknown feature phase: ${unknownPhase}.`, { status: 400, code: "FEATURE_PHASE_NOT_FOUND" });
    }
  }
  return parsed;
}

function validateOptions(status: StatusSnapshot, options: unknown): DecisionOption[] {
  if (options === undefined) return [];
  if (!Array.isArray(options)) {
    throw new ApiError("Options must be a list.", { status: 400, code: "INVALID_OPTIONS" });
  }
  const taken = new Set<string>();
  return options.map((raw, index) => {
    const parsed = OptionInputSchema.safeParse(raw);
    if (!parsed.success || !parsed.data.title.trim()) {
      throw new ApiError(`Option ${index + 1} needs a title.`, { status: 400, code: "INVALID_OPTIONS" });
    }
    const option = parsed.data;
    const id = option.id?.trim() || uniqueId(taken, option.title, "option");
    if (taken.has(id)) {
      throw new ApiError("Option IDs must be unique.", { status: 400, code: "INVALID_OPTIONS" });
    }
    taken.add(id);
    return {
      id,
      title: option.title.trim(),
      ...(option.description?.trim() ? { description: option.description.trim() } : {}),
      ...(option.consequences?.trim() ? { consequences: option.consequences.trim() } : {}),
      creates_features: validateDrafts(status, option.creates_features ?? []),
    };
  });
}

/** First line of an answer, shortened for the update feed. */
function summarize(text: string, max = 80): string {
  const line = text.split("\n")[0]!.trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

function validateImpact(impact: unknown): Decision["impact"] {
  const parsed = DecisionImpactSchema.safeParse(impact ?? "medium");
  if (!parsed.success) {
    throw new ApiError("Impact must be low, medium, or high.", { status: 400, code: "INVALID_IMPACT" });
  }
  return parsed.data;
}

function validateKind(kind: unknown): Decision["kind"] {
  const parsed = DecisionKindSchema.safeParse(kind ?? "options");
  if (!parsed.success) {
    throw new ApiError("Kind must be options or open_ended.", { status: 400, code: "INVALID_KIND" });
  }
  return parsed.data;
}

async function requireDecision(repoPath: string, id: string): Promise<Decision> {
  const decision = await readDecision(repoPath, id);
  if (!decision) throw new ApiError("Decision not found.", { status: 404, code: "DECISION_NOT_FOUND" });
  return decision;
}

export function registerDecisionRoutes(router: Router): void {
  router.get("/api/project/:id/decisions", async ({ params }) => {
    const entry = await requireProject(params["id"]!);
    return json({ decisions: await listDecisions(entry.repo_path) });
  });

  router.post("/api/project/:id/decisions", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const body = await readJsonBody<DecisionBody>(request);
    const title = body.title?.trim();
    if (!title) throw new ApiError("A decision title is required.", { status: 400, code: "TITLE_REQUIRED" });
    const status = await requireStatus(entry.repo_path);
    const kind = validateKind(body.kind);
    if (kind === "open_ended" && !body.problem?.trim()) {
      throw new ApiError("An open-ended decision needs a problem description.", { status: 400, code: "PROBLEM_REQUIRED" });
    }
    const decision = await createDecision(entry.repo_path, {
      title,
      question: body.question?.trim() || title,
      ...(body.context?.trim() ? { context: body.context.trim() } : {}),
      kind,
      ...(kind === "open_ended" ? { problem: body.problem!.trim() } : {}),
      impact: validateImpact(body.impact),
      ...(body.owner?.trim() ? { owner: body.owner.trim() } : {}),
      options: kind === "options" ? validateOptions(status, body.options) : [],
      feature_item_ids: validateFeatureIds(status, body.feature_item_ids),
      source: "dashboard",
      run_id: null,
    });
    await appendUpdate(entry.repo_path, {
      kind: "milestone",
      subject: "decision",
      action: "created",
      message: `Recorded decision "${title}".`,
      agent: "dashboard",
      source: "dashboard",
      feature_item_id: decision.feature_item_ids[0] ?? null,
    });
    return json({ decision });
  });

  router.put("/api/project/:id/decisions/:decisionId", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const body = await readJsonBody<DecisionBody>(request);
    const status = await requireStatus(entry.repo_path);
    const current = await requireDecision(entry.repo_path, params["decisionId"]!);
    const patch: Parameters<typeof updateDecision>[2] = {};
    if (body.title !== undefined) {
      const title = body.title.trim();
      if (!title) throw new ApiError("A decision title is required.", { status: 400, code: "TITLE_REQUIRED" });
      patch.title = title;
    }
    if (body.question !== undefined) patch.question = body.question.trim();
    if (body.context !== undefined) patch.context = body.context.trim() || undefined;
    if (body.problem !== undefined) {
      const problem = body.problem.trim();
      if (current.kind === "open_ended" && !problem) {
        throw new ApiError("An open-ended decision needs a problem description.", { status: 400, code: "PROBLEM_REQUIRED" });
      }
      patch.problem = problem || undefined;
    }
    if (body.impact !== undefined) patch.impact = validateImpact(body.impact);
    if (body.owner !== undefined) patch.owner = body.owner?.trim() || undefined;
    if (body.options !== undefined) patch.options = validateOptions(status, body.options);
    if (body.feature_item_ids !== undefined) patch.feature_item_ids = validateFeatureIds(status, body.feature_item_ids);
    const decision = await updateDecision(entry.repo_path, params["decisionId"]!, patch);
    await appendUpdate(entry.repo_path, {
      kind: "brief",
      subject: "decision",
      action: "edited",
      message: `Edited decision "${decision.title}".`,
      agent: "dashboard",
      source: "dashboard",
      feature_item_id: decision.feature_item_ids[0] ?? null,
    });
    return json({ decision });
  });

  router.post("/api/project/:id/decisions/:decisionId/resolve", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const body = await readJsonBody<ResolveDecisionBody>(request);
    const decision = await requireDecision(entry.repo_path, params["decisionId"]!);
    if (decision.status === "resolved") {
      throw new ApiError("Decision is already resolved.", { status: 409, code: "DECISION_RESOLVED" });
    }
    const openEnded = decision.kind === "open_ended";
    const answer = body.answer?.trim() ?? "";
    if (openEnded && !answer) {
      throw new ApiError("Write an answer to resolve this decision.", { status: 400, code: "ANSWER_REQUIRED" });
    }
    const option = openEnded ? null : decision.options.find((candidate) => candidate.id === body.option_id?.trim()) ?? null;
    if (!openEnded && !option) {
      throw new ApiError("Choose one of the decision's options.", { status: 400, code: "OPTION_REQUIRED" });
    }
    const status = await requireStatus(entry.repo_path);
    const drafts = validateDrafts(status, body.create_features);
    const handoff = body.handoff;
    if (handoff) {
      if (!handoff.prompt?.trim()) {
        throw new ApiError("Hand-off instructions are required.", { status: 400, code: "PROMPT_REQUIRED" });
      }
      // `draft:<n>` attaches the run to the n-th feature this resolution creates.
      const draftTarget = handoff.feature_item_id?.match(/^draft:(\d+)$/);
      if (draftTarget && !drafts[Number(draftTarget[1])]) {
        throw new ApiError("Hand-off target feature is not in the created list.", { status: 400, code: "FEATURE_NOT_FOUND" });
      }
      if (handoff.feature_item_id && !draftTarget) validateFeatureIds(status, [handoff.feature_item_id]);
    }

    const created: string[] = [];
    for (const draft of drafts) {
      const result = await createFeatureItem(entry.repo_path, {
        title: draft.title,
        category_id: draft.category_id,
        phase_ids: draft.phase_ids,
        ...(draft.description ? { description: draft.description } : {}),
      }, { decision_title: decision.title });
      created.push(result.feature_item_id);
    }

    let resolved = await resolveDecision(entry.repo_path, decision.id, {
      option_id: option?.id ?? null,
      ...(openEnded ? { answer } : {}),
      ...(body.rationale?.trim() ? { rationale: body.rationale.trim() } : {}),
      resolved_by: "dashboard",
      created_feature_item_ids: created,
    });
    await appendUpdate(entry.repo_path, {
      kind: "milestone",
      subject: "decision",
      action: "success",
      message: `Decided "${decision.title}": ${option ? option.title : summarize(answer)}.`,
      agent: "dashboard",
      source: "dashboard",
      feature_item_id: resolved.feature_item_ids[0] ?? null,
    });

    if (!handoff) return json({ decision: resolved, run: null });

    let run: RunSummary | null = null;
    let handoffError: string | null = null;
    try {
      await ensureHostRunning(entry.repo_path);
      const response = await proxyToHost(`/projects/${encodeURIComponent(entry.id)}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...handoff,
          prompt: handoff.prompt!.trim(),
          feature_item_id: handoff.feature_item_id?.startsWith("draft:")
            ? created[Number(handoff.feature_item_id.slice("draft:".length))] ?? null
            : handoff.feature_item_id ?? null,
          decision_id: decision.id,
          source: "dashboard",
        }),
      });
      const payload = await response.json() as RunSummary & { error?: string };
      if (!response.ok) {
        handoffError = payload.error ?? `Host returned ${response.status}.`;
      } else {
        run = payload;
        resolved = await setDecisionHandoffRun(entry.repo_path, decision.id, run.id);
      }
    } catch (error) {
      handoffError = error instanceof Error ? error.message : String(error);
    }
    return json({ decision: resolved, run, ...(handoffError ? { handoff_error: handoffError } : {}) });
  });
}
