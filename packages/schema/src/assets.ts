import { z } from "zod";

export const AssetBucketPresetSchema = z.enum([
  "no_relation",
  "page_based",
  "type_based",
  "custom",
]);

/** The visual accent used to distinguish a folder in the asset explorer. */
export const AssetBucketColorSchema = z.enum([
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
]);

export const AssetReviewPolicySchema = z.enum([
  "wait_for_review",
  "continue_after_handoff",
]);

/** Optional descriptive context. Agents only receive it when explicitly exposed. */
export const AssetMetadataSchema = z.object({
  description: z.string().default(""),
  tags: z.array(z.string()).default([]),
  fields: z.record(z.string(), z.string()).default({}),
  expose_to_agents: z.boolean().default(false),
});

export const AssetManagerConfigSchema = z.object({
  enabled: z.boolean().default(false),
  preset: AssetBucketPresetSchema.default("no_relation"),
  custom_preset_id: z.string().nullable().default(null),
  asset_roots: z.array(z.string()).default([]),
  selected_profile_ids: z.array(z.string()).default([]),
  review_policy: AssetReviewPolicySchema.default("continue_after_handoff"),
  customer_reviews: z.object({
    enabled: z.boolean().default(false),
    default_expiry_days: z.number().int().positive().default(14),
  }).default({ enabled: false, default_expiry_days: 14 }),
});

/** A folder. `parent_id` nests folders; `null` means a root folder. */
export const AssetBucketSchema = z.object({
  id: z.string(),
  parent_id: z.string().nullable().default(null),
  title: z.string(),
  color: AssetBucketColorSchema.default("gray"),
  preset: AssetBucketPresetSchema,
  instruction: z.string(),
  path: z.string().nullable(),
  accepted_types: z.array(z.string()).default([]),
  prevent_agent_uploads: z.boolean().default(false),
  metadata: AssetMetadataSchema.default({
    description: "",
    tags: [],
    fields: {},
    expose_to_agents: false,
  }),
  created_at: z.string().datetime(),
});

export const AssetVariationSchema = z.object({
  id: z.string(),
  name: z.string(),
  file_name: z.string(),
  storage_path: z.string(),
  media_type: z.string(),
  content_hash: z.string(),
  size_bytes: z.number().int().nonnegative(),
  used: z.boolean().default(false),
  approval: z.enum(["pending", "approved", "refused"]),
  created_at: z.string().datetime(),
  created_by: z.enum(["user", "agent", "import"]),
  originating_run_id: z.string().nullable(),
  originating_profile_id: z.string().nullable(),
});

