import { z } from "zod";

/**
 * Fine-grained dashboard permissions granted to a user per project. This catalog is
 * stored on users today and is not yet enforced: routes still gate on the coarse
 * `AuthPermissionSchema` via role expansion. Enforcement will map these onto that
 * table in a later step, so add new capabilities here rather than widening
 * existing ones.
 */
export const UserPermissionSchema = z.enum([
  // Assets. Folder-specific grants come later through `assets.grant`.
  "assets.upload",
  "assets.delete",
  "assets.create",
  "assets.edit",
  "assets.category.create",
  "assets.category.delete",
  "assets.category.edit",
  "assets.grant",
  // Agents on remote instances. Local agents are added once their surface is defined.
  "agents.remote.use",
  "agents.remote.skill_packs.edit",
  "agents.remote.skill_repository.edit",
  "agents.remote.prompt_packs.edit",
  "agents.remote.providers.edit",
  "agents.remote.harness_downloads.edit",
  "agents.remote.skill_permissions.edit",
  // Features, categories, and phases.
  "features.add",
  "features.delete",
  "features.edit",
  "features.category.add",
  "features.category.edit",
  "features.category.delete",
  "features.phase.add",
  "features.phase.edit",
  "features.phase.delete",
  "features.phase.reorder",
  "features.phase.grant",
  "features.category.grant",
  // To-dos.
  "todos.add",
  "todos.delete",
  "todos.edit",
  // Updates feed decisions.
  "decisions.resolve",
  "decisions.add",
  "decisions.edit",
  "decisions.delete",
  // Agent access tokens.
  "tokens.manage",
  "tokens.permissions.edit",
  // Reviews.
  "reviews.reserve_port",
  "reviews.launch_instance",
]);

export const USER_PERMISSIONS = UserPermissionSchema.options;

export type UserPermission = z.infer<typeof UserPermissionSchema>;

export interface UserPermissionItem {
  id: UserPermission;
  label: string;
  help?: string;
}

export interface UserPermissionGroup {
  id: string;
  label: string;
  note?: string;
  items: readonly UserPermissionItem[];
}

/** Display catalog for the dashboard, in the order groups and items are shown. */
export const USER_PERMISSION_GROUPS: readonly UserPermissionGroup[] = [
  {
    id: "assets",
    label: "Assets",
    note: "Applies to every asset and category.",
    items: [
      { id: "assets.upload", label: "Upload asset" },
      { id: "assets.create", label: "Create asset" },
      { id: "assets.edit", label: "Edit asset" },
      { id: "assets.delete", label: "Delete asset" },
      { id: "assets.category.create", label: "Create category" },
      { id: "assets.category.edit", label: "Edit category", help: "Name, metadata, and agent access on the folder." },
      { id: "assets.category.delete", label: "Delete category" },
      { id: "assets.grant", label: "Give asset permissions", help: "Grant other users access to specific folders." },
    ],
  },
  {
    id: "agents",
    label: "Agents",
    note: "Remote instance agents.",
    items: [
      { id: "agents.remote.use", label: "Use remote instance agents" },
      { id: "agents.remote.skill_packs.edit", label: "Edit skill packs" },
      { id: "agents.remote.skill_repository.edit", label: "Edit skill repository" },
      { id: "agents.remote.prompt_packs.edit", label: "Edit prompt packs" },
      { id: "agents.remote.providers.edit", label: "Edit providers", help: "Provider tokens stay hidden after setup." },
      { id: "agents.remote.harness_downloads.edit", label: "Edit harness downloads" },
      { id: "agents.remote.skill_permissions.edit", label: "Edit skill permission levels", help: "Skill and skill-pack levels in the repository." },
    ],
  },
  {
    id: "features",
    label: "Features",
    items: [
      { id: "features.add", label: "Add feature" },
      { id: "features.edit", label: "Edit feature" },
      { id: "features.delete", label: "Delete feature" },
      { id: "features.category.add", label: "Add category" },
      { id: "features.category.edit", label: "Edit category" },
      { id: "features.category.delete", label: "Delete category" },
      { id: "features.phase.add", label: "Add phase" },
      { id: "features.phase.edit", label: "Edit phase" },
      { id: "features.phase.delete", label: "Delete phase" },
      { id: "features.phase.reorder", label: "Reorder phases" },
      { id: "features.phase.grant", label: "Give phase permissions", help: "Grant feature add/edit/delete in chosen phases." },
      { id: "features.category.grant", label: "Give category permissions", help: "Grant feature add/edit/delete in chosen categories." },
    ],
  },
  {
    id: "todos",
    label: "To-do",
    items: [
      { id: "todos.add", label: "Add to-do" },
      { id: "todos.edit", label: "Edit to-do" },
      { id: "todos.delete", label: "Delete to-do" },
    ],
  },
  {
    id: "updates",
    label: "Updates",
    items: [
      { id: "decisions.add", label: "Add decision" },
      { id: "decisions.edit", label: "Edit decision" },
      { id: "decisions.resolve", label: "Resolve decision" },
      { id: "decisions.delete", label: "Delete decision" },
    ],
  },
  {
    id: "tokens",
    label: "Access tokens",
    items: [
      { id: "tokens.manage", label: "Create and delete tokens" },
      { id: "tokens.permissions.edit", label: "Modify token permissions" },
    ],
  },
  {
    id: "reviews",
    label: "Reviews",
    items: [
      { id: "reviews.reserve_port", label: "Reserve port" },
      { id: "reviews.launch_instance", label: "Launch instance" },
    ],
  },
];

/** A named bundle of permissions and the projects it applies to for one user. */
export const UserPermissionSetSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  permissions: z.array(UserPermissionSchema),
  project_ids: z.array(z.string().min(1)).min(1),
});

export type UserPermissionSet = z.infer<typeof UserPermissionSetSchema>;

/**
 * Cross-set rules that zod cannot express per item: names are unique, every set
 * grants something, and a project belongs to at most one set for the same user.
 * Returns operator-facing messages; empty means valid.
 */
export function validatePermissionSets(
  sets: ReadonlyArray<Pick<UserPermissionSet, "name" | "permissions" | "project_ids">>,
  projectLabel: (projectId: string) => string = (id) => id,
): string[] {
  const errors: string[] = [];
  const seenNames = new Map<string, number>();
  const claimedProjects = new Map<string, string>();
  sets.forEach((set, index) => {
    const name = set.name.trim();
    const label = name || `Set ${index + 1}`;
    if (!name) errors.push(`${label} needs a name.`);
    else {
      const key = name.toLowerCase();
      if (seenNames.has(key)) errors.push(`"${name}" is used by more than one set.`);
      seenNames.set(key, index);
    }
    if (set.permissions.length === 0) errors.push(`${label} has no permissions.`);
    if (set.project_ids.length === 0) errors.push(`${label} does not apply to any project.`);
    for (const projectId of new Set(set.project_ids)) {
      const owner = claimedProjects.get(projectId);
      if (owner) errors.push(`${projectLabel(projectId)} is in both ${owner} and ${label}.`);
      else claimedProjects.set(projectId, label);
    }
  });
  return errors;
}
