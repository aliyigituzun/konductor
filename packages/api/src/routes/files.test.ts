import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentTypeFor, listDirectory, parseFileSearchFilters, resolveRepoPath, searchFiles } from "./files.js";

async function fixtureRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "konductor-files-"));
  await mkdir(join(root, "src"));
  await mkdir(join(root, "node_modules", "dep"), { recursive: true });
  await mkdir(join(root, ".git"));
  await writeFile(join(root, "README.md"), "# hi");
  await writeFile(join(root, "zeta.txt"), "z");
  await writeFile(join(root, ".DS_Store"), "");
  await writeFile(join(root, "src", "index.ts"), "export {};");
  await mkdir(join(root, "notes"));
  await writeFile(join(root, "notes", "guide.md"), "# guide");
  await writeFile(join(root, "notes", "guide.ts"), "export {};");
  return root;
}

describe("resolveRepoPath", () => {
  test("keeps paths inside the root", () => {
    expect(resolveRepoPath("/repo", "docs/a.md")).toBe("/repo/docs/a.md");
    expect(resolveRepoPath("/repo", "")).toBe("/repo");
  });

  test("rejects traversal and absolute paths", () => {
    expect(resolveRepoPath("/repo", "../etc/passwd")).toBeNull();
    expect(resolveRepoPath("/repo", "docs/../../x")).toBeNull();
    expect(resolveRepoPath("/repo", "/etc/passwd")).toBeNull();
    // A sibling whose name merely starts with the root's name is still outside.
    expect(resolveRepoPath("/repo", "../repo2/x")).toBeNull();
  });
});

describe("searchFiles", () => {
  test("finds nested file paths, excludes ignored directories, and prioritizes documents", async () => {
    const root = await fixtureRepo();
    await writeFile(join(root, "node_modules", "dep", "guide.md"), "hidden");

    const files = await searchFiles(root, "guide");

    expect(files.map((file) => file.path)).toEqual(["notes/guide.md", "notes/guide.ts"]);
  });

  test("returns no results for an empty query", async () => {
    expect(await searchFiles(await fixtureRepo(), "   ")).toEqual([]);
  });

  test("filters by file type, byte size, and latest modification time", async () => {
    const root = await fixtureRepo();
    const recent = join(root, "notes", "recent.md");
    await writeFile(recent, "a".repeat(2_048));
    await utimes(recent, new Date(), new Date());
    await utimes(join(root, "notes", "guide.md"), new Date("2020-01-01"), new Date("2020-01-01"));

    expect((await searchFiles(root, "filetype:md size:>1kb latest:7d")).map((file) => file.path)).toEqual(["notes/recent.md"]);
  });
});

describe("parseFileSearchFilters", () => {
  test("keeps free text while extracting valid quiet filters", () => {
    const filters = parseFileSearchFilters("guide filetype:.md,pdf size:<=2kb latest:2026-09-10", Date.parse("2026-09-18"));
    expect(filters.text).toBe("guide");
    expect([...filters.fileTypes]).toEqual(["md", "pdf"]);
    expect(filters.size).toEqual({ comparator: "<=", bytes: 2_048 });
    expect(filters.modifiedSince).toBe(Date.parse("2026-09-10"));
  });
});

describe("listDirectory", () => {
  test("lists dirs first, drops ignored names, and reports relative paths", async () => {
    const root = await fixtureRepo();
    const { path, entries } = await listDirectory(root, "");
    expect(path).toBe("");
    expect(entries.map((e) => e.name)).toEqual(["notes", "src", "README.md", "zeta.txt"]);
    expect(entries[0]).toMatchObject({ kind: "dir", path: "notes", size: null });
    expect(entries[2]).toMatchObject({ kind: "file", path: "README.md", size: 4 });
  });

  test("lists a nested directory", async () => {
    const root = await fixtureRepo();
    const { path, entries } = await listDirectory(root, "src");
    expect(path).toBe("src");
    expect(entries).toEqual([{ name: "index.ts", path: "src/index.ts", kind: "file", size: 10 }]);
  });

  test("refuses to escape the root", async () => {
    const root = await fixtureRepo();
    await expect(listDirectory(root, "../")).rejects.toMatchObject({ code: "DIR_NOT_FOUND" });
  });
});

describe("contentTypeFor", () => {
  test("maps known extensions and falls back to text", () => {
    expect(contentTypeFor("a.md")).toBe("text/markdown; charset=utf-8");
    expect(contentTypeFor("a.PNG")).toBe("image/png");
    expect(contentTypeFor("a.pdf")).toBe("application/pdf");
    expect(contentTypeFor("a.tsx")).toBe("text/plain; charset=utf-8");
    expect(contentTypeFor("Makefile")).toBe("text/plain; charset=utf-8");
  });
});
