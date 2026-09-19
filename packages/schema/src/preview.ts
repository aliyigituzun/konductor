import { z } from "zod";

export const PreviewStatusSchema = z.enum(["starting", "ready", "failed", "stopped", "dead"]);

/**
 * A browsable instance of a project branch, run by the host as a tmux pane on a port
 * the allocator picked. Mirrors the run summary shape so restart adoption works the same.
 */
export const PreviewInstanceSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  repo_path: z.string(),
  branch: z.string(),
  /** Checkout the dev server runs in; the repo root when the branch was already checked out there. */
  worktree_path: z.string(),
  /** True when this preview created the worktree, so stopping may offer to remove it. */
  worktree_created: z.boolean().default(false),
  port: z.number().int().min(1).max(65535),
  command: z.string(),
  status: PreviewStatusSchema,
  transport: z.literal("tmux").default("tmux"),
  session_name: z.string().nullable().default(null),
  window_id: z.string().nullable().default(null),
  pane_id: z.string().nullable().default(null),
  exit_code: z.number().int().nullable().default(null),
  last_error: z.string().nullable().default(null),
  created_at: z.string().datetime(),
  ready_at: z.string().datetime().nullable().default(null),
  stopped_at: z.string().datetime().nullable().default(null),
});

export const GitBranchSchema = z.object({
  name: z.string(),
  current: z.boolean(),
  remote: z.boolean(),
  /** Absolute path of the worktree that has this branch checked out, if any. */
  checked_out_at: z.string().nullable(),
});

export type PreviewStatus = z.infer<typeof PreviewStatusSchema>;
export type PreviewInstance = z.infer<typeof PreviewInstanceSchema>;
export type GitBranch = z.infer<typeof GitBranchSchema>;
