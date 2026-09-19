import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import {
  AssetLibrarySchema,
  AssetMetadataSchema,
  type AssetBucket,
  type AssetLibrary,
  type AssetMetadata,
  type AssetVariation,
  type ManagedAsset,
} from "@konductor/schema";
import { repoLocal } from "./paths.js";
import { withDatabase, importDocument, readDocument, writeDocument } from "./database.js";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const UNCATEGORIZED_BUCKET_ID = "uncategorized";

export type AssetActor = {
  kind: "user" | "agent" | "import";
  run_id?: string | null;
  profile_id?: string | null;
};

export type AssetUploadInput = {
  file_name: string;
  media_type?: string;
  content_base64?: string;
  source_project_path?: string;
  variation_name?: string;
  used?: boolean;
};

export type AssetMetadataInput = Partial<AssetMetadata>;

function now(): string {
  return new Date().toISOString();
}

function emptyLibrary(): AssetLibrary {
  return { schema_version: "0.1.0", buckets: [], assets: [], updated_at: now() };
}

function uncategorizedBucket(): AssetBucket {
  return {
    id: UNCATEGORIZED_BUCKET_ID,
    parent_id: null,
    title: "Uncategorized",
    color: "gray",
    preset: "no_relation",
    instruction: "Loose assets at the library root are kept here.",
    path: null,
    accepted_types: [],
    prevent_agent_uploads: false,
    metadata: normalizeMetadata(undefined),
    created_at: now(),
  };
}

function ensureUncategorized(library: AssetLibrary): boolean {
  if (library.buckets.some((bucket) => bucket.id === UNCATEGORIZED_BUCKET_ID)) return false;
  library.buckets.push(uncategorizedBucket());
  return true;
}

function safeSegment(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function uniqueId(taken: Iterable<string>, value: string, fallback: string): string {
  const existing = new Set(taken);
  const root = safeSegment(value, fallback);
  if (!existing.has(root)) return root;
  for (let index = 2; ; index += 1) {
    const candidate = `${root}-${index}`;
    if (!existing.has(candidate)) return candidate;
  }
}

/** Folder chain from the root down to `bucketId` (inclusive). Unknown ids yield []. */
export function bucketAncestors(library: AssetLibrary, bucketId: string): AssetBucket[] {
  const byId = new Map(library.buckets.map((bucket) => [bucket.id, bucket]));
  const chain: AssetBucket[] = [];
  const seen = new Set<string>();
  let current = byId.get(bucketId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return chain;
}

/** Ids of every folder nested under `bucketId`, at any depth. */
export function bucketDescendantIds(library: AssetLibrary, bucketId: string): string[] {
  const result: string[] = [];
  const queue = [bucketId];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const bucket of library.buckets) {
      if (bucket.parent_id === parent && !result.includes(bucket.id)) {
        result.push(bucket.id);
        queue.push(bucket.id);
      }
    }
  }
  return result;
}

function assertParentFolder(library: AssetLibrary, parentId: string | null): void {
  if (parentId === null) return;
  if (parentId === UNCATEGORIZED_BUCKET_ID) throw new Error("Root folders use a null parent.");
  if (!library.buckets.some((item) => item.id === parentId)) throw new Error(`Asset folder "${parentId}" was not found.`);
}

function normalizeMetadata(input: AssetMetadataInput | undefined): AssetMetadata {
  return AssetMetadataSchema.parse({
    description: input?.description ?? "",
    tags: input?.tags ?? [],
    fields: input?.fields ?? {},
    expose_to_agents: input?.expose_to_agents ?? false,
  });
}

function mutateLibrary<T>(cwd: string, mutate: (library: AssetLibrary) => T): T {
  const paths = repoLocal(cwd);
  return withDatabase(paths.database, (db) => {
    importDocument(db, "assets", paths.assetsIndex, AssetLibrarySchema.parse);
    return db.transaction(() => {
      const library = readDocument(db, "assets", AssetLibrarySchema.parse) ?? emptyLibrary();
      const result = mutate(library);
      writeDocument(db, "assets", AssetLibrarySchema.parse({ ...library, updated_at: now() }));
      return result;
    }).immediate();
  });
}

export async function readAssetLibrary(cwd: string): Promise<AssetLibrary> {
  const paths = repoLocal(cwd);
  return withDatabase(paths.database, (db) => {
    importDocument(db, "assets", paths.assetsIndex, AssetLibrarySchema.parse);
    const library = readDocument(db, "assets", AssetLibrarySchema.parse) ?? emptyLibrary();
    if (ensureUncategorized(library)) writeDocument(db, "assets", AssetLibrarySchema.parse({ ...library, updated_at: now() }));
    return library;
  });
}

