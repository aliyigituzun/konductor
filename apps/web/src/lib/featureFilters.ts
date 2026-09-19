import type { FeatureCategory } from "./types.js";

export function filterFeatureCategories(
  categories: FeatureCategory[],
  selectedPhaseIds: string[],
): FeatureCategory[] {
  if (selectedPhaseIds.length === 0) return categories;
  const selected = new Set(selectedPhaseIds);
  return categories
    .map((category) => ({
      ...category,
      items: category.items.filter((item) => item.phase_ids?.some((phaseId) => selected.has(phaseId))),
    }))
    .filter((category) => category.items.length > 0);
}
