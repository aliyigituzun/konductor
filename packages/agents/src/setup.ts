import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentAdapterManifest } from "@konductor/schema";
import { HARNESSES_DIR } from "@konductor/store";

const SETUP_VERSION = 2;
const PI_MCP_PACKAGE = "pi-mcp-adapter";

type ManagedInstallSpec = {
  packageName: string;
  binaryName: string;
  ignoreScripts?: boolean;
};

const MANAGED_INSTALLS: Record<string, ManagedInstallSpec> = {
  claude_code: { packageName: "@anthropic-ai/claude-code", binaryName: "claude" },
  codex: { packageName: "@openai/codex", binaryName: "codex" },
  gemini_cli: { packageName: "@google/gemini-cli", binaryName: "gemini" },
  opencode: { packageName: "opencode-ai", binaryName: "opencode" },
  pi: {
    packageName: "@earendil-works/pi-coding-agent",
    binaryName: "pi",
    ignoreScripts: true,
  },
};

export type AdapterSetupStatus = {
  supported: boolean;
  configured: boolean;
  directory: string | null;
  runtime_package: string | null;
  mcp_package: string | null;
  note: string | null;
};

export type AdapterSetupResult = AdapterSetupStatus & {
  changed: boolean;
};

export type AdapterRuntime = {
  binary: string | null;
  args: string[];
  env: Record<string, string>;
};

type CommandResult = { code: number; stdout: string; stderr: string };
type CommandRunner = (
  argv: string[],
  options: { env: Record<string, string> },
) => Promise<CommandResult>;
type BinaryResolver = (binary: string) => string | null;

const defaultRunner: CommandRunner = async (argv, options) => {
  const processHandle = Bun.spawn(argv, {
    env: options.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
    processHandle.exited,
  ]);
  return { code, stdout, stderr };
};

export function adapterSetupDir(
  manifest: Pick<AgentAdapterManifest, "id">,
  root = HARNESSES_DIR,
): string {
  return join(root, manifest.id);
}

export function adapterInstallPackage(
  manifest: Pick<AgentAdapterManifest, "id">,
): string | null {
  return MANAGED_INSTALLS[manifest.id]?.packageName ?? null;
}

function managedBinary(directory: string, spec: ManagedInstallSpec): string {
  return join(directory, "runtime", "node_modules", ".bin", spec.binaryName);
}

export function resolveAdapterBinary(
  manifest: AgentAdapterManifest,
  options: { directory?: string; which?: BinaryResolver } = {},
): string | null {
  const spec = MANAGED_INSTALLS[manifest.id];
  if (spec) {
    const candidate = managedBinary(options.directory ?? adapterSetupDir(manifest), spec);
    if (existsSync(candidate)) return candidate;
  }
  return (options.which ?? Bun.which)(manifest.binary);
}

function markerPath(directory: string): string {
  return join(directory, "setup.json");
}

function mcpServer() {
  return {
    type: "stdio",
    command: "konductor",
    args: ["mcp", "serve"],
  };
}

function configFor(
  manifest: AgentAdapterManifest,
  directory: string,
): { path: string; content: string } | null {
  switch (manifest.mcp.kind) {
    case "mcp_json":
    case "pi_mcp_json":
      return {
        path: join(directory, "mcp.json"),
        content: JSON.stringify({ mcpServers: { konductor: mcpServer() } }, null, 2),
      };
    case "codex_toml":
      return {
        path: join(directory, "config.toml"),
        content:
          `[mcp_servers.konductor]\n` +
          `command = "konductor"\n` +
          `args = ["mcp", "serve"]\n\n` +
          // Preserve workspace containment while avoiding the obsolete trust-mode
          // onboarding prompt in Konductor's isolated Codex home.
          `approval_policy = "on-request"\n` +
          `sandbox_mode = "workspace-write"\n`,
      };
    case "gemini_settings":
      return {
        path: join(directory, "settings.json"),
        content: JSON.stringify(
          {
            mcpServers: {
              konductor: { command: "konductor", args: ["mcp", "serve"] },
            },
          },
          null,
          2,
        ),
      };
    case "opencode_json":
      return {
        path: join(directory, "opencode.json"),
        content: JSON.stringify(
          {
            $schema: "https://opencode.ai/config.json",
            mcp: {
              konductor: {
                type: "local",
                command: ["konductor", "mcp", "serve"],
              },
            },
          },
          null,
          2,
        ),
      };
    case "none":
      return null;
  }
}

