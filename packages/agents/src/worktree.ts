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
