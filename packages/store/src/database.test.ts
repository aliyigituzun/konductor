import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendUpdate, readUpdates } from "./updates.js";
import { repoLocal } from "./paths.js";
import { withDatabase } from "./database.js";
import { redactSensitiveText } from "./redaction.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "konductor-db-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

// Each worker gets an isolated home before importing the store. Never touch the
// developer's registry; separate processes also exercise real SQLite file locks.
async function worker(code: string): Promise<void> {
  const child = Bun.spawn([process.execPath, "-e", `
    import * as store from ${JSON.stringify(new URL("./index.ts", import.meta.url).href)};
    import { expect } from "bun:test";
    const repo = ${JSON.stringify(dir)};
    ${code}
  `], { env: { ...process.env, KONDUCTOR_HOME: join(dir, "home") }, stdout: "pipe", stderr: "pipe" });
  const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (exit !== 0) throw new Error(stderr);
}

function run(id: string) {
  return {
    schema_version: "0.2.0", id, project_id: "project", repo_path: dir,
    profile_id: "claude", profile_title: "Claude", agent_kind: "claude_code",
    feature_item_id: null, prompt_excerpt: "test", prompt_packs: [], source: "cli",
    command: "claude", env_summary: {}, status: "running",
    started_at: "2026-09-17T10:00:00.000Z", ended_at: null, exit_code: null,
    log_path: "test.log", repo_log_path: null,
  };
}

test("credential redaction removes access tokens and secret environment values", () => {
  const text = "KONDUCTOR_ACCESS_TOKEN=knd_int_123456789abc_supersecretvalue and API_KEY=private";
  expect(redactSensitiveText(text)).toBe(
    "KONDUCTOR_ACCESS_TOKEN=[redacted] and API_KEY=[redacted]",
  );
});

test("legacy updates import once; failed imports roll back and can be repaired", async () => {
  const paths = repoLocal(dir);
  await mkdir(paths.dir);
  const entry = { schema_version: "0.2.0", id: "old", at: "2026-09-17T10:00:00.000Z", kind: "brief", message: "legacy", agent: "test" };
  const line = JSON.stringify(entry) + "\n";
  await writeFile(paths.updatesFile, line + "invalid\n");
  await expect(readUpdates(dir)).rejects.toThrow();
  await writeFile(paths.updatesFile, line);
  expect(await readUpdates(dir)).toHaveLength(1);
  await appendUpdate(dir, { kind: "brief", message: "new", agent: "test" });
  expect(await readUpdates(dir)).toHaveLength(2);
  expect(await readFile(paths.updatesFile, "utf-8")).toBe(line);
  await writeFile(paths.updatesFile, "invalid after import");
  expect(await readUpdates(dir)).toHaveLength(2);
});

test("registry imports old data and concurrent upserts do not lose projects or resurrect removals", async () => {
  const home = join(dir, "home");
  await mkdir(home);
  const entry = { id: "old", name: "Old", repo_path: dir, last_sync: null, status_path: "", telemetry_path: "", history_dir: "", initialized_at: "2026-09-17T10:00:00.000Z" };
  await writeFile(join(home, "registry.json"), JSON.stringify({ schema_version: "0.1.0", projects: [entry] }));
  await worker(`expect((await store.getProject("old")).active_run_count).toBe(0);`);
  await Promise.all(Array.from({ length: 4 }, (_, i) => worker(`
    for (let n = 0; n < 10; n++) await store.upsertProject({ ...${JSON.stringify(entry)}, id: ${JSON.stringify(`worker-${i}-`)} + n });
  `)));
  await worker(`
    expect((await store.readRegistry()).projects).toHaveLength(41);
    await store.removeProject("old");
    expect(await store.getProject("old")).toBeUndefined();
    expect((await store.readRegistry()).projects).toHaveLength(40);
  `);
});

test("run migration, indexed repo filtering, and concurrent counters share one authoritative record", async () => {
  const runsDir = join(dir, "home", "host", "runs");
  await mkdir(runsDir, { recursive: true });
  await writeFile(join(runsDir, "legacy.json"), JSON.stringify(run("legacy")));
  const localRuns = repoLocal(dir).runsDir;
  await mkdir(localRuns, { recursive: true });
  await writeFile(join(localRuns, "local.json"), JSON.stringify(run("local")));
  await worker(`
    expect((await store.listProjectRuns(repo))).toHaveLength(2);
    expect((await store.readRunSummary(repo, "legacy")).adapter_id).toBe("claude_code");
    expect(await store.readRunSummary(repo + "/other", "legacy")).toBeNull();
  `);
  await Promise.all(Array.from({ length: 4 }, () => worker(`
    for (let n = 0; n < 20; n++) await store.incrementRunCounters(repo, "legacy", { updates: 1, status_writes: 1 });
  `)));
  await worker(`
    await store.patchRunSummary(repo, "legacy", { status: "succeeded" });
    const saved = await store.readGlobalRunSummary("legacy");
    expect(saved.update_count).toBe(80);
    expect(saved.status_write_count).toBe(80);
    expect(await store.readRunSummary(repo, "legacy")).toEqual(saved);
    expect(await store.listGlobalRuns()).toHaveLength(2);
    await expect(store.patchRunSummary(repo, "legacy", { id: "changed" })).rejects.toThrow();
  `);
  expect(JSON.parse(await readFile(join(runsDir, "legacy.json"), "utf-8")).status).toBe("running");
});

