import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { builtinAdapters } from "./adapters/builtin.js";
import {
  adapterRuntime,
  adapterSetupStatus,
  resolveAdapterBinary,
  setupAdapter,
} from "./setup.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "konductor-harness-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

function adapter(id: string) {
  return builtinAdapters().find((item) => item.id === id)!;
}

describe("isolated adapter setup", () => {
  test("writes Claude MCP config outside the project and injects it only at runtime", async () => {
    const directory = await temporaryDirectory();
    const claude = { ...adapter("claude_code"), binary: process.execPath };
    expect((await adapterSetupStatus(claude, { directory })).configured).toBe(false);

    const result = await setupAdapter(claude, { directory });
    expect(result.configured).toBe(true);
    expect(JSON.parse(await readFile(join(directory, "mcp.json"), "utf-8"))).toEqual({
      mcpServers: {
        konductor: {
          type: "stdio",
          command: "konductor",
          args: ["mcp", "serve"],
        },
      },
    });
    expect(await adapterRuntime(claude, { directory })).toEqual({
      binary: process.execPath,
      args: ["--mcp-config", join(directory, "mcp.json"), "--strict-mcp-config"],
      env: { CLAUDE_CONFIG_DIR: directory },
    });
    expect((await setupAdapter(claude, { directory })).changed).toBe(false);
  });

  test("installs the popular Pi MCP package into an isolated Pi agent directory", async () => {
    const directory = await temporaryDirectory();
    const calls: Array<{ argv: string[]; env: Record<string, string> }> = [];

    // The real binary check happens before the injectable runner. Give this test a
    // known executable while keeping the manifest's setup behavior otherwise intact.
    const pi = { ...adapter("pi"), binary: process.execPath };
    const result = await setupAdapter(pi, {
      directory,
      run: async (argv, options) => {
        calls.push({ argv, env: options.env });
        return { code: 0, stdout: "installed", stderr: "" };
      },
    });

    expect(result.configured).toBe(true);
    expect(result.mcp_package).toBe("pi-mcp-adapter");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.argv).toEqual([process.execPath, "install", "npm:pi-mcp-adapter"]);
    expect(calls[0]!.env["PI_CODING_AGENT_DIR"]).toBe(directory);
    expect((await adapterRuntime(pi, { directory })).env).toEqual({
      PI_CODING_AGENT_DIR: directory,
    });
  });

  test("installs a missing Pi binary into the Konductor-owned harness directory", async () => {
    const directory = await temporaryDirectory();
    const calls: string[][] = [];
    const managedBinary = join(directory, "runtime", "node_modules", ".bin", "pi");

    const result = await setupAdapter(adapter("pi"), {
      directory,
      installMissingBinary: true,
      which: (binary) => binary === "npm" ? "/usr/bin/npm" : null,
      run: async (argv) => {
        calls.push(argv);
        if (argv[0] === "/usr/bin/npm") {
          await mkdir(join(directory, "runtime", "node_modules", ".bin"), { recursive: true });
          await writeFile(managedBinary, "#!/bin/sh\n");
        }
        return { code: 0, stdout: "installed", stderr: "" };
      },
    });

    expect(result.configured).toBe(true);
    expect(calls[0]).toEqual([
      "/usr/bin/npm",
      "install",
      "--prefix",
      join(directory, "runtime"),
      "--ignore-scripts",
      "@earendil-works/pi-coding-agent",
    ]);
    expect(calls[1]).toEqual([managedBinary, "install", "npm:pi-mcp-adapter"]);
    expect((await adapterRuntime(adapter("pi"), { directory })).binary).toBe(managedBinary);
  });

  test("requires explicit permission before installing a missing Pi binary", async () => {
    const directory = await temporaryDirectory();
    await expect(setupAdapter(adapter("pi"), {
      directory,
      which: () => null,
    })).rejects.toThrow(/Permission is required/);
  });

  test("prefers a managed runtime over a system binary once installed", async () => {
    const directory = await temporaryDirectory();
    const managed = join(directory, "runtime", "node_modules", ".bin", "codex");
    await mkdir(join(directory, "runtime", "node_modules", ".bin"), { recursive: true });
    await writeFile(managed, "#!/bin/sh\n");
    expect(resolveAdapterBinary(adapter("codex"), {
      directory,
      which: () => "/usr/local/bin/codex",
    })).toBe(managed);
  });

  test("creates isolated runtime overlays for Codex, Gemini CLI, and OpenCode", async () => {
    const runtimes = new Map<string, Awaited<ReturnType<typeof adapterRuntime>>>();
    for (const id of ["codex", "gemini_cli", "opencode"]) {
      const directory = await temporaryDirectory();
      const manifest = { ...adapter(id), binary: process.execPath };
      await setupAdapter(manifest, { directory });
      const status = await adapterSetupStatus(manifest, { directory });
      expect(status.configured).toBe(true);
      const runtime = await adapterRuntime(manifest, { directory });
      runtimes.set(id, runtime);
      expect(runtime.binary).toBe(process.execPath);
      expect(runtime.args.length + Object.keys(runtime.env).length).toBeGreaterThan(0);
    }
    expect(runtimes.get("codex")!.env.CODEX_HOME).toContain("konductor-harness-test-");
    expect(runtimes.get("codex")!.args).toEqual([]);
    expect(runtimes.get("gemini_cli")!.env.GEMINI_CLI_HOME).toEndWith("/home");
    expect(runtimes.get("gemini_cli")!.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH).toEndWith(
      "/settings.json",
    );
    expect(runtimes.get("opencode")!.env.OPENCODE_CONFIG_DIR).toContain(
      "konductor-harness-test-",
    );
    expect(runtimes.get("opencode")!.env.XDG_DATA_HOME).toEndWith("/data");
    expect(runtimes.get("opencode")!.env.XDG_CONFIG_HOME).toEndWith("/config");
    const opencodeDirectory = runtimes.get("opencode")!.env.OPENCODE_CONFIG_DIR!;
    expect(JSON.parse(await readFile(join(opencodeDirectory, "opencode.json"), "utf-8"))).toEqual({
      $schema: "https://opencode.ai/config.json",
      mcp: {
        konductor: {
          type: "local",
          command: ["konductor", "mcp", "serve"],
        },
      },
    });
  });

  test("can install every built-in harness into its own managed runtime", async () => {
    const cases = [
      ["claude_code", "@anthropic-ai/claude-code", "claude"],
      ["codex", "@openai/codex", "codex"],
      ["gemini_cli", "@google/gemini-cli", "gemini"],
      ["opencode", "opencode-ai", "opencode"],
    ] as const;

    for (const [id, packageName, binaryName] of cases) {
      const directory = await temporaryDirectory();
      const expectedBinary = join(directory, "runtime", "node_modules", ".bin", binaryName);
      const calls: string[][] = [];
      await setupAdapter(adapter(id), {
        directory,
        installMissingBinary: true,
        which: (binary) => binary === "npm" ? "/usr/bin/npm" : null,
        run: async (argv) => {
          calls.push(argv);
          await mkdir(join(directory, "runtime", "node_modules", ".bin"), { recursive: true });
          await writeFile(expectedBinary, "#!/bin/sh\n");
          return { code: 0, stdout: "installed", stderr: "" };
        },
      });
      expect(calls[0]).toEqual([
        "/usr/bin/npm",
        "install",
        "--prefix",
        join(directory, "runtime"),
        packageName,
      ]);
      expect((await adapterRuntime(adapter(id), {
        directory,
        which: () => null,
      })).binary).toBe(expectedBinary);
    }
  });

  test("refuses runtime injection before setup has completed", async () => {
    const directory = await temporaryDirectory();
    await expect(adapterRuntime(adapter("codex"), { directory })).rejects.toThrow(
      /konductor adapters setup codex/,
    );
  });
});