/** Benign display defaults for isolated homes. They never grant tool permissions. */
function bootstrapSettingsFor(manifest: AgentAdapterManifest, directory: string): { path: string; content: string } | null {
  if (manifest.mcp.kind !== "pi_mcp_json") return null;
  return {
    path: join(directory, "settings.json"),
    content: JSON.stringify({ theme: "default", quietStartup: true }, null, 2),
  };
}

async function fileMatches(path: string, content: string): Promise<boolean> {
  if (!existsSync(path)) return false;
  try {
    return (await readFile(path, "utf-8")) === content;
  } catch {
    return false;
  }
}

export async function adapterSetupStatus(
  manifest: AgentAdapterManifest,
  options: { directory?: string; which?: BinaryResolver } = {},
): Promise<AdapterSetupStatus> {
  const directory = options.directory ?? adapterSetupDir(manifest);
  const config = configFor(manifest, directory);
  const bootstrap = bootstrapSettingsFor(manifest, directory);
  if (!config) {
    return {
      supported: false,
      configured: false,
      directory: null,
      runtime_package: null,
      mcp_package: null,
      note: `${manifest.title} has no Konductor-managed MCP setup.`,
    };
  }

  let markerValid = false;
  try {
    const marker = JSON.parse(await readFile(markerPath(directory), "utf-8")) as {
      setup_version?: number;
      adapter_id?: string;
      mcp_package?: string | null;
    };
    markerValid =
      marker.setup_version === SETUP_VERSION &&
      marker.adapter_id === manifest.id &&
      (manifest.mcp.kind !== "pi_mcp_json" || marker.mcp_package === PI_MCP_PACKAGE);
  } catch {
    markerValid = false;
  }

  const installSpec = MANAGED_INSTALLS[manifest.id];
  const binaryReady =
    !installSpec ||
    resolveAdapterBinary(manifest, {
      directory,
      ...(options.which ? { which: options.which } : {}),
    }) !== null;

  return {
    supported: true,
    configured: markerValid && binaryReady && (await fileMatches(config.path, config.content)) &&
      (!bootstrap || await fileMatches(bootstrap.path, bootstrap.content)),
    directory,
    runtime_package: installSpec?.packageName ?? null,
    mcp_package: manifest.mcp.kind === "pi_mcp_json" ? PI_MCP_PACKAGE : null,
    note:
      installSpec
        ? `${manifest.title} uses isolated Konductor configuration; authenticate inside it separately if needed.`
        : null,
  };
}

