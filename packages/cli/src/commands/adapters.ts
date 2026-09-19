import {
  adapterSetupStatus,
  adapterSetupDir,
  adapterInstallPackage,
  detectAdapter,
  loadAdapters,
  setupAdapter,
  resolveAdapterBinary,
  userAdaptersDir,
} from "@konductor/agents";
import { fmt, header, table } from "../ui/format.js";

async function promptConfirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  process.stdout.write(question);
  return new Promise<boolean>((resolve) => {
    process.stdin.setEncoding("utf-8");
    process.stdin.once("data", (chunk) => {
      const answer = String(chunk).trim().toLowerCase();
      resolve(answer === "y" || answer === "yes");
    });
  });
}

function usage(): never {
  console.error("Usage:");
  console.error("  konductor adapters list");
  console.error("  konductor adapters show <id>");
  console.error("  konductor adapters setup <id>");
  process.exit(1);
}

async function list(cwd: string): Promise<void> {
  const registry = await loadAdapters(cwd);
  console.log(header("konductor adapters"));

  const rows = await Promise.all(
    registry.adapters.map(async ({ manifest, source }) => {
      const [detection, setup] = await Promise.all([
        detectAdapter(manifest),
        adapterSetupStatus(manifest),
      ]);
      const installed = detection.installed || resolveAdapterBinary(manifest) !== null;
      return [
        fmt.bold(manifest.id),
        manifest.title,
        installed ? fmt.green("installed") : fmt.dim("not installed"),
        detection.version ?? fmt.dim("-"),
        manifest.providers.map((provider) => provider.id).join(", "),
        source,
        setup.supported
          ? setup.configured
            ? fmt.green("ready")
            : fmt.yellow("setup needed")
          : fmt.dim("n/a"),
        manifest.verified ? fmt.green("verified") : fmt.yellow("unverified"),
      ];
    }),
  );

  console.log(table(rows, ["id", "agent", "binary", "version", "providers", "source", "mcp setup", "flags"]));
  console.log();

  const unverified = registry.adapters.filter((a) => !a.manifest.verified);
  if (unverified.length > 0) {
    console.log(
      `${fmt.yellow("⚠")} ${unverified.length} adapter(s) have invocation flags that were never ` +
        `checked against the real CLI. They will run, but a wrong flag will surface as a launch failure.`,
    );
  }
  for (const issue of registry.issues) {
    console.log(`${fmt.red("✗")} ${issue.path}: ${issue.message}`);
  }
  console.log(`${fmt.dim("Add your own:")} drop a manifest JSON in ${userAdaptersDir()}\n`);
}

