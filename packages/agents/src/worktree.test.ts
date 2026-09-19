import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  WorktreeError,
  ensureWorktree,
  isGitRepo,
  removeWorktree,
  worktreeBranch,
  worktreePath,
} from "./worktree.js";

async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(stderr);
  return stdout.trim();
}

// Worktrees are created as siblings of the repo, so each test owns a parent
// directory and puts the repo one level down.
let parent: string;
let repo: string;

beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), "konductor-worktree-"));
  repo = join(parent, "repo");
  await mkdir(repo);
  await git(repo, "init", "-q", "-b", "main");
  await git(repo, "config", "user.email", "test@example.test");
  await git(repo, "config", "user.name", "Test");
  await writeFile(join(repo, "README.md"), "# repo\n");
  await git(repo, "add", "README.md");
  await git(repo, "commit", "-q", "-m", "init");
});

afterEach(async () => {
  await rm(parent, { recursive: true, force: true });
});

describe("path helpers", () => {
  test("a worktree lives beside the repo and is named for the slug", () => {
    expect(worktreePath("/work/app", "fix-login")).toBe("/work/app-fix-login");
    expect(worktreePath("/work/app/", "fix-login")).toBe("/work/app-fix-login");
    expect(worktreePath("/work/app/../app", "x")).toBe("/work/app-x");
  });

  test("branches are namespaced under konductor/", () => {
    expect(worktreeBranch("fix-login")).toBe("konductor/fix-login");
  });
});

describe("isGitRepo", () => {
  test("is true inside a repository and false elsewhere", async () => {
    expect(await isGitRepo(repo)).toBe(true);
    const plain = join(parent, "plain");
    await mkdir(plain);
    expect(await isGitRepo(plain)).toBe(false);
    expect(await isGitRepo(join(parent, "missing"))).toBe(false);
  });
});

describe("ensureWorktree", () => {
  test("creates a checkout on a fresh branch with the repo's files", async () => {
    const worktree = await ensureWorktree(repo, "fix-login");
    expect(worktree).toEqual({
      path: join(parent, "repo-fix-login"),
      branch: "konductor/fix-login",
      created: true,
    });
    expect(await readFile(join(worktree.path, "README.md"), "utf-8")).toBe("# repo\n");
    expect(await git(worktree.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe("konductor/fix-login");
    expect(await git(repo, "worktree", "list")).toContain(basename(worktree.path));
  });

  test("reuses an existing worktree so a restarted agent keeps its work", async () => {
    const first = await ensureWorktree(repo, "fix-login");
    await writeFile(join(first.path, "wip.txt"), "in progress");
    const second = await ensureWorktree(repo, "fix-login");
    expect(second).toEqual({ ...first, created: false });
    expect(existsSync(join(second.path, "wip.txt"))).toBe(true);
  });

  test("re-attaches to an existing branch when its checkout was removed", async () => {
    const first = await ensureWorktree(repo, "fix-login");
    await writeFile(join(first.path, "wip.txt"), "committed");
    await git(first.path, "add", "wip.txt");
    await git(first.path, "commit", "-q", "-m", "wip");
    await removeWorktree(repo, first.path);
    expect(existsSync(first.path)).toBe(false);

    const again = await ensureWorktree(repo, "fix-login");
    expect(again.created).toBe(true);
    expect(await readFile(join(again.path, "wip.txt"), "utf-8")).toBe("committed");
  });

  test("gives parallel agents independent checkouts", async () => {
    const [a, b] = await Promise.all([
      ensureWorktree(repo, "agent-a"),
      ensureWorktree(repo, "agent-b"),
    ]);
    expect(a.path).not.toBe(b.path);
    expect(dirname(a.path)).toBe(parent);
    await writeFile(join(a.path, "only-a.txt"), "a");
    expect(existsSync(join(b.path, "only-a.txt"))).toBe(false);
  });

  test("refuses a directory that is not a git repository with an actionable message", async () => {
    const plain = join(parent, "plain");
    await mkdir(plain);
    const attempt = ensureWorktree(plain, "fix-login");
    await expect(attempt).rejects.toBeInstanceOf(WorktreeError);
    await expect(attempt).rejects.toThrow("git init");
  });
});

describe("removeWorktree", () => {
  test("removes the checkout and unregisters it from git", async () => {
    const worktree = await ensureWorktree(repo, "fix-login");
    await removeWorktree(repo, worktree.path);
    expect(existsSync(worktree.path)).toBe(false);
    expect(await git(repo, "worktree", "list")).not.toContain("repo-fix-login");
  });

  test("surfaces git's refusal as a WorktreeError", async () => {
    await expect(removeWorktree(repo, join(parent, "never-existed")))
      .rejects.toBeInstanceOf(WorktreeError);
  });
});
