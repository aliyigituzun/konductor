import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * End-to-end coverage of the dashboard route table.
 *
 * The routes read the machine-level registry, so each scenario runs in a child
 * process with its own KONDUCTOR_HOME. The worker seeds one registered project,
 * points the host state at a closed port (so proxied routes fall back rather than
 * reaching a real daemon), and then drives `createApiRouter()` with plain Requests.
 */

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "konductor-api-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

async function worker(code: string): Promise<void> {
  const child = Bun.spawn([process.execPath, "-e", `
    import * as store from ${JSON.stringify(new URL("../../../store/src/index.ts", import.meta.url).href)};
    import { createApiRouter } from ${JSON.stringify(new URL("../index.ts", import.meta.url).href)};
    import { expect } from "bun:test";
    import { mkdir, writeFile } from "node:fs/promises";
    import { join } from "node:path";
    import { existsSync } from "node:fs";

    const repo = ${JSON.stringify(dir)};
    const router = createApiRouter();

    // Nothing listens on port 1, so every proxied call fails fast.
    await store.writeHostState({
      schema_version: "0.3.0", host_id: "test", started_at: new Date().toISOString(), port: 1, pid: null,
    });

    const config = store.normalizeConfig({ project_id: "demo", project_name: "Demo" });
    await store.writeConfig(repo, config);
    await store.writeStatus(repo, {
      schema_version: "0.2.0",
      project: { id: "demo", name: "Demo" },
      agent: { kind: "claude_code", session_id: null },
      report: { reported_at: new Date().toISOString() },
      status: { state: "todo", summary: "seed", current_phase_id: null },
      phases: [],
      issues: { blockers: [], decisions_needed: [], external_dependencies: [], risks: [] },
      next_actions: [],
      feature_phases: [{ id: "mvp", title: "MVP" }],
      features: [{ id: "core", title: "Core", items: [] }],
    });
    await writeFile(join(repo, "README.md"), "# Demo");
    await writeFile(join(repo, "notes.txt"), "not a doc");
    const paths = store.repoLocal(repo);
    await store.upsertProject({
      id: "demo", name: "Demo", repo_path: repo, last_sync: null,
      status_path: paths.currentStatus, telemetry_path: paths.latestTelemetry,
      history_dir: paths.historyDir, initialized_at: new Date().toISOString(),
    });

    // A one-cookie jar, so a scenario that enables authentication can sign in.
    let cookie = "";
    const call = async (method, path, body) => {
      const headers = cookie ? { cookie } : {};
      const res = await router.handle(new Request("http://localhost" + path, {
        method,
        ...(body === undefined ? { headers } : { body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } }),
      }));
      if (!res) throw new Error("No route for " + method + " " + path);
      const setCookie = res.headers.getSetCookie();
      if (setCookie.length) cookie = setCookie[0].split(";")[0];
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      return { status: res.status, json, text, headers: res.headers };
    };

    ${code}
  `], { env: { ...process.env, KONDUCTOR_HOME: join(dir, "home") }, stdout: "pipe", stderr: "pipe" });
  const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (exit !== 0) throw new Error(stderr);
}

test("registry and project detail routes expose the seeded project with reachability", async () => {
  await worker(`
    const registry = await call("GET", "/api/registry");
    expect(registry.status).toBe(200);
    expect(registry.json.projects).toHaveLength(1);
    expect(registry.json.projects[0]).toMatchObject({ id: "demo", reachable: true });

    const project = await call("GET", "/api/project/demo");
    expect(project.status).toBe(200);
    expect(project.json.entry.id).toBe("demo");
    expect(project.json.status.project.name).toBe("Demo");
    expect(project.json.config.project_id).toBe("demo");
    expect(project.json.runs).toEqual([]);
    expect(project.json.important_paths.repo_root).toBe(repo);

    const info = await call("GET", "/api/project/demo/info");
    expect(info.json.config_path).toBe(join(repo, "konductor.config.json"));

    const missing = await call("GET", "/api/project/nope");
    expect(missing.status).toBe(404);
    expect(missing.json.code).toBe("PROJECT_NOT_FOUND");
  `);
});

test("a registered project whose repo vanished is reported as unreachable, not crashed", async () => {
  await worker(`
    await store.upsertProject({
      id: "gone", name: "Gone", repo_path: join(repo, "does-not-exist"), last_sync: null,
      status_path: "", telemetry_path: "", history_dir: "", initialized_at: new Date().toISOString(),
    });
    const registry = await call("GET", "/api/registry");
    expect(registry.json.projects.find((p) => p.id === "gone").reachable).toBe(false);
    const detail = await call("GET", "/api/project/gone");
    expect(detail.status).toBe(410);
    expect(detail.json.code).toBe("PROJECT_UNREACHABLE");
  `);
});

test("doc routes only list and serve markdown inside the repository", async () => {
  await worker(`
    const docs = await call("GET", "/api/project/demo/docs");
    expect(docs.json.files).toEqual(["README.md"]);

    const doc = await call("GET", "/api/project/demo/doc?file=README.md");
    expect(doc.json.content).toBe("# Demo");

    expect((await call("GET", "/api/project/demo/doc")).json.code).toBe("MISSING_FILE");
    expect((await call("GET", "/api/project/demo/doc?file=notes.txt")).status).toBe(404);
    expect((await call("GET", "/api/project/demo/doc?file=../outside.md")).status).toBe(404);
    expect((await call("GET", "/api/project/demo/doc?file=" + encodeURIComponent("/etc/passwd.md"))).status).toBe(404);
  `);
});

