import { describe, expect, test } from "bun:test";
import { fmt, pctBar, relativeTime, formatNumber, table } from "./format.js";

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("pctBar", () => {
  test("renders empty and full bars at the requested width", () => {
    expect(pctBar(0, 10)).toBe("[░░░░░░░░░░] 0%");
    expect(pctBar(1, 10)).toBe("[██████████] 100%");
  });

  test("rounds partial progress to the nearest cell", () => {
    expect(pctBar(0.5, 10)).toBe("[█████░░░░░] 50%");
    // 0.44 * 10 = 4.4 cells -> 4 filled, but the label keeps the real percentage.
    expect(pctBar(0.44, 10)).toBe("[████░░░░░░] 44%");
  });
});

describe("relativeTime", () => {
  test("scales the unit to the age of the timestamp", () => {
    const now = Date.now();
    const at = (msAgo: number) => relativeTime(new Date(now - msAgo).toISOString());
    expect(at(5_000)).toBe("5s ago");
    expect(at(90_000)).toBe("1m ago");
    expect(at(3 * 3_600_000)).toBe("3h ago");
    expect(at(2 * 86_400_000)).toBe("2d ago");
  });
});

describe("formatNumber", () => {
  test("marks missing values rather than printing zero", () => {
    expect(stripAnsi(formatNumber(null))).toBe("n/a");
    expect(stripAnsi(formatNumber(undefined))).toBe("n/a");
    expect(formatNumber(0)).toBe("0");
  });
});

describe("table", () => {
  test("aligns columns using visible width, ignoring ANSI codes", () => {
    const rendered = table(
      [
        [fmt.green("ok"), "short"],
        ["failed", "a much longer cell"],
      ],
      ["status", "detail"],
    );
    const lines = stripAnsi(rendered).split("\n");
    // header, separator, two rows
    expect(lines).toHaveLength(4);
    // The colored "ok" is padded to the width of "failed" despite its escape codes.
    // Trailing padding on the final column is not meaningful, so trim it.
    expect(lines[2]?.trimEnd()).toBe("ok      short");
    expect(lines[3]?.trimEnd()).toBe("failed  a much longer cell");
  });
});
