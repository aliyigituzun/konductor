import { readConfig, listProjectRuns } from "@konductor/store";
import { fmt, header, sectionHeader } from "../ui/format.js";
import { ensureHostRunning, formatHostRequestError, hostFetch, parseFlag } from "./host-client.js";

type RunApiError = {
  error?: string;
  code?: string;
  hint?: string;
  details?: string[];
  run_id?: string;
};

function usage(): never {
  console.error("Usage:");
  console.error("  konductor run start --prompt <text> [--profile <id>] [--packs <a,b>] [--feature <id>]");
  console.error("  konductor run list");
  console.error("  konductor run show <run-id>");
  console.error("  konductor run logs <run-id>");
  console.error("  konductor run stop <run-id>");
  process.exit(1);
}

async function currentProjectId(cwd: string): Promise<string> {
  const config = await readConfig(cwd);
  if (!config) {
    console.error(`${fmt.red("✗")} No konductor.config.json found. Run ${fmt.bold("konductor init")} first.`);
    process.exit(1);
  }
  return config.project_id;
}

async function readJsonBody<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function printRunApiError(prefix: string, body: RunApiError | null, fallback: string): never {
  console.error(`${fmt.red("✗")} ${prefix}${body?.error ?? fallback}`);
  if (body?.code) {
    console.error(`  ${fmt.dim("code:")}   ${body.code}`);
  }
  if (body?.hint) {
    console.error(`  ${fmt.dim("hint:")}   ${body.hint}`);
  }
  if (body?.run_id) {
    console.error(`  ${fmt.dim("run id:")} ${body.run_id}`);
  }
  for (const detail of body?.details ?? []) {
    console.error(`  ${fmt.dim("detail:")} ${detail}`);
  }
  process.exit(1);
}