test("agents workspace updates validate profiles, persist config, and issue internal tokens", async () => {
  await worker(`
    const before = await call("GET", "/api/project/demo/agents");
    expect(before.status).toBe(200);
    expect(before.json.config.agents.profiles.map((p) => p.id)).toEqual(["claude-default"]);
    expect(before.json.active_runs).toEqual([]);

    const empty = await call("PUT", "/api/project/demo/agents/workspace", { agents: { default_profile: "x", profiles: [], prompt_packs: [], skill_profiles: [] } });
    expect(empty.status).toBe(400);
    expect(empty.json.code).toBe("PROFILES_REQUIRED");

    const profiles = [
      ...before.json.config.agents.profiles,
      { ...before.json.config.agents.profiles[0], id: "reviewer", title: "Reviewer" },
    ];
    const badDefault = await call("PUT", "/api/project/demo/agents/workspace", {
      agents: { ...before.json.config.agents, default_profile: "missing", profiles },
    });
    expect(badDefault.json.code).toBe("DEFAULT_PROFILE_INVALID");

    const saved = await call("PUT", "/api/project/demo/agents/workspace", {
      agents: { ...before.json.config.agents, default_profile: "reviewer", profiles },
    });
    expect(saved.status).toBe(200);
    expect(saved.json.config.agents.default_profile).toBe("reviewer");
    expect((await store.readConfig(repo)).agents.default_profile).toBe("reviewer");
    expect(existsSync(join(repo, ".mcp.json"))).toBe(true);

    const tokens = await store.listAccessTokens("demo");
    expect(tokens.filter((t) => t.kind === "internal" && !t.revoked_at).map((t) => t.agent_profile_id).sort())
      .toEqual(["claude-default", "reviewer"]);

    // Dropping a profile revokes its identity.
    await call("PUT", "/api/project/demo/agents/workspace", {
      agents: { ...before.json.config.agents, default_profile: "reviewer", profiles: [profiles[1]] },
    });
    const after = await store.listAccessTokens("demo");
    expect(after.find((t) => t.agent_profile_id === "claude-default").revoked_at).not.toBeNull();
    expect(after.find((t) => t.agent_profile_id === "reviewer").revoked_at).toBeNull();
  `);
});

test("feature routes create categories, phases, and items with collision-safe ids", async () => {
  await worker(`
    expect((await call("POST", "/api/project/demo/features/categories", { title: "  " })).json.code).toBe("TITLE_REQUIRED");

    const category = await call("POST", "/api/project/demo/features/categories", { title: "Core" });
    expect(category.json.category_id).toBe("core-2");

    const phase = await call("POST", "/api/project/demo/features/phases", { title: "Phase Two!" });
    expect(phase.json.phase_id).toBe("phase-two");
    expect((await call("POST", "/api/project/demo/features/phases", { title: " phase two! " })).json.code).toBe("DUPLICATE_FEATURE_PHASE_TITLE");

    expect((await call("POST", "/api/project/demo/features", { title: "Login" })).json.code).toBe("CATEGORY_REQUIRED");
    const unknownPhase = await call("POST", "/api/project/demo/features", { title: "Login", category_id: "core", phase_ids: ["nope"] });
    expect(unknownPhase.json.code).toBe("FEATURE_PHASE_NOT_FOUND");
    expect((await call("POST", "/api/project/demo/features", { title: "Login", category_id: "core", phase_ids: "mvp" })).json.code).toBe("INVALID_FEATURE_PHASES");

    const login = await call("POST", "/api/project/demo/features", {
      title: "Login", category_id: "core", description: "  SSO  ", phase_ids: ["mvp", "mvp", " phase-two "],
    });
    expect(login.json).toEqual({ category_id: "core", feature_item_id: "login" });
    const dupe = await call("POST", "/api/project/demo/features", { title: "Login", category_id: "core-2" });
    expect(dupe.json.feature_item_id).toBe("login-2");

    let status = await store.readStatus(repo);
    const item = status.features[0].items[0];
    expect(item).toMatchObject({ id: "login", status: "todo", description: "SSO", phase_ids: ["mvp", "phase-two"] });
    expect(status.todos.find((todo) => todo.feature_item_id === "login")).toMatchObject({ title: "Login", status: "todo", related_feature_item_ids: ["login"] });
    await call("POST", "/api/project/demo/features", { title: "No to-do", category_id: "core", status: "in_progress", create_todo: false });
    status = await store.readStatus(repo);
    expect(status.todos.some((todo) => todo.feature_item_id === "no-to-do")).toBe(false);
    expect(status.feature_phases.map((p) => p.id)).toEqual(["mvp", "phase-two"]);

    expect((await call("PUT", "/api/project/demo/features/phases", { phase_ids: ["mvp"] })).json.code).toBe("INVALID_FEATURE_PHASE_ORDER");
    const reordered = await call("PUT", "/api/project/demo/features/phases", { phase_ids: ["phase-two", "mvp"] });
    expect(reordered.json).toEqual({ phase_ids: ["phase-two", "mvp"] });
    status = await store.readStatus(repo);
    expect(status.feature_phases.map((p) => p.id)).toEqual(["phase-two", "mvp"]);

    const managed = await call("PUT", "/api/project/demo/features/phases", {
      phases: [{ id: "phase-two", title: "Build" }, { title: "Polish" }],
    });
    expect(managed.json.phases).toEqual([{ id: "phase-two", title: "Build" }, { id: "polish", title: "Polish" }]);
    status = await store.readStatus(repo);
    expect(status.features[0].items[0].phase_ids).toEqual(["phase-two"]);
    expect((await call("PUT", "/api/project/demo/features/phases", {
      phases: [{ id: "phase-two", title: "Build" }, { id: "polish", title: " build " }],
    })).json.code).toBe("DUPLICATE_FEATURE_PHASE_TITLE");

    const rephased = await call("PUT", "/api/project/demo/features/login/phases", { phase_ids: ["phase-two"] });
    expect(rephased.json).toEqual({ feature_item_id: "login", phase_ids: ["phase-two"] });
    expect((await call("PUT", "/api/project/demo/features/ghost/phases", { phase_ids: [] })).status).toBe(404);
    status = await store.readStatus(repo);
    expect(status.features[0].items[0].phase_ids).toEqual(["phase-two"]);

    const updates = await store.readUpdates(repo);
    expect(updates.map((u) => u.kind + ":" + u.subject + ":" + u.action + ":" + u.message)).toEqual([
      'milestone:feature:created:Added feature category "Core".',
      'milestone:feature:created:Added feature phase "Phase Two!".',
      'milestone:feature:created:Feature added "Login" to Core → To-do added "Login"',
      'milestone:feature:created:Feature added "Login" to Core → To-do added "Login"',
      'milestone:feature:created:Feature added "No to-do" to Core',
      "brief:feature:edited:Reordered feature phases.",
      'brief:feature:edited:Renamed feature phase "Phase Two!" to "Build".',
      'brief:feature:created:Added feature phase "Polish".',
      'brief:feature:deleted:Removed feature phase "MVP".',
      'brief:feature:edited:Moved feature "Login" to Build.',
    ]);
    expect(updates.find((u) => u.feature_item_id === "login").message).toContain('"Login"');

    const agentTodo = await call("POST", "/api/project/demo/todos", {
      title: "Review logs", status: "in_progress", related_feature_item_ids: ["login"], creates_feature: false,
    });
    expect(agentTodo.json).toEqual({ todo_id: "review-logs", feature_item_id: null });
    const assetBucket = await store.createAssetBucket(repo, { title: "Brand" });
    const asset = await store.createManagedAsset(repo, {
      bucket_id: assetBucket.id, name: "Logo", upload: { file_name: "logo.txt", content_base64: "eA==" },
    }, { kind: "user" });
    const assetTodo = await call("POST", "/api/project/demo/todos", {
      title: "Place logo", related_asset_ids: [asset.id], creates_feature: false,
    });
    expect(assetTodo.json).toEqual({ todo_id: "place-logo", feature_item_id: null });
    const pairedTodo = await call("POST", "/api/project/demo/todos", {
      title: "Harden login", status: "blocked", category_id: "core", related_feature_item_ids: ["login"],
    });
    expect(pairedTodo.json.feature_item_id).toBe("harden-login");
    status = await store.readStatus(repo);
    expect(status.todos.find((todo) => todo.id === "review-logs")).toMatchObject({ status: "in_progress", related_feature_item_ids: ["login"], creates_feature: false });
    expect(status.todos.find((todo) => todo.id === "place-logo")).toMatchObject({ related_asset_ids: [asset.id] });
    expect(status.todos.find((todo) => todo.id === "harden-login")).toMatchObject({ status: "blocked", feature_item_id: "harden-login" });
    expect(status.features[0].items.find((item) => item.id === "harden-login")).toMatchObject({ status: "blocked" });

    await call("PUT", "/api/project/demo/todos/review-logs", { status: "blocked" });
    await call("PUT", "/api/project/demo/todos/review-logs", { imminent: true });
    await call("PUT", "/api/project/demo/todos/review-logs", { status: "done" });
    const todoUpdates = (await store.readUpdates(repo)).filter((u) => u.subject === "todo").map((u) => u.action + ":" + u.message);
    expect(todoUpdates).toEqual([
      'created:To-do added "Review logs"',
      'created:To-do added "Place logo"',
      'created:To-do added "Harden login" → Feature added "Harden login"',
      'failure:To-do "Review logs" marked blocked',
      'edited:To-do "Review logs" updated',
      'success:To-do "Review logs" marked done',
    ]);
  `);
});

