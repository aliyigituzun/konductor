import { AssetBucketColorSchema, AssetManagerConfigSchema, AssetMetadataSchema } from "@konductor/schema";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import {
  addAssetVariation,
  createAssetBucket,
  createManagedAsset,
  deleteAssetVariation,
  deleteManagedAsset,
  deleteAssetBucket,
  moveAssetBucket,
  moveManagedAsset,
  readAssetLibrary,
  readConfig,
  repoLocal,
  setAssetVariationUsed,
  updateAssetBucketMetadata,
  updateAssetBucketSettings,
  updateManagedAssetMetadata,
  writeConfig,
  type AssetUploadInput,
} from "@konductor/store";
import { ApiError, json, readJsonBody, type Router } from "../router.js";
import { requireProject } from "./projects.js";

function badRequest(error: unknown): never {
  throw new ApiError(error instanceof Error ? error.message : String(error), {
    status: 400,
    code: "ASSET_REQUEST_INVALID",
  });
}

const defaultSettings = () => AssetManagerConfigSchema.parse({});

export function registerAssetRoutes(router: Router): void {
  router.get("/api/project/:id/assets", async ({ params }) => {
    const entry = await requireProject(params["id"]!);
    const [config, library] = await Promise.all([
      readConfig(entry.repo_path),
      readAssetLibrary(entry.repo_path),
    ]);
    return json({ settings: config?.assets ?? defaultSettings(), library });
  });

  router.put("/api/project/:id/assets/settings", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const current = await readConfig(entry.repo_path);
    if (!current) {
      throw new ApiError("Project has no konductor.config.json.", {
        status: 400,
        code: "CONFIG_MISSING",
      });
    }
    const body = await readJsonBody<unknown>(request);
    const parsed = AssetManagerConfigSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError("Asset settings are invalid.", {
        status: 400,
        code: "ASSET_SETTINGS_INVALID",
        details: parsed.error.errors.map((item) => `${item.path.join(".")}: ${item.message}`),
      });
    }
    await writeConfig(entry.repo_path, { ...current, assets: parsed.data });
    return json({ settings: parsed.data, library: await readAssetLibrary(entry.repo_path) });
  });

  router.get("/api/project/:id/assets/items/:assetId/variations/:variationId/content", async ({ params }) => {
    const entry = await requireProject(params["id"]!);
    const library = await readAssetLibrary(entry.repo_path);
    const asset = library.assets.find((item) => item.id === params["assetId"]!);
    const variation = asset?.variations.find((item) => item.id === params["variationId"]!);
    if (!variation) {
      throw new ApiError("Asset variation was not found.", { status: 404, code: "ASSET_VARIATION_NOT_FOUND" });
    }
    const root = resolve(repoLocal(entry.repo_path).assetsFilesDir);
    const filePath = resolve(entry.repo_path, variation.storage_path);
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      throw new ApiError("Asset variation is outside managed storage.", { status: 400, code: "ASSET_STORAGE_INVALID" });
    }
    try {
      return new Response(await readFile(filePath), {
        headers: {
          "Content-Type": variation.media_type,
          "Cache-Control": "no-store",
        },
      });
    } catch {
      throw new ApiError("Asset file is no longer available.", { status: 404, code: "ASSET_FILE_MISSING" });
    }
  });

  router.post("/api/project/:id/assets/buckets", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const body = await readJsonBody<Parameters<typeof createAssetBucket>[1]>(request);
    try {
      return json(await createAssetBucket(entry.repo_path, body), 201);
    } catch (error) {
      return badRequest(error);
    }
  });

  router.put("/api/project/:id/assets/buckets/:bucketId/metadata", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const body = await readJsonBody<unknown>(request);
    const metadata = AssetMetadataSchema.safeParse(body);
    if (!metadata.success) return badRequest(metadata.error);
    try {
      return json(await updateAssetBucketMetadata(entry.repo_path, params["bucketId"]!, metadata.data));
    } catch (error) {
      return badRequest(error);
    }
  });

  router.put("/api/project/:id/assets/buckets/:bucketId/settings", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const body = await readJsonBody<unknown>(request);
    if (typeof body !== "object" || body === null) return badRequest(new Error("Folder settings must be an object."));
    const candidate = body as { prevent_agent_uploads?: unknown; color?: unknown };
    const includesUploadLock = "prevent_agent_uploads" in candidate;
    const includesColor = "color" in candidate;
    if (!includesUploadLock && !includesColor) return badRequest(new Error("Provide prevent_agent_uploads or color."));
    if (includesUploadLock && typeof candidate.prevent_agent_uploads !== "boolean") {
      return badRequest(new Error("prevent_agent_uploads must be a boolean."));
    }
    const color = includesColor ? AssetBucketColorSchema.safeParse(candidate.color) : null;
    if (color && !color.success) return badRequest(color.error);
    try {
      return json(await updateAssetBucketSettings(entry.repo_path, params["bucketId"]!, {
        ...(includesUploadLock ? { prevent_agent_uploads: candidate.prevent_agent_uploads as boolean } : {}),
        ...(color?.success ? { color: color.data } : {}),
      }));
    } catch (error) {
      return badRequest(error);
    }
  });

  router.put("/api/project/:id/assets/buckets/:bucketId/parent", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const body = await readJsonBody<{ parent_id?: unknown }>(request);
    if (body.parent_id !== null && typeof body.parent_id !== "string") {
      return badRequest(new Error("parent_id must be a folder id or null."));
    }
    try {
      return json(await moveAssetBucket(entry.repo_path, params["bucketId"]!, body.parent_id));
    } catch (error) {
      return badRequest(error);
    }
  });

  router.delete("/api/project/:id/assets/buckets/:bucketId", async ({ params }) => {
    const entry = await requireProject(params["id"]!);
    try {
      return json(await deleteAssetBucket(entry.repo_path, params["bucketId"]!));
    } catch (error) {
      return badRequest(error);
    }
  });

  router.post("/api/project/:id/assets/items", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const body = await readJsonBody<{
      bucket_id?: string;
      name?: string;
      metadata?: unknown;
      upload?: AssetUploadInput;
    }>(request);
    if (!body.bucket_id || !body.name || !body.upload) {
      throw new ApiError("bucket_id, name, and upload are required.", {
        status: 400,
        code: "ASSET_FIELDS_REQUIRED",
      });
    }
    const metadata = AssetMetadataSchema.safeParse(body.metadata ?? {});
    if (!metadata.success) return badRequest(metadata.error);
    try {
      return json(
        await createManagedAsset(
          entry.repo_path,
          { bucket_id: body.bucket_id, name: body.name, metadata: metadata.data, upload: body.upload },
          { kind: "user" },
        ),
        201,
      );
    } catch (error) {
      return badRequest(error);
    }
  });

  router.put("/api/project/:id/assets/items/:assetId/metadata", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const body = await readJsonBody<unknown>(request);
    const metadata = AssetMetadataSchema.safeParse(body);
    if (!metadata.success) return badRequest(metadata.error);
    try {
      return json(await updateManagedAssetMetadata(entry.repo_path, params["assetId"]!, metadata.data));
    } catch (error) {
      return badRequest(error);
    }
  });

  router.put("/api/project/:id/assets/items/:assetId/bucket", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const body = await readJsonBody<{ bucket_id?: unknown }>(request);
    if (typeof body.bucket_id !== "string" || !body.bucket_id) {
      return badRequest(new Error("bucket_id must be a folder id."));
    }
    try {
      return json(await moveManagedAsset(entry.repo_path, params["assetId"]!, body.bucket_id));
    } catch (error) {
      return badRequest(error);
    }
  });

  router.delete("/api/project/:id/assets/items/:assetId", async ({ params }) => {
    const entry = await requireProject(params["id"]!);
    try {
      await deleteManagedAsset(entry.repo_path, params["assetId"]!);
      return json({ deleted: params["assetId"] });
    } catch (error) {
      return badRequest(error);
    }
  });

  router.post("/api/project/:id/assets/items/:assetId/variations", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const body = await readJsonBody<AssetUploadInput>(request);
    try {
      return json(
        await addAssetVariation(entry.repo_path, params["assetId"]!, body, { kind: "user" }),
        201,
      );
    } catch (error) {
      return badRequest(error);
    }
  });

  router.put(
    "/api/project/:id/assets/items/:assetId/variations/:variationId",
    async ({ params, request }) => {
      const entry = await requireProject(params["id"]!);
      const body = await readJsonBody<{ used?: boolean }>(request);
      if (typeof body.used !== "boolean") {
        throw new ApiError("used must be a boolean.", {
          status: 400,
          code: "ASSET_USED_REQUIRED",
        });
      }
      try {
        return json(
          await setAssetVariationUsed(
            entry.repo_path,
            params["assetId"]!,
            params["variationId"]!,
            body.used,
          ),
        );
      } catch (error) {
        return badRequest(error);
      }
    },
  );

  router.delete(
    "/api/project/:id/assets/items/:assetId/variations/:variationId",
    async ({ params }) => {
      const entry = await requireProject(params["id"]!);
      try {
        await deleteAssetVariation(
          entry.repo_path,
          params["assetId"]!,
          params["variationId"]!,
        );
        return json({ deleted: params["variationId"] });
      } catch (error) {
        return badRequest(error);
      }
    },
  );
}
