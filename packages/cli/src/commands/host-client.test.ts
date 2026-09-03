import { describe, expect, test } from "bun:test";
import { parseFlag } from "./host-client.js";

describe("parseFlag", () => {
  const args = ["start", "--prompt", "fix the tests", "--profile", "claude-default", "-f"];

  test("returns the value following a long flag", () => {
    expect(parseFlag(args, "--prompt")).toBe("fix the tests");
    expect(parseFlag(args, "--profile")).toBe("claude-default");
  });

  test("accepts a short alias", () => {
    expect(parseFlag(args, "--force", "-f")).toBeUndefined();
    expect(parseFlag(["-p", "hello"], "--prompt", "-p")).toBe("hello");
  });

  test("returns undefined for an absent flag", () => {
    expect(parseFlag(args, "--feature")).toBeUndefined();
  });

  test("returns undefined when the flag is last and has no value", () => {
    expect(parseFlag(["run", "--prompt"], "--prompt")).toBeUndefined();
  });
});
