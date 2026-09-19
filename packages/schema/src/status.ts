import { z } from "zod";
import { RunContextSchema, RunSourceSchema, RunTaskStateSchema } from "./run.js";

export const PhaseItemTypeSchema = z.enum([
  "feature",
  "bug",
  "task",
  "decision",
  "dependency",
  "research",
]);

export const PhaseItemStatusSchema = z.enum([
  "todo",
  "in_progress",
  "blocked",
  "done",
]);

export const PhaseItemPrioritySchema = z.enum(["low", "medium", "high"]);

export const PhaseItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: PhaseItemTypeSchema,
  status: PhaseItemStatusSchema,
  priority: PhaseItemPrioritySchema,
  summary: z.string().optional(),
});

export const PhaseStatusSchema = z.enum([
  "todo",
  "in_progress",
  "blocked",
  "done",
]);

export const PhaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: PhaseStatusSchema,
  order: z.number().int().nonnegative(),
  summary: z.string().optional(),
  items: z.array(PhaseItemSchema),
});

export const ProjectStateSchema = z.enum([
  "todo",
  "in_progress",
  "blocked",
  "done",
  "paused",
  "cancelled",
]);

export const BlockerSchema = z.object({
  id: z.string(),
  summary: z.string(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  owner: z.string().optional(),
  created_at: z.string().datetime(),
  unblock_condition: z.string().optional(),
});

/**
 * @deprecated Decisions are SQLite records (see `decision.ts`). This snapshot list is
 * still accepted from older agents and imported into the decisions table once.
 */
export const DecisionNeededSchema = z.object({
  id: z.string(),
  summary: z.string(),
  impact: z.enum(["low", "medium", "high"]),
  owner: z.string().optional(),
});

export const ExternalDependencySchema = z.object({
  id: z.string(),
  type: z.string(),
  summary: z.string(),
  status: z.enum(["open", "resolved", "blocked"]),
  owner: z.string().optional(),
});

export const IssuesSchema = z.object({
  blockers: z.array(BlockerSchema),
  decisions_needed: z.array(DecisionNeededSchema),
  external_dependencies: z.array(ExternalDependencySchema),
  risks: z.array(z.string()),
});

export const TelemetryTokensSchema = z.object({
  input: z.number().int().nonnegative().nullable(),
  output: z.number().int().nonnegative().nullable(),
  cache_read: z.number().int().nonnegative().nullable(),
  cache_write: z.number().int().nonnegative().nullable(),
});

export const TelemetryContextSchema = z.object({
  window: z.number().int().nonnegative().nullable(),
  peak_used: z.number().int().nonnegative().nullable(),
  peak_pct: z.number().min(0).max(1).nullable(),
  compact_count: z.number().int().nonnegative().nullable(),
});

export const FileActivitySchema = z.object({
  path: z.string(),
  reads: z.number().int().nonnegative(),
  writes: z.number().int().nonnegative(),
});

export const ToolActivitySchema = z.object({
  name: z.string(),
  count: z.number().int().nonnegative(),
});

export const TelemetryActivitySchema = z.object({
  capture_mode: z.enum(["verified", "best_effort", "unavailable"]),
  top_files: z.array(FileActivitySchema),
  top_tools: z.array(ToolActivitySchema),
});

export const TelemetrySchema = z.object({
  tokens: TelemetryTokensSchema,
  context: TelemetryContextSchema,
  activity: TelemetryActivitySchema,
});

export const LinksSchema = z.object({
  task_url: z.string().url().nullable(),
  pr_url: z.string().url().nullable(),
  issue_urls: z.array(z.string().url()),
});

export const FeatureItemStatusSchema = z.enum([
  "done",
  "in_progress",
  "todo",
  "blocked",
]);

export const FeaturePhaseSchema = z.object({
  id: z.string(),
  title: z.string(),
});

export const FeatureItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: FeatureItemStatusSchema,
  description: z.string().optional(),
  phase_ids: z.array(z.string()).optional(),
  todo_id: z.string().optional(),
});

export const FeatureCategorySchema = z.object({
  id: z.string(),
  title: z.string(),
  items: z.array(FeatureItemSchema),
});

export const TodoItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: FeatureItemStatusSchema,
  description: z.string().optional(),
  related_feature_item_ids: z.array(z.string()).default([]),
  /** Managed assets that provide context or inputs for this piece of work. */
  related_asset_ids: z.array(z.string()).default([]),
  feature_item_id: z.string().nullable().optional(),
  /** When false, this work is owned by an agent and does not create a feature. */
  creates_feature: z.boolean().default(true),
  /** Surfaces this to-do ahead of phase-based work. */
  imminent: z.boolean().default(false),
});

