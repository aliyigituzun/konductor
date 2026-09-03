import { readFile } from "node:fs/promises";
import { readConfig } from "@konductor/store";
import { fmt, header, table } from "../ui/format.js";
import { formatHostRequestError, hostFetch, parseFlag } from "./host-client.js";

type AgentRow = {
  slug: string;
  run_id: string;
  adapter_id: string;
  adapter_title: string;
  transport: string;
  session_name: string | null;
  pane_id: string | null;
  agent_status: string;
  reason: string;
  cwd: string | null;
  worktree_path: string | null;
  branch: string | null;
  feature_item_title: string | null;
  started_at: string | null;
};

function usage(): never {
  console.error("Usage:");
  console.error("  konductor agent start [--adapter <id>] [--profile <id>] [--slug <name>]");
  console.error("                        (--task <text> | --task-file <path>)");
  console.error("                        [--packs <a,b>] [--feature <id>] [--worktree] [--headless]");
  console.error("  konductor agent list");
  console.error("  konductor agent send <slug> <message>");
  console.error("  konductor agent read <slug> [--scrollback] [--lines <n>]");
  console.error("  konductor agent status <slug>");
  console.error("  konductor agent explain <slug>");
  console.error("  konductor agent stop <slug>");
  console.error("  konductor agent attach [<slug>]");
  process.exit(1);
}

async function currentProjectId(cwd: string): Promise<string> {
  const config = await readConfig(cwd);
  if (!config) {
    console.error(
      `${fmt.red("✗")} No konductor.config.json found. Run ${fmt.bold("konductor init")} first.`,
    );
    process.exit(1);
  }
  return config.project_id;
}

type HostError = { error?: string; code?: string; hint?: string; details?: string[] };

async function hostJson<T>(res: Response, action: string): Promise<T> {
  const text = await res.text();
  const body = text.trim() ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (body ?? {}) as HostError;
    console.error(`${fmt.red("✗")} ${action}: ${err.error ?? `HTTP ${res.status}`}`);
    if (err.code) console.error(`  ${fmt.dim("code:")} ${err.code}`);
    if (err.hint) console.error(`  ${fmt.dim("hint:")} ${err.hint}`);
    for (const detail of err.details ?? []) console.error(`  ${fmt.dim("detail:")} ${detail}`);
    process.exit(1);
  }
  return body as T;
}

function statusColor(status: string): string {
  switch (status) {
    case "working":
      return fmt.cyan(status);
    case "idle":
      return fmt.green(status);
    case "blocked":
      return fmt.yellow(status);
    case "dead":
      return fmt.red(status);
    default:
      return fmt.dim(status);
  }
}

async function start(cwd: string, args: string[]): Promise<void> {
  const taskText = parseFlag(args, "--task", "-t");
  const taskFile = parseFlag(args, "--task-file");

  if (!taskText && !taskFile) {
    console.error(`${fmt.red("✗")} Provide the task with --task or --task-file.`);
    usage();
  }
  // A brief long enough to be worth writing down belongs in a file; --task is for
  // one-liners.
  const prompt = taskFile ? await readFile(taskFile, "utf-8") : taskText!;

  const projectId = await currentProjectId(cwd);
  const packs = parseFlag(args, "--packs");
  const body = {
    profile_id: parseFlag(args, "--profile"),
    prompt,
    prompt_packs: packs ? packs.split(",").map((p) => p.trim()).filter(Boolean) : undefined,
    feature_item_id: parseFlag(args, "--feature") ?? null,
    slug: parseFlag(args, "--slug"),
    mode: args.includes("--headless") ? ("headless" as const) : undefined,
    worktree: args.includes("--worktree") ? true : undefined,
    source: "cli" as const,
  };

  const res = await hostFetch(cwd, `/projects/${encodeURIComponent(projectId)}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const run = await hostJson<{
    id: string;
    slug: string;
    adapter_id: string;
    transport: string;
    pane_id: string | null;
    session_name: string | null;
    working_directory?: string;
    branch: string | null;
  }>(res, "Could not start agent");

  console.log(`${fmt.green("✓")} Agent ${fmt.bold(run.slug)} started`);
  console.log(`  ${fmt.dim("run id:")}    ${run.id}`);
  console.log(`  ${fmt.dim("adapter:")}   ${run.adapter_id}`);
  console.log(`  ${fmt.dim("transport:")} ${run.transport}`);
  if (run.pane_id) console.log(`  ${fmt.dim("pane:")}      ${run.pane_id}`);
  if (run.working_directory) console.log(`  ${fmt.dim("cwd:")}       ${run.working_directory}`);
  if (run.branch) console.log(`  ${fmt.dim("branch:")}    ${run.branch}`);
  console.log();
  console.log(`  ${fmt.dim("watch:")}  konductor agent read ${run.slug}`);
  console.log(`  ${fmt.dim("take over:")} konductor agent attach ${run.slug}`);
  console.log();
}

async function list(cwd: string): Promise<void> {
  const res = await hostFetch(cwd, "/agents");
  const { agents } = await hostJson<{ agents: AgentRow[] }>(res, "Could not list agents");

  console.log(header("konductor agents"));
  if (agents.length === 0) {
    console.log(`${fmt.dim("No live agents.")}\n`);
    return;
  }
  console.log(
    table(
      agents.map((agent) => [
        fmt.bold(agent.slug),
        agent.adapter_id,
        statusColor(agent.agent_status),
        agent.pane_id ?? (agent.transport === "headless" ? "headless" : "-"),
        agent.branch ?? "-",
        agent.feature_item_title ?? fmt.dim("direct task"),
      ]),
      ["agent", "adapter", "status", "pane", "branch", "task"],
    ),
  );
  console.log();
}

async function send(cwd: string, args: string[]): Promise<void> {
  const [slug, ...rest] = args;
  const message = rest.join(" ").trim();
  if (!slug || !message) usage();

  const res = await hostFetch(cwd, `/agents/${encodeURIComponent(slug)}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });
  await hostJson(res, `Could not send to "${slug}"`);
  console.log(`${fmt.green("✓")} Sent to ${fmt.bold(slug)}\n`);
}