export async function createAssetBucket(
  cwd: string,
  input: {
    title: string;
    parent_id?: string | null;
    color?: AssetBucket["color"];
    preset?: AssetBucket["preset"];
    instruction?: string;
    path?: string | null;
    accepted_types?: string[];
    prevent_agent_uploads?: boolean;
    metadata?: AssetMetadataInput;
  },
): Promise<AssetBucket> {
  return mutateLibrary(cwd, (library) => {
    const title = input.title.trim();
    if (!title) throw new Error("Folder title is required.");
    const parentId = input.parent_id ?? null;
    assertParentFolder(library, parentId);
    const bucket: AssetBucket = {
      id: uniqueId(library.buckets.map((item) => item.id), title, "folder"),
      parent_id: parentId,
      title,
      color: input.color ?? "gray",
      preset: input.preset ?? "no_relation",
      instruction: input.instruction?.trim() ?? "",
      path: input.path?.trim() || null,
      accepted_types: input.accepted_types ?? [],
      prevent_agent_uploads: input.prevent_agent_uploads ?? false,
      metadata: normalizeMetadata(input.metadata),
      created_at: now(),
    };
    Object.assign(library, { ...library, buckets: [...library.buckets, bucket] });
    return bucket;
  });
}

export async function updateAssetBucketMetadata(
  cwd: string,
  bucketId: string,
  metadata: AssetMetadataInput,
): Promise<AssetBucket> {
  return mutateLibrary(cwd, (library) => {
    const current = library.buckets.find((item) => item.id === bucketId);
    if (!current) throw new Error(`Asset folder "${bucketId}" was not found.`);
    const updated = { ...current, metadata: normalizeMetadata(metadata) };
    Object.assign(library, {
      ...library,
      buckets: library.buckets.map((item) => item.id === bucketId ? updated : item),
  });
  return updated;
  });
}

async function readUpload(cwd: string, input: AssetUploadInput): Promise<Buffer> {
  if (input.content_base64 !== undefined && input.source_project_path) {
    throw new Error("Provide either uploaded content or a project source path, not both.");
  }
  if (input.content_base64 !== undefined) {
    const compact = input.content_base64.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) throw new Error("Upload is not valid base64.");
    const value = Buffer.from(compact, "base64");
    if (value.byteLength > MAX_UPLOAD_BYTES) throw new Error("Asset upload exceeds the 25 MB limit.");
    return value;
  }
  if (input.source_project_path) {
    const root = await realpath(cwd);
    const source = await realpath(resolve(root, input.source_project_path));
    if (source !== root && !source.startsWith(root + sep)) {
      throw new Error("Asset source path must stay inside the project.");
    }
    const info = await stat(source);
    if (!info.isFile()) throw new Error("Asset source path must point to a file.");
    if (info.size > MAX_UPLOAD_BYTES) throw new Error("Asset upload exceeds the 25 MB limit.");
    return readFile(source);
  }
  throw new Error("Uploaded content or a source project path is required.");
}

async function buildVariation(
  cwd: string,
  bucketId: string,
  assetId: string,
  input: AssetUploadInput,
  actor: AssetActor,
): Promise<AssetVariation> {
  const content = await readUpload(cwd, input);
  const id = randomUUID();
  const originalName = basename(input.file_name.trim() || "asset.bin");
  const extension = extname(originalName).toLowerCase();
  const stem = safeSegment(originalName.slice(0, extension ? -extension.length : undefined), "asset");
  const fileName = `${id}-${stem}${extension}`;
  const target = resolve(repoLocal(cwd).assetsFilesDir, safeSegment(bucketId, "category"), assetId, fileName);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
  return {
    id,
    name: input.variation_name?.trim() || originalName,
    file_name: originalName,
    storage_path: relative(cwd, target),
    media_type: input.media_type?.trim() || "application/octet-stream",
    content_hash: createHash("sha256").update(content).digest("hex"),
    size_bytes: content.byteLength,
    used: input.used ?? false,
    approval: actor.kind === "agent" ? "pending" : "approved",
    created_at: now(),
    created_by: actor.kind,
    originating_run_id: actor.run_id ?? null,
    originating_profile_id: actor.profile_id ?? null,
  };
}

function assertAgentUploadAllowed(bucket: AssetBucket, actor: AssetActor): void {
  if (actor.kind === "agent" && bucket.prevent_agent_uploads) {
    throw new Error(`Agent uploads are disabled for folder "${bucket.title}".`);
  }
}