/** A logical asset. A/B or design alternatives live in `variations`. */
export const ManagedAssetSchema = z.object({
  id: z.string(),
  bucket_id: z.string(),
  name: z.string(),
  metadata: AssetMetadataSchema.default({
    description: "",
    tags: [],
    fields: {},
    expose_to_agents: false,
  }),
  variations: z.array(AssetVariationSchema).default([]),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const AssetLibrarySchema = z.object({
  schema_version: z.literal("0.1.0"),
  buckets: z.array(AssetBucketSchema).default([]),
  assets: z.array(ManagedAssetSchema).default([]),
  updated_at: z.string().datetime(),
});

export const AssetSubmissionStatusSchema = z.enum([
  "draft",
  "pending_permission",
  "accepted",
  "refused",
  "revision_requested",
  "withdrawn",
]);

export const AssetSubmissionSchema = z.object({
  id: z.string(),
  asset_ids: z.array(z.string()).min(1),
  bucket_id: z.string(),
  status: AssetSubmissionStatusSchema,
  originating_run_id: z.string(),
  originating_profile_id: z.string(),
  submitted_at: z.string().datetime(),
  decided_at: z.string().datetime().nullable(),
  decision_message: z.string().nullable(),
});

export const ReviewPointerSchema = z.object({
  id: z.string(),
  page_id: z.string(),
  index: z.number().int().positive(),
  x_ratio: z.number().min(0).max(1),
  y_document_ratio: z.number().min(0).max(1),
  viewport_width: z.number().int().positive(),
  viewport_height: z.number().int().positive(),
  scroll_y: z.number().nonnegative(),
  note: z.string().default(""),
});

export const ChangeRequestStatusSchema = z.enum(["open", "acknowledged", "in_progress", "resolved", "closed"]);

export const ChangeRequestSchema = z.object({
  id: z.string(),
  review_session_id: z.string(),
  page_id: z.string(),
  summary: z.string(),
  pointers: z.array(ReviewPointerSchema).default([]),
  status: ChangeRequestStatusSchema,
  submitted_by: z.string().nullable().default(null),
  viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).nullable().default(null),
  created_at: z.string().datetime(),
});

/** How the customer's browser reaches the preview: the dev server's own port, or the host's `/preview/:id/` proxy. */
export const PreviewAccessSchema = z.enum(["direct", "proxied"]);

export const ReviewPageSchema = z.object({
  id: z.string(),
  label: z.string().min(1),
  /** Path inside the previewed app, always starting with `/`. */
  path: z.string().regex(/^\//),
});

export const ReviewSessionSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  title: z.string(),
  token_hash: z.string(),
  state: z.enum(["draft", "active", "expired", "revoked"]),
  preview_instance_id: z.string().nullable().default(null),
  access: PreviewAccessSchema.default("direct"),
  pages: z.array(ReviewPageSchema).default([]),
  page_ids: z.array(z.string()),
  created_at: z.string().datetime(),
  expires_at: z.string().datetime(),
});

/** Operator request that mints a review link; the page ids are assigned when missing. */
export const ReviewSessionCreateSchema = z.object({
  title: z.string().min(1),
  preview_instance_id: z.string().nullable().default(null),
  access: PreviewAccessSchema.default("direct"),
  pages: z.array(ReviewPageSchema.extend({ id: z.string().optional() })).min(1),
  expires_in_days: z.number().positive().default(14),
});

/** What the customer page posts for one change request. */
export const ChangeRequestSubmitSchema = z.object({
  page_id: z.string().min(1),
  summary: z.string().default(""),
  pointers: z.array(ReviewPointerSchema).default([]),
  viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).nullable().default(null),
  submitted_by: z.string().nullable().default(null),
});

export type AssetBucketPreset = z.infer<typeof AssetBucketPresetSchema>;
export type AssetBucketColor = z.infer<typeof AssetBucketColorSchema>;
export type AssetReviewPolicy = z.infer<typeof AssetReviewPolicySchema>;
export type AssetMetadata = z.infer<typeof AssetMetadataSchema>;
export type AssetManagerConfig = z.infer<typeof AssetManagerConfigSchema>;
export type AssetBucket = z.infer<typeof AssetBucketSchema>;
export type AssetVariation = z.infer<typeof AssetVariationSchema>;
export type ManagedAsset = z.infer<typeof ManagedAssetSchema>;
export type AssetLibrary = z.infer<typeof AssetLibrarySchema>;
export type AssetSubmissionStatus = z.infer<typeof AssetSubmissionStatusSchema>;
export type AssetSubmission = z.infer<typeof AssetSubmissionSchema>;
export type ReviewPointer = z.infer<typeof ReviewPointerSchema>;
export type ChangeRequest = z.infer<typeof ChangeRequestSchema>;
export type ReviewSession = z.infer<typeof ReviewSessionSchema>;
export type ReviewPage = z.infer<typeof ReviewPageSchema>;
export type ChangeRequestStatus = z.infer<typeof ChangeRequestStatusSchema>;
export type PreviewAccess = z.infer<typeof PreviewAccessSchema>;
export type ReviewSessionCreate = z.infer<typeof ReviewSessionCreateSchema>;
export type ChangeRequestSubmit = z.infer<typeof ChangeRequestSubmitSchema>;