test("project-scoped tokens authorize exact capabilities, audit activity, and revoke cleanly", async () => {
  await worker(`
    const issued = await store.createAccessToken({
      kind: "external",
      name: "Review bot",
      grants: [{ project_id: "project", role: "observer" }],
      created_by: "test",
    });
    expect(issued.token.startsWith("knd_ext_")).toBe(true);
    expect(issued.record.token_hash).toBeUndefined();
    const startupIdentity = await store.authenticateAccessToken(
      issued.token,
      "project",
      undefined,
      { record_use: false },
    );
    expect(startupIdentity.label).toBe("Review bot");
    expect((await store.listAccessTokens("project")).find((token) => token.id === issued.record.id).use_count).toBe(0);
    const identity = await store.authenticateAccessToken(issued.token, "project", "status.read");
    expect(identity.label).toBe("Review bot");
    expect(identity.permissions).toContain("status.read");
    await store.authenticateAccessToken(issued.token, "project", "status.read");
    const used = (await store.listAccessTokens("project")).find((token) => token.id === issued.record.id);
    expect(used.use_count).toBe(2);
    expect(used.last_used_at).not.toBeNull();
    await expect(store.authenticateAccessToken(issued.token, "project", "status.write")).rejects.toThrow("does not grant status.write");
    await expect(store.authenticateAccessToken(issued.token, "another", "status.read")).rejects.toThrow("does not grant access");
    await store.recordTokenAuditEvent({
      actor_token_id: issued.record.id,
      actor_kind: "external",
      actor_label: "Review bot",
      project_id: "project",
      agent_profile_id: null,
      action: "mcp.get_current_status",
      permission: "status.read",
      outcome: "allowed",
      target: "get_current_status",
      metadata: {},
    });
    expect((await store.listTokenAuditEvents({ project_id: "project" })).map((event) => event.action)).toContain("mcp.get_current_status");
    const other = await store.createAccessToken({
      kind: "external",
      name: "Other bot",
      grants: [{ project_id: "project", role: "observer" }],
      created_by: "test",
    });
    await store.recordTokenAuditEvent({
      actor_token_id: other.record.id,
      actor_kind: "external",
      actor_label: "Other bot",
      project_id: "project",
      agent_profile_id: null,
      action: "mcp.get_current_status",
      permission: "status.read",
      outcome: "allowed",
      target: "get_current_status",
      metadata: {},
    });
    const combined = await store.listTokenAuditEvents({
      project_id: "project",
      token_id: issued.record.id,
    });
    expect(combined.length).toBe(1);
    expect(combined.every((event) => event.actor_token_id === issued.record.id)).toBe(true);

    const badToken = issued.token.slice(0, -1) + (issued.token.endsWith("A") ? "B" : "A");
    try {
      await store.authenticateAccessToken(badToken, "project");
      throw new Error("Expected bad token authentication to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(store.AccessTokenAuthenticationError);
      expect(error.reason).toBe("unrecognized");
      expect(error.actor).toBeNull();
    }

    await store.revokeAccessToken(issued.record.id, { revoked_by: "test" });
    const firstRevokeCount = (await store.listTokenAuditEvents({ project_id: "project", limit: 100 }))
      .filter((event) => event.action === "token.revoked" && event.target === issued.record.id).length;
    await store.revokeAccessToken(issued.record.id, { revoked_by: "test-again" });
    const secondRevokeCount = (await store.listTokenAuditEvents({ project_id: "project", limit: 100 }))
      .filter((event) => event.action === "token.revoked" && event.target === issued.record.id).length;
    expect(firstRevokeCount).toBe(1);
    expect(secondRevokeCount).toBe(1);
    try {
      await store.authenticateAccessToken(issued.token, "project");
      throw new Error("Expected revoked token authentication to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(store.AccessTokenAuthenticationError);
      expect(error.reason).toBe("revoked");
      expect(error.actor.token_id).toBe(issued.record.id);
    }

    const expired = await store.createAccessToken({
      kind: "external",
      name: "Expired bot",
      grants: [{ project_id: "project", role: "observer" }],
      created_by: "test",
      expires_at: "2020-01-01T00:00:00.000Z",
    });
    try {
      await store.authenticateAccessToken(expired.token, "project");
      throw new Error("Expected expired token authentication to fail");
    } catch (error) {
      expect(error.reason).toBe("expired");
      expect(error.actor.token_id).toBe(expired.record.id);
    }

    await store.pruneTokenAuditEvents(2);
    expect(await store.listTokenAuditEvents({ limit: 100 })).toHaveLength(2);
  `);
});