export async function createManagedAsset(
  cwd: string,
  input: { bucket_id: string; name: string; metadata?: AssetMetadataInput; upload: AssetUploadInput },
  actor: AssetActor,
): Promise<ManagedAsset> {
  const name = input.name.trim();
  if (!name) throw new Error("Asset name is required.");
  const initial = await readAssetLibrary(cwd);
  const bucket = initial.buckets.find((item) => item.id === input.bucket_id);
  if (!bucket) {
    throw new Error(`Asset folder "${input.bucket_id}" was not found.`);
  }
  assertAgentUploadAllowed(bucket, actor);
  // UUID storage directories avoid concurrent name allocation collisions.
  const variation = await buildVariation(cwd, input.bucket_id, randomUUID(), input.upload, actor);
  try {
    return mutateLibrary(cwd, (library) => {
      if (!library.buckets.some((item) => item.id === input.bucket_id)) {
        throw new Error(`Asset folder "${input.bucket_id}" was not found.`);
      }
      const createdAt = now();
      const asset: ManagedAsset = {
        id: uniqueId(library.assets.map((item) => item.id), name, "asset"),
        bucket_id: input.bucket_id, name, metadata: normalizeMetadata(input.metadata),
        variations: [variation], created_at: createdAt, updated_at: createdAt,
      };
      library.assets.push(asset);
      return asset;
    });
  } catch (error) {
    await removeStoredVariation(cwd, variation);
    throw error;
  }
}

export async function addAssetVariation(
  cwd: string, assetId: string, input: AssetUploadInput, actor: AssetActor,
): Promise<AssetVariation> {
  const initial = await readAssetLibrary(cwd);
  const asset = initial.assets.find((item) => item.id === assetId);
  if (!asset) throw new Error(`Asset "${assetId}" was not found.`);
  const bucket = initial.buckets.find((item) => item.id === asset.bucket_id);
  if (!bucket) throw new Error(`Asset folder "${asset.bucket_id}" was not found.`);
  assertAgentUploadAllowed(bucket, actor);
  const variation = await buildVariation(cwd, asset.bucket_id, randomUUID(), input, actor);
  try {
    return mutateLibrary(cwd, (library) => {
      const current = library.assets.find((item) => item.id === assetId);
      if (!current || current.created_at !== asset.created_at) throw new Error(`Asset "${assetId}" was removed.`);
      current.variations.push(variation);
      current.updated_at = now();
      return variation;
    });
  } catch (error) {
    await removeStoredVariation(cwd, variation);
    throw error;
  }
}

export async function setAssetVariationUsed(
  cwd: string,
  assetId: string,
  variationId: string,
  used: boolean,
): Promise<AssetVariation> {
  return mutateLibrary(cwd, (library) => {
  const asset = library.assets.find((item) => item.id === assetId);
  const variation = asset?.variations.find((item) => item.id === variationId);
  if (!asset || !variation) throw new Error(`Asset variation "${variationId}" was not found.`);
  const updatedVariation = { ...variation, used };
  const updatedAsset = {
    ...asset,
    variations: asset.variations.map((item) => item.id === variationId ? updatedVariation : item),
    updated_at: now(),
  };
  Object.assign(library, {
    ...library,
    assets: library.assets.map((item) => item.id === assetId ? updatedAsset : item),
  });
  return updatedVariation;
  });
}

function storedVariationPath(cwd: string, variation: AssetVariation): string {
  const filesRoot = resolve(repoLocal(cwd).assetsFilesDir);
  const target = resolve(cwd, variation.storage_path);
  if (target !== filesRoot && !target.startsWith(filesRoot + sep)) {
    throw new Error("Refusing to delete an asset file outside managed storage.");
  }
  return target;
}

async function removeStoredVariation(cwd: string, variation: AssetVariation): Promise<void> {
  await rm(storedVariationPath(cwd, variation), { force: true });
}

export async function deleteAssetVariation(
  cwd: string, assetId: string, variationId: string,
): Promise<void> {
  const removed = mutateLibrary(cwd, (library) => {
    const asset = library.assets.find((item) => item.id === assetId);
    const variation = asset?.variations.find((item) => item.id === variationId);
    if (!asset || !variation) throw new Error(`Asset variation "${variationId}" was not found.`);
    storedVariationPath(cwd, variation);
    asset.variations = asset.variations.filter((item) => item.id !== variationId);
    asset.updated_at = now();
    return variation;
  });
  await removeStoredVariation(cwd, removed);
}

export async function updateManagedAssetMetadata(
  cwd: string,
  assetId: string,
  metadata: AssetMetadataInput,
): Promise<ManagedAsset> {
  return mutateLibrary(cwd, (library) => {
    const asset = library.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error(`Asset "${assetId}" was not found.`);
    const updated = { ...asset, metadata: normalizeMetadata(metadata), updated_at: now() };
    Object.assign(library, {
      ...library,
      assets: library.assets.map((item) => item.id === assetId ? updated : item),
  });
  return updated;
  });
}