test("decision routes create, patch, resolve with feature creation, and report a failed hand-off", async () => {
  await worker(`
    await call("POST", "/api/project/demo/features", { title: "Login", category_id: "core" });

    expect((await call("POST", "/api/project/demo/decisions", { title: " " })).json.code).toBe("TITLE_REQUIRED");
    expect((await call("POST", "/api/project/demo/decisions", { title: "X", impact: "huge" })).json.code).toBe("INVALID_IMPACT");
    expect((await call("POST", "/api/project/demo/decisions", { title: "X", feature_item_ids: ["ghost"] })).json.code).toBe("FEATURE_NOT_FOUND");
    expect((await call("POST", "/api/project/demo/decisions", { title: "X", options: [{ title: "" }] })).json.code).toBe("INVALID_OPTIONS");
    expect((await call("POST", "/api/project/demo/decisions", {
      title: "X", options: [{ title: "A", creates_features: [{ title: "F", category_id: "nope" }] }],
    })).json.code).toBe("CATEGORY_REQUIRED");

    const created = await call("POST", "/api/project/demo/decisions", {
      title: "Session storage",
      question: "Cookies or tokens?",
      impact: "high",
      owner: "ali",
      feature_item_ids: ["login"],
      options: [
        { title: "Cookies", description: "HttpOnly session cookie" },
        { id: "tokens", title: "Bearer tokens", creates_features: [{ title: "Token refresh", category_id: "core", phase_ids: ["mvp"] }] },
      ],
    });
    expect(created.status).toBe(200);
    const decision = created.json.decision;
    expect(decision.id).toBe("session-storage");
    expect(decision.status).toBe("open");
    expect(decision.options.map((o) => o.id)).toEqual(["cookies", "tokens"]);
    expect((await call("GET", "/api/project/demo/decisions")).json.decisions.map((d) => d.id)).toEqual(["session-storage"]);
    expect((await call("GET", "/api/project/demo")).json.decisions.length).toBe(1);

    const patched = await call("PUT", "/api/project/demo/decisions/session-storage", { owner: "sam", context: "  why  " });
    expect(patched.json.decision).toMatchObject({ owner: "sam", context: "why" });
    expect((await call("PUT", "/api/project/demo/decisions/ghost", { owner: "x" })).status).toBe(404);

    expect((await call("POST", "/api/project/demo/decisions/session-storage/resolve", { option_id: "nope" })).json.code).toBe("OPTION_REQUIRED");
    expect((await call("POST", "/api/project/demo/decisions/session-storage/resolve", {
      option_id: "tokens", handoff: { prompt: " " },
    })).json.code).toBe("PROMPT_REQUIRED");

    // Nothing listens on the host port, so the hand-off fails after the decision resolves.
    const resolved = await call("POST", "/api/project/demo/decisions/session-storage/resolve", {
      option_id: "tokens",
      rationale: "Mobile clients.",
      create_features: [{ title: "Token refresh", category_id: "core", phase_ids: ["mvp"] }],
      handoff: { prompt: "Implement it", feature_item_id: "login" },
    });
    expect(resolved.status).toBe(200);
    expect(resolved.json.run).toBeNull();
    expect(typeof resolved.json.handoff_error).toBe("string");
    expect(resolved.json.decision.status).toBe("resolved");
    expect(resolved.json.decision.outcome).toMatchObject({
      option_id: "tokens", rationale: "Mobile clients.", resolved_by: "dashboard",
      handoff_run_id: null, created_feature_item_ids: ["token-refresh"],
    });
    expect(resolved.json.decision.feature_item_ids).toEqual(["login", "token-refresh"]);

    const status = await store.readStatus(repo);
    expect(status.features[0].items.map((i) => i.id)).toEqual(["login", "token-refresh"]);
    expect(status.features[0].items[1].phase_ids).toEqual(["mvp"]);

    expect((await call("POST", "/api/project/demo/decisions/session-storage/resolve", { option_id: "cookies" })).status).toBe(409);

    const messages = (await store.readUpdates(repo)).map((u) => u.message);
    expect(messages.some((m) => m.includes('Recorded decision "Session storage"'))).toBe(true);
    expect(messages.some((m) => m.includes('from decision "Session storage"'))).toBe(true);
    expect(messages.some((m) => m.includes('Decided "Session storage": Bearer tokens.'))).toBe(true);
  `);
});

