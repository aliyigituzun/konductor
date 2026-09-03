import { readStatus } from "@konductor/store";
import { fmt, header, sectionHeader, table } from "../ui/format.js";

export async function runIssues(_args: string[]): Promise<void> {
  const cwd = process.cwd();
  const snap = await readStatus(cwd);

  if (!snap) {
    console.error(`${fmt.red("✗")} No status found. Run ${fmt.bold("konductor init")} first.`);
    process.exit(1);
  }

  console.log(header(`${snap.project.name} — Issues`));

  const { blockers, decisions_needed, external_dependencies, risks } = snap.issues;

  // Blockers
  console.log(sectionHeader(`Blockers (${blockers.length})`));
  if (blockers.length === 0) {
    console.log(`  ${fmt.gray("None")}\n`);
  } else {
    const rows = blockers.map((b) => [
      b.id,
      b.severity.toUpperCase(),
      b.owner ?? "—",
      b.summary,
    ]);
    console.log(table(rows, ["ID", "SEVERITY", "OWNER", "SUMMARY"]));
    console.log();
    for (const b of blockers) {
      if (b.unblock_condition) {
        console.log(`  ${fmt.dim("Unblock:")} ${b.unblock_condition}`);
      }
    }
  }

  // Decisions needed
  console.log(sectionHeader(`Decisions Needed (${decisions_needed.length})`));
  if (decisions_needed.length === 0) {
    console.log(`  ${fmt.gray("None")}\n`);
  } else {
    const rows = decisions_needed.map((d) => [
      d.id,
      d.impact.toUpperCase(),
      d.owner ?? "—",
      d.summary,
    ]);
    console.log(table(rows, ["ID", "IMPACT", "OWNER", "SUMMARY"]));
    console.log();
  }

  // External dependencies
  console.log(sectionHeader(`External Dependencies (${external_dependencies.length})`));
  if (external_dependencies.length === 0) {
    console.log(`  ${fmt.gray("None")}\n`);
  } else {
    const rows = external_dependencies.map((d) => [
      d.id,
      d.type,
      d.status,
      d.owner ?? "—",
      d.summary,
    ]);
    console.log(table(rows, ["ID", "TYPE", "STATUS", "OWNER", "SUMMARY"]));
    console.log();
  }

  // Risks
  if (risks.length > 0) {
    console.log(sectionHeader("Risks"));
    risks.forEach((r, i) => {
      console.log(`  ${fmt.dim(`${i + 1}.`)} ${r}`);
    });
    console.log();
  }
}