async function start(cwd: string, args: string[]): Promise<void> {
  const prompt = parseFlag(args, "--prompt", "-p");
  if (!prompt) usage();
  const projectId = await currentProjectId(cwd);
  try {
    await ensureHostRunning(cwd);
  } catch (error) {
    console.error(`${fmt.red("✗")} Could not start Konductor host.`);
    console.error(`  ${fmt.dim(formatHostRequestError(error))}`);
    process.exit(1);
  }
  const profileId = parseFlag(args, "--profile");
  const featureItemId = parseFlag(args, "--feature");
  const packsRaw = parseFlag(args, "--packs");
  const promptPacks = packsRaw ? packsRaw.split(",").map((item) => item.trim()).filter(Boolean) : undefined;

  let res: Response;
  try {
    res = await hostFetch(cwd, `/projects/${projectId}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile_id: profileId,
        prompt,
        prompt_packs: promptPacks,
        feature_item_id: featureItemId ?? null,
        source: "cli",
      }),
    });
  } catch (error) {
    console.error(`${fmt.red("✗")} ${formatHostRequestError(error)}`);
    process.exit(1);
  }

  const body = await readJsonBody<{ id?: string; status?: string; error?: string; command?: string } & RunApiError>(res);
  if (!res.ok) {
    printRunApiError("Failed to start run. ", body, "Failed to start run");
  }

  console.log(header("konductor run start"));
  console.log(`${fmt.green("✓")} Run started`);
  console.log(`  ${fmt.dim("id:")}      ${body?.id}`);
  console.log(`  ${fmt.dim("status:")}  ${body?.status}`);
  console.log(`  ${fmt.dim("command:")} ${((body?.command ?? "").slice(0, 120))}${(body?.command ?? "").length > 120 ? "…" : ""}`);
  console.log();
}

async function list(cwd: string): Promise<void> {
  const config = await readConfig(cwd);
  if (!config) {
    console.error(`${fmt.red("✗")} No konductor.config.json found.`);
    process.exit(1);
  }
  const runs = await listProjectRuns(cwd);
  console.log(header("konductor run list"));
  if (runs.length === 0) {
    console.log(`  ${fmt.dim("No runs recorded yet.")}\n`);
    return;
  }
  for (const run of runs) {
    console.log(
      `  ${fmt.bold(run.id)}  ${run.status.padEnd(9)}  ${fmt.dim(run.profile_id)}  ${run.feature_item_id ?? "direct"}`
    );
    console.log(`     ${run.prompt_excerpt}`);
  }
  console.log();
}

async function show(cwd: string, runId: string): Promise<void> {
  let res: Response;
  try {
    res = await hostFetch(cwd, `/runs/${runId}`);
  } catch (error) {
    console.error(`${fmt.red("✗")} ${formatHostRequestError(error)}`);
    process.exit(1);
  }
  const body = await readJsonBody<Record<string, unknown> & RunApiError>(res);
  if (!res.ok) {
    printRunApiError("", body, "Run not found");
  }

  console.log(header(`Run ${runId}`));
  console.log(`  ${fmt.dim("status:")}   ${String(body?.["status"] ?? "")}`);
  console.log(`  ${fmt.dim("profile:")}  ${String(body?.["profile_id"] ?? "")}`);
  console.log(`  ${fmt.dim("feature:")}  ${String(body?.["feature_item_id"] ?? "direct")}`);
  console.log(`  ${fmt.dim("source:")}   ${String(body?.["source"] ?? "")}`);
  console.log(`  ${fmt.dim("started:")}  ${String(body?.["started_at"] ?? "")}`);
  console.log(`  ${fmt.dim("ended:")}    ${String(body?.["ended_at"] ?? "—")}`);
  console.log(`  ${fmt.dim("command:")}  ${String(body?.["command"] ?? "")}`);
  if (body?.["last_error"]) {
    console.log(`  ${fmt.dim("error:")}    ${String(body["last_error"])}`);
  }
  console.log(sectionHeader("Prompt"));
  console.log(`  ${String(body?.["prompt_excerpt"] ?? "")}`);
  console.log();
}

async function logs(cwd: string, runId: string): Promise<void> {
  let res: Response;
  try {
    res = await hostFetch(cwd, `/runs/${runId}/terminal`);
  } catch (error) {
    console.error(`${fmt.red("✗")} ${formatHostRequestError(error)}`);
    process.exit(1);
  }
  const body = await readJsonBody<{
    error?: string;
    log?: string;
    run?: { status?: string; exit_code?: number | null };
  } & RunApiError>(res);
  if (!res.ok) {
    printRunApiError("", body, "Run not found");
  }

  console.log(header(`Run ${runId} terminal`));
  console.log(`  ${fmt.dim("status:")} ${body?.run?.status ?? "unknown"}`);
  if (body?.run?.exit_code !== undefined) {
    console.log(`  ${fmt.dim("exit:")}   ${body.run.exit_code ?? "—"}`);
  }
  console.log();
  process.stdout.write(body?.log ?? "");
  if (body?.log && !body.log.endsWith("\n")) process.stdout.write("\n");
}

async function stop(cwd: string, runId: string): Promise<void> {
  let res: Response;
  try {
    res = await hostFetch(cwd, `/runs/${runId}/stop`, { method: "POST" });
  } catch (error) {
    console.error(`${fmt.red("✗")} ${formatHostRequestError(error)}`);
    process.exit(1);
  }
  const body = await readJsonBody<{ error?: string; status?: string } & RunApiError>(res);
  if (!res.ok) {
    printRunApiError("Failed to stop run. ", body, "Failed to stop run");
  }
  console.log(header(`Stop ${runId}`));
  console.log(`${fmt.green("✓")} Run stopped`);
  console.log(`  ${fmt.dim("status:")} ${body?.status ?? "stopped"}`);
  console.log();
}

export async function runRun(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const subcommand = args[0];
  if (!subcommand) usage();

  switch (subcommand) {
    case "start":
      await start(cwd, args.slice(1));
      break;
    case "list":
      await list(cwd);
      break;
    case "show":
      if (!args[1]) usage();
      await show(cwd, args[1]);
      break;
    case "logs":
      if (!args[1]) usage();
      await logs(cwd, args[1]);
      break;
    case "stop":
      if (!args[1]) usage();
      await stop(cwd, args[1]);
      break;
    default:
      usage();
  }
}
