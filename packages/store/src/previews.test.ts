import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "konductor-previews-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

// Preview records share the host database, so the worker gets its own home.
test("preview instances round-trip and the live filter follows status", async () => {
  const child = Bun.spawn([process.execPath, "-e", `
    import * as store from ${JSON.stringify(new URL("./index.ts", import.meta.url).href)};
    import { expect } from "bun:test";
    const base = {
      project_id: "demo", repo_path: ${JSON.stringify(dir)}, branch: "feature/x", worktree_path: "/tmp/x", worktree_created: true,
      command: "bun run dev", status: "starting", transport: "tmux", session_name: "konductor", window_id: "@1", pane_id: "%1",
      exit_code: null, last_error: null, created_at: new Date().toISOString(), ready_at: null, stopped_at: null,
    };
    await store.putPreview({ ...base, id: "a", port: 4200 });
    await store.putPreview({ ...base, id: "b", port: 4201, project_id: "other" });
    expect((await store.listPreviews({ live: true })).map((p) => p.port).sort()).toEqual([4200, 4201]);
    expect((await store.listPreviews({ project_id: "demo" })).map((p) => p.id)).toEqual(["a"]);
    const stopped = await store.patchPreview("a", { status: "stopped", stopped_at: new Date().toISOString() });
    expect(stopped.status).toBe("stopped");
    expect((await store.listPreviews({ live: true })).map((p) => p.id)).toEqual(["b"]);
    expect((await store.getPreview("a"))?.status).toBe("stopped");
    await expect(store.patchPreview("zzz", { status: "dead" })).rejects.toThrow("not found");
  `], { env: { ...process.env, KONDUCTOR_HOME: join(dir, "home") }, stdout: "pipe", stderr: "pipe" });
  const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (exit !== 0) throw new Error(stderr);
});
