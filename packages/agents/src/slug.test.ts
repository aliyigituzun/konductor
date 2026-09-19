import { describe, expect, test } from "bun:test";
import { slugify, uniqueSlug } from "./slug.js";

describe("slugify", () => {
  test("lowercases and collapses runs of non-alphanumerics into single dashes", () => {
    expect(slugify("Fix Login Flow")).toBe("fix-login-flow");
    expect(slugify("  Retry -- OAuth!! callback  ")).toBe("retry-oauth-callback");
    expect(slugify("v2.0/release_candidate")).toBe("v2-0-release-candidate");
  });

  test("returns an empty string when nothing addressable remains", () => {
    expect(slugify("")).toBe("");
    expect(slugify("!!! ???")).toBe("");
  });

  test("caps the slug so it stays short enough to type", () => {
    const long = slugify("a".repeat(50));
    expect(long).toHaveLength(32);
    expect(long).toBe("a".repeat(32));
  });
});

describe("uniqueSlug", () => {
  test("uses the plain slug when it is free", () => {
    expect(uniqueSlug("Fix Login", [])).toBe("fix-login");
    expect(uniqueSlug("Fix Login", ["other"])).toBe("fix-login");
  });

  test("appends the first free numeric suffix, starting at 2", () => {
    expect(uniqueSlug("Fix Login", ["fix-login"])).toBe("fix-login-2");
    expect(uniqueSlug("Fix Login", ["fix-login", "fix-login-2"])).toBe("fix-login-3");
    // A gap is reused rather than skipped past.
    expect(uniqueSlug("Fix Login", ["fix-login", "fix-login-3"])).toBe("fix-login-2");
  });

  test("falls back to a generic base for unusable titles", () => {
    expect(uniqueSlug("", [])).toBe("agent");
    expect(uniqueSlug("???", ["agent"])).toBe("agent-2");
  });

  test("accepts any iterable of taken slugs", () => {
    expect(uniqueSlug("Fix Login", new Set(["fix-login"]))).toBe("fix-login-2");
  });
});
