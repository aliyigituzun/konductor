import { describe, expect, test } from "bun:test";
import type { AuthenticatedToken } from "@konductor/store";
import {
  bindMcpRunContext,
  identityCanUseAssets,
  requireMcpAccessToken,
  resolveMcpRunContext,
} from "./mcp.js";

function identity(
  kind: "internal" | "external",
  profileId: string | null,
): AuthenticatedToken {
  return {
    token_id: "token-id",
    kind,
    label: "Test identity",
    agent_profile_id: profileId,
    project_id: "project",
    permissions: ["project.read", "assets.read"],
  };
}

describe("resolveMcpRunContext", () => {
  test("ignores unresolved shell placeholders from MCP configuration", () => {
    expect(resolveMcpRunContext({
      KONDUCTOR_RUN_ID: "${KONDUCTOR_RUN_ID:-}",
      KONDUCTOR_PROFILE_ID: "${KONDUCTOR_PROFILE_ID:-}",
      KONDUCTOR_FEATURE_ITEM_ID: "${KONDUCTOR_FEATURE_ITEM_ID:-}",
      KONDUCTOR_RUN_SOURCE: "${KONDUCTOR_RUN_SOURCE:-cli}",
    })).toEqual({
      run_id: null,
      profile_id: null,
      feature_item_id: null,
      source: "cli",
    });
  });

  test("preserves metadata injected by a Konductor run", () => {
    expect(resolveMcpRunContext({
      KONDUCTOR_RUN_ID: "run-123",
      KONDUCTOR_PROFILE_ID: "claude-default",
      KONDUCTOR_FEATURE_ITEM_ID: "dashboard-updates-feed",
      KONDUCTOR_RUN_SOURCE: "dashboard",
    })).toEqual({
      run_id: "run-123",
      profile_id: "claude-default",
      feature_item_id: "dashboard-updates-feed",
      source: "dashboard",
    });
  });
});

describe("requireMcpAccessToken", () => {
  test("rejects tokenless MCP sessions", () => {
    expect(() => requireMcpAccessToken(null)).toThrow("requires an access token");
  });

  test("passes a configured token through for authentication", () => {
    expect(requireMcpAccessToken("opaque-token")).toBe("opaque-token");
  });
});

describe("bindMcpRunContext", () => {
  const requested = {
    run_id: "run-123",
    profile_id: "spoofed-profile",
    feature_item_id: "feature-123",
    source: "dashboard" as const,
  };

  test("discards caller-supplied attribution for external tokens", () => {
    expect(bindMcpRunContext(requested, identity("external", null))).toEqual({
      run_id: null,
      profile_id: null,
      feature_item_id: null,
      source: "cli",
    });
  });

  test("requires managed internal tokens to match the injected profile", () => {
    const internal = identity("internal", "claude");
    expect(() => bindMcpRunContext(requested, internal)).toThrow("does not match");
    expect(() => bindMcpRunContext({ ...requested, profile_id: null }, internal)).toThrow("does not match");
    expect(bindMcpRunContext({ ...requested, profile_id: "claude" }, internal)).toEqual({
      ...requested,
      profile_id: "claude",
    });
  });
});

describe("identityCanUseAssets", () => {
  test("uses token identity rather than caller environment", () => {
    expect(identityCanUseAssets(identity("external", null), [])).toBe(true);
    expect(identityCanUseAssets(identity("internal", "claude"), ["claude"])).toBe(true);
    expect(identityCanUseAssets(identity("internal", "claude"), ["codex"])).toBe(false);
  });
});
