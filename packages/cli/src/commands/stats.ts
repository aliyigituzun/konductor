import { listProjectRuns, readTelemetry } from "@konductor/store";
import { fmt, header, sectionHeader, formatNumber, table } from "../ui/format.js";
import { SIGNAL_STATUS } from "@konductor/telemetry";

export async function runStats(_args: string[]): Promise<void> {
  const cwd = process.cwd();
  const [snap, runs] = await Promise.all([readTelemetry(cwd), listProjectRuns(cwd)]);

  if (!snap) {
    console.error(
      `${fmt.red("✗")} No telemetry found. Run ${fmt.bold("konductor sync")} first.`
    );
    process.exit(1);
  }

  console.log(header("Telemetry Stats"));
  console.log(`  ${fmt.dim("captured:")}  ${snap.captured_at}`);
  if (snap.session_id) {
    console.log(`  ${fmt.dim("session:")}   ${snap.session_id}`);
  }
  if (snap.run_id) {
    console.log(`  ${fmt.dim("run:")}       ${snap.run_id}`);
  }
  if (runs[0]) {
    console.log(`  ${fmt.dim("active:")}    ${runs.filter((run) => run.status === "running").length}`);
    console.log(`  ${fmt.dim("last task:")} ${runs[0].status} via ${runs[0].profile_id}`);
  }

  // Token usage
  console.log(sectionHeader("Token Usage"));
  const signalLabel = (key: string) => {
    const s = snap.signal_availability[key] ?? SIGNAL_STATUS[key];
    if (!s) return "";
    if (s === "verified") return fmt.green(" [verified]");
    if (s === "best_effort") return fmt.yellow(" [best-effort]");
    return fmt.gray(" [unavailable]");
  };

  console.log(
    `  ${fmt.dim("input:")}        ${formatNumber(snap.input_tokens)}${signalLabel("input_tokens")}`
  );
  console.log(
    `  ${fmt.dim("output:")}       ${formatNumber(snap.output_tokens)}${signalLabel("output_tokens")}`
  );
  console.log(
    `  ${fmt.dim("cache_read:")}   ${formatNumber(snap.cache_read_tokens)}${signalLabel("cache_read_tokens")}`
  );
  console.log(
    `  ${fmt.dim("cache_write:")}  ${formatNumber(snap.cache_write_tokens)}${signalLabel("cache_write_tokens")}`
  );
  if (snap.request_count !== null) {
    console.log(`  ${fmt.dim("requests:")}     ${formatNumber(snap.request_count)}`);
  }

  // Context usage
  console.log(sectionHeader("Context Usage"));
  if (snap.context_window === null && snap.peak_context_tokens === null) {
    console.log(`  ${fmt.gray("unavailable")} — context metrics not exposed via OTEL`);
  } else {
    console.log(`  ${fmt.dim("window:")}       ${formatNumber(snap.context_window)}`);
    console.log(`  ${fmt.dim("peak_tokens:")}  ${formatNumber(snap.peak_context_tokens)}`);
    if (snap.peak_context_percent !== null) {
      console.log(
        `  ${fmt.dim("peak_pct:")}     ${(snap.peak_context_percent * 100).toFixed(1)}%`
      );
    }
  }
  if (snap.compact_count !== null) {
    console.log(`  ${fmt.dim("compactions:")}  ${snap.compact_count}`);
  } else {
    console.log(`  ${fmt.dim("compactions:")}  ${fmt.gray("unavailable")}`);
  }

  // Tool usage
  if (snap.top_tools.length > 0) {
    console.log(sectionHeader("Top Tools"));
    const rows = snap.top_tools.map((t) => [t.name, String(t.count), t.signal_status]);
    console.log(table(rows, ["TOOL", "COUNT", "SIGNAL"]));
  }

  // File activity
  if (snap.top_files.length > 0) {
    console.log(sectionHeader("File Activity"));
    const rows = snap.top_files.map((f) => [
      f.path,
      String(f.reads),
      String(f.writes),
      f.signal_status,
    ]);
    console.log(table(rows, ["PATH", "READS", "WRITES", "SIGNAL"]));
  } else {
    console.log(sectionHeader("File Activity"));
    console.log(
      `  ${fmt.gray("best-effort")} — file paths extracted from tool parameters where available`
    );
  }

  console.log();
}
