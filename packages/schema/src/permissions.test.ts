import { expect, test } from "bun:test";
import { USER_PERMISSION_GROUPS, USER_PERMISSIONS, validatePermissionSets } from "./permissions.js";

test("the display catalog covers every permission exactly once", () => {
  const listed = USER_PERMISSION_GROUPS.flatMap((group) => group.items.map((item) => item.id));
  expect([...listed].sort()).toEqual([...USER_PERMISSIONS].sort());
  expect(new Set(listed).size).toBe(listed.length);
});

test("validatePermissionSets reports cross-set problems", () => {
  expect(validatePermissionSets([
    { name: "Build", permissions: ["features.add"], project_ids: ["a"] },
    { name: "Review", permissions: ["reviews.reserve_port"], project_ids: ["b"] },
  ])).toEqual([]);
  expect(validatePermissionSets([
    { name: "Build", permissions: ["features.add"], project_ids: ["a"] },
    { name: "build", permissions: ["todos.add"], project_ids: ["a", "a"] },
    { name: " ", permissions: [], project_ids: [] },
  ], (id) => id.toUpperCase())).toEqual([
    '"build" is used by more than one set.',
    "A is in both Build and build.",
    "Set 3 needs a name.",
    "Set 3 has no permissions.",
    "Set 3 does not apply to any project.",
  ]);
});
