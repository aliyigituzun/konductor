import { describe, expect, test } from "bun:test";
import {
  captureArgs,
  chooseSplitDirection,
  newWindowArgs,
  parsePaneLine,
  pickLargestPane,
  splitWindowArgs,
  type TmuxPane,
} from "./tmux.js";
import { uniqueSlug, slugify } from "./slug.js";

const pane = (overrides: Partial<TmuxPane> = {}): TmuxPane => ({
  pane_id: "%1",
  window_id: "@1",
  width: 100,
  height: 40,
  dead: false,
  dead_status: null,
  cwd: "/repo",
  title: "",
  ...overrides,
});

describe("parsePaneLine", () => {
  test("parses a tab-separated pane record", () => {
    const parsed = parsePaneLine("%12\t@3\t203\t51\t0\t\t/repo\tlogin");
    expect(parsed).toEqual({
      pane_id: "%12",
      window_id: "@3",
      width: 203,
      height: 51,
      dead: false,
      dead_status: null,
      cwd: "/repo",
      title: "login",
    });
  });

  test("reads the exit status of a dead pane", () => {
    const parsed = parsePaneLine("%12\t@3\t80\t24\t1\t137\t/repo\tlogin");
    expect(parsed?.dead).toBe(true);
    expect(parsed?.dead_status).toBe(137);
  });

  test("rejects lines that are not pane records", () => {
    expect(parsePaneLine("")).toBeNull();
    expect(parsePaneLine("no tabs here")).toBeNull();
    expect(parsePaneLine("12\t@3\t80\t24\t0\t\t/repo\tx")).toBeNull();
  });
});

describe("chooseSplitDirection", () => {
  test("splits a wide pane side by side", () => {
    expect(chooseSplitDirection(400, 50)).toBe("horizontal");
  });

  test("stacks a pane that is not twice as wide as it is tall", () => {
    // A cell is about twice as tall as it is wide, so 90x50 already reads as
    // square on screen even though the column count is larger.
    expect(chooseSplitDirection(90, 50)).toBe("vertical");
  });

  test("stacks rather than producing halves under 80 columns", () => {
    expect(chooseSplitDirection(120, 20)).toBe("vertical");
  });

  test("a tall narrow pane always stacks", () => {
    expect(chooseSplitDirection(80, 100)).toBe("vertical");
  });
});

describe("pickLargestPane", () => {
  test("picks the pane with the most cells", () => {
    const largest = pickLargestPane([
      pane({ pane_id: "%1", width: 80, height: 24 }),
      pane({ pane_id: "%2", width: 200, height: 50 }),
      pane({ pane_id: "%3", width: 100, height: 40 }),
    ]);
    expect(largest?.pane_id).toBe("%2");
  });

  test("never picks a dead pane", () => {
    const largest = pickLargestPane([
      pane({ pane_id: "%1", width: 500, height: 100, dead: true }),
      pane({ pane_id: "%2", width: 80, height: 24 }),
    ]);
    expect(largest?.pane_id).toBe("%2");
  });

  test("returns null when nothing is alive", () => {
    expect(pickLargestPane([])).toBeNull();
    expect(pickLargestPane([pane({ dead: true })])).toBeNull();
  });
});

describe("tmux argv builders", () => {
  const options = {
    session: "konductor",
    cwd: "/repo",
    name: "login",
    env: { KONDUCTOR_RUN_ID: "r1" },
    command: ["claude", "--model", "opus"],
  };

  test("new-window targets the session exactly and passes env through", () => {
    const args = newWindowArgs(options);
    // "=konductor" is an exact-match target; without it tmux would prefix-match
    // and could land the pane in someone else's session.
    expect(args).toContain("=konductor");
    expect(args).toContain("-e");
    expect(args).toContain("KONDUCTOR_RUN_ID=r1");
    // The command follows "--" so a leading-dash argument is never read as a flag.
    expect(args.slice(args.indexOf("--") + 1)).toEqual(["claude", "--model", "opus"]);
  });

  test("new-window prints the durable pane id", () => {
    const args = newWindowArgs(options);
    expect(args).toContain("-P");
    expect(args[args.indexOf("-F") + 1]).toBe("#{pane_id}");
  });

  test("split-window maps direction onto tmux's flags", () => {
    expect(splitWindowArgs("%4", "horizontal", options)).toContain("-h");
    expect(splitWindowArgs("%4", "vertical", options)).toContain("-v");
  });
});

describe("captureArgs", () => {
  test("captures the visible viewport by default", () => {
    expect(captureArgs("%2")).toEqual(["capture-pane", "-p", "-t", "%2"]);
  });

  test("reaches into scrollback when asked", () => {
    expect(captureArgs("%2", { source: "scrollback", lines: 500 })).toEqual([
      "capture-pane", "-p", "-t", "%2", "-S", "-500",
    ]);
  });

  test("keeps ANSI escapes when rendering the TUI", () => {
    expect(captureArgs("%2", { ansi: true })).toContain("-e");
  });
});

describe("slugs", () => {
  test("slugify strips punctuation and casing", () => {
    expect(slugify("Fix the Login Flow!")).toBe("fix-the-login-flow");
  });

  test("uniqueSlug avoids collisions with live agents", () => {
    expect(uniqueSlug("login", [])).toBe("login");
    expect(uniqueSlug("login", ["login"])).toBe("login-2");
    expect(uniqueSlug("login", ["login", "login-2"])).toBe("login-3");
  });

  test("uniqueSlug still produces something addressable for an empty title", () => {
    expect(uniqueSlug("!!!", [])).toBe("agent");
  });
});
