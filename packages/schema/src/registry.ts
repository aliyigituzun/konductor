import { z } from "zod";

export const RegistryEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  repo_path: z.string(),
  last_sync: z.string().datetime().nullable(),
  status_path: z.string(),
  telemetry_path: z.string(),
  history_dir: z.string(),
  initialized_at: z.string().datetime(),
  default_profile: z.string().nullable().optional(),
  active_run_count: z.number().int().nonnegative().default(0),
  last_agent_activity_at: z.string().datetime().nullable().optional(),
  // Derived at read time (does the repo_path still exist on disk?); never persisted.
  reachable: z.boolean().optional(),
});

export const RegistrySchema = z.object({
  schema_version: z.enum(["0.1.0", "0.2.0"]),
  projects: z.array(RegistryEntrySchema),
});

export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;
export type Registry = z.infer<typeof RegistrySchema>;
