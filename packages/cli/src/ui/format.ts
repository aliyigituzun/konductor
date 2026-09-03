/** Terminal formatting helpers — no external dependencies */

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";
const GRAY = "\x1b[90m";

export const fmt = {
  bold: (s: string) => `${BOLD}${s}${RESET}`,
  dim: (s: string) => `${DIM}${s}${RESET}`,
  red: (s: string) => `${RED}${s}${RESET}`,
  green: (s: string) => `${GREEN}${s}${RESET}`,
  yellow: (s: string) => `${YELLOW}${s}${RESET}`,
  cyan: (s: string) => `${CYAN}${s}${RESET}`,
  gray: (s: string) => `${GRAY}${s}${RESET}`,
  white: (s: string) => `${WHITE}${s}${RESET}`,
};

export function header(title: string): string {
  return `\n${fmt.bold(title)}\n${"─".repeat(title.length)}\n`;
}

export function sectionHeader(title: string): string {
  return `\n${fmt.bold(fmt.cyan(title))}\n`;
}

export function checkMark(pass: boolean): string {
  return pass ? fmt.green("✓") : fmt.red("✗");
}

export function warnMark(): string {
  return fmt.yellow("⚠");
}

export function stateColor(state: string): string {
  switch (state) {
    case "in_progress":
      return fmt.cyan(state);
    case "done":
      return fmt.green(state);
    case "blocked":
      return fmt.red(state);
    case "paused":
      return fmt.yellow(state);
    case "cancelled":
      return fmt.gray(state);
    default:
      return fmt.dim(state);
  }
}

export function pctBar(pct: number, width = 20): string {
  const filled = Math.round(pct * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${(pct * 100).toFixed(0)}%`;
}

export function relativeTime(isoStr: string): string {
  const ms = Date.now() - new Date(isoStr).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return fmt.gray("n/a");
  return n.toLocaleString();
}

export function table(
  rows: string[][],
  headers?: string[]
): string {
  const allRows = headers ? [headers, ...rows] : rows;
  const colWidths = allRows[0]?.map((_, ci) =>
    Math.max(...allRows.map((r) => stripAnsi(r[ci] ?? "").length))
  ) ?? [];

  const lines: string[] = [];
  if (headers) {
    lines.push(
      headers.map((h, i) => fmt.bold(h).padEnd(colWidths[i] ?? 0 + (fmt.bold(h).length - h.length))).join("  ")
    );
    lines.push(colWidths.map((w) => "─".repeat(w)).join("  "));
  }
  for (const row of rows) {
    lines.push(
      row
        .map((cell, i) => {
          const plain = stripAnsi(cell);
          const pad = (colWidths[i] ?? 0) - plain.length;
          return cell + " ".repeat(Math.max(0, pad));
        })
        .join("  ")
    );
  }
  return lines.join("\n");
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}