export async function setupAdapter(
  manifest: AgentAdapterManifest,
  options: {
    run?: CommandRunner;
    directory?: string;
    installMissingBinary?: boolean;
    which?: BinaryResolver;
  } = {},
): Promise<AdapterSetupResult> {
  const directory = options.directory ?? adapterSetupDir(manifest);
  const before = await adapterSetupStatus(manifest, {
    directory,
    ...(options.which ? { which: options.which } : {}),
  });
  const config = configFor(manifest, directory);
  if (!config) return { ...before, changed: false };
  if (before.configured) return { ...before, changed: false };

  const installSpec = MANAGED_INSTALLS[manifest.id];
  let adapterBinary: string | null = null;
  let binaryInstalled = false;
  if (installSpec) {
    adapterBinary = resolveAdapterBinary(manifest, {
      directory,
      ...(options.which ? { which: options.which } : {}),
    });
    if (!adapterBinary && !options.installMissingBinary) {
      throw new Error(`${manifest.title} is not installed. Permission is required to install it.`);
    }
    if (!adapterBinary) {
      const npm = (options.which ?? Bun.which)("npm");
      if (!npm) {
        throw new Error(
          `npm is required to install a Konductor-managed copy of ${manifest.title}.`,
        );
      }
      const runtimeDirectory = join(directory, "runtime");
      await mkdir(runtimeDirectory, { recursive: true });
      const installArgs = [npm, "install", "--prefix", runtimeDirectory];
      if (installSpec.ignoreScripts) installArgs.push("--ignore-scripts");
      installArgs.push(installSpec.packageName);
      const installResult = await (options.run ?? defaultRunner)(
        installArgs,
        { env: process.env as Record<string, string> },
      );
      if (installResult.code !== 0) {
        throw new Error(
          `${manifest.title} installation failed: ${installResult.stderr.trim() || installResult.stdout.trim() || `exit ${installResult.code}`}`,
        );
      }
      adapterBinary = managedBinary(directory, installSpec);
      if (!existsSync(adapterBinary)) {
        throw new Error(
          `${manifest.title} installation completed but did not create the expected executable at ${adapterBinary}.`,
        );
      }
      binaryInstalled = true;
    }
  }

  await mkdir(directory, { recursive: true });
  const configChanged = !(await fileMatches(config.path, config.content));
  if (configChanged) await writeFile(config.path, config.content, "utf-8");
  const bootstrap = bootstrapSettingsFor(manifest, directory);
  if (bootstrap && !(await fileMatches(bootstrap.path, bootstrap.content))) {
    await writeFile(bootstrap.path, bootstrap.content, "utf-8");
  }

  if (manifest.mcp.kind === "pi_mcp_json") {
    const result = await (options.run ?? defaultRunner)(
      [adapterBinary!, "install", `npm:${PI_MCP_PACKAGE}`],
      {
        env: {
          ...(process.env as Record<string, string>),
          PI_CODING_AGENT_DIR: directory,
        },
      },
    );
    if (result.code !== 0) {
      throw new Error(
        `Pi could not install ${PI_MCP_PACKAGE}: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`,
      );
    }
  }

  const marker = {
    setup_version: SETUP_VERSION,
    adapter_id: manifest.id,
    mcp_kind: manifest.mcp.kind,
    mcp_package: manifest.mcp.kind === "pi_mcp_json" ? PI_MCP_PACKAGE : null,
    configured_at: new Date().toISOString(),
  };
  await writeFile(markerPath(directory), JSON.stringify(marker, null, 2), "utf-8");

  const after = await adapterSetupStatus(manifest, {
    directory,
    ...(options.which ? { which: options.which } : {}),
  });
  return { ...after, changed: binaryInstalled || configChanged || !before.configured };
}

/** Runtime-only configuration injected into Konductor-launched harnesses. */
export async function adapterRuntime(
  manifest: AgentAdapterManifest,
  options: { directory?: string; which?: BinaryResolver } = {},
): Promise<AdapterRuntime> {
  const status = await adapterSetupStatus(manifest, options);
  if (!status.supported || !status.configured || !status.directory) {
    throw new Error(
      `${manifest.title} is not set up for Konductor MCP. Run ` +
        `\`konductor adapters setup ${manifest.id}\` first.`,
    );
  }

  const directory = status.directory;
  const binary = resolveAdapterBinary(manifest, {
    directory,
    ...(options.which ? { which: options.which } : {}),
  });
  if (MANAGED_INSTALLS[manifest.id] && !binary) {
    throw new Error(
      `${manifest.title} is no longer installed. Run ` +
        `\`konductor adapters setup ${manifest.id}\` again.`,
    );
  }
  switch (manifest.mcp.kind) {
    case "mcp_json":
      return {
        binary,
        args: ["--mcp-config", join(directory, "mcp.json"), "--strict-mcp-config"],
        env: { CLAUDE_CONFIG_DIR: directory },
      };
    case "codex_toml":
      return {
        binary,
        args: [],
        env: { CODEX_HOME: directory },
      };
    case "gemini_settings":
      return {
        binary,
        args: [],
        env: {
          GEMINI_CLI_HOME: join(directory, "home"),
          GEMINI_CLI_SYSTEM_SETTINGS_PATH: join(directory, "settings.json"),
        },
      };
    case "opencode_json":
      return {
        binary,
        args: [],
        env: {
          OPENCODE_CONFIG_DIR: directory,
          OPENCODE_CONFIG_CONTENT: await readFile(join(directory, "opencode.json"), "utf-8"),
          XDG_CACHE_HOME: join(directory, "cache"),
          XDG_CONFIG_HOME: join(directory, "config"),
          XDG_DATA_HOME: join(directory, "data"),
          XDG_STATE_HOME: join(directory, "state"),
        },
      };
    case "pi_mcp_json":
      return {
        binary,
        args: [],
        env: { PI_CODING_AGENT_DIR: directory },
      };
    case "none":
      return { binary: null, args: [], env: {} };
  }
}