export async function updateAssetBucketSettings(
  cwd: string,
  bucketId: string,
  input: { prevent_agent_uploads?: boolean; color?: AssetBucket["color"] },
): Promise<AssetBucket> {
  return mutateLibrary(cwd, (library) => {
    const bucket = library.buckets.find((item) => item.id === bucketId);
    if (!bucket) throw new Error(`Asset folder "${bucketId}" was not found.`);
    const preventAgentUploads = input.prevent_agent_uploads ?? bucket.prevent_agent_uploads;
    if (bucket.id === UNCATEGORIZED_BUCKET_ID && preventAgentUploads) {
      throw new Error("The root archive cannot block agent uploads because it is the fallback destination.");
    }
    const updated = { ...bucket, prevent_agent_uploads: preventAgentUploads, color: input.color ?? bucket.color };
    library.buckets = library.buckets.map((item) => item.id === bucketId ? updated : item);
    return updated;
  });
}

export async function moveAssetBucket(cwd: string, bucketId: string, parentId: string | null): Promise<AssetBucket> {
  return mutateLibrary(cwd, (library) => {
    if (bucketId === UNCATEGORIZED_BUCKET_ID) throw new Error("The root archive cannot be moved.");
    const bucket = library.buckets.find((item) => item.id === bucketId);
    if (!bucket) throw new Error(`Asset folder "${bucketId}" was not found.`);
    assertParentFolder(library, parentId);
    if (parentId === bucketId || (parentId && bucketDescendantIds(library, bucketId).includes(parentId))) {
      throw new Error("A folder cannot be moved into itself.");
    }
    const updated = { ...bucket, parent_id: parentId };
    library.buckets = library.buckets.map((item) => item.id === bucketId ? updated : item);
    return updated;
  });
}

export async function moveManagedAsset(cwd: string, assetId: string, bucketId: string): Promise<ManagedAsset> {
  return mutateLibrary(cwd, (library) => {
    const asset = library.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error(`Asset "${assetId}" was not found.`);
    if (!library.buckets.some((item) => item.id === bucketId)) throw new Error(`Asset folder "${bucketId}" was not found.`);
    const updated = { ...asset, bucket_id: bucketId, updated_at: now() };
    library.assets = library.assets.map((item) => item.id === assetId ? updated : item);
    return updated;
  });
}

/** Deletes a folder and every folder nested under it; their assets move to the root archive. */
export async function deleteAssetBucket(cwd: string, bucketId: string): Promise<{ moved_assets: number; deleted_folders: number }> {
  return mutateLibrary(cwd, (library) => {
    if (bucketId === UNCATEGORIZED_BUCKET_ID) throw new Error("The root archive cannot be deleted.");
    const bucket = library.buckets.find((item) => item.id === bucketId);
    if (!bucket) throw new Error(`Asset folder "${bucketId}" was not found.`);
    const removed = new Set([bucketId, ...bucketDescendantIds(library, bucketId)]);
    const movedAssets = library.assets.filter((asset) => removed.has(asset.bucket_id)).length;
    library.assets = library.assets.map((asset) => removed.has(asset.bucket_id) ? { ...asset, bucket_id: UNCATEGORIZED_BUCKET_ID, updated_at: now() } : asset);
    library.buckets = library.buckets.filter((item) => !removed.has(item.id));
    return { moved_assets: movedAssets, deleted_folders: removed.size };
  });
}

export async function deleteManagedAsset(cwd: string, assetId: string): Promise<void> {
  const removed = mutateLibrary(cwd, (library) => {
    const asset = library.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error(`Asset "${assetId}" was not found.`);
    for (const variation of asset.variations) storedVariationPath(cwd, variation);
    library.assets = library.assets.filter((item) => item.id !== assetId);
    return asset.variations;
  });
  for (const variation of removed) await removeStoredVariation(cwd, variation);
}

/** Agent-facing context strips metadata unless its owner opted into exposure. */
export async function readAgentAssetContext(cwd: string): Promise<AssetLibrary> {
  const library = await readAssetLibrary(cwd);
  return {
    ...library,
    buckets: library.buckets.map((bucket) => ({
      ...bucket,
      metadata: bucket.metadata.expose_to_agents ? bucket.metadata : normalizeMetadata(undefined),
    })),
    assets: library.assets.map((asset) => ({
      ...asset,
      metadata: asset.metadata.expose_to_agents ? asset.metadata : normalizeMetadata(undefined),
    })),
  };
}
