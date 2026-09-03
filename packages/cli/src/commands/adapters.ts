import { detectAdapter, loadAdapters, userAdaptersDir } from "@konductor/agents";
import { fmt, header, table } from "../ui/format.js";

function usage(): never {
  console.error("Usage:");
  console.error("  konductor adapters list");
  console.error("  konductor adapters show <id>");
  process.exit(1);
}

async function list(cwd: string): Promise<void> {
  const registry = await loadAdapters(cwd);
  console.log(header("konductor adapters"));

  const rows = await Promise.all(
    registry.adapters.map(async ({ manifest, source }) => {
      const detection = await detectAdapter(manifest);
      return [
        fmt.bold(manifest.id),
        manifest.title,
        detection.installed ? fmt.green("installed") : fmt.dim("not installed"),
        detection.version ?? fmt.dim("-"),
        source,
        manifest.verified ? fmt.green("verified") : fmt.yellow("unverified"),
      ];
    }),
  );

  console.log(table(rows, ["id", "agent", "binary", "version", "source", "flags"]));
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
  console.log(header(`adapter ${found.manifest.id}`));
  console.log(`  ${fmt.dim("title:")}     ${found.manifest.title}`);
  console.log(`  ${fmt.dim("binary:")}    ${found.manifest.binary} ${detection.path ? fmt.dim(`-> ${detection.path}`) : fmt.red("(not on PATH)")}`);
  console.log(`  ${fmt.dim("version:")}   ${detection.version ?? fmt.dim("unknown")}`);
  console.log(`  ${fmt.dim("source:")}    ${found.source}${found.path ? fmt.dim(` (${found.path})`) : ""}`);
  console.log(`  ${fmt.dim("verified:")}  ${found.manifest.verified ? fmt.green("yes") : fmt.yellow("no")}`);
  console.log(`  ${fmt.dim("mcp:")}       ${found.manifest.mcp.kind}`);
  console.log(`  ${fmt.dim("telemetry:")} ${found.manifest.telemetry.kind}`);
  if (found.manifest.homepage) console.log(`  ${fmt.dim("homepage:")}  ${found.manifest.homepage}`);
  console.log();
  console.log(`  ${fmt.dim("pane:")}     ${found.manifest.interactive ? [found.manifest.binary, ...found.manifest.interactive.args].join(" ") : fmt.dim("unsupported")}`);
  console.log(`  ${fmt.dim("headless:")} ${found.manifest.headless ? [found.manifest.binary, ...found.manifest.headless.args].join(" ") : fmt.dim("unsupported")}`);
  console.log(`  ${fmt.dim("resume:")}   ${found.manifest.resume ? [found.manifest.binary, ...found.manifest.resume.args].join(" ") : fmt.dim("unsupported")}`);
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
    default:
      return usage();
  }
}
