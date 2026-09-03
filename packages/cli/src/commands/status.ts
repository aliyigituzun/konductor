import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { listProjectRuns, readStatus } from "@konductor/store";
import {
  fmt,
  header,
  sectionHeader,
  stateColor,
  pctBar,
  relativeTime,
} from "../ui/format.js";
// pctBar is still used for per-phase item rollup display below
import type { Phase } from "@konductor/schema";

const PID_FILE = join(process.env["HOME"] ?? "~", ".konductor", "dashboard.pid");

async function dashboardStatus(): Promise<string> {
  try {
    const raw = await readFile(PID_FILE, "utf-8");
    const pid = parseInt(raw.trim(), 10);
    if (isNaN(pid)) return fmt.gray("stopped");
    try {
      process.kill(pid, 0);
      return `${fmt.green("running")}  ${fmt.dim(`pid ${pid} · http://localhost:5173`)}`;
    } catch {
      return fmt.gray("stopped");
    }
  } catch {
    return fmt.gray("stopped");
  }
}

export async function runStatus(_args: string[]): Promise<void> {
  const cwd = process.cwd();
  const [snap, dash, runs] = await Promise.all([readStatus(cwd), dashboardStatus(), listProjectRuns(cwd)]);

  if (!snap) {
    console.error(`${fmt.red("✗")} No status found. Run ${fmt.bold("konductor init")} first.`);
    process.exit(1);
  }

  console.log(header(`${snap.project.name} — Status`));

  // Overview
  console.log(`  ${fmt.dim("state:")}     ${stateColor(snap.status.state)}`);
  console.log(`  ${fmt.dim("phase:")}     ${snap.status.current_phase_id ?? fmt.gray("none")}`);
  console.log(`  ${fmt.dim("reported:")}  ${relativeTime(snap.report.reported_at)}`);
  console.log(`  ${fmt.dim("dashboard:")}    ${dash}`);
  console.log(`  ${fmt.dim("agents:")}    ${runs.filter((run) => run.status === "running").length} active`);
  if (runs[0]) {
    console.log(
      `  ${fmt.dim("last run:")}   ${runs[0].status}  ${fmt.dim(runs[0].profile_id)}  ${fmt.gray(relativeTime(runs[0].started_at))}`
    );
  }
  console.log();
  console.log(`  ${fmt.dim("summary:")}      ${snap.status.summary}`);

  // Phases
  if (snap.phases.length > 0) {
    console.log(sectionHeader("Phases"));
    for (const phase of snap.phases) {
      const done = phase.items.filter((i) => i.status === "done").length;
      const total = phase.items.length;
      const phasePct = total > 0 ? done / total : 0;
      console.log(
        `  ${fmt.bold(phase.title.padEnd(30))} ${stateColor(phase.status)}  ${fmt.gray(`${done}/${total}`)}  ${pctBar(phasePct, 12)}`
      );
      for (const item of phase.items) {
        const icon =
          item.status === "done"
            ? fmt.green("✓")
            : item.status === "blocked"
            ? fmt.red("✗")
            : item.status === "in_progress"
            ? fmt.cyan("▶")
            : fmt.dim("·");
        console.log(`    ${icon} ${item.title}  ${fmt.gray(`[${item.type}]`)}`);
      }
    }
  }

  // Next actions
  if (snap.next_actions.length > 0) {
    console.log(sectionHeader("Next Actions"));
    snap.next_actions.forEach((a, i) => {
      console.log(`  ${fmt.dim(`${i + 1}.`)} ${a}`);
    });
  }

  console.log();
}
