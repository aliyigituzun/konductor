import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendUpdate, readStatus, writeStatus } from "@konductor/store";
import type { FeatureCategory, StatusSnapshot } from "@konductor/schema";
import { ApiError, json, readJsonBody, type Router } from "../router.js";
import { requireProject } from "./projects.js";

const execFileAsync = promisify(execFile);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueId(taken: Set<string>, base: string, fallback = "item"): string {
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
  category_title?: string;
};

/**
 * npm package names, per the registry's own rules.
 *
 * This is passed to `npm install`, so it is validated against a grammar rather than
 * trusted: argv already prevents shell injection, but a name like `--registry=...`
 * would still be read by npm as a flag.
 */
const NPM_PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const NPM_VERSION = /^[a-zA-Z0-9.\-+^~*<>= |]{1,64}$/;

export function registerFeatureRoutes(router: Router): void {
  router.post("/api/project/:id/features", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const body = await readJsonBody<CreateFeatureBody>(request);

    const title = body.title?.trim();
    if (!title) {
      throw new ApiError("A feature title is required.", {
        status: 400,
        code: "TITLE_REQUIRED",
      });
    }

    const status = await readStatus(entry.repo_path);
    if (!status) {
      throw new ApiError("Project has no status snapshot yet.", {
        status: 400,
        code: "STATUS_MISSING",
        hint: "Run `konductor init` to seed .konductor/status/current.json.",
      });
    }

    const features: FeatureCategory[] = [...(status.features ?? [])];
    const categoryIds = new Set(features.map((category) => category.id));
    const itemIds = new Set(features.flatMap((category) => category.items.map((item) => item.id)));

    let category = features.find((entry_) => entry_.id === body.category_id?.trim()) ?? null;
    if (!category) {
      const categoryTitle = body.category_title?.trim();
      if (!categoryTitle) {
        throw new ApiError("Choose an existing category or name a new one.", {
          status: 400,
          code: "CATEGORY_REQUIRED",
        });
      }
      category = { id: uniqueId(categoryIds, categoryTitle, "category"), title: categoryTitle, items: [] };
      features.push(category);
    }

    const featureId = uniqueId(itemIds, title, "feature");
    category.items = [
      ...category.items,
      {
        id: featureId,
        title,
        status: "todo",
        ...(body.description?.trim() ? { description: body.description.trim() } : {}),
      },
    ];

    // writeStatus validates and keeps a timestamped backup, which the dev server's
    // hand-rolled copy of this did not.
    const next: StatusSnapshot = { ...status, features };
    await writeStatus(entry.repo_path, next);
    await appendUpdate(entry.repo_path, {
      kind: "milestone",
      message: `Added feature "${title}" to ${category.title}.`,
      agent: "dashboard",
      feature_item_id: featureId,
      source: "dashboard",
    });

    return json({ category_id: category.id, feature_item_id: featureId });
  });

  router.get("/api/skills/search", async ({ url }) => {
    const query = url.searchParams.get("q")?.trim();
    if (!query) return json({ objects: [] });
    const response = await fetch(
      `https://registry.npmjs.org/-/v1/search?size=10&text=${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) {
      throw new ApiError(`npm registry search failed (${response.status}).`, {
        status: 502,
        code: "NPM_SEARCH_FAILED",
      });
    }
    return json(await response.json());
  });

  router.post("/api/project/:id/skills/install", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const body = await readJsonBody<{ package_name?: string; version?: string }>(request);

    const name = body.package_name?.trim() ?? "";
    if (!NPM_PACKAGE_NAME.test(name)) {
      throw new ApiError(`"${name}" is not a valid npm package name.`, {
        status: 400,
        code: "INVALID_PACKAGE_NAME",
      });
    }
    const version = body.version?.trim();
    if (version && !NPM_VERSION.test(version)) {
      throw new ApiError(`"${version}" is not a valid version range.`, {
        status: 400,
        code: "INVALID_VERSION",
      });
    }

    const spec = version ? `${name}@${version}` : name;
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