test("internal tokens are stable per agent profile and removed profiles are revoked", async () => {
  await worker(`
    const first = await store.reconcileInternalProfileTokens("project", [
      { id: "claude", title: "Claude" },
      { id: "codex", title: "Codex" },
    ]);
    const second = await store.reconcileInternalProfileTokens("project", [
      { id: "claude", title: "Claude" },
      { id: "codex", title: "Codex" },
    ]);
    expect(second.get("claude").record.id).toBe(first.get("claude").record.id);
    expect(second.get("codex").record.id).toBe(first.get("codex").record.id);
    const claude = await store.authenticateAccessToken(first.get("claude").token, "project", "updates.write");
    expect(claude.agent_profile_id).toBe("claude");
    await store.reconcileInternalProfileTokens("project", [{ id: "claude", title: "Claude" }]);
    await expect(store.authenticateAccessToken(first.get("codex").token, "project")).rejects.toThrow("revoked");
  `);
});

test("configuration scopes bootstrap an admin before auth and remote access", async () => {
  await worker(`
    const empty = await store.readConfigurationState("project", "project");
    expect(empty.settings.general.theme).toBe("system");
    expect(empty.settings.auth.enabled).toBe(false);
    expect(empty.settings.integrations.github).toBeNull();
    await expect(store.setAuthenticationEnabled("project", "project", true)).rejects.toThrow("administrator");
    await expect(store.updateRemoteConfiguration("project", "project", {
      ...empty.settings.remote,
      enabled: true,
      ssh_host: "example.test",
    })).rejects.toThrow("authentication");

    const withAdmin = await store.createAuthUser({
      scope_type: "project",
      scope_id: "project",
      display_name: "Owner",
      email: "OWNER@example.test",
      password: "correct horse battery staple",
      role: "member",
    });
    expect(withAdmin.users[0].role).toBe("admin");
    expect(withAdmin.users[0].permission_sets).toEqual([]);
    expect(JSON.stringify(withAdmin)).not.toContain("credential_hash");
    const credential = await store.findAuthCredential("project", "project", "owner@example.test");
    expect(await store.verifyAuthPassword("correct horse battery staple", credential.credential_hash)).toBe(true);
    expect(await store.verifyAuthPassword("wrong password", credential.credential_hash)).toBe(false);

    const enabled = await store.setAuthenticationEnabled("project", "project", true);
    expect(enabled.settings.auth.enabled).toBe(true);
    const remote = await store.updateRemoteConfiguration("project", "project", {
      ...enabled.settings.remote,
      enabled: true,
      ssh_host: "example.test",
      remote_port: 44096,
    });
    expect(remote.settings.remote.enabled).toBe(true);
    expect(remote.settings.remote.remote_port).toBe(44096);
    const themed = await store.updateGeneralConfiguration("project", "project", "dark");
    expect(themed.settings.general.theme).toBe("dark");
    const connected = await store.connectGitHub("project", "project", {
      login: "konductor-bot", name: "Konductor Bot", avatar_url: null, connected_at: new Date().toISOString(),
    });
    expect(connected.settings.integrations.github.login).toBe("konductor-bot");
    const disconnected = await store.disconnectGitHub("project", "project");
    expect(disconnected.settings.integrations.github).toBeNull();
  `);
});

test("a failed transaction preserves committed state and newer database versions are rejected", () => {
  const path = repoLocal(dir).database;
  withDatabase(path, (db) => {
    expect(() => db.transaction(() => {
      db.query("INSERT INTO documents VALUES (?, ?)").run("test", "{}");
      throw new Error("abort");
    }).immediate()).toThrow("abort");
    expect(db.query("SELECT * FROM documents").all()).toEqual([]);
  });
  const db = new Database(path);
  db.exec("PRAGMA user_version = 10");
  db.close();
  expect(() => withDatabase(path, () => null)).toThrow("Unsupported Konductor database version");
});

