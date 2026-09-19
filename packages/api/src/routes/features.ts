import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendUpdate, createTodo, diffStatusSnapshots, readStatus, readTodo, updateTodo, writeStatus } from "@konductor/store";
import type { FeatureCategory, FeatureItemStatus, FeaturePhase, StatusSnapshot } from "@konductor/schema";
import { ApiError, json, readJsonBody, type Router } from "../router.js";
import { requireProject } from "./projects.js";

const execFileAsync = promisify(execFile);

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function uniqueId(taken: Set<string>, base: string, fallback = "item"): string {
  const root = slugify(base) || fallback;
  if (!taken.has(root)) return root;
  for (let n = 2; ; n += 1) {
    const candidate = `${root}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export type CreateFeatureBody = {
  title?: string;
  description?: string;
  category_id?: string;
  phase_ids?: string[];
  status?: FeatureItemStatus;
  create_todo?: boolean;
};

type CreateNamedBody = { title?: string };
type ManageFeaturePhasesBody = {
  phases?: Array<{ id?: string; title?: string }>;
  phase_ids?: string[];
};
export type UpdateFeatureBody = {
  title?: string;
  description?: string;
  status?: FeatureItemStatus;
  category_id?: string;
};

function normalizedPhaseTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function assertUniquePhaseTitle(phases: FeaturePhase[], title: string, excludeId?: string): void {
  const normalized = normalizedPhaseTitle(title);
  if (phases.some((phase) => phase.id !== excludeId && normalizedPhaseTitle(phase.title) === normalized)) {
    throw new ApiError("Feature phase names must be unique.", {
      status: 400,
      code: "DUPLICATE_FEATURE_PHASE_TITLE",
    });
  }
}

export function validatePhaseIds(status: StatusSnapshot, phaseIds: unknown): string[] {
  if (phaseIds === undefined) return [];
  if (!Array.isArray(phaseIds) || phaseIds.some((id) => typeof id !== "string")) {
    throw new ApiError("Feature phases must be a list of phase IDs.", {
      status: 400,
      code: "INVALID_FEATURE_PHASES",
    });
  }
  const uniqueIds = [...new Set(phaseIds.map((id) => id.trim()).filter(Boolean))];
  const knownIds = new Set((status.feature_phases ?? []).map((phase) => phase.id));
  const unknownIds = uniqueIds.filter((id) => !knownIds.has(id));
  if (unknownIds.length > 0) {
    throw new ApiError(`Unknown feature phase: ${unknownIds.join(", ")}.`, {
      status: 400,
      code: "FEATURE_PHASE_NOT_FOUND",
    });
  }
  return uniqueIds;
}

function validatePhaseOrder(status: StatusSnapshot, phaseIds: unknown): string[] {
  if (!Array.isArray(phaseIds) || phaseIds.some((id) => typeof id !== "string")) {
    throw new ApiError("Feature phase order must be a list of phase IDs.", {
      status: 400,
      code: "INVALID_FEATURE_PHASE_ORDER",
    });
  }
  const currentIds = (status.feature_phases ?? []).map((phase) => phase.id);
  const requestedIds = phaseIds.map((id) => id.trim());
  if (
    requestedIds.some((id) => !id)
    || new Set(requestedIds).size !== requestedIds.length
    || requestedIds.length !== currentIds.length
    || requestedIds.some((id) => !currentIds.includes(id))
  ) {
    throw new ApiError("Feature phase order must include every phase exactly once.", {
      status: 400,
      code: "INVALID_FEATURE_PHASE_ORDER",
    });
  }
  return requestedIds;
}

/**
 * npm package names, per the registry's own rules.
 *
 * This is passed to `npm install`, so it is validated against a grammar rather than
 * trusted: argv already prevents shell injection, but a name like `--registry=...`
 * would still be read by npm as a flag.
 */
const NPM_PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/**
 * Adds one feature item to an existing category. Shared by the features route and by
 * decision resolution, which may create the features a chosen option calls for.
 */
/** Dashboard edits that touch phases/items wholesale log whatever actually changed. */
async function writeStatusWithUpdates(repoPath: string, previous: StatusSnapshot, next: StatusSnapshot): Promise<void> {
  await writeStatus(repoPath, next);
  for (const draft of diffStatusSnapshots(previous, next)) {
    await appendUpdate(repoPath, { ...draft, agent: "dashboard", source: "dashboard" });
  }
}

export async function createFeatureItem(
  repoPath: string,
  body: CreateFeatureBody,
  options: { agent?: string; decision_title?: string } = {},
): Promise<{ category_id: string; feature_item_id: string; title: string }> {
  const title = body.title?.trim();
  if (!title) {
    throw new ApiError("A feature title is required.", {
      status: 400,
      code: "TITLE_REQUIRED",
    });
  }

  const status = await readStatus(repoPath);
  if (!status) {
    throw new ApiError("Project has no status snapshot yet.", {
      status: 400,
      code: "STATUS_MISSING",
      hint: "Run `konductor init` to seed .konductor/status/current.json.",
    });
  }

  const features: FeatureCategory[] = [...(status.features ?? [])];
  const itemIds = new Set(features.flatMap((category) => category.items.map((item) => item.id)));

  const category = features.find((entry_) => entry_.id === body.category_id?.trim()) ?? null;
  if (!category) {
    throw new ApiError("Choose an existing feature category.", {
      status: 400,
      code: "CATEGORY_REQUIRED",
    });
  }

  const phaseIds = validatePhaseIds(status, body.phase_ids);
  const featureStatus = body.status ?? "todo";
  if (!["todo", "in_progress", "blocked", "done"].includes(featureStatus)) {
    throw new ApiError("Feature status is invalid.", { status: 400, code: "INVALID_FEATURE_STATUS" });
  }

  const featureId = uniqueId(itemIds, title, "feature");
  category.items = [
    ...category.items,
    {
      id: featureId,
      title,
      status: featureStatus,
      phase_ids: phaseIds,
      ...(body.description?.trim() ? { description: body.description.trim() } : {}),
    },
  ];
  await writeStatus(repoPath, { ...status, features });
  // Feature and to-do tracking are deliberately independent: a feature may begin
  // in progress or done, but it still gets a linked to-do unless the operator opts
  // out. Keeping the statuses aligned avoids a misleading open to-do for a done
  // feature. The to-do lives in the project database; readStatus links it back
  // onto the feature item.
  const todoId = body.create_todo !== false
    ? (await createTodo(repoPath, {
      title,
      status: featureStatus,
      related_feature_item_ids: [featureId],
      related_asset_ids: [],
      feature_item_id: featureId,
      creates_feature: false,
      imminent: false,
      ...(body.description?.trim() ? { description: body.description.trim() } : {}),
    })).id
    : null;
  await appendUpdate(repoPath, {
    kind: "milestone",
    subject: "feature",
    action: "created",
    // A feature that spawned a linked to-do reports both in one line so the feed
    // reads as a single event rather than two unrelated additions.
    message: [
      options.decision_title
        ? `Feature added "${title}" to ${category.title} from decision "${options.decision_title}"`
        : `Feature added "${title}" to ${category.title}`,
      ...(todoId ? [`To-do added "${title}"`] : []),
    ].join(" → "),
    agent: options.agent ?? "dashboard",
    feature_item_id: featureId,
    source: "dashboard",
  });

  return { category_id: category.id, feature_item_id: featureId, title };
}

export function registerFeatureRoutes(router: Router): void {
  router.post("/api/project/:id/features/categories", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const body = await readJsonBody<CreateNamedBody>(request);
    const title = body.title?.trim();
    if (!title) {
      throw new ApiError("A feature category title is required.", {
        status: 400,
        code: "TITLE_REQUIRED",
      });
    }
    const status = await readStatus(entry.repo_path);
    if (!status) {
      throw new ApiError("Project has no status snapshot yet.", {
        status: 400,
        code: "STATUS_MISSING",
      });
    }
    const features = [...(status.features ?? [])];
    const id = uniqueId(new Set(features.map((category) => category.id)), title, "category");
    features.push({ id, title, items: [] });
    await writeStatus(entry.repo_path, { ...status, features });
    await appendUpdate(entry.repo_path, {
      kind: "milestone",
      subject: "feature",
      action: "created",
      message: `Added feature category "${title}".`,
      agent: "dashboard",
      source: "dashboard",
    });
    return json({ category_id: id });
  });

  router.post("/api/project/:id/features/phases", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const body = await readJsonBody<CreateNamedBody>(request);
    const title = body.title?.trim();
    if (!title) {
      throw new ApiError("A feature phase title is required.", {
        status: 400,
        code: "TITLE_REQUIRED",
      });
    }
    const status = await readStatus(entry.repo_path);
    if (!status) {
      throw new ApiError("Project has no status snapshot yet.", {
        status: 400,
        code: "STATUS_MISSING",
      });
    }
    const phases: FeaturePhase[] = [...(status.feature_phases ?? [])];
    assertUniquePhaseTitle(phases, title);
    const id = uniqueId(new Set(phases.map((phase) => phase.id)), title, "phase");
    phases.push({ id, title });
    await writeStatus(entry.repo_path, { ...status, feature_phases: phases });
    await appendUpdate(entry.repo_path, {
      kind: "milestone",
      subject: "feature",
      action: "created",
      message: `Added feature phase "${title}".`,
      agent: "dashboard",
      source: "dashboard",
    });
    return json({ phase_id: id });
  });

  router.put("/api/project/:id/features/phases", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const body = await readJsonBody<ManageFeaturePhasesBody>(request);
    const status = await readStatus(entry.repo_path);
    if (!status) {
      throw new ApiError("Project has no status snapshot yet.", {
        status: 400,
        code: "STATUS_MISSING",
      });
    }
    // Keep the original ordering payload supported for older dashboard clients.
    if (body.phases === undefined) {
      const phaseIds = validatePhaseOrder(status, body.phase_ids);
      const phasesById = new Map((status.feature_phases ?? []).map((phase) => [phase.id, phase]));
      const feature_phases = phaseIds.map((id) => phasesById.get(id)!);
      await writeStatusWithUpdates(entry.repo_path, status, { ...status, feature_phases });
      return json({ phase_ids: phaseIds });
    }

    if (!Array.isArray(body.phases)) {
      throw new ApiError("Feature phases must be a list of named phases.", {
        status: 400,
        code: "INVALID_FEATURE_PHASES",
      });
    }

    const existing = status.feature_phases ?? [];
    const existingById = new Map(existing.map((phase) => [phase.id, phase]));
    const usedIds = new Set<string>();
    const seenTitles = new Set<string>();
    const feature_phases: FeaturePhase[] = body.phases.map((phase) => {
      const title = phase.title?.trim();
      if (!title) {
        throw new ApiError("Every feature phase needs a name.", { status: 400, code: "TITLE_REQUIRED" });
      }
      const normalized = normalizedPhaseTitle(title);
      if (seenTitles.has(normalized)) {
        throw new ApiError("Feature phase names must be unique.", {
          status: 400,
          code: "DUPLICATE_FEATURE_PHASE_TITLE",
        });
      }
      seenTitles.add(normalized);

      const requestedId = phase.id?.trim();
      if (requestedId && !existingById.has(requestedId)) {
        throw new ApiError(`Unknown feature phase: ${requestedId}.`, {
          status: 400,
          code: "FEATURE_PHASE_NOT_FOUND",
        });
      }
      if (requestedId && usedIds.has(requestedId)) {
        throw new ApiError("Feature phase IDs must be unique.", {
          status: 400,
          code: "INVALID_FEATURE_PHASES",
        });
      }
      const id = requestedId ?? uniqueId(new Set([...existingById.keys(), ...usedIds]), title, "phase");
      usedIds.add(id);
      return { id, title };
    });
    const retainedIds = new Set(feature_phases.map((phase) => phase.id));
    const features = (status.features ?? []).map((category) => ({
      ...category,
      items: category.items.map((item) => ({
        ...item,
        phase_ids: (item.phase_ids ?? []).filter((phaseId) => retainedIds.has(phaseId)),
      })),
    }));
    await writeStatusWithUpdates(entry.repo_path, status, { ...status, feature_phases, features });
    return json({ phases: feature_phases });
  });

  router.put("/api/project/:id/features/:featureId/phases", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const body = await readJsonBody<{ phase_ids?: string[] }>(request);
    const status = await readStatus(entry.repo_path);
    if (!status) {
      throw new ApiError("Project has no status snapshot yet.", {
        status: 400,
        code: "STATUS_MISSING",
      });
    }
    const phaseIds = validatePhaseIds(status, body.phase_ids);
    let found = false;
    const features = (status.features ?? []).map((category) => ({
      ...category,
      items: category.items.map((item) => {
        if (item.id !== params["featureId"]) return item;
        found = true;
        return { ...item, phase_ids: phaseIds };
      }),
    }));
    if (!found) {
      throw new ApiError("Feature not found.", { status: 404, code: "FEATURE_NOT_FOUND" });
    }
    await writeStatusWithUpdates(entry.repo_path, status, { ...status, features });
    return json({ feature_item_id: params["featureId"], phase_ids: phaseIds });
  });

  router.post("/api/project/:id/features", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const body = await readJsonBody<CreateFeatureBody>(request);
    const created = await createFeatureItem(entry.repo_path, body);
    return json({ category_id: created.category_id, feature_item_id: created.feature_item_id });
  });

  router.put("/api/project/:id/features/:featureId", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const body = await readJsonBody<UpdateFeatureBody>(request);
    const status = await readStatus(entry.repo_path);
    if (!status) {
      throw new ApiError("Project has no status snapshot yet.", {
        status: 400,
        code: "STATUS_MISSING",
      });
    }
    const featureId = params["featureId"]!;
    const features: FeatureCategory[] = status.features ?? [];
    let sourceCategory: FeatureCategory | null = null;
    let item = null as FeatureCategory["items"][number] | null;
    for (const category of features) {
      const found = category.items.find((candidate) => candidate.id === featureId);
      if (found) {
        sourceCategory = category;
        item = found;
        break;
      }
    }
    if (!sourceCategory || !item) {
      throw new ApiError("Feature not found.", { status: 404, code: "FEATURE_NOT_FOUND" });
    }

    const title = body.title === undefined ? item.title : body.title.trim();
    if (!title) {
      throw new ApiError("A feature title is required.", { status: 400, code: "TITLE_REQUIRED" });
    }
    const featureStatus = body.status ?? item.status;
    if (!["todo", "in_progress", "blocked", "done"].includes(featureStatus)) {
      throw new ApiError("Feature status is invalid.", { status: 400, code: "INVALID_FEATURE_STATUS" });
    }
    const description = body.description === undefined ? item.description : body.description.trim();
    const targetCategory = body.category_id === undefined
      ? sourceCategory
      : features.find((category) => category.id === body.category_id!.trim());
    if (!targetCategory) {
      throw new ApiError("Choose an existing feature category.", { status: 400, code: "CATEGORY_REQUIRED" });
    }

    const updatedItem = { ...item, title, status: featureStatus, ...(description ? { description } : { description: undefined }) };
    const nextFeatures = features.map((category) => {
      if (category.id === sourceCategory!.id && category.id === targetCategory.id) {
        return { ...category, items: category.items.map((candidate) => candidate.id === featureId ? updatedItem : candidate) };
      }
      if (category.id === sourceCategory!.id) {
        return { ...category, items: category.items.filter((candidate) => candidate.id !== featureId) };
      }
      if (category.id === targetCategory.id) {
        return { ...category, items: [...category.items, updatedItem] };
      }
      return category;
    });
    await writeStatus(entry.repo_path, { ...status, features: nextFeatures });

    if (item.todo_id) {
      const existingTodo = await readTodo(entry.repo_path, item.todo_id);
      if (existingTodo) {
        await updateTodo(entry.repo_path, item.todo_id, {
          title,
          status: featureStatus,
          ...(description ? { description } : {}),
        });
      }
    }

    const changedCategory = targetCategory.id !== sourceCategory.id;
    await appendUpdate(entry.repo_path, {
      kind: "brief",
      subject: "feature",
      action: "edited",
      message: changedCategory
        ? `Feature "${title}" updated and moved to ${targetCategory.title}`
        : `Feature "${title}" updated`,
      agent: "dashboard",
      feature_item_id: featureId,
      source: "dashboard",
    });

    return json({ feature_item_id: featureId, category_id: targetCategory.id });
  });

  router.post("/api/project/:id/skills/install", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const body = await readJsonBody<{ source?: "npm" | "github"; url?: string }>(request);

    const source = body.source;
    const url = body.url?.trim() ?? "";
    const npmMatch = url.match(/^https:\/\/(?:www\.)?npmjs\.com\/package\/(.+?)\/?$/i);
    const githubMatch = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
    if (source !== "npm" && source !== "github") {
      throw new ApiError("Skill source must be npm or github.", {
        status: 400,
        code: "INVALID_SKILL_LINK",
      });
    }
    if (source === "npm" && (!npmMatch || !NPM_PACKAGE_NAME.test(decodeURIComponent(npmMatch[1]!)))) {
      throw new ApiError(`"${url}" is not a valid npm package link.`, {
        status: 400,
        code: "INVALID_SKILL_LINK",
      });
    }
    if (source === "github" && !githubMatch) {
      throw new ApiError(`"${url}" is not a valid GitHub repository link.`, {
        status: 400,
        code: "INVALID_SKILL_LINK",
      });
    }

    const spec = source === "github"
      ? `https://github.com/${githubMatch![1]}/${githubMatch![2]!.replace(/\.git$/, "")}.git`
      : decodeURIComponent(npmMatch![1]!);
    const command = `npm install ${spec}`;
    try {
      const { stdout, stderr } = await execFileAsync("npm", ["install", spec], {
        cwd: entry.repo_path,
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      return json({ command, stdout, stderr, error: null });
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; message?: string };
      return json({
        command,
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? "",
        error: failure.message ?? "npm install failed.",
      });
    }
  });
}