test("skill install rejects links that are not real npm or GitHub packages before touching npm", async () => {
  await worker(`
    const cases = [
      [{ source: "pip", url: "https://pypi.org/x" }, "INVALID_SKILL_LINK"],
      [{ source: "npm", url: "https://www.npmjs.com/package/--registry=evil" }, "INVALID_SKILL_LINK"],
      [{ source: "npm", url: "https://example.com/package/left-pad" }, "INVALID_SKILL_LINK"],
      [{ source: "github", url: "https://github.com/only-owner" }, "INVALID_SKILL_LINK"],
      [{ source: "github", url: "https://gitlab.com/a/b" }, "INVALID_SKILL_LINK"],
    ];
    for (const [body, code] of cases) {
      const res = await call("POST", "/api/project/demo/skills/install", body);
      expect(res.status).toBe(400);
      expect(res.json.code).toBe(code);
    }
  `);
});

test("asset routes manage settings, categories, items, variations, and serve managed content", async () => {
  await worker(`
    const initial = await call("GET", "/api/project/demo/assets");
    expect(initial.json.settings.enabled).toBe(false);
    expect(initial.json.library.assets).toEqual([]);

    const badSettings = await call("PUT", "/api/project/demo/assets/settings", { enabled: "yes" });
    expect(badSettings.json.code).toBe("ASSET_SETTINGS_INVALID");
    expect(badSettings.json.details[0]).toContain("enabled");
    const settings = await call("PUT", "/api/project/demo/assets/settings", { enabled: true, selected_profile_ids: ["claude-default"] });
    expect(settings.json.settings).toMatchObject({ enabled: true, selected_profile_ids: ["claude-default"], preset: "no_relation" });
    expect((await store.readConfig(repo)).assets.enabled).toBe(true);

    const bucket = await call("POST", "/api/project/demo/assets/buckets", { title: "Icons", instruction: "Use in the sidebar." });
    expect(bucket.status).toBe(201);
    const bucketId = bucket.json.id;
    expect((await call("POST", "/api/project/demo/assets/buckets", { title: "" })).json.code).toBe("ASSET_REQUEST_INVALID");

    expect((await call("PUT", "/api/project/demo/assets/buckets/" + bucketId + "/settings", { prevent_agent_uploads: "no" })).status).toBe(400);
    const locked = await call("PUT", "/api/project/demo/assets/buckets/" + bucketId + "/settings", { prevent_agent_uploads: true });
    expect(locked.json.prevent_agent_uploads).toBe(true);
    const meta = await call("PUT", "/api/project/demo/assets/buckets/" + bucketId + "/metadata", { description: "Sidebar icons", tags: ["ui"], expose_to_agents: true });
    expect(meta.json.metadata).toMatchObject({ description: "Sidebar icons", tags: ["ui"], expose_to_agents: true });

    expect((await call("POST", "/api/project/demo/assets/items", { name: "x" })).json.code).toBe("ASSET_FIELDS_REQUIRED");
    const content = Buffer.from("PNGDATA").toString("base64");
    const item = await call("POST", "/api/project/demo/assets/items", {
      bucket_id: bucketId, name: "Home", metadata: { description: "Home icon" },
      upload: { file_name: "home.png", media_type: "image/png", content_base64: content, used: true },
    });
    expect(item.status).toBe(201);
    expect(item.json.variations).toHaveLength(1);
    expect(item.json.variations[0].approval).toBe("approved");
    const assetId = item.json.id;
    const variationId = item.json.variations[0].id;

    const served = await call("GET", "/api/project/demo/assets/items/" + assetId + "/variations/" + variationId + "/content");
    expect(served.status).toBe(200);
    expect(served.headers.get("Content-Type")).toBe("image/png");
    expect(served.text).toBe("PNGDATA");
    expect((await call("GET", "/api/project/demo/assets/items/" + assetId + "/variations/nope/content")).status).toBe(404);

    const second = await call("POST", "/api/project/demo/assets/items/" + assetId + "/variations", {
      file_name: "home-dark.png", content_base64: Buffer.from("DARK").toString("base64"), variation_name: "Dark",
    });
    expect(second.status).toBe(201);
    expect(second.json.used).toBe(false);
    expect((await call("PUT", "/api/project/demo/assets/items/" + assetId + "/variations/" + second.json.id, { used: "yes" })).json.code).toBe("ASSET_USED_REQUIRED");
    const used = await call("PUT", "/api/project/demo/assets/items/" + assetId + "/variations/" + second.json.id, { used: true });
    expect(used.json.used).toBe(true);

    const renamed = await call("PUT", "/api/project/demo/assets/items/" + assetId + "/metadata", { description: "Updated", expose_to_agents: true });
    expect(renamed.json.metadata.description).toBe("Updated");

    expect((await call("DELETE", "/api/project/demo/assets/items/" + assetId + "/variations/" + second.json.id)).json).toEqual({ deleted: second.json.id });
    let library = (await call("GET", "/api/project/demo/assets")).json.library;
    expect(library.assets[0].variations).toHaveLength(1);

    const child = await call("POST", "/api/project/demo/assets/buckets", { title: "Small", parent_id: bucketId });
    expect(child.status).toBe(201);
    expect(child.json.parent_id).toBe(bucketId);
    expect((await call("POST", "/api/project/demo/assets/buckets", { title: "Orphan", parent_id: "nope" })).status).toBe(400);
    expect((await call("PUT", "/api/project/demo/assets/buckets/" + bucketId + "/parent", { parent_id: child.json.id })).status).toBe(400);
    expect((await call("PUT", "/api/project/demo/assets/buckets/" + bucketId + "/parent", { parent_id: 5 })).status).toBe(400);
    expect((await call("PUT", "/api/project/demo/assets/buckets/" + child.json.id + "/parent", { parent_id: null })).json.parent_id).toBe(null);
    expect((await call("PUT", "/api/project/demo/assets/buckets/" + child.json.id + "/parent", { parent_id: bucketId })).json.parent_id).toBe(bucketId);
    expect((await call("PUT", "/api/project/demo/assets/items/" + assetId + "/bucket", { bucket_id: "" })).status).toBe(400);
    expect((await call("PUT", "/api/project/demo/assets/items/" + assetId + "/bucket", { bucket_id: child.json.id })).json.bucket_id).toBe(child.json.id);

    const moved = await call("DELETE", "/api/project/demo/assets/buckets/" + bucketId);
    expect(moved.json).toEqual({ moved_assets: 1, deleted_folders: 2 });
    library = (await call("GET", "/api/project/demo/assets")).json.library;
    expect(library.assets[0].bucket_id).toBe("uncategorized");
    expect(library.buckets.map((item) => item.id)).toEqual(["uncategorized"]);

    expect((await call("DELETE", "/api/project/demo/assets/items/" + assetId)).json).toEqual({ deleted: assetId });
    expect((await call("DELETE", "/api/project/demo/assets/items/" + assetId)).status).toBe(400);
    expect((await call("GET", "/api/project/demo/assets")).json.library.assets).toEqual([]);
  `);
});

