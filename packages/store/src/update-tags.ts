import type { UpdateAction, UpdateEntry, UpdateSubject } from "@konductor/schema";

type Tags = { subject?: UpdateSubject; action?: UpdateAction };

/** Author recorded on entries reconstructed from status snapshot backups. */
export const MIGRATION_AGENT = "konductor-migration";

// Message prefixes written by the dashboard, host, and MCP before updates carried
// explicit subject/action fields. Order matters: the first match wins, so combined
// lines like `Feature added "X" → To-do added "X"` classify by their leading event.
const RULES: [RegExp, UpdateSubject, UpdateAction][] = [
  [/^(Feature added|Added feature (category|phase)|Added feature ".*" to)\b/, "feature", "created"],
  [/^(Feature removed|Removed feature (category|phase))\b/, "feature", "deleted"],
  [/^Feature ".*" marked done\b/, "feature", "success"],
  [/^Feature ".*" blocked\b/, "feature", "failure"],
  [/^(Feature ".*" (marked|updated)|Moved feature|Updated feature phases|Renamed feature|Reordered feature phases)\b/, "feature", "edited"],
  [/^To-do added\b/, "todo", "created"],
  [/^To-do ".*" marked done\b/, "todo", "success"],
  [/^To-do ".*" marked blocked\b/, "todo", "failure"],
  [/^To-do ".*" (marked|updated)\b/, "todo", "edited"],
  [/^(Recorded|Raised) decision\b/, "decision", "created"],
  [/^Edited decision\b/, "decision", "edited"],
  [/^Decided\b/, "decision", "success"],
  [/^Review link ".*" revoked\b/, "review", "deleted"],
  [/^Change request ".*" marked (resolved|closed)\b/, "review", "success"],
  [/^Change request ".*" marked\b/, "review", "edited"],
  [/^(Review link|Customer change request)\b/, "review", "created"],
  [/^Preview of .* (failed to (start|launch)|exited\.|died while the host was down)/, "preview", "failure"],
  [/^Preview of .* ready on\b/, "preview", "success"],
  [/^Preview of .* starting\b/, "preview", "created"],
  [/^Stopped preview\b/, "preview", "deleted"],
  [/^Queued .* agent\b/, "agent", "created"],
  [/ agent ".*" started\.$/, "agent", "edited"],
  [/^Stopped .* run\b/, "agent", "deleted"],
  [/ (completed successfully|exited successfully but did not write)/, "agent", "success"],
  [/ agent ".*" failed\b/, "agent", "failure"],
];

// Authors that are Konductor itself rather than an agent. Anything else that
// writes an untagged note is an agent reporting on its own work.
const SYSTEM_AGENTS = new Set(["dashboard", "konductor-host", "konductor-dashboard", "customer-review", MIGRATION_AGENT]);

const TASK_STATE_ACTION: Record<NonNullable<UpdateEntry["task_state"]>, UpdateAction> = {
  started: "created",
  completed: "success",
  failed: "failure",
  stopped: "deleted",
};

/** Infer subject/action for an entry that predates the fields or was written without them. */
export function inferUpdateTags(entry: Omit<UpdateEntry, "id" | "at">): Tags {
  if (entry.subject && entry.action) return {};
  const inferred: Tags = {};
  const rule = RULES.find(([pattern]) => pattern.test(entry.message));
  if (rule) {
    inferred.subject = rule[1];
    inferred.action = rule[2];
  } else if (entry.run_id || !SYSTEM_AGENTS.has(entry.agent)) {
    // Agent-authored notes and status summaries: the agent's work is the subject
    // even when the message itself says nothing about what changed. Older CLI
    // sessions wrote without a run context, so the author label is the tell.
    inferred.subject = "agent";
    if (entry.task_state) inferred.action = TASK_STATE_ACTION[entry.task_state];
  }
  return {
    ...(entry.subject ? {} : inferred.subject ? { subject: inferred.subject } : {}),
    ...(entry.action ? {} : inferred.action ? { action: inferred.action } : {}),
  };
}
