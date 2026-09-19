import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureProjectMcpConfig, normalizeConfig } from "./config.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryProject(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "konductor-mcp-config-"));
  temporaryDirectories.push(path);
  return path;
}

describe("ensureProjectMcpConfig", () => {
  test("does not write shell placeholders into the MCP process environment", async () => {
    const cwd = await temporaryProject();

    expect(await ensureProjectMcpConfig(cwd)).toBe(true);

    const config = JSON.parse(await readFile(join(cwd, ".mcp.json"), "utf-8"));
    expect(config.mcpServers.konductor).toEqual({
      type: "stdio",
      command: "konductor",
      args: ["mcp", "serve"],
    });
  });

  test("repairs an existing Konductor entry and preserves other MCP servers", async () => {
    const cwd = await temporaryProject();
    await writeFile(join(cwd, ".mcp.json"), JSON.stringify({
      mcpServers: {
        other: { command: "other-server" },
        konductor: {
          command: "konductor",
          args: ["mcp", "serve"],
          env: { KONDUCTOR_RUN_ID: "${KONDUCTOR_RUN_ID:-}" },
        },
      },
    }));

    expect(await ensureProjectMcpConfig(cwd)).toBe(true);

    const config = JSON.parse(await readFile(join(cwd, ".mcp.json"), "utf-8"));
    expect(config.mcpServers.other).toEqual({ command: "other-server" });
    expect(config.mcpServers.konductor.env).toBeUndefined();
  });
});

test("normalization preserves provider connections", () => {
  const config = normalizeConfig({
    project_id: "demo", project_name: "Demo", repo_root: ".", default_branch: "main",
    agents: {
      default_profile: "", profiles: [], prompt_packs: [], skill_profiles: [],
      provider_connections: [{
        id: "minimax", title: "MiniMax", kind: "remote_api", endpoint: "https://api.minimax.io/v1",
        provider: "minimax", compatible_adapters: ["pi"], models: [], enabled: true,
      }],
    },
  });
  expect(config.agents?.provider_connections?.map((connection) => connection.id)).toEqual(["minimax"]);
});