test("configuration routes validate scopes and drive theme, users, auth, and remote settings", async () => {
  await worker(`
    expect((await call("GET", "/api/config/team/demo")).json.code).toBe("CONFIG_SCOPE_INVALID");
    expect((await call("GET", "/api/config/project/unknown")).json.code).toBe("PROJECT_NOT_FOUND");
    expect((await call("GET", "/api/config/project_space/Bad_Id")).json.code).toBe("PROJECT_SPACE_INVALID");

    const state = await call("GET", "/api/config/project/demo");
    expect(state.status).toBe(200);
    expect(state.json.settings).toMatchObject({ scope_type: "project", scope_id: "demo", general: { theme: "system" } });
    expect(state.json.users).toEqual([]);

    expect((await call("PUT", "/api/config/project/demo/general", { theme: "blue" })).json.code).toBe("THEME_INVALID");
    expect((await call("PUT", "/api/config/project/demo/general", { theme: "dark" })).json.settings.general.theme).toBe("dark");

    expect((await call("PUT", "/api/config/project/demo/auth", { enabled: true })).json.code).toBe("SCOPE_PROJECT_SPACE_REQUIRED");
    expect((await call("POST", "/api/config/project/demo/auth/users", { display_name: "A", email: "a@example.test", password: "correct horse battery staple" })).json.code).toBe("SCOPE_PROJECT_SPACE_REQUIRED");
    expect((await call("PUT", "/api/config/project_space/demo-space/auth", { enabled: "true" })).json.code).toBe("AUTH_SETTINGS_INVALID");
    const noAdmin = await call("PUT", "/api/config/project_space/demo-space/auth", { enabled: true });
    expect(noAdmin.status).toBe(409);
    expect(noAdmin.json.code).toBe("AUTH_ADMIN_REQUIRED");

    expect((await call("POST", "/api/config/project_space/demo-space/auth/users", { display_name: "A", email: "a@example.test" })).json.code).toBe("AUTH_USER_FIELDS_REQUIRED");
    const shortPassword = await call("POST", "/api/config/project_space/demo-space/auth/users", { display_name: "A", email: "a@example.test", password: "short" });
    expect(shortPassword.json.code).toBe("AUTH_USER_INVALID");
    expect(shortPassword.json.error).toContain("12 characters");

    const created = await call("POST", "/api/config/project_space/demo-space/auth/users", {
      display_name: " Owner ", email: "Owner@Example.test", password: "correct horse battery staple", role: "member",
    });
    expect(created.status).toBe(201);
    expect(created.json.users[0]).toMatchObject({ display_name: "Owner", email: "owner@example.test", role: "admin" });
    expect(created.text).not.toContain("credential_hash");
    const pins = await call("PUT", "/api/config/project_space/demo-space/auth/users/" + created.json.users[0].id + "/todo-pins", { pinned_todo_phase_ids: ["build", "build", "release"] });
    expect(pins.status).toBe(200);
    expect(pins.json.users[0].pinned_todo_phase_ids).toEqual(["build", "release"]);
    const duplicate = await call("POST", "/api/config/project_space/demo-space/auth/users", {
      display_name: "Again", email: "owner@example.test", password: "correct horse battery staple",
    });
    expect(duplicate.json.error).toContain("already exists");

    const badRemote = await call("PUT", "/api/config/project_space/demo-space/remote", { enabled: true, remote_port: 70000, local_host: "0.0.0.0" });
    expect(badRemote.json.code).toBe("REMOTE_SETTINGS_INVALID");
    expect(badRemote.json.details).toEqual(expect.arrayContaining([expect.stringContaining("remote_port"), expect.stringContaining("local_host")]));
    const remote = { enabled: true, transport: "ssh_reverse_tunnel", ssh_host: "example.test", ssh_user: "ops", local_host: "127.0.0.1", local_port: 4096, remote_port: 44096 };
    const authRequired = await call("PUT", "/api/config/project_space/demo-space/remote", remote);
    expect(authRequired.status).toBe(409);
    expect(authRequired.json.code).toBe("REMOTE_AUTH_REQUIRED");

    expect((await call("PUT", "/api/config/project_space/demo-space/auth", { enabled: true })).json.settings.auth.enabled).toBe(true);
    // Enabling authentication in any scope closes the dashboard until sign-in.
    expect((await call("PUT", "/api/config/project_space/demo-space/remote", remote)).status).toBe(401);
    expect((await call("POST", "/api/auth/login", { email: "owner@example.test", password: "correct horse battery staple" })).status).toBe(200);
    const enabled = await call("PUT", "/api/config/project_space/demo-space/remote", remote);
    expect(enabled.json.settings.remote).toMatchObject({ enabled: true, remote_port: 44096 });

    const originalFetch = globalThis.fetch;
    let githubAuthorization = null;
    globalThis.fetch = async (_url, options) => {
      githubAuthorization = options.headers.Authorization;
      return new Response(JSON.stringify({ login: "octo", name: "Octo Cat", avatar_url: "https://avatars.example.test/octo" }), { status: 200 });
    };
    const github = await call("POST", "/api/config/project/demo/integrations/github", { token: "github_pat_secret" });
    globalThis.fetch = originalFetch;
    expect(github.status).toBe(201);
    expect(github.json.settings.integrations.github).toMatchObject({ login: "octo", name: "Octo Cat" });
    expect(github.text).not.toContain("github_pat_secret");
    expect(githubAuthorization).toBe("Bearer github_pat_secret");
    expect(await store.readProviderSecret("integration-project-demo", "github")).toBe("github_pat_secret");
    const githubDisconnected = await call("DELETE", "/api/config/project/demo/integrations/github");
    expect(githubDisconnected.json.settings.integrations.github).toBeNull();
    expect(await store.readProviderSecret("integration-project-demo", "github")).toBeNull();

    // A project space is a separate scope with its own defaults.
    const space = await call("GET", "/api/config/project_space/team-a");
    expect(space.json.settings.general.theme).toBe("system");
  `);
});

