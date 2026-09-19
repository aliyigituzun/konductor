import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export type Worktree = { path: string; branch: string; created: boolean };

async function git(repoPath: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["git", "-C", repoPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

export async function isGitRepo(repoPath: string): Promise<boolean> {
  const result = await git(repoPath, ["rev-parse", "--is-inside-work-tree"]);
  return result.code === 0 && result.stdout.trim() === "true";
}

/** Where an agent's isolated checkout goes: a sibling of the repo, named for the slug. */
export function worktreePath(repoPath: string, slug: string): string {
  const root = resolve(repoPath);
  return join(dirname(root), `${basename(root)}-${slug}`);
}

export function worktreeBranch(slug: string): string {
  return `konductor/${slug}`;
}

export class WorktreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorktreeError";
  }
}

/**
 * Give an agent its own checkout so parallel agents never write over each other.
 *
 * Reuses an existing worktree at the expected path rather than failing, so a
 * restarted agent picks up where the previous one left off.
 */
export async function ensureWorktree(repoPath: string, slug: string): Promise<Worktree> {
  if (!(await isGitRepo(repoPath))) {
    throw new WorktreeError(
      `${repoPath} is not a git repository, so this agent cannot be given an isolated ` +
        `worktree. Turn off "worktree" on the profile, or run \`git init\` first.`,
    );
  }

  const path = worktreePath(repoPath, slug);
  const branch = worktreeBranch(slug);

  if (existsSync(path)) return { path, branch, created: false };

  const branchExists =
    (await git(repoPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0;

  const args = branchExists
    ? ["worktree", "add", path, branch]
    : ["worktree", "add", "-b", branch, path];

  const result = await git(repoPath, args);
  if (result.code !== 0) {
    throw new WorktreeError(`git worktree add failed: ${result.stderr.trim()}`);
  }
  return { path, branch, created: true };
}

/** Remove an agent's worktree. Left to the operator after a merge, never automatic. */
export async function removeWorktree(repoPath: string, path: string): Promise<void> {
  const result = await git(repoPath, ["worktree", "remove", path]);
  if (result.code !== 0) {
    throw new WorktreeError(`git worktree remove failed: ${result.stderr.trim()}`);
  }
}

export type WorktreeEntry = { path: string; branch: string | null; head: string | null };

/** Every checkout of the repo, main working tree first, from `git worktree list --porcelain`. */
export async function listWorktrees(repoPath: string): Promise<WorktreeEntry[]> {
  const result = await git(repoPath, ["worktree", "list", "--porcelain"]);
  if (result.code !== 0) throw new WorktreeError(`git worktree list failed: ${result.stderr.trim()}`);
  const entries: WorktreeEntry[] = [];
  let current: WorktreeEntry | null = null;
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length), branch: null, head: null };
      entries.push(current);
    } else if (current && line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (current && line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    }
  }
  return entries;
}

export type GitBranchInfo = { name: string; current: boolean; remote: boolean; checked_out_at: string | null };

/**
 * Local branches plus remote-only branches (as `origin/x`), so a preview can be
 * started for work that has not been fetched into a local branch yet.
 */
export async function listBranches(repoPath: string): Promise<GitBranchInfo[]> {
  const worktrees = await listWorktrees(repoPath);
  const checkedOut = new Map(worktrees.filter((tree) => tree.branch).map((tree) => [tree.branch!, tree.path]));
  const currentBranch = worktrees[0]?.branch ?? null;

  const local = await git(repoPath, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  if (local.code !== 0) throw new WorktreeError(`git for-each-ref failed: ${local.stderr.trim()}`);
  const localNames = local.stdout.split("\n").map((name) => name.trim()).filter(Boolean);

  const remote = await git(repoPath, ["for-each-ref", "--format=%(refname:short)", "refs/remotes"]);
  const remoteNames = remote.code === 0
    ? remote.stdout.split("\n").map((name) => name.trim()).filter((name) => name && !name.endsWith("/HEAD"))
    : [];
  const localSet = new Set(localNames);

  return [
    ...localNames.map((name) => ({
      name,
      current: name === currentBranch,
      remote: false,
      checked_out_at: checkedOut.get(name) ?? null,
    })),
    ...remoteNames
      .filter((name) => !localSet.has(name.replace(/^[^/]+\//, "")))
      .map((name) => ({ name, current: false, remote: true, checked_out_at: null })),
  ];
}

/** Sibling directory used for a preview checkout of an arbitrary branch. */
export function previewWorktreePath(repoPath: string, branch: string): string {
  const root = resolve(repoPath);
  const slug = branch.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "branch";
  return join(dirname(root), `${basename(root)}-preview-${slug}`);
}

/**
 * A checkout of an existing branch for a preview. Reuses the working tree that already
 * has the branch (git refuses to check one branch out twice), otherwise adds a sibling
 * worktree. A remote-only `origin/x` gets a tracking branch `x`.
 */
export async function ensureBranchWorktree(repoPath: string, branch: string): Promise<Worktree> {
  if (!(await isGitRepo(repoPath))) {
    throw new WorktreeError(`${repoPath} is not a git repository, so no branch can be previewed.`);
  }
  const existing = (await listWorktrees(repoPath)).find((tree) => tree.branch === branch);
  if (existing) return { path: existing.path, branch, created: false };

  const localExists = (await git(repoPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0;
  const remoteExists = !localExists
    && (await git(repoPath, ["rev-parse", "--verify", "--quiet", `refs/remotes/${branch}`])).code === 0;
  if (!localExists && !remoteExists) {
    throw new WorktreeError(`Branch ${branch} does not exist in ${repoPath}.`);
  }

  const localName = remoteExists ? branch.replace(/^[^/]+\//, "") : branch;
  const path = previewWorktreePath(repoPath, localName);
  if (existsSync(path)) return { path, branch: localName, created: false };

  const args = remoteExists
    ? ["worktree", "add", "--track", "-b", localName, path, branch]
    : ["worktree", "add", path, branch];
  const result = await git(repoPath, args);
  if (result.code !== 0) {
    throw new WorktreeError(`git worktree add failed: ${result.stderr.trim()}`);
  }
  return { path, branch: localName, created: true };
}
