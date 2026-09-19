import { describe, expect, test } from "bun:test";
import type { FeatureCategory } from "./types.js";
import { filterFeatureCategories } from "./featureFilters.js";

const categories: FeatureCategory[] = [
  {
    id: "dashboard",
    title: "Dashboard",
    items: [
      { id: "filters", title: "Filters", status: "todo", phase_ids: ["build"] },
      { id: "empty-state", title: "Empty state", status: "todo", phase_ids: ["polish"] },
      { id: "responsive", title: "Responsive layout", status: "todo", phase_ids: ["build", "polish"] },
      { id: "legacy", title: "Legacy item", status: "todo" },
    ],
  },
  {
    id: "api",
    title: "API",
    items: [{ id: "health", title: "Health check", status: "done", phase_ids: ["release"] }],
  },
];

describe("filterFeatureCategories", () => {
  test("shows all categories when no phases are selected", () => {
    expect(filterFeatureCategories(categories, [])).toEqual(categories);
  });

  test("uses union semantics for multiple selected phases", () => {
    const result = filterFeatureCategories(categories, ["build", "polish"]);
    expect(result.map((category) => category.id)).toEqual(["dashboard"]);
    expect(result[0]!.items.map((item) => item.id)).toEqual(["filters", "empty-state", "responsive"]);
  });

  test("omits categories with no matching features", () => {
    expect(filterFeatureCategories(categories, ["release"]).map((category) => category.id)).toEqual(["api"]);
  });
});