export const StatusSnapshotSchema = z.object({
  schema_version: z.enum(["0.1.0", "0.2.0"]),
  project: z.object({
    id: z.string(),
    name: z.string(),
  }),
  agent: z.object({
    kind: z.string(),
    session_id: z.string().nullable().optional(),
  }),
  report: z.object({
    reported_at: z.string().datetime(),
  }),
  status: z.object({
    state: ProjectStateSchema,
    summary: z.string(),
    current_phase_id: z.string().nullable(),
  }),
  phases: z.array(PhaseSchema),
  feature_phases: z.array(FeaturePhaseSchema).optional(),
  features: z.array(FeatureCategorySchema).optional(),
  todos: z.array(TodoItemSchema).optional(),
  issues: IssuesSchema,
  next_actions: z.array(z.string()),
  telemetry: TelemetrySchema.optional(),
  links: LinksSchema.optional(),
  run: RunContextSchema.optional(),
}).superRefine((snapshot, context) => {
  const seenTitles = new Set<string>();
  for (const [index, phase] of (snapshot.feature_phases ?? []).entries()) {
    const normalizedTitle = phase.title.trim().replace(/\s+/g, " ").toLocaleLowerCase();
    if (seenTitles.has(normalizedTitle)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["feature_phases", index, "title"],
        message: "Feature phase names must be unique.",
      });
    }
    seenTitles.add(normalizedTitle);
  }
});

export type PhaseItemType = z.infer<typeof PhaseItemTypeSchema>;
export type PhaseItemStatus = z.infer<typeof PhaseItemStatusSchema>;
export type PhaseItemPriority = z.infer<typeof PhaseItemPrioritySchema>;
export type PhaseItem = z.infer<typeof PhaseItemSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type PhaseStatus = z.infer<typeof PhaseStatusSchema>;
export type ProjectState = z.infer<typeof ProjectStateSchema>;
export type Blocker = z.infer<typeof BlockerSchema>;
export type DecisionNeeded = z.infer<typeof DecisionNeededSchema>;
export type ExternalDependency = z.infer<typeof ExternalDependencySchema>;
export type Issues = z.infer<typeof IssuesSchema>;
export type TelemetryTokens = z.infer<typeof TelemetryTokensSchema>;
export type TelemetryContext = z.infer<typeof TelemetryContextSchema>;
export type FileActivity = z.infer<typeof FileActivitySchema>;
export type ToolActivity = z.infer<typeof ToolActivitySchema>;
export type TelemetryActivity = z.infer<typeof TelemetryActivitySchema>;
export type Telemetry = z.infer<typeof TelemetrySchema>;
export type Links = z.infer<typeof LinksSchema>;
export type FeatureItemStatus = z.infer<typeof FeatureItemStatusSchema>;
export type FeaturePhase = z.infer<typeof FeaturePhaseSchema>;
export type FeatureItem = z.infer<typeof FeatureItemSchema>;
export type FeatureCategory = z.infer<typeof FeatureCategorySchema>;
export type TodoItem = z.infer<typeof TodoItemSchema>;
export type StatusSnapshot = z.infer<typeof StatusSnapshotSchema>;

export const UpdateKindSchema = z.enum(["brief", "milestone"]);
// What an update is about and what happened to it. Both are optional so
// free-form agent notes (write_update) and pre-existing rows stay valid;
// the dashboard uses them to filter the feed.
export const UpdateSubjectSchema = z.enum(["feature", "todo", "decision", "agent", "review", "preview"]);
export const UpdateActionSchema = z.enum(["created", "edited", "deleted", "failure", "success"]);

export const UpdateEntrySchema = z.object({
  id: z.string(),
  at: z.string().datetime(),
  kind: UpdateKindSchema,
  subject: UpdateSubjectSchema.optional(),
  action: UpdateActionSchema.optional(),
  message: z.string(),
  agent: z.string(),
  session_id: z.string().nullable().optional(),
  phase_id: z.string().nullable().optional(),
  run_id: z.string().nullable().optional(),
  profile_id: z.string().nullable().optional(),
  feature_item_id: z.string().nullable().optional(),
  source: RunSourceSchema.optional(),
  task_state: RunTaskStateSchema.optional(),
});

export type UpdateKind = z.infer<typeof UpdateKindSchema>;
export type UpdateSubject = z.infer<typeof UpdateSubjectSchema>;
export type UpdateAction = z.infer<typeof UpdateActionSchema>;
export type UpdateEntry = z.infer<typeof UpdateEntrySchema>;
