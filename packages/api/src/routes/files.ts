import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { ApiError, json, type Router } from "../router.js";
import { requireProject } from "./projects.js";

/** Directories the file tree never descends into. Build output and dependency trees are noise. */
export const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".turbo", ".cache"]);
const IGNORED_FILES = new Set([".DS_Store"]);

/** Text responses above this are refused; the viewer is for reading, not for downloading. */
export const MAX_TEXT_BYTES = 5 * 1024 * 1024;

export interface FileEntry {
  name: string;
  path: string;
  kind: "dir" | "file";
  size: number | null;
}

/** A search result is deliberately limited to file names and paths; file content stays private to the reader. */
export const MAX_FILE_SEARCH_RESULTS = 100;

function isDocument(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return extension === ".md" || extension === ".markdown" || extension === ".pdf";
}

type SizeComparator = "<" | "<=" | "=" | ">=" | ">";

interface FileSearchFilters {
  text: string;
  fileTypes: Set<string>;
  size: { comparator: SizeComparator; bytes: number } | null;
  modifiedSince: number | null;
}

function parseByteSize(value: string): number | null {
  const match = value.match(/^(\d+(?:\.\d+)?)(b|kb|mb|gb)?$/i);
  if (!match) return null;
  const unit = (match[2] ?? "b").toLowerCase();
  const multiplier = unit === "gb" ? 1024 ** 3 : unit === "mb" ? 1024 ** 2 : unit === "kb" ? 1024 : 1;
  return Number(match[1]) * multiplier;
}

function parseModifiedSince(value: string, now: number): number | null {
  if (value === "today") return new Date(new Date(now).setHours(0, 0, 0, 0)).getTime();
  const relative = value.match(/^(\d+)([dwmy])$/i);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = (relative[2] ?? "").toLowerCase();
    const milliseconds = unit === "d" ? 86_400_000 : unit === "w" ? 604_800_000 : unit === "m" ? 2_592_000_000 : 31_536_000_000;
    return now - amount * milliseconds;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Parse quiet path-search operators; unrecognised operators remain ordinary text. */
export function parseFileSearchFilters(query: string, now = Date.now()): FileSearchFilters {
  const fileTypes = new Set<string>();
  let size: FileSearchFilters["size"] = null;
  let modifiedSince: number | null = null;
  const text: string[] = [];

  for (const term of query.trim().split(/\s+/)) {
    if (!term) continue;
    const [key, value] = term.split(":", 2);
    if (key === "filetype" && value) {
      value.split(",").filter(Boolean).forEach((type) => fileTypes.add(type.replace(/^\./, "").toLowerCase()));
      continue;
    }
    if (key === "size" && value) {
      const match = value.match(/^(<=|>=|<|>|=)?(.+)$/);
      const bytes = match?.[2] ? parseByteSize(match[2]) : null;
      if (bytes !== null && match) {
        size = { comparator: (match[1] ?? "=") as SizeComparator, bytes };
        continue;
      }
    }
    if (key === "latest" && value) {
      const since = parseModifiedSince(value, now);
      if (since !== null) {
        modifiedSince = since;
        continue;
      }
    }
    text.push(term);
  }
  return { text: text.join(" ").toLocaleLowerCase(), fileTypes, size, modifiedSince };
}

function matchesSize(size: number, filter: FileSearchFilters["size"]): boolean {
  if (!filter) return true;
  if (filter.comparator === "<") return size < filter.bytes;
  if (filter.comparator === "<=") return size <= filter.bytes;
  if (filter.comparator === ">") return size > filter.bytes;
  if (filter.comparator === ">=") return size >= filter.bytes;
  return size === filter.bytes;
}

const CONTENT_TYPES: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
};

export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "text/plain; charset=utf-8";
}

/**
 * Resolve a caller-supplied relative path against a repo root.
 *
 * Any path that escapes the root (`../`, absolute paths, symlink-free traversal)
 * resolves to null. An empty path is the root itself.
 */