async function show(cwd: string, id: string | undefined): Promise<void> {
  if (!id) usage();
  const registry = await loadAdapters(cwd);
  const found = registry.adapters.find((a) => a.manifest.id === id);
  if (!found) {
    console.error(`${fmt.red("✗")} No adapter "${id}".`);
    console.error(`  Known: ${registry.adapters.map((a) => a.manifest.id).join(", ")}`);
    process.exit(1);
  }

  const detection = await detectAdapter(found.manifest);
  const setup = await adapterSetupStatus(found.manifest);
  const resolvedBinary = resolveAdapterBinary(found.manifest);
  console.log(header(`adapter ${found.manifest.id}`));
  console.log(`  ${fmt.dim("title:")}     ${found.manifest.title}`);
  console.log(`  ${fmt.dim("binary:")}    ${found.manifest.binary} ${resolvedBinary ? fmt.dim(`-> ${resolvedBinary}`) : fmt.red("(not installed)")}`);
  console.log(`  ${fmt.dim("version:")}   ${detection.version ?? fmt.dim("unknown")}`);
  console.log(`  ${fmt.dim("source:")}    ${found.source}${found.path ? fmt.dim(` (${found.path})`) : ""}`);
  console.log(`  ${fmt.dim("verified:")}  ${found.manifest.verified ? fmt.green("yes") : fmt.yellow("no")}`);
  console.log(`  ${fmt.dim("mcp:")}       ${found.manifest.mcp.kind}`);
  console.log(
    `  ${fmt.dim("setup:")}     ${
      !setup.supported
        ? fmt.dim("not available")
        : setup.configured
          ? fmt.green(`ready at ${setup.directory}`)
          : fmt.yellow(`run konductor adapters setup ${found.manifest.id}`)
    }`,
  );
  if (setup.mcp_package) console.log(`  ${fmt.dim("package:")}   ${setup.mcp_package}`);
  if (setup.runtime_package) console.log(`  ${fmt.dim("runtime:")}   ${setup.runtime_package}`);
  console.log(`  ${fmt.dim("telemetry:")} ${found.manifest.telemetry.kind}`);
  if (found.manifest.homepage) console.log(`  ${fmt.dim("homepage:")}  ${found.manifest.homepage}`);
  console.log();
  console.log(`  ${fmt.dim("launch:")}   ${[found.manifest.binary, ...found.manifest.launch.args].join(" ")}`);
  console.log(`  ${fmt.dim("resume:")}   ${found.manifest.resume ? [found.manifest.binary, ...found.manifest.resume.args].join(" ") : fmt.dim("unsupported")}`);
  console.log(`  ${fmt.dim("model:")}    ${found.manifest.model_format === "provider/id" ? "passed as provider/model" : "passed as the bare model id"}`);
  console.log();
  const bound = found.manifest.providers.length === 1;
  console.log(`  ${fmt.dim("providers:")} ${bound ? fmt.dim("bound to one vendor") : ""}`);
  for (const provider of found.manifest.providers) {
    const models = provider.models.length > 0
      ? provider.models.map((model) => model.id).join(", ")
      : fmt.dim("any model id");
    console.log(`    ${fmt.bold(provider.id)} ${fmt.dim("(" + provider.title + ")")}: ${models}`);
  }
  console.log();
}

async function setup(cwd: string, id: string | undefined): Promise<void> {
  if (!id) usage();
  const registry = await loadAdapters(cwd);
  const found = registry.adapters.find((item) => item.manifest.id === id);
  if (!found) {
    console.error(`${fmt.red("✗")} No adapter "${id}".`);
    console.error(`  Known: ${registry.adapters.map((item) => item.manifest.id).join(", ")}`);
    process.exit(1);
  }

  console.log(header(`setup ${found.manifest.title}`));
  let installMissingBinary = false;
  const runtimePackage = adapterInstallPackage(found.manifest);
  if (runtimePackage && !resolveAdapterBinary(found.manifest)) {
    console.log(`${found.manifest.title} is required for this adapter and is not installed.`);
    console.log(
      `Konductor can install an isolated copy under ${fmt.dim(`${adapterSetupDir(found.manifest)}/runtime`)} ` +
        `without changing your existing ${found.manifest.title} configuration.`,
    );
    console.log(
      `${fmt.dim("package:")} ${runtimePackage}` +
        (found.manifest.id === "pi" ? ` ${fmt.dim("(npm install --ignore-scripts)")}` : ""),
    );
    installMissingBinary = await promptConfirm(
      `${fmt.yellow("?")} Install ${found.manifest.title} for Konductor now? [y/N] `,
    );
    console.log();
    if (!installMissingBinary) {
      console.log(`${fmt.dim(`Cancelled. ${found.manifest.title} was not installed.`)}\n`);
      return;
    }
  }
  const result = await setupAdapter(found.manifest, { installMissingBinary });
  if (!result.supported) {
    console.log(`${fmt.yellow("!")} ${result.note}`);
    return;
  }
  console.log(`${fmt.green("✓")} Konductor-managed harness setup is ready.`);
  console.log(`  ${fmt.dim("directory:")} ${result.directory}`);
  if (result.mcp_package) console.log(`  ${fmt.dim("package:")}   ${result.mcp_package}`);
  if (result.note) console.log(`  ${fmt.dim("note:")}      ${result.note}`);
  console.log();
}

export async function runAdapters(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const [sub, ...rest] = args;
  switch (sub) {
    case "list":
    case undefined:
      return list(cwd);
    case "show":
      return show(cwd, rest[0]);
    case "setup":
      return setup(cwd, rest[0]);
    default:
      return usage();
  }
}
