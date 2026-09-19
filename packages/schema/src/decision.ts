import { z } from "zod";

/**
 * Decisions are SQLite-backed project records, not part of the status snapshot.
 * `issues.decisions_needed` in the snapshot is the legacy shape and is imported once.
 */

/** A feature a chosen option will create when the decision is resolved. */
export const DecisionFeatureDraftSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  category_id: z.string().min(1),
  phase_ids: z.array(z.string()).default([]),
});

export const DecisionOptionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  consequences: z.string().optional(),
  creates_features: z.array(DecisionFeatureDraftSchema).default([]),
});

export const DecisionImpactSchema = z.enum(["low", "medium", "high"]);
/**
 * "options" decisions pick one of a fixed set; "open_ended" decisions describe a problem
 * and are resolved with a free-text answer instead of an option.
 */
export const DecisionKindSchema = z.enum(["options", "open_ended"]);
export const DecisionStatusSchema = z.enum(["open", "resolved"]);
export const DecisionSourceSchema = z.enum(["dashboard", "agent", "import"]);

export const DecisionOutcomeSchema = z.object({
  /** Chosen option for "options" decisions; null for open-ended ones. */
  option_id: z.string().min(1).nullable().default(null),
  /** The free-text resolution of an open-ended decision. */
  answer: z.string().optional(),
  rationale: z.string().optional(),
  resolved_at: z.string().datetime(),
  /** "dashboard" for operator resolutions, otherwise the agent identity label. */
  resolved_by: z.string().min(1),
  /** Run launched to carry out the chosen option, when the operator handed it off. */
  handoff_run_id: z.string().nullable().default(null),
  /** Features created from the chosen option's drafts plus any added at resolve time. */
  created_feature_item_ids: z.array(z.string()).default([]),
});

export const DecisionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** The thing to decide, phrased as a question or a short statement. */
  question: z.string(),
  /** Longer background, markdown allowed. */
  context: z.string().optional(),
  kind: DecisionKindSchema.default("options"),
  /** Problem description for open-ended decisions, markdown allowed. */
  problem: z.string().optional(),
  impact: DecisionImpactSchema,
  owner: z.string().optional(),
  status: DecisionStatusSchema,
  options: z.array(DecisionOptionSchema),
  /** Feature items this decision affects; features list their decisions from this. */
  feature_item_ids: z.array(z.string()).default([]),
  source: DecisionSourceSchema,
  /** Run that raised the decision, when an agent created it. */
  run_id: z.string().nullable().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  outcome: DecisionOutcomeSchema.nullable().default(null),
});

export type DecisionFeatureDraft = z.infer<typeof DecisionFeatureDraftSchema>;
export type DecisionOption = z.infer<typeof DecisionOptionSchema>;
export type DecisionImpact = z.infer<typeof DecisionImpactSchema>;
export type DecisionKind = z.infer<typeof DecisionKindSchema>;
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;
export type DecisionSource = z.infer<typeof DecisionSourceSchema>;
export type DecisionOutcome = z.infer<typeof DecisionOutcomeSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
