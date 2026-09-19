import { listDecisions, readStatus } from "@konductor/store";
import { fmt, header, sectionHeader, table } from "../ui/format.js";

export async function runIssues(_args: string[]): Promise<void> {
  const cwd = process.cwd();
  const snap = await readStatus(cwd);

  if (!snap) {
    console.error(`${fmt.red("✗")} No status found. Run ${fmt.bold("konductor init")} first.`);
    process.exit(1);
  }

  console.log(header(`${snap.project.name} — Issues`));

  const { blockers, external_dependencies, risks } = snap.issues;
  const decisions = await listDecisions(cwd);

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

  const openDecisions = decisions.filter((d) => d.status === "open");
  const resolvedDecisions = decisions.filter((d) => d.status === "resolved");
  console.log(sectionHeader(`Decisions Needed (${openDecisions.length})`));
  if (openDecisions.length === 0) {
    console.log(`  ${fmt.gray("None")}\n`);
  } else {
    const rows = openDecisions.map((d) => [
      d.id,
      d.impact.toUpperCase(),
      d.owner ?? "—",
      d.kind === "open_ended" ? "open-ended" : `${d.options.length} option${d.options.length === 1 ? "" : "s"}`,
      d.title,
    ]);
    console.log(table(rows, ["ID", "IMPACT", "OWNER", "OPTIONS", "TITLE"]));
    console.log();
  }

  console.log(sectionHeader(`Decisions Resolved (${resolvedDecisions.length})`));
  if (resolvedDecisions.length === 0) {
    console.log(`  ${fmt.gray("None")}\n`);
  } else {
    const rows = resolvedDecisions.map((d) => [
      d.id,
      d.outcome ? d.outcome.resolved_at.slice(0, 10) : "—",
      d.title,
      d.outcome?.answer ?? d.options.find((o) => o.id === d.outcome?.option_id)?.title ?? d.outcome?.option_id ?? "—",
    ]);
    console.log(table(rows, ["ID", "RESOLVED", "TITLE", "CHOSEN"]));
    console.log();
  }

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

  if (risks.length > 0) {
    console.log(sectionHeader("Risks"));
    risks.forEach((r, i) => {
      console.log(`  ${fmt.dim(`${i + 1}.`)} ${r}`);
    });
    console.log();
  }
}
