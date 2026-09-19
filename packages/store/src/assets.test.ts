import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { repoLocal } from "./paths.js";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  addAssetVariation,
  createAssetBucket,
  createManagedAsset,
  deleteAssetBucket,
  deleteAssetVariation,
  deleteManagedAsset,
  moveAssetBucket,
  moveManagedAsset,
  readAgentAssetContext,
  readAssetLibrary,
  setAssetVariationUsed,
  updateAssetBucketMetadata,
  updateManagedAssetMetadata,
} from "./assets.js";

describe("asset library", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "konductor-assets-"));
    await writeFile(join(cwd, "a.png"), "variation-a");
    await writeFile(join(cwd, "b.png"), "variation-b");
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test("stores multiple independently-used variations on one logical asset", async () => {
    const bucket = await createAssetBucket(cwd, { title: "Checkout" });
    const asset = await createManagedAsset(cwd, {
      bucket_id: bucket.id,
      name: "Hero render",
      upload: { file_name: "a.png", source_project_path: "a.png", used: true },
    }, { kind: "user" });
    const second = await addAssetVariation(cwd, asset.id, {
      file_name: "b.png",
      source_project_path: "b.png",
      variation_name: "B",
      used: true,
    }, { kind: "agent", run_id: "run-1", profile_id: "codex" });

    const stored = await readAssetLibrary(cwd);
    expect(stored.assets[0]?.variations).toHaveLength(2);
    expect(stored.assets[0]?.variations.every((item) => item.used)).toBe(true);
    expect(second.approval).toBe("pending");
    expect(second.originating_run_id).toBe("run-1");

    await setAssetVariationUsed(cwd, asset.id, second.id, false);
    expect((await readAssetLibrary(cwd)).assets[0]?.variations.map((item) => item.used)).toEqual([true, false]);

    await deleteAssetVariation(cwd, asset.id, second.id);
    expect((await readAssetLibrary(cwd)).assets[0]?.variations).toHaveLength(1);
  });

  test("only exposes opted-in category and asset metadata to agents", async () => {
    const bucket = await createAssetBucket(cwd, {
      title: "Models",
      metadata: { description: "private category", expose_to_agents: false },
    });
    const asset = await createManagedAsset(cwd, {
      bucket_id: bucket.id,
      name: "Ship",
      metadata: { description: "private asset", expose_to_agents: false },
      upload: { file_name: "a.png", source_project_path: "a.png" },
    }, { kind: "user" });

    let context = await readAgentAssetContext(cwd);
    expect(context.buckets.find((item) => item.id === bucket.id)?.metadata.description).toBe("");
    expect(context.assets.find((item) => item.id === asset.id)?.metadata.description).toBe("");

    await updateAssetBucketMetadata(cwd, bucket.id, {
      description: "Use for checkout scenes",
      tags: ["checkout"],
      fields: { owner: "design" },
      expose_to_agents: true,
    });
    await updateManagedAssetMetadata(cwd, asset.id, {
      description: "Primary ship model",
      tags: ["3d"],
      fields: { format: "blend" },
      expose_to_agents: true,
    });

    context = await readAgentAssetContext(cwd);
    expect(context.buckets.find((item) => item.id === bucket.id)?.metadata.description).toBe("Use for checkout scenes");
    expect(context.assets.find((item) => item.id === asset.id)?.metadata.fields).toEqual({ format: "blend" });
  });

  test("rejects source files outside the project", async () => {
    const bucket = await createAssetBucket(cwd, { title: "Imports" });
    const outsidePath = `${cwd}-outside.txt`;
    await writeFile(outsidePath, "outside");

    try {
      await expect(createManagedAsset(cwd, {
        bucket_id: bucket.id,
        name: "Escaped file",
        upload: { file_name: "outside.txt", source_project_path: `../${basename(outsidePath)}` },
      }, { kind: "user" })).rejects.toThrow("Asset source path must stay inside the project");
    } finally {
      await rm(outsidePath, { force: true });
    }

    expect((await readAssetLibrary(cwd)).assets).toHaveLength(0);
  });

  test("imports legacy metadata once and preserves concurrent uploads and edits", async () => {
    const paths = repoLocal(cwd);
    await mkdir(paths.assetsDir, { recursive: true });
    const legacy = JSON.stringify({ schema_version: "0.1.0", buckets: [], assets: [], updated_at: new Date().toISOString() });
    await writeFile(paths.assetsIndex, legacy);
    const bucket = await createAssetBucket(cwd, { title: "Images" });
    const assets = await Promise.all(Array.from({ length: 6 }, () => createManagedAsset(cwd, {
      bucket_id: bucket.id, name: "Same name", upload: { file_name: "a.png", source_project_path: "a.png" },
    }, { kind: "user" })));
    expect(new Set(assets.map((asset) => asset.id)).size).toBe(6);
    const asset = assets[0]!;
    await Promise.all([
      ...Array.from({ length: 6 }, () => addAssetVariation(cwd, asset.id, {
        file_name: "b.png", source_project_path: "b.png",
      }, { kind: "user" })),
      updateManagedAssetMetadata(cwd, asset.id, { description: "Keep this edit" }),
    ]);
    const saved = (await readAssetLibrary(cwd)).assets.find((item) => item.id === asset.id)!;
    expect(saved.variations).toHaveLength(7);
    expect(saved.metadata.description).toBe("Keep this edit");
    expect(await readFile(paths.assetsIndex, "utf-8")).toBe(legacy);
    await deleteManagedAsset(cwd, asset.id);
    expect((await readAssetLibrary(cwd)).assets).toHaveLength(5);
    for (const variation of saved.variations) expect(await Bun.file(join(cwd, variation.storage_path)).exists()).toBe(false);
  });

  test("nests folders, moves items between them, and deletes subtrees into the root archive", async () => {
    const models = await createAssetBucket(cwd, { title: "3D" });
    const characters = await createAssetBucket(cwd, { title: "Characters", parent_id: models.id });
    const heroes = await createAssetBucket(cwd, { title: "Heroes", parent_id: characters.id });
    expect(models.parent_id).toBe(null);
    expect(characters.parent_id).toBe(models.id);
    await expect(createAssetBucket(cwd, { title: "Orphan", parent_id: "missing" })).rejects.toThrow("was not found");
    await expect(createAssetBucket(cwd, { title: "Loose", parent_id: "uncategorized" })).rejects.toThrow("null parent");

    const asset = await createManagedAsset(cwd, {
      bucket_id: heroes.id, name: "Knight", upload: { file_name: "a.png", source_project_path: "a.png" },
    }, { kind: "user" });
    expect((await moveManagedAsset(cwd, asset.id, models.id)).bucket_id).toBe(models.id);
    await expect(moveManagedAsset(cwd, asset.id, "missing")).rejects.toThrow("was not found");
    expect((await moveManagedAsset(cwd, asset.id, heroes.id)).bucket_id).toBe(heroes.id);

    await expect(moveAssetBucket(cwd, models.id, heroes.id)).rejects.toThrow("into itself");
    await expect(moveAssetBucket(cwd, models.id, models.id)).rejects.toThrow("into itself");
    await expect(moveAssetBucket(cwd, "uncategorized", models.id)).rejects.toThrow("cannot be moved");
    expect((await moveAssetBucket(cwd, heroes.id, null)).parent_id).toBe(null);
    expect((await moveAssetBucket(cwd, heroes.id, characters.id)).parent_id).toBe(characters.id);

    expect(await deleteAssetBucket(cwd, models.id)).toEqual({ moved_assets: 1, deleted_folders: 3 });
    const library = await readAssetLibrary(cwd);
    expect(library.buckets.map((item) => item.id)).toEqual(["uncategorized"]);
    expect(library.assets[0]?.bucket_id).toBe("uncategorized");
    await expect(deleteAssetBucket(cwd, "uncategorized")).rejects.toThrow("cannot be deleted");
  });

  test("reads folders saved before parent_id existed as root folders", async () => {
    const paths = repoLocal(cwd);
    await mkdir(paths.assetsDir, { recursive: true });
    const bucket = { id: "legacy", title: "Legacy", preset: "no_relation", instruction: "", path: null, accepted_types: [], prevent_agent_uploads: false, created_at: new Date().toISOString() };
    await writeFile(paths.assetsIndex, JSON.stringify({ schema_version: "0.1.0", buckets: [bucket], assets: [], updated_at: new Date().toISOString() }));
    expect((await readAssetLibrary(cwd)).buckets.find((item) => item.id === "legacy")?.parent_id).toBe(null);
  });
});
