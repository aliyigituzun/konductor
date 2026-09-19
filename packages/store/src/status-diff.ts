import type { FeatureItem, StatusSnapshot, UpdateEntry } from "@konductor/schema";

/** An update entry minus the fields the caller supplies (id, timestamp, author). */
export type UpdateDraft = Omit<UpdateEntry, "id" | "at" | "agent">;

const STATUS_LABEL: Record<FeatureItem["status"], string> = {
  todo: "to-do",
  in_progress: "in progress",
  done: "done",
  blocked: "blocked",
};

function phaseLabel(ids: string[] | undefined, next: StatusSnapshot): string {
  const titles = new Map((next.feature_phases ?? []).map((phase) => [phase.id, phase.title]));
  const names = (ids ?? []).map((id) => titles.get(id) ?? id);
  return names.length ? names.join(", ") : "no phase";
}

function sameIds(a: string[] | undefined, b: string[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * Describe what changed between two status snapshots as feature-tagged update
 * drafts. Feature categories, phases, and items are matched by id, so a rename or
 * a move between categories is one `edited` entry rather than a delete + create.
 * A missing previous snapshot is initial seeding, which is not an event.
 */
export function diffStatusSnapshots(prev: StatusSnapshot | null, next: StatusSnapshot): UpdateDraft[] {
  if (!prev) return [];
  const drafts: UpdateDraft[] = [];
  const feature = (action: UpdateDraft["action"], message: string, featureItemId?: string): void => {
    drafts.push({ kind: "brief", subject: "feature", action, message, ...(featureItemId ? { feature_item_id: featureItemId } : {}) });
  };

  const prevPhases = prev.feature_phases ?? [];
  const nextPhases = next.feature_phases ?? [];
  const prevPhaseById = new Map(prevPhases.map((phase) => [phase.id, phase]));
  const nextPhaseById = new Map(nextPhases.map((phase) => [phase.id, phase]));
  for (const phase of nextPhases) {
    const before = prevPhaseById.get(phase.id);
    if (!before) feature("created", `Added feature phase "${phase.title}".`);
    else if (before.title !== phase.title) feature("edited", `Renamed feature phase "${before.title}" to "${phase.title}".`);
  }
  for (const phase of prevPhases) {
    if (!nextPhaseById.has(phase.id)) feature("deleted", `Removed feature phase "${phase.title}".`);
  }
  const survivingOrder = (phases: typeof prevPhases) => phases.filter((phase) => prevPhaseById.has(phase.id) && nextPhaseById.has(phase.id)).map((phase) => phase.id);
  if (!sameIds(survivingOrder(prevPhases), survivingOrder(nextPhases))) feature("edited", "Reordered feature phases.");

  const prevCategories = prev.features ?? [];
  const nextCategories = next.features ?? [];
  const prevCategoryById = new Map(prevCategories.map((category) => [category.id, category]));
  const nextCategoryById = new Map(nextCategories.map((category) => [category.id, category]));
  for (const category of nextCategories) {
    const before = prevCategoryById.get(category.id);
    if (!before) feature("created", `Added feature category "${category.title}".`);
    else if (before.title !== category.title) feature("edited", `Renamed feature category "${before.title}" to "${category.title}".`);
  }
  for (const category of prevCategories) {
    if (!nextCategoryById.has(category.id)) feature("deleted", `Removed feature category "${category.title}".`);
  }

  const prevItems = new Map<string, { item: FeatureItem; category: string }>();
  for (const category of prevCategories) for (const item of category.items) prevItems.set(item.id, { item, category: category.title });
  const nextItems = new Map<string, { item: FeatureItem; category: string }>();
  for (const category of nextCategories) for (const item of category.items) nextItems.set(item.id, { item, category: category.title });

  for (const [id, { item, category }] of nextItems) {
    const before = prevItems.get(id);
    if (!before) {
      feature("created", `Feature added "${item.title}" to ${category}`, id);
      continue;
    }
    if (before.item.status !== item.status) {
      if (item.status === "done") feature("success", `Feature "${item.title}" marked done.`, id);
      else if (item.status === "blocked") feature("failure", `Feature "${item.title}" blocked.`, id);
      else feature("edited", `Feature "${item.title}" marked ${STATUS_LABEL[item.status]}.`, id);
    }
    if (!sameIds(before.item.phase_ids, item.phase_ids)) {
      feature("edited", `Moved feature "${item.title}" to ${phaseLabel(item.phase_ids, next)}.`, id);
    }
    if (before.item.title !== item.title || (before.item.description ?? "") !== (item.description ?? "") || before.category !== category) {
      feature("edited", `Feature "${item.title}" updated.`, id);
    }
  }
  for (const [id, { item, category }] of prevItems) {
    if (!nextItems.has(id)) feature("deleted", `Feature removed "${item.title}" from ${category}`, id);
  }

  return drafts;
}