test("token routes issue, list per scope, validate grants, and revoke external tokens", async () => {
  await worker(`
    expect((await call("POST", "/api/config/project/demo/tokens", { name: "x" })).json.code).toBe("TOKEN_FIELDS_REQUIRED");
    expect((await call("POST", "/api/config/project/demo/tokens", { name: "x", project_ids: ["demo"], role: "root" })).json.code).toBe("TOKEN_GRANT_INVALID");
    expect((await call("POST", "/api/config/project/demo/tokens", { name: "x", project_ids: ["demo"], role: "custom" })).json.code).toBe("TOKEN_PERMISSIONS_REQUIRED");
    expect((await call("POST", "/api/config/project/demo/tokens", { name: "x", project_ids: ["demo"], role: "observer", permissions: ["status.read"] })).json.code).toBe("TOKEN_ROLE_INVALID");
    const unknownProject = await call("POST", "/api/config/project/demo/tokens", { name: "x", project_ids: ["demo", "ghost"] });
    expect(unknownProject.json.code).toBe("TOKEN_PROJECT_INVALID");
    expect(unknownProject.json.details).toEqual(["ghost"]);
    expect((await call("POST", "/api/config/project/demo/tokens", { name: "x", project_ids: ["demo"], expires_at: "2000-01-01T00:00:00.000Z" })).json.code).toBe("TOKEN_EXPIRY_INVALID");
    expect((await call("POST", "/api/config/project/demo/tokens", { name: "x", project_ids: ["demo"], expires_at: "soon" })).json.code).toBe("TOKEN_EXPIRY_INVALID");

    const issued = await call("POST", "/api/config/project/demo/tokens", {
      name: " Review bot ", project_ids: ["demo", "demo"], role: "custom", permissions: ["status.read", "status.read", "files.read"],
    });
    expect(issued.status).toBe(201);
    expect(issued.json.token.startsWith("knd_ext_")).toBe(true);
    expect(issued.json.record.name).toBe("Review bot");
    expect(issued.json.record.grants).toEqual([{ project_id: "demo", project_profile_id: null, role: "custom", permissions: ["status.read", "files.read"] }]);
    expect(issued.text).not.toContain("token_hash");

    const identity = await store.authenticateAccessToken(issued.json.token, "demo", "files.read");
    expect(identity.kind).toBe("external");
    await expect(store.authenticateAccessToken(issued.json.token, "demo", "status.write")).rejects.toThrow("status.write");

    const listed = await call("GET", "/api/config/project/demo/tokens");
    expect(listed.json.tokens.map((t) => t.id)).toEqual([issued.json.record.id]);
    expect((await call("GET", "/api/config/project_space/team-a/tokens")).json.tokens).toEqual([]);
    expect((await call("GET", "/api/config/project_space/team-a/tokens?projects=demo,other")).json.tokens).toHaveLength(1);

    expect((await call("DELETE", "/api/access-tokens/missing")).status).toBe(404);
    const revoked = await call("DELETE", "/api/access-tokens/" + issued.json.record.id);
    expect(revoked.json.token.revoked_by).toBe("local-dashboard");
    await expect(store.authenticateAccessToken(issued.json.token, "demo")).rejects.toThrow("revoked");
  `);
});