async function read(cwd: string, args: string[]): Promise<void> {
  const [slug] = args;
  if (!slug) usage();
  const params = new URLSearchParams();
  if (args.includes("--scrollback")) params.set("source", "scrollback");
  const lines = parseFlag(args, "--lines", "-n");
  if (lines) params.set("lines", lines);
  if (args.includes("--ansi")) params.set("ansi", "1");

  const res = await hostFetch(
    cwd,
    `/agents/${encodeURIComponent(slug)}/read?${params.toString()}`,
  );
  const { text } = await hostJson<{ text: string }>(res, `Could not read "${slug}"`);
  console.log(text);
}

async function status(cwd: string, args: string[], verbose: boolean): Promise<void> {
  const [slug] = args;
  if (!slug) usage();

  if (!verbose) {
    const res = await hostFetch(cwd, `/agents/${encodeURIComponent(slug)}`);
    const agent = await hostJson<AgentRow>(res, `Could not read "${slug}"`);
    console.log(statusColor(agent.agent_status));
    return;
  }

  const res = await hostFetch(cwd, `/agents/${encodeURIComponent(slug)}/explain`);
  const detail = await hostJson<{
    status: string;
    reason: string;
    matched_pattern: string | null;
    pane_id: string | null;
    adapter_id: string;
    screen_tail: string;
  }>(res, `Could not explain "${slug}"`);

  console.log(header(`agent ${slug}`));
  console.log(`  ${fmt.dim("status:")}  ${statusColor(detail.status)}`);
  console.log(`  ${fmt.dim("why:")}     ${detail.reason}`);
  console.log(`  ${fmt.dim("pattern:")} ${detail.matched_pattern ?? fmt.dim("none")}`);
  console.log(`  ${fmt.dim("adapter:")} ${detail.adapter_id}`);
  console.log(`  ${fmt.dim("pane:")}    ${detail.pane_id ?? "-"}`);
  console.log(`\n${fmt.dim("screen tail:")}`);
  console.log(detail.screen_tail);
  console.log();
}

async function stop(cwd: string, args: string[]): Promise<void> {
  const [slug] = args;
  if (!slug) usage();
  const res = await hostFetch(cwd, `/agents/${encodeURIComponent(slug)}/stop`, { method: "POST" });
  await hostJson(res, `Could not stop "${slug}"`);
  console.log(`${fmt.green("✓")} Stopped ${fmt.bold(slug)}\n`);
}

/**
 * Hand the terminal to the operator.
 *
 * This replaces the CLI process with tmux rather than spawning it, so the operator
 * gets a real attached session and Konductor is out of the way entirely.
 */
async function attach(cwd: string, args: string[]): Promise<void> {
  const [slug] = args;
  const config = await readConfig(cwd);
  const session = config?.host?.tmux_session ?? "konductor";

  let target = session;
  if (slug) {
    const res = await hostFetch(cwd, `/agents/${encodeURIComponent(slug)}`);
    const agent = await hostJson<AgentRow>(res, `Could not find "${slug}"`);
    if (!agent.pane_id) {
      console.error(`${fmt.red("✗")} Agent "${slug}" runs headless and has no pane to attach to.`);
      process.exit(1);
    }
    target = agent.pane_id;
  }

  console.log(`${fmt.dim("attaching to")} ${target} ${fmt.dim("— detach with Ctrl-b d")}\n`);
  const proc = Bun.spawn(["tmux", "attach-session", "-t", target], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(await proc.exited);
}

export async function runAgent(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const [sub, ...rest] = args;

  try {
    switch (sub) {
      case "start":
        return await start(cwd, rest);
      case "list":
      case "ls":
        return await list(cwd);
      case "send":
        return await send(cwd, rest);
      case "read":
        return await read(cwd, rest);
      case "status":
        return await status(cwd, rest, false);
      case "explain":
        return await status(cwd, rest, true);
      case "stop":
        return await stop(cwd, rest);
      case "attach":
        return await attach(cwd, rest);
      default:
        return usage();
    }
  } catch (error) {
    console.error(formatHostRequestError(error));
    process.exit(1);
  }
}
