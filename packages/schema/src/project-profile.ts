import { z } from "zod";
import { RegistryEntrySchema } from "./registry.js";

export const ProjectProfileLifecycleSchema = z.enum(["active", "inactive", "archived"]);

export const ProjectProfileSchema = z.object({
  schema_version: z.literal("0.1.0"),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  description: z.string().default(""),
  color: z.string().default("#2563eb"),
  lifecycle: ProjectProfileLifecycleSchema.default("inactive"),
  storage_namespace: z.string().min(1),
  preferences: z.object({
    overview_density: z.enum(["comfortable", "compact"]).default("compact"),
    default_sort: z.enum(["activity", "name", "state"]).default("activity"),
  }).default({ overview_density: "compact", default_sort: "activity" }),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  last_activated_at: z.string().datetime().nullable().default(null),
});

export const ProjectProfileDirectorySchema = z.object({
  schema_version: z.literal("0.1.0"),
  active_profile_id: z.string(),
  profiles: z.array(ProjectProfileSchema),
});

export const ProfileProjectRegistrySchema = z.object({
  schema_version: z.literal("0.1.0"),
  profile_id: z.string(),
  projects: z.array(RegistryEntrySchema),
});

export type ProjectProfileLifecycle = z.infer<typeof ProjectProfileLifecycleSchema>;
export type ProjectProfile = z.infer<typeof ProjectProfileSchema>;
export type ProjectProfileDirectory = z.infer<typeof ProjectProfileDirectorySchema>;
export type ProfileProjectRegistry = z.infer<typeof ProfileProjectRegistrySchema>;