export function resolveRepoPath(repoPath: string, relPath: string): string | null {
  const root = resolve(repoPath);
  const target = resolve(root, relPath);
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

function relativeTo(root: string, target: string): string {
  return target === root ? "" : target.slice(root.length + 1).split(sep).join("/");
}

/** List one directory: dirs first, then files, both alphabetical, ignored names dropped. */
export async function listDirectory(repoPath: string, relPath: string): Promise<{ path: string; entries: FileEntry[] }> {
  const root = resolve(repoPath);
  const dir = resolveRepoPath(root, relPath);
  if (!dir || !existsSync(dir)) {
    throw new ApiError("Directory not found.", { status: 404, code: "DIR_NOT_FOUND" });
  }
  const dirents = await readdir(dir, { withFileTypes: true });
  const entries: FileEntry[] = [];
  for (const dirent of dirents) {
    const isDir = dirent.isDirectory();
    if (isDir && IGNORED_DIRS.has(dirent.name)) continue;
    if (!isDir && IGNORED_FILES.has(dirent.name)) continue;
    if (!isDir && !dirent.isFile()) continue;
    const full = resolve(dir, dirent.name);
    let size: number | null = null;
    if (!isDir) {
      try {
        size = (await stat(full)).size;
      } catch {
        size = null;
      }
    }
    entries.push({ name: dirent.name, path: relativeTo(root, full), kind: isDir ? "dir" : "file", size });
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return { path: relativeTo(root, dir), entries };
}

/**
 * Find repository files by path, without descending into the same generated and
 * dependency directories hidden by the explorer. Documents are listed first so
 * project notes remain easy to reach in a mixed result set.
 */
export async function searchFiles(repoPath: string, query: string): Promise<FileEntry[]> {
  const filters = parseFileSearchFilters(query);
  if (!filters.text && !filters.fileTypes.size && !filters.size && filters.modifiedSince === null) return [];

  const root = resolve(repoPath);
  const matches: FileEntry[] = [];

  async function visit(dir: string): Promise<void> {
    if (matches.length >= MAX_FILE_SEARCH_RESULTS) return;
    const dirents = await readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      if (matches.length >= MAX_FILE_SEARCH_RESULTS) return;
      if (dirent.isDirectory() && IGNORED_DIRS.has(dirent.name)) continue;
      if (!dirent.isDirectory() && IGNORED_FILES.has(dirent.name)) continue;
      const full = resolve(dir, dirent.name);
      if (dirent.isDirectory()) {
        await visit(full);
        continue;
      }
      if (!dirent.isFile()) continue;
      const path = relativeTo(root, full);
      if (filters.text && !path.toLocaleLowerCase().includes(filters.text)) continue;
      const extension = extname(path).slice(1).toLowerCase();
      if (filters.fileTypes.size && !filters.fileTypes.has(extension)) continue;
      let size: number | null = null;
      let modifiedAt: number | null = null;
      try {
        const info = await stat(full);
        size = info.size;
        modifiedAt = info.mtimeMs;
      } catch {
        // A file disappearing during search should not fail every result.
      }
      if (filters.size && (size === null || !matchesSize(size, filters.size))) continue;
      if (filters.modifiedSince !== null && (modifiedAt === null || modifiedAt < filters.modifiedSince)) continue;
      matches.push({ name: dirent.name, path, kind: "file", size });
    }
  }

  await visit(root);
  return matches.sort((a, b) => {
    const documentOrder = Number(isDocument(b.path)) - Number(isDocument(a.path));
    return documentOrder || a.path.localeCompare(b.path, undefined, { sensitivity: "base" });
  });
}

export function registerFileRoutes(router: Router): void {
  router.get("/api/project/:id/files", async ({ params, url }) => {
    const entry = await requireProject(params["id"]!);
    return json(await listDirectory(entry.repo_path, url.searchParams.get("path") ?? ""));
  });

  router.get("/api/project/:id/files/search", async ({ params, url }) => {
    const entry = await requireProject(params["id"]!);
    return json({ files: await searchFiles(entry.repo_path, url.searchParams.get("q") ?? "") });
  });

  router.get("/api/project/:id/file", async ({ params, url }) => {
    const entry = await requireProject(params["id"]!);
    const relPath = url.searchParams.get("path");
    if (!relPath) {
      throw new ApiError("Missing `path` query parameter.", { status: 400, code: "MISSING_PATH" });
    }
    const filePath = resolveRepoPath(entry.repo_path, relPath);
    if (!filePath || !existsSync(filePath)) {
      throw new ApiError("File not found.", { status: 404, code: "FILE_NOT_FOUND" });
    }
    const info = await stat(filePath);
    if (!info.isFile()) {
      throw new ApiError("Not a file.", { status: 400, code: "NOT_A_FILE" });
    }
    const contentType = contentTypeFor(filePath);
    if (contentType.startsWith("text/") && info.size > MAX_TEXT_BYTES) {
      throw new ApiError("File is too large to view.", { status: 413, code: "FILE_TOO_LARGE" });
    }
    return new Response(await readFile(filePath), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(info.size),
        "Cache-Control": "no-store",
      },
    });
  });
}
