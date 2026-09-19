import {
  formatPortRange,
  parsePortRange,
  readHostPortSettings,
  releaseHostPorts,
  reserveHostPorts,
  saveHostPortSettings,
} from "@konductor/store";
import { fmt, header, table } from "../ui/format.js";

/**
 * Machine-wide port bookkeeping. Reserved ports are never handed to a preview
 * instance; the preview range is the pool previews draw from.
 */

function option(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

async function list(): Promise<void> {
  const settings = await readHostPortSettings();
  console.log(`Preview range: ${fmt.bold(formatPortRange(settings.preview_range))}`);
  if (settings.reserved.length === 0) {
    console.log(fmt.dim("No reserved ports."));
    return;
  }
  console.log(table(
    settings.reserved.map((range) => [formatPortRange(range), range.label || fmt.dim("—")]),
    ["Reserved", "Label"],
  ));
}

async function reserve(args: string[]): Promise<void> {
  const target = args.find((arg) => !arg.startsWith("--") && arg !== option(args, "--label"));
  if (!target) throw new Error("Usage: konductor ports reserve <port|start-end> [--label <text>]");
  const settings = await reserveHostPorts(parsePortRange(target), option(args, "--label") ?? "");
  console.log(`${fmt.green("✓")} Reserved ${target}. ${settings.reserved.length} reservation(s) on this machine.`);
}

async function release(args: string[]): Promise<void> {
  const target = args.find((arg) => !arg.startsWith("--"));
  if (!target) throw new Error("Usage: konductor ports release <port|start-end>");
  await releaseHostPorts(parsePortRange(target));
  console.log(`${fmt.green("✓")} Released ${target}.`);
}

async function range(args: string[]): Promise<void> {
  const target = args.find((arg) => !arg.startsWith("--"));
  if (!target) throw new Error("Usage: konductor ports range <start-end>");
  const current = await readHostPortSettings();
  const saved = await saveHostPortSettings({ ...current, preview_range: parsePortRange(target) });
  console.log(`${fmt.green("✓")} Previews now draw from ${formatPortRange(saved.preview_range)}.`);
}

function help(): void {
  console.log(`
${fmt.bold("konductor ports")} — ports previews must stay off

  ports list                         Show the preview range and reserved ports
  ports reserve <port|a-b> [--label] Mark a port or range as taken on this machine
  ports release <port|a-b>           Remove a reservation (exact match)
  ports range <a-b>                  Set the pool preview instances draw from
`);
}

export async function runPorts(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "list";
  console.log(header(`konductor ports ${subcommand}`));
  switch (subcommand) {
    case "list": await list(); break;
    case "reserve": await reserve(args.slice(1)); break;
    case "release": await release(args.slice(1)); break;
    case "range": await range(args.slice(1)); break;
    case "help":
    case "--help":
    case "-h": help(); break;
    default: throw new Error(`Unknown ports subcommand: ${subcommand}`);
  }
}