test("run routes fall back to stored history when the host is unreachable", async () => {
  await worker(`
    const health = await call("GET", "/api/host/health");
    expect(health.json.running).toBe(false);
    expect(health.json.code).toBe("HOST_UNREACHABLE");

    // Profile creation is configuration, not live process state. The complete
    // harness catalog must remain available while the host is stopped.
    const adapters = await call("GET", "/api/project/demo/adapters");
    expect(adapters.status).toBe(200);
    expect(adapters.json.adapters.map((item) => item.id)).toEqual([
      "claude_code", "codex", "gemini_cli", "opencode", "pi",
    ]);
    expect(adapters.json.adapters.find((item) => item.id === "pi").providers.length).toBeGreaterThan(1);

    const run = {
      schema_version: "0.3.0", id: "run-1", project_id: "demo", repo_path: repo,
      profile_id: "claude-default", profile_title: "Claude Code", adapter_id: "claude_code", slug: "fix-login",
      feature_item_id: null, prompt_excerpt: "fix login", prompt_packs: [], source: "cli", command: "claude",
      env_summary: {}, status: "succeeded", started_at: "2026-09-17T10:00:00.000Z",
      ended_at: "2026-09-17T10:05:00.000Z", exit_code: 0, log_path: "run-1.log", repo_log_path: null,
    };
    await store.writeRunSummary(repo, run);
    await store.writeRunLog(repo, "run-1", "hello from the agent");

    const listed = await call("GET", "/api/project/demo/runs");
    expect(listed.json.runs.map((r) => r.id)).toEqual(["run-1"]);
    const agents = await call("GET", "/api/project/demo/agents");
    expect(agents.json.past_runs).toHaveLength(1);
    expect(agents.json.active_runs).toHaveLength(0);

    const detail = await call("GET", "/api/run/run-1");
    expect(detail.status).toBe(200);
    expect(detail.json.slug).toBe("fix-login");
    const terminal = await call("GET", "/api/run/run-1/terminal");
    expect(terminal.json.log).toBe("hello from the agent");
    expect((await call("GET", "/api/run/nope")).json.code).toBe("RUN_NOT_FOUND");

    // Live-only operations report why the host is missing instead of a bare fetch error.
    const stop = await call("POST", "/api/run/run-1/stop");
    expect(stop.status).toBe(503);
    expect(stop.json.code).toBe("HOST_UNREACHABLE");
    expect((await call("GET", "/api/agents")).status).toBe(503);
    expect((await call("POST", "/api/agent/fix-login/send", { text: "  " })).json.code).toBe("MESSAGE_REQUIRED");
    expect((await call("POST", "/api/agent/fix-login/send", { text: "hi" })).status).toBe(503);
    expect((await call("POST", "/api/project/demo/adapters/unknown/setup", {})).json.code).toBe("ADAPTER_NOT_FOUND");
  `);
});

test("telemetry reset zeroes counters and project deletion removes only Konductor files", async () => {
  await worker(`
    expect((await call("POST", "/api/project/demo/telemetry/reset")).json.telemetry).toBeNull();
    await store.writeTelemetry(repo, {
      schema_version: "0.2.0", project_id: "demo", captured_at: new Date().toISOString(), session_id: "s1",
      input_tokens: 10, output_tokens: 5, cache_read_tokens: null, cache_write_tokens: null,
      request_count: 2, cost_usd: 0.5, top_tools: [{ name: "Read", count: 3, signal_status: "best_effort" }],
      top_files: [], context_window: null, peak_context_tokens: null, peak_context_percent: null,
      compact_count: null, signal_availability: {},
    });
    const reset = await call("POST", "/api/project/demo/telemetry/reset");
    expect(reset.json.telemetry).toMatchObject({ input_tokens: 0, output_tokens: 0, cache_read_tokens: null, request_count: 0, cost_usd: 0 });
    // Activity is kept; only the counters reset.
    expect(reset.json.telemetry.top_tools).toEqual([{ name: "Read", count: 3, signal_status: "best_effort" }]);

    await mkdir(join(repo, ".claude"), { recursive: true });
    await writeFile(join(repo, ".claude", "settings.local.json"), JSON.stringify({
      env: { ...store.DEFAULT_OTEL_ENV, MY_VAR: "keep" }, permissions: { allow: ["Bash"] },
    }));
    await writeFile(join(repo, ".mcp.json"), "{}");

    const deleted = await call("DELETE", "/api/project/demo");
    expect(deleted.json.deleted).toBe("demo");
    expect(deleted.json.removed.sort()).toEqual([
      join(repo, ".konductor"), join(repo, ".mcp.json"), join(repo, "konductor.config.json"),
    ].sort());
    expect(existsSync(join(repo, "README.md"))).toBe(true);
    expect(existsSync(join(repo, ".konductor"))).toBe(false);
    const settings = JSON.parse(await Bun.file(join(repo, ".claude", "settings.local.json")).text());
    expect(settings.env).toEqual({ MY_VAR: "keep" });
    expect(settings.permissions).toEqual({ allow: ["Bash"] });
    expect(await store.getProject("demo")).toBeUndefined();
    expect((await call("GET", "/api/project/demo")).status).toBe(404);
    // Deleting an unknown project is a no-op rather than an error.
    expect((await call("DELETE", "/api/project/demo")).json).toEqual({ deleted: "demo", removed: [] });
  `);
});

