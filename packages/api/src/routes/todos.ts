import { appendUpdate, createTodo, readAssetLibrary, readStatus, readTodo, updateTodo } from "@konductor/store";
import type { FeatureItemStatus, StatusSnapshot } from "@konductor/schema";
import { ApiError, json, readJsonBody, type Router } from "../router.js";
import { requireProject } from "./projects.js";
import { createFeatureItem } from "./features.js";

type CreateTodoBody = {
  title?: string;
  description?: string;
  status?: FeatureItemStatus;
  related_feature_item_ids?: string[];
  related_asset_ids?: string[];
  creates_feature?: boolean;
  category_id?: string;
  phase_ids?: string[];
  imminent?: boolean;
};

function assertStatus(status: unknown): FeatureItemStatus {
  if (status === undefined) return "todo";
  if (["todo", "in_progress", "blocked", "done"].includes(String(status))) return status as FeatureItemStatus;
  throw new ApiError("To-do status is invalid.", { status: 400, code: "INVALID_TODO_STATUS" });
}

function requireStatus(snapshot: StatusSnapshot | null): StatusSnapshot {
  if (!snapshot) throw new ApiError("Project has no status snapshot yet.", { status: 400, code: "STATUS_MISSING" });
  return snapshot;
}

function validateFeatureIds(status: StatusSnapshot, ids: unknown): string[] {
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    throw new ApiError("Related features must be a list of feature IDs.", { status: 400, code: "INVALID_FEATURE_IDS" });
  }
  const known = new Set((status.features ?? []).flatMap((category) => category.items.map((item) => item.id)));
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const missing = unique.filter((id) => !known.has(id));
  if (missing.length) throw new ApiError(`Unknown feature: ${missing.join(", ")}.`, { status: 400, code: "FEATURE_NOT_FOUND" });
  return unique;
}

async function validateAssetIds(repoPath: string, ids: unknown): Promise<string[]> {
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    throw new ApiError("Related assets must be a list of asset IDs.", { status: 400, code: "INVALID_ASSET_IDS" });
  }
  const known = new Set((await readAssetLibrary(repoPath)).assets.map((asset) => asset.id));
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const missing = unique.filter((id) => !known.has(id));
  if (missing.length) throw new ApiError(`Unknown asset: ${missing.join(", ")}.`, { status: 400, code: "ASSET_NOT_FOUND" });
  return unique;
}

export function registerTodoRoutes(router: Router): void {
  router.post("/api/project/:id/todos", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const body = await readJsonBody<CreateTodoBody>(request);
    const title = body.title?.trim();
    if (!title) throw new ApiError("A to-do title is required.", { status: 400, code: "TITLE_REQUIRED" });

    let status = requireStatus(await readStatus(entry.repo_path));
    const relatedFeatureIds = validateFeatureIds(status, body.related_feature_item_ids);
    const relatedAssetIds = await validateAssetIds(entry.repo_path, body.related_asset_ids);
    const createsFeature = body.creates_feature !== false;
    let featureItemId: string | null = null;
    if (createsFeature) {
      const created = await createFeatureItem(entry.repo_path, {
        title,
        ...(body.description ? { description: body.description } : {}),
        ...(body.category_id ? { category_id: body.category_id } : {}),
        ...(body.phase_ids ? { phase_ids: body.phase_ids } : {}),
        ...(body.status ? { status: body.status } : {}),
        create_todo: false,
      });
      featureItemId = created.feature_item_id;
      status = requireStatus(await readStatus(entry.repo_path));
    }

    const todo = await createTodo(entry.repo_path, {
      title,
      status: assertStatus(body.status),
      related_feature_item_ids: [...new Set([...relatedFeatureIds, ...(featureItemId ? [featureItemId] : [])])],
      related_asset_ids: relatedAssetIds,
      feature_item_id: featureItemId,
      creates_feature: createsFeature,
      imminent: body.imminent === true,
      ...(body.description?.trim() ? { description: body.description.trim() } : {}),
    });
    const todoId = todo.id;
    await appendUpdate(entry.repo_path, {
      kind: "milestone",
      subject: "todo",
      action: "created",
      message: featureItemId ? `To-do added "${title}" → Feature added "${title}"` : `To-do added "${title}"`,
      agent: "dashboard",
      source: "dashboard",
      ...(featureItemId ? { feature_item_id: featureItemId } : {}),
    });
    return json({ todo_id: todoId, feature_item_id: featureItemId });
  });

  router.put("/api/project/:id/todos/:todoId", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const body = await readJsonBody<Pick<CreateTodoBody, "status" | "related_feature_item_ids" | "related_asset_ids" | "creates_feature" | "imminent">>(request);
    const status = requireStatus(await readStatus(entry.repo_path));
    const todoId = params["todoId"]!;
    const existing = await readTodo(entry.repo_path, todoId);
    if (!existing) throw new ApiError("To-do not found.", { status: 404, code: "TODO_NOT_FOUND" });
    const related = body.related_feature_item_ids === undefined ? undefined : validateFeatureIds(status, body.related_feature_item_ids);
    const relatedAssets = body.related_asset_ids === undefined ? undefined : await validateAssetIds(entry.repo_path, body.related_asset_ids);
    await updateTodo(entry.repo_path, todoId, {
      ...(body.status === undefined ? {} : { status: assertStatus(body.status) }),
      ...(related === undefined ? {} : { related_feature_item_ids: related }),
      ...(relatedAssets === undefined ? {} : { related_asset_ids: relatedAssets }),
      ...(body.creates_feature === undefined ? {} : { creates_feature: body.creates_feature }),
      ...(body.imminent === undefined ? {} : { imminent: body.imminent === true }),
    });
    const nextStatus = body.status === undefined ? existing.status : assertStatus(body.status);
    await appendUpdate(entry.repo_path, {
      kind: "brief",
      subject: "todo",
      action: nextStatus === existing.status ? "edited" : nextStatus === "done" ? "success" : nextStatus === "blocked" ? "failure" : "edited",
      message: nextStatus !== existing.status
        ? `To-do "${existing.title}" marked ${nextStatus}`
        : `To-do "${existing.title}" updated`,
      agent: "dashboard",
      source: "dashboard",
      ...(existing.feature_item_id ? { feature_item_id: existing.feature_item_id } : {}),
    });
    return json({ todo_id: params["todoId"] });
  });
}
