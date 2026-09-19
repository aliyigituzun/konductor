import type { PreviewInstance } from "@konductor/schema";
import { getProject, readConfig } from "@konductor/store";
import { fmt, header, relativeTime, table } from "../ui/format.js";
import { ensureHostRunning, formatHostRequestError, hostFetch, parseFlag } from "./host-client.js";

/** Thin wrapper over the host's preview routes; the dashboard Reviews tab is the main surface. */

async function projectId(cwd: string, args: string[]): Promise<string> {
  const id = parseFlag(args, "--project") ?? (await readConfig(cwd))?.project_id;
  if (!id) throw new Error("Select a project with --project or run this inside an initialized project.");
  if (!(await getProject(id))) throw new Error(`Project ${id} is not registered with Konductor.`);
  return id;
}

async function hostJson<T>(cwd: string, path: string, init?: RequestInit): Promise<T> {
  const response = await hostFetch(cwd, path, init);
  const payload = await response.json() as T & { error?: string; hint?: string | null };
  if (!response.ok) {
    throw new Error(`${payload.error ?? response.statusText}${payload.hint ? `\n${fmt.dim(payload.hint)}` : ""}`);
  }
  return payload;
}

function statusColor(status: PreviewInstance["status"]): string {
  if (status === "ready") return fmt.green(status);
  if (status === "starting") return fmt.yellow(status);
  return fmt.dim(status);
}

async function start(cwd: string, args: string[]): Promise<void> {
  const branch = parseFlag(args, "--branch", "-b");
  if (!branch) throw new Error("Usage: konductor preview start --branch <name> [--project <id>]");
  const id = await projectId(cwd, args);
  await ensureHostRunning(cwd);
  const preview = await hostJson<PreviewInstance>(cwd, `/projects/${encodeURIComponent(id)}/previews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branch, source: "cli" }),
  });
  console.log(`${fmt.green("✓")} Preview ${fmt.bold(preview.id)} starting: ${preview.branch} on http://127.0.0.1:${preview.port}/`);
  console.log(fmt.dim(`Checkout: ${preview.worktree_path}`));
}

async function list(cwd: string, args: string[]): Promise<void> {
  const id = await projectId(cwd, args);
  const { previews } = await hostJson<{ previews: PreviewInstance[] }>(cwd, `/projects/${encodeURIComponent(id)}/previews`);
  if (previews.length === 0) {
    console.log(fmt.dim("No previews recorded."));
    return;
  }
  console.log(table(
    previews.map((preview) => [
      preview.id.slice(0, 8), preview.branch, String(preview.port), statusColor(preview.status), relativeTime(preview.created_at),
    ]),
    ["ID", "Branch", "Port", "Status", "Started"],
  ));
}

async function stop(cwd: string, args: string[]): Promise<void> {
  const target = args.find((arg) => !arg.startsWith("--"));
  if (!target) throw new Error("Usage: konductor preview stop <id> [--remove-worktree]");
  const id = await projectId(cwd, args);
  const { previews } = await hostJson<{ previews: PreviewInstance[] }>(cwd, `/projects/${encodeURIComponent(id)}/previews`);
  const match = previews.find((preview) => preview.id === target || preview.id.startsWith(target));
  if (!match) throw new Error(`No preview matches ${target}.`);
  const stopped = await hostJson<PreviewInstance>(cwd, `/previews/${encodeURIComponent(match.id)}/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remove_worktree: args.includes("--remove-worktree") }),
  });
  console.log(`${fmt.green("✓")} Preview ${stopped.branch} on :${stopped.port} is ${stopped.status}.`);
}

function help(): void {
  console.log(`
${fmt.bold("konductor preview")} — run a branch for customer review

  preview start --branch <name>      Start the project's preview command on a free port
  preview list                       Show preview instances for this project
  preview stop <id> [--remove-worktree]
`);
}

export async function runPreview(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const subcommand = args[0] ?? "list";
  console.log(header(`konductor preview ${subcommand}`));
  try {
    switch (subcommand) {
      case "start": await start(cwd, args.slice(1)); break;
      case "list": await list(cwd, args.slice(1)); break;
      case "stop": await stop(cwd, args.slice(1)); break;
      case "help":
      case "--help":
      case "-h": help(); break;
      default: throw new Error(`Unknown preview subcommand: ${subcommand}`);
    }
  } catch (error) {
    console.error(`${fmt.red("✗")} ${formatHostRequestError(error)}`);
    process.exit(1);
  }
}
