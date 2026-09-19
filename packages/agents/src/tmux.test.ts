import { describe, expect, test } from "bun:test";
import {
  TmuxError,
  attachCommand,
  captureArgs,
  newWindowArgs,
  parsePaneLine,
  parseSpawnLine,
  redactTmuxArgs,
} from "./tmux.js";
import { uniqueSlug, slugify } from "./slug.js";

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
    // "=konductor:" exact-matches the session and leaves the window index open so
    // tmux allocates the next free one instead of colliding with window 0.
    expect(args[args.indexOf("-t") + 1]).toBe("=konductor:");
    expect(args).toContain("-e");
    expect(args).toContain("KONDUCTOR_RUN_ID=r1");
    // The command follows "--" so a leading-dash argument is never read as a flag.
    expect(args.slice(args.indexOf("--") + 1)).toEqual(["claude", "--model", "opus"]);
  });

  test("new-window prints the durable pane and window ids", () => {
    const args = newWindowArgs(options);
    expect(args).toContain("-P");
    expect(args[args.indexOf("-F") + 1]).toBe("#{pane_id}\t#{window_id}");
  });

  test("new-window is created detached so it never steals an attached operator's focus", () => {
    expect(newWindowArgs(options)).toContain("-d");
  });

  test("new-window is named after the agent's slug", () => {
    const args = newWindowArgs(options);
    expect(args[args.indexOf("-n") + 1]).toBe("login");
  });
});

describe("tmux error redaction", () => {
  test("drops environment values and access tokens from persisted errors", () => {
    const raw = [
      "new-window",
      "-e",
      "KONDUCTOR_ACCESS_TOKEN=knd_int_123456789abc_supersecret",
      "-e",
      "HOME=/Users/example",
      "--",
      "agent",
      "--token",
      "knd_ext_123456789abc_anothersecret",
    ];
    expect(redactTmuxArgs(raw)).toEqual([
      "new-window",
      "[2 environment variables redacted]",
      "--",
      "agent",
      "--token",
      "[redacted]",
    ]);
    const error = new TmuxError(raw, 1, "failed with knd_ext_123456789abc_anothersecret");
    expect(error.message).not.toContain("supersecret");
    expect(error.message).not.toContain("anothersecret");
    expect(error.stderr).toBe("failed with [redacted-access-token]");
  });
});

describe("parseSpawnLine", () => {
  test("reads the ids tmux prints for a new window", () => {
    expect(parseSpawnLine("%12\t@3\n")).toEqual({ pane_id: "%12", window_id: "@3" });
  });

  test("rejects output that is not a pane/window pair", () => {
    expect(parseSpawnLine("")).toBeNull();
    expect(parseSpawnLine("%12")).toBeNull();
    expect(parseSpawnLine("@3\t%12")).toBeNull();
  });
});

describe("attachCommand", () => {
  test("attaches to the exact session and lands on the agent's window", () => {
    expect(attachCommand("konductor", "@3")).toBe(
      "tmux attach-session -t '=konductor' \\; select-window -t @3",
    );
  });

  test("always quotes the exact-match target, which zsh would otherwise expand", () => {
    // `=name` is a zsh command-path expansion; unquoted it breaks the paste.
    expect(attachCommand("my project", "@1")).toBe(
      "tmux attach-session -t '=my project' \\; select-window -t @1",
    );
  });

  test("escapes a quote inside the session name", () => {
    expect(attachCommand("it's", "@1")).toContain(`'=it'\\''s'`);
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