test("review links, customer submissions, and previews when the host is down", async () => {
  await worker(`
    // A preview record the host wrote earlier; the host itself is unreachable here.
    await store.putPreview({
      id: "prev-1", project_id: "demo", repo_path: repo, branch: "feature/hero", worktree_path: repo + "-preview-feature-hero",
      worktree_created: true, port: 4200, command: "bun run dev", status: "ready", transport: "tmux", session_name: "konductor",
      window_id: "@1", pane_id: "%1", exit_code: null, last_error: null, created_at: new Date().toISOString(),
      ready_at: new Date().toISOString(), stopped_at: null,
    });
    const previews = await call("GET", "/api/project/demo/previews");
    expect(previews.status).toBe(200);
    expect(previews.json.previews.map((p) => p.id)).toEqual(["prev-1"]);
    // Starting a preview needs the daemon; with none reachable the route reports the host problem.
    expect((await call("POST", "/api/project/demo/previews", { branch: "main" })).status).toBe(503);

    const invalid = await call("POST", "/api/project/demo/reviews", { title: "", pages: [] });
    expect(invalid.status).toBe(400);
    expect(invalid.json.code).toBe("REVIEW_INVALID");
    expect((await call("POST", "/api/project/demo/reviews", {
      title: "x", preview_instance_id: "ghost", pages: [{ label: "Home", path: "/" }],
    })).json.code).toBe("PREVIEW_NOT_FOUND");

    const created = await call("POST", "/api/project/demo/reviews", {
      title: "Website refresh", preview_instance_id: "prev-1", access: "proxied",
      pages: [{ label: "Home", path: "/" }, { label: "Pricing", path: "/pricing" }], expires_in_days: 7,
    });
    expect(created.status).toBe(201);
    expect(created.json.token.startsWith("krv_")).toBe(true);
    expect(created.json.session.token_hash).toBeUndefined();
    expect(created.json.session.pages.map((p) => p.id)).toEqual(["page-1", "page-2"]);
    const token = created.json.token;

    const customer = await call("GET", "/api/review/" + token);
    expect(customer.status).toBe(200);
    expect(customer.json.project_name).toBe("Demo");
    expect(customer.json.preview).toMatchObject({ status: "ready", port: 4200, url: "/preview/prev-1/", access: "proxied" });
    expect((await call("GET", "/api/review/krv_definitely-not-a-token-value")).status).toBe(404);

    expect((await call("POST", "/api/review/" + token + "/requests", { page_id: "nope", summary: "x" })).json.code).toBe("REVIEW_PAGE_INVALID");
    const submitted = await call("POST", "/api/review/" + token + "/requests", {
      page_id: "page-2", summary: "Compare annual savings", submitted_by: "Ada",
      pointers: [{ id: "p1", page_id: "page-2", index: 1, x_ratio: 0.4, y_document_ratio: 0.3, viewport_width: 1280, viewport_height: 720, scroll_y: 0, note: "here" }],
    });
    expect(submitted.status).toBe(201);
    expect(submitted.json.request.status).toBe("open");

    const overview = await call("GET", "/api/project/demo/reviews");
    expect(overview.json.sessions).toHaveLength(1);
    expect(overview.json.requests).toHaveLength(1);
    expect(overview.json.previews).toHaveLength(1);
    const requestId = overview.json.requests[0].id;
    expect((await call("PATCH", "/api/project/demo/reviews/requests/" + requestId, { status: "bogus" })).json.code).toBe("CHANGE_REQUEST_STATUS_INVALID");
    expect((await call("PATCH", "/api/project/demo/reviews/requests/" + requestId, { status: "acknowledged" })).json.request.status).toBe("acknowledged");

    const revoked = await call("POST", "/api/project/demo/reviews/" + created.json.session.id + "/revoke");
    expect(revoked.json.session.state).toBe("revoked");
    expect((await call("GET", "/api/review/" + token)).status).toBe(404);
    expect((await call("POST", "/api/review/" + token + "/requests", { page_id: "page-1", summary: "late" })).status).toBe(404);

    expect((await call("PATCH", "/api/project/demo/reviews/requests/" + requestId, { status: "resolved" })).json.request.status).toBe("resolved");

    const updates = await call("GET", "/api/project/demo");
    expect(updates.json.updates.some((u) => u.agent === "customer-review")).toBe(true);
    expect(updates.json.updates.filter((u) => u.subject === "review").map((u) => u.action + ":" + u.message)).toEqual([
      'created:Review link "Website refresh" created with 2 pages.',
      "created:Customer change request on Website refresh: Compare annual savings",
      'edited:Change request "Compare annual savings" marked acknowledged.',
      'deleted:Review link "Website refresh" revoked.',
      'success:Change request "Compare annual savings" marked resolved.',
    ]);
  `);
});

test("port reservations are host-scoped and refuse ports a live preview holds", async () => {
  await worker(`
    expect((await call("PUT", "/api/config/project/demo/ports", { reserved: [], preview_range: { start: 4200, end: 4210 } })).json.code).toBe("PORTS_SCOPE_INVALID");
    expect((await call("PUT", "/api/config/host/other/ports", {})).json.code).toBe("HOST_SCOPE_INVALID");
    expect((await call("PUT", "/api/config/host/local/ports", { reserved: [{ start: 4200, end: 4210 }], preview_range: { start: 4200, end: 4210 } })).json.code).toBe("PORT_SETTINGS_INVALID");

    await store.putPreview({
      id: "prev-live", project_id: "demo", repo_path: repo, branch: "main", worktree_path: repo, worktree_created: false,
      port: 4205, command: "x", status: "starting", transport: "tmux", session_name: "konductor", window_id: null, pane_id: null,
      exit_code: null, last_error: null, created_at: new Date().toISOString(), ready_at: null, stopped_at: null,
    });
    const clash = await call("PUT", "/api/config/host/local/ports", { reserved: [{ start: 4205, end: 4205, label: "x" }], preview_range: { start: 4200, end: 4299 } });
    expect(clash.status).toBe(409);
    expect(clash.json.code).toBe("PORT_IN_USE");

    const saved = await call("PUT", "/api/config/host/local/ports", { reserved: [{ start: 3000, end: 3010, label: "next dev" }], preview_range: { start: 4300, end: 4310 } });
    expect(saved.status).toBe(200);
    expect(saved.json.settings.scope_type).toBe("host");
    expect(saved.json.settings.ports.reserved).toEqual([{ start: 3000, end: 3010, label: "next dev" }]);
    expect((await call("GET", "/api/config/host/local")).json.settings.ports.preview_range).toEqual({ start: 4300, end: 4310 });
  `);
});
