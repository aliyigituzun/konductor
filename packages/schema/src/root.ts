import { z } from "zod";

/** A project space is the persisted unit `/root` creates: a named container that
 * owns its own `project_space` configuration scope, users, and registered projects. */
export const ProjectSpaceSchema = z.object({
  schema_version: z.literal("0.1.0"),
  id: z.string().min(1),
  name: z.string().min(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const ProjectSpaceSummarySchema = ProjectSpaceSchema.extend({
  admin_count: z.number().int().min(0),
  project_count: z.number().int().min(0),
});

export const RootStatusSchema = z.object({
  /** Whether this browser currently holds a live root session. */
  authenticated: z.boolean(),
});

export type ProjectSpace = z.infer<typeof ProjectSpaceSchema>;
export type ProjectSpaceSummary = z.infer<typeof ProjectSpaceSummarySchema>;
export type RootStatus = z.infer<typeof RootStatusSchema>;
