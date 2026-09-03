#!/usr/bin/env bun
import { runInit } from "./commands/init.js";
import { runProjects } from "./commands/projects.js";
import { runStatus } from "./commands/status.js";
import { runIssues } from "./commands/issues.js";
import { runStats } from "./commands/stats.js";
import { runSync } from "./commands/sync.js";
import { runDashboard } from "./commands/dashboard.js";
import { runMcpServe } from "./commands/mcp.js";
import { runDoctor } from "./commands/doctor.js";
import { runTelemetry } from "./commands/telemetry.js";
import { runDelete } from "./commands/delete.js";
import { runHost } from "./commands/host.js";
import { runRun } from "./commands/run.js";
import { fmt } from "./ui/format.js";

const args = process.argv.slice(2);
const [command, ...rest] = args;

const USAGE = `
${fmt.bold("konductor")} — local-first project oversight for agent-assisted repos

${fmt.bold("Usage:")}
  konductor <command> [options]

${fmt.bold("Commands:")}
  init              Initialize this repo for Konductor
  delete            Remove a project from Konductor
  projects          List all registered projects (flags moved/missing ones)
  status            Show current project status
  issues            Show blockers, decisions, and dependencies
  stats             Show token and telemetry stats
  sync              Write history snapshot
  host start        Start the local Claude host daemon
  host stop         Stop the local Claude host daemon
  host status       Show host daemon status
  run start         Start a Claude run through the host
  run list          List recorded runs for this project
  run show          Show one run summary
  run logs          Show stored terminal output for a run
  run stop          Stop a running run
  telemetry start   Start background OTEL receiver
  telemetry stop    Stop background OTEL receiver
  telemetry status  Show receiver status
  dashboard         Launch the local dashboard
  mcp serve         Start the MCP server for Claude Code (stdio, stays running)
  doctor            Check your Konductor setup

${fmt.bold("Options:")}
  --empty        (init only) Skip inference, write minimal config
  --project <id> (delete only) Delete a project by ID from anywhere
  --keep-local   (delete only) Remove from registry only, keep local files
  --force, -f    (delete only) Skip confirmation prompt
  --dry-run      (delete only) Preview what would be deleted without acting
  --background   (dashboard) Run Vite in background and return
  --stop         (dashboard) Stop a background dashboard process
  --prompt       (run start) Prompt text for Claude
  --help         Show this help message

${fmt.bold("Examples:")}
  konductor init
  konductor host start
  konductor run start --prompt "Investigate the current blockers"
  konductor mcp serve
  konductor status
  konductor doctor
`;

async function main() {
  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    return;
  }

  switch (command) {
    case "init":
      await runInit(rest);
      break;
    case "delete":
      await runDelete(rest);
      break;
    case "projects":
    case "list":
      await runProjects(rest);
      break;
    case "status":
      await runStatus(rest);
      break;
    case "issues":
      await runIssues(rest);
      break;
    case "stats":
      await runStats(rest);
      break;
    case "sync":
      await runSync(rest);
      break;
    case "host":
      await runHost(rest);
      break;
    case "run":
      await runRun(rest);
      break;
    case "dashboard":
      await runDashboard(rest);
      break;
    case "mcp":
      if (rest[0] === "serve") {
        await runMcpServe(rest.slice(1));
      } else {
        console.error(`Unknown mcp subcommand: ${rest[0]}`);
        console.error("Usage: konductor mcp serve");
        process.exit(1);
      }
      break;
    case "doctor":
      await runDoctor(rest);
      break;
    case "telemetry":
      await runTelemetry(rest);
      break;
    default:
      console.error(`${fmt.red("✗")} Unknown command: ${command}`);
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(`${fmt.red("✗")} Fatal error:`, e);
  process.exit(1);
});
