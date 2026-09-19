import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  AssetMetadataSchema,
  StatusSnapshotSchema,
  UpdateActionSchema,
  UpdateSubjectSchema,
  type TokenPermission,
} from "@konductor/schema";
import {
  AccessTokenAuthenticationError,
  writeStatus,
  readStatus,
  diffStatusSnapshots,
  repoLocal,
  RECEIVER_PID,
  RECEIVER_LOG,
  appendUpdate,
  readUpdates,
  readConfig,
  createDecision,
  listDecisions,
  resolveDecision,
  importantProjectPaths,
  incrementRunCounters,
  addAssetVariation,
  createManagedAsset,
  deleteAssetVariation,
  deleteManagedAsset,
  readAgentAssetContext,
  setAssetVariationUsed,
  updateAssetBucketMetadata,
  updateManagedAssetMetadata,
  authenticateAccessToken,
  recordTokenAuditEvent,
  type AccessTokenAuditActor,
  type AuthenticatedToken,
} from "@konductor/store";
import { RECEIVER_SCRIPT } from "@konductor/telemetry";

export interface McpRunContext {
  run_id: string | null;
  profile_id: string | null;
  feature_item_ids: string[];
  feature_item_id: string | null;
  source: "dashboard" | "cli";
}

function optionalRunValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized || /^\$\{[^}]+\}$/.test(normalized)) return null;
  return normalized;
}

export function resolveMcpRunContext(env: NodeJS.ProcessEnv): McpRunContext {
  const source = optionalRunValue(env["KONDUCTOR_RUN_SOURCE"]);
  const featureItemId = optionalRunValue(env["KONDUCTOR_FEATURE_ITEM_ID"]);
  const featureItemIds = (optionalRunValue(env["KONDUCTOR_FEATURE_ITEM_IDS"]) ?? "")
    .split(",").map((id) => id.trim()).filter(Boolean);
  return {
    run_id: optionalRunValue(env["KONDUCTOR_RUN_ID"]),
    profile_id: optionalRunValue(env["KONDUCTOR_PROFILE_ID"]),
    feature_item_ids: [...new Set([...featureItemIds, ...(featureItemId ? [featureItemId] : [])])],
    feature_item_id: featureItemId,
    source: source === "dashboard" ? "dashboard" : "cli",
  };
}

export function bindMcpRunContext(
  requested: McpRunContext,
  identity: AuthenticatedToken,
): McpRunContext {
  if (identity.kind === "external") {
    return {
      run_id: null,
      profile_id: null,
      feature_item_ids: [],
      feature_item_id: null,
      source: "cli",
    };
  }
  if (!requested.profile_id || requested.profile_id !== identity.agent_profile_id) {
    throw new Error("The managed MCP token does not match this run's agent profile.");
  }
  return { ...requested, profile_id: identity.agent_profile_id };
}

export function identityCanUseAssets(
  identity: AuthenticatedToken,
  selectedProfileIds: string[],
): boolean {
  if (identity.kind === "external") return true;
  return Boolean(
    identity.agent_profile_id && selectedProfileIds.includes(identity.agent_profile_id),
  );
}

function attemptedActorKind(rawToken: string): "internal" | "external" {
  return rawToken.startsWith("knd_int_") ? "internal" : "external";
}

function authenticationFailure(error: unknown): {
  actor: AccessTokenAuditActor | null;
  reason: string;
  message: string;
} {
  if (error instanceof AccessTokenAuthenticationError) {
    return { actor: error.actor, reason: error.reason, message: error.message };
  }
  return {
    actor: null,
    reason: "authentication_failed",
    message: error instanceof Error ? error.message : "Access token authentication failed.",
  };
}

async function ensureReceiverRunning(cwd: string): Promise<void> {
  if (existsSync(RECEIVER_PID)) {
    try {
      const pid = parseInt(await readFile(RECEIVER_PID, "utf-8"), 10);
      if (!isNaN(pid)) {
        process.kill(pid, 0); // throws if not running
        return; // already up
      }
    } catch {
      // stale pid — fall through to start
    }
  }

  if (!existsSync(join(cwd, ".konductor"))) return; // not an initialized project

  const proc = Bun.spawn(["bun", "run", RECEIVER_SCRIPT], {
    env: { ...process.env, KONDUCTOR_PROJECT_DIR: cwd },
    stdout: Bun.file(RECEIVER_LOG),
    stderr: Bun.file(RECEIVER_LOG),
    detached: true,
  });
  await writeFile(RECEIVER_PID, String(proc.pid), "utf-8");
  proc.unref();
  process.stderr.write(`[konductor mcp] telemetry receiver started (pid ${proc.pid})\n`);
}

const MCP_TOOL_PERMISSIONS: Record<string, TokenPermission> = {
  get_status_schema: "project.read",
  get_current_status: "status.read",
  get_project_context: "project.read",
  get_run_context: "project.read",
  write_update: "updates.write",
  write_status: "status.write",
  list_decisions: "decisions.read",
  create_decision: "decisions.write",
  resolve_decision: "decisions.write",
  get_asset_context: "assets.read",
  create_asset: "assets.write",
  add_asset_variation: "assets.write",
  set_asset_variation_used: "assets.write",
  delete_asset_variation: "assets.delete",
  delete_asset: "assets.delete",
  update_asset_metadata: "assets.write",
};

async function accessToken(args: string[]): Promise<string | null> {
  const fromEnvironment = optionalRunValue(process.env["KONDUCTOR_ACCESS_TOKEN"]);
  if (fromEnvironment) return fromEnvironment;
  const fileIndex = args.indexOf("--token-file");
  const file = optionalRunValue(
    fileIndex >= 0 ? args[fileIndex + 1] : process.env["KONDUCTOR_ACCESS_TOKEN_FILE"],
  );
  return file ? (await readFile(file, "utf-8")).trim() : null;
}

export function requireMcpAccessToken(token: string | null): string {
  if (token) return token;
  throw new Error(
    "Konductor MCP requires an access token. Konductor-managed agents receive one automatically; " +
    "external agents must set KONDUCTOR_ACCESS_TOKEN or use KONDUCTOR_ACCESS_TOKEN_FILE/--token-file.",
  );
}

export async function runMcpServe(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const runContext = resolveMcpRunContext(process.env);
  const configAtStartup = await readConfig(cwd);
  if (!configAtStartup) {
    throw new Error("This directory is not an initialized Konductor project.");
  }
  const rawToken = requireMcpAccessToken(await accessToken(args));
  let startupIdentity: AuthenticatedToken;
  try {
    startupIdentity = await authenticateAccessToken(
      rawToken,
      configAtStartup.project_id,
      undefined,
      { record_use: false },
    );
  } catch (error) {
    const failure = authenticationFailure(error);
    await recordTokenAuditEvent({
      actor_token_id: failure.actor?.token_id ?? null,
      actor_kind: failure.actor?.kind ?? attemptedActorKind(rawToken),
      actor_label: failure.actor?.label ?? "unrecognized-token",
      project_id: configAtStartup.project_id,
      agent_profile_id: failure.actor?.agent_profile_id ?? null,
      action: "mcp.authenticate",
      permission: null,
      outcome: "denied",
      target: "mcp-session",
      metadata: { reason: failure.reason },
    }).catch(() => {});
    throw error;
  }
  let trustedRunContext: McpRunContext;
  try {
    trustedRunContext = bindMcpRunContext(runContext, startupIdentity);
  } catch (error) {
    await recordTokenAuditEvent({
      actor_token_id: startupIdentity.token_id,
      actor_kind: startupIdentity.kind,
      actor_label: startupIdentity.label,
      project_id: configAtStartup.project_id,
      agent_profile_id: startupIdentity.agent_profile_id,
      action: "mcp.authenticate",
      permission: null,
      outcome: "denied",
      target: "mcp-session",
      metadata: { reason: "profile_mismatch" },
    }).catch(() => {});
    throw error;
  }

  const server = new Server(
    {
      name: "konductor",
      version: "0.2.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const textResult = (value: unknown, isError = false) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  });

  async function assetAccess(
    identity: AuthenticatedToken,
    requireReadPermission = false,
  ): Promise<{
    allowed: boolean;
    reason: string | null;
  }> {
    const config = await readConfig(cwd);
    if (!config?.assets?.enabled) {
      return { allowed: false, reason: "Asset management is not enabled for this project." };
    }
    if (requireReadPermission && !identity.permissions.includes("assets.read")) {
      return { allowed: false, reason: "This identity does not have assets.read." };
    }
    if (!identityCanUseAssets(identity, config.assets.selected_profile_ids)) {
      return { allowed: false, reason: "This agent profile is not enabled for asset management." };
    }
    return { allowed: true, reason: null };
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "get_status_schema",
          description:
            "Returns the JSON Schema for the Konductor StatusSnapshot format. Use this to understand the required structure before calling write_status.",
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
          },
        },
        {
          name: "get_current_status",
          description:
            "Returns the current full project status snapshot from .konductor/status/current.json, plus the 20 most recent update feed entries. Call this before writing status so you can see the latest state and recent agent activity.",
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
          },
        },
        {
          name: "get_project_context",
          description:
            "Returns project configuration, important Konductor file paths, available prompt packs, and the currently selected feature context where available.",
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
          },
        },
        {
          name: "get_run_context",
          description:
            "Returns the current Konductor run metadata injected by the host or caller, including every selected feature, run_id, profile_id, and source.",
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
          },
        },
        {
          name: "write_update",
          description:
            "Append a brief timestamped update to the project's SQLite update feed. Call this after every action — reading files, making a decision, completing a small task, finding an issue, finishing a spike, or any other incremental progress. Keep the message to 1–3 sentences describing what just happened or what was found. For major state changes (a phase completes, a new blocker appears, a significant milestone is reached) also call write_status.",
          inputSchema: {
            type: "object",
            properties: {
              message: {
                type: "string",
                description: "1–3 sentences describing what just happened or was found.",
              },
              kind: {
                type: "string",
                enum: ["brief", "milestone"],
                description: "brief = routine progress note (default). milestone = significant state change that may also warrant a write_status call.",
              },
              subject: {
                type: "string",
                enum: ["feature", "todo", "decision", "agent", "review", "preview"],
                description: "What the update is about, so the dashboard can filter the feed. Omit it for general progress notes; they are filed under agent automatically.",
              },
              action: {
                type: "string",
                enum: ["created", "edited", "deleted", "failure", "success"],
                description: "What happened: created/edited/deleted for changes to a thing, success/failure for outcomes of a task or check.",
              },
              phase_id: {
                type: "string",
                description: "The id of the current phase from the status snapshot, if applicable.",
              },
              session_id: {
                type: "string",
                description: "Claude Code session id, if known.",
              },
            },
            required: ["message"],
          },
        },
        {
          name: "write_status",
          description:
            "Validates and writes a full StatusSnapshot to .konductor/status/current.json, and automatically appends a milestone entry to the update feed. Use this only when project state changes significantly: a phase transitions to done or blocked, a new blocker is added or resolved, or a major milestone is reached. For routine progress notes use write_update instead. For decisions the operator must make, use create_decision rather than issues.decisions_needed. The payload must conform to the schema returned by get_status_schema.",
          inputSchema: {
            type: "object",
            properties: {
              payload: {
                type: "object",
                description: "A valid StatusSnapshot object.",
              },
            },
            required: ["payload"],
          },
        },
        {
          name: "list_decisions",
          description:
            "Lists project decisions from the Konductor database: open decisions awaiting the operator and resolved decisions with their chosen option, rationale, and linked feature items. Check this before making an architectural or product choice; if a relevant decision is resolved, follow it.",
          inputSchema: {
            type: "object",
            properties: {
              status: {
                type: "string",
                enum: ["open", "resolved"],
                description: "Only return decisions in this state. Omit for all.",
              },
              feature_item_id: {
                type: "string",
                description: "Only return decisions linked to this feature item.",
              },
            },
            required: [],
          },
        },
        {
          name: "create_decision",
          description:
            "Records a decision the operator needs to make, with the options you see. Use this instead of choosing yourself when a choice materially changes scope, architecture, cost, or user-facing behavior. When there is no clear set of options, set kind to open_ended and describe the problem instead; the operator answers in free text. The operator resolves it in the dashboard and may hand the chosen option back to an agent. Re-using an existing id is a no-op.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "Optional stable id (kebab-case). Omit to derive one from the title." },
              title: { type: "string", description: "Short name for the decision." },
              question: { type: "string", description: "The choice to make, as one sentence." },
              context: { type: "string", description: "Background the operator needs. Markdown allowed." },
              impact: { type: "string", enum: ["low", "medium", "high"] },
              kind: { type: "string", enum: ["options", "open_ended"], description: "Defaults to options." },
              problem: { type: "string", description: "For open_ended decisions: the problem the operator should think through. Markdown allowed." },
              options: {
                type: "array",
                description: "Two or more options (required unless kind is open_ended). Each may list features that resolving with it should create.",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    title: { type: "string" },
                    description: { type: "string" },
                    consequences: { type: "string" },
                    creates_features: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          title: { type: "string" },
                          description: { type: "string" },
                          category_id: { type: "string", description: "An existing feature category id from the status snapshot." },
                          phase_ids: { type: "array", items: { type: "string" } },
                        },
                        required: ["title", "category_id"],
                      },
                    },
                  },
                  required: ["title"],
                },
              },
              feature_item_ids: {
                type: "array",
                items: { type: "string" },
                description: "Feature items this decision affects. Defaults to the run's selected feature.",
              },
            },
            required: ["title", "question", "impact"],
          },
        },
        {
          name: "resolve_decision",
          description:
            "Resolves an open decision with one of its options, or with a free-text answer for open-ended decisions. Only call this when the operator has explicitly told you what to do; otherwise leave the decision open for the dashboard.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string" },
              option_id: { type: "string", description: "Required for options decisions." },
              answer: { type: "string", description: "Required for open_ended decisions." },
              rationale: { type: "string" },
            },
            required: ["id"],
          },
        },
        {
          name: "get_asset_context",
          description:
            "Returns asset folders (buckets nest via parent_id; null is the root), logical assets, and all variations. Folder and asset metadata is included only when its expose_to_agents switch is enabled.",
          inputSchema: { type: "object", properties: {}, required: [] },
        },
        {
          name: "create_asset",
          description:
            "Uploads a project file as the first variation of a new logical asset in an existing folder (bucket_id may be any folder id, including nested ones). Agent uploads start pending approval.",
          inputSchema: {
            type: "object",
            properties: {
              bucket_id: { type: "string" },
              name: { type: "string" },
              source_project_path: { type: "string" },
              variation_name: { type: "string" },
              media_type: { type: "string" },
              used: { type: "boolean" },
              metadata: { type: "object" },
            },
            required: ["bucket_id", "name", "source_project_path"],
          },
        },
        {
          name: "add_asset_variation",
          description:
            "Uploads a project file as another A/B or design variation of an existing logical asset.",
          inputSchema: {
            type: "object",
            properties: {
              asset_id: { type: "string" },
              source_project_path: { type: "string" },
              variation_name: { type: "string" },
              media_type: { type: "string" },
              used: { type: "boolean" },
            },
            required: ["asset_id", "source_project_path"],
          },
        },
        {
          name: "set_asset_variation_used",
          description:
            "Marks one asset variation as used or not used. Multiple variations of the same asset may be used simultaneously.",
          inputSchema: {
            type: "object",
            properties: {
              asset_id: { type: "string" },
              variation_id: { type: "string" },
              used: { type: "boolean" },
            },
            required: ["asset_id", "variation_id", "used"],
          },
        },
        {
          name: "delete_asset_variation",
          description: "Deletes one managed variation and its uploaded copy.",
          inputSchema: {
            type: "object",
            properties: {
              asset_id: { type: "string" },
              variation_id: { type: "string" },
            },
            required: ["asset_id", "variation_id"],
          },
        },
        {
          name: "delete_asset",
          description: "Deletes a logical asset and all of its managed variations.",
          inputSchema: {
            type: "object",
            properties: { asset_id: { type: "string" } },
            required: ["asset_id"],
          },
        },
        {
          name: "update_asset_metadata",
          description:
            "Updates optional metadata for an asset or folder (target_type \"category\" targets a folder). Set expose_to_agents to control whether future agents receive that metadata.",
          inputSchema: {
            type: "object",
            properties: {
              target_type: { type: "string", enum: ["asset", "category"] },
              target_id: { type: "string" },
              description: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              fields: { type: "object", additionalProperties: { type: "string" } },
              expose_to_agents: { type: "boolean" },
            },
            required: ["target_type", "target_id", "expose_to_agents"],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const permission = MCP_TOOL_PERMISSIONS[name];
    let identity = startupIdentity;
    if (permission) {
      try {
        identity = await authenticateAccessToken(rawToken, configAtStartup.project_id, permission);
      } catch (error) {
        const failure = authenticationFailure(error);
        await recordTokenAuditEvent({
          actor_token_id: failure.actor?.token_id ?? null,
          actor_kind: failure.actor?.kind ?? attemptedActorKind(rawToken),
          actor_label: failure.actor?.label ?? "unrecognized-token",
          project_id: configAtStartup.project_id,
          agent_profile_id: failure.actor?.agent_profile_id ?? null,
          action: `mcp.${name}`,
          permission,
          outcome: "denied",
          target: name,
          metadata: { reason: failure.reason, run_id: trustedRunContext.run_id },
        }).catch(() => {});
        return textResult({ error: failure.message }, true);
      }
    }
    if (permission && (name.startsWith("get_asset_") || name.includes("asset"))) {
      const access = await assetAccess(identity);
      if (!access.allowed) {
        await recordTokenAuditEvent({
          actor_token_id: identity.token_id,
          actor_kind: identity.kind,
          actor_label: identity.label,
          project_id: configAtStartup.project_id,
          agent_profile_id: identity.agent_profile_id,
          action: `mcp.${name}`,
          permission,
          outcome: "denied",
          target: name,
          metadata: { reason: "asset_policy", run_id: trustedRunContext.run_id },
        });
        return textResult({ error: access.reason }, true);
      }
    }
    if (permission) {
      await recordTokenAuditEvent({
        actor_token_id: identity.token_id,
        actor_kind: identity.kind,
        actor_label: identity.label,
        project_id: configAtStartup.project_id,
        agent_profile_id: identity.agent_profile_id,
        action: `mcp.${name}`,
        permission,
        outcome: "allowed",
        target: name,
        metadata: { run_id: trustedRunContext.run_id },
      });
    }

    if (name === "get_status_schema") {
      const jsonSchema = zodToJsonSchema(StatusSnapshotSchema, {
        name: "StatusSnapshot",
        errorMessages: false,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(jsonSchema, null, 2),
          },
        ],
      };
    }

    if (name === "get_project_context") {
      const [config, snap, access] = await Promise.all([
        readConfig(cwd),
        readStatus(cwd),
        assetAccess(identity, true),
      ]);
      const assetContext = access.allowed
        ? await readAgentAssetContext(cwd)
        : { enabled: false, reason: access.reason };
      const features = snap?.features
        ?.flatMap((category) => category.items.map((item) => ({ category_id: category.id, category_title: category.title, ...item })))
        .filter((item) => trustedRunContext.feature_item_ids.includes(item.id)) ?? [];
      const feature = features[0] ?? null;
      const decisions = await listDecisions(cwd);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                config,
                run_context: trustedRunContext,
                important_paths: importantProjectPaths(cwd),
                available_prompt_packs: config?.agents?.prompt_packs ?? [],
                selected_feature: feature,
                selected_features: features,
                open_decisions: decisions.filter((decision) => decision.status === "open"),
                feature_decisions: feature
                  ? decisions.filter((decision) => decision.feature_item_ids.includes(feature.id))
                  : [],
                asset_context: assetContext,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    if (name === "get_run_context") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(trustedRunContext, null, 2),
          },
        ],
      };
    }

    if (name === "get_asset_context") {
      return textResult(await readAgentAssetContext(cwd));
    }

    if (name === "create_asset") {
      const a = args as {
        bucket_id?: string;
        name?: string;
        source_project_path?: string;
        variation_name?: string;
        media_type?: string;
        used?: boolean;
        metadata?: Record<string, unknown>;
      };
      if (!a.bucket_id || !a.name || !a.source_project_path) {
        return textResult({ error: "bucket_id, name, and source_project_path are required" }, true);
      }
      const metadata = AssetMetadataSchema.safeParse(a.metadata ?? {});
      if (!metadata.success) {
        return textResult({ error: "Asset metadata is invalid", details: metadata.error.errors }, true);
      }
      try {
        return textResult(await createManagedAsset(cwd, {
          bucket_id: a.bucket_id,
          name: a.name,
          metadata: metadata.data,
          upload: {
            file_name: a.source_project_path,
            source_project_path: a.source_project_path,
            ...(a.variation_name ? { variation_name: a.variation_name } : {}),
            ...(a.media_type ? { media_type: a.media_type } : {}),
            ...(typeof a.used === "boolean" ? { used: a.used } : {}),
          },
        }, {
          kind: "agent",
          run_id: trustedRunContext.run_id,
          profile_id: trustedRunContext.profile_id,
        }));
      } catch (error) {
        return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
      }
    }

    if (name === "add_asset_variation") {
      const a = args as {
        asset_id?: string;
        source_project_path?: string;
        variation_name?: string;
        media_type?: string;
        used?: boolean;
      };
      if (!a.asset_id || !a.source_project_path) {
        return textResult({ error: "asset_id and source_project_path are required" }, true);
      }
      try {
        return textResult(await addAssetVariation(cwd, a.asset_id, {
          file_name: a.source_project_path,
          source_project_path: a.source_project_path,
          ...(a.variation_name ? { variation_name: a.variation_name } : {}),
          ...(a.media_type ? { media_type: a.media_type } : {}),
          ...(typeof a.used === "boolean" ? { used: a.used } : {}),
        }, {
          kind: "agent",
          run_id: trustedRunContext.run_id,
          profile_id: trustedRunContext.profile_id,
        }));
      } catch (error) {
        return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
      }
    }

    if (name === "set_asset_variation_used") {
      const a = args as { asset_id?: string; variation_id?: string; used?: boolean };
      if (!a.asset_id || !a.variation_id || typeof a.used !== "boolean") {
        return textResult({ error: "asset_id, variation_id, and used are required" }, true);
      }
      try {
        return textResult(await setAssetVariationUsed(cwd, a.asset_id, a.variation_id, a.used));
      } catch (error) {
        return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
      }
    }

    if (name === "delete_asset_variation") {
      const a = args as { asset_id?: string; variation_id?: string };
      if (!a.asset_id || !a.variation_id) {
        return textResult({ error: "asset_id and variation_id are required" }, true);
      }
      try {
        await deleteAssetVariation(cwd, a.asset_id, a.variation_id);
        return textResult({ success: true, deleted: a.variation_id });
      } catch (error) {
        return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
      }
    }

    if (name === "delete_asset") {
      const a = args as { asset_id?: string };
      if (!a.asset_id) return textResult({ error: "asset_id is required" }, true);
      try {
        await deleteManagedAsset(cwd, a.asset_id);
        return textResult({ success: true, deleted: a.asset_id });
      } catch (error) {
        return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
      }
    }

    if (name === "update_asset_metadata") {
      const a = args as {
        target_type?: "asset" | "category";
        target_id?: string;
        description?: string;
        tags?: string[];
        fields?: Record<string, string>;
        expose_to_agents?: boolean;
      };
      if (!a.target_type || !a.target_id || typeof a.expose_to_agents !== "boolean") {
        return textResult({ error: "target_type, target_id, and expose_to_agents are required" }, true);
      }
      const metadata = {
        description: a.description ?? "",
        tags: a.tags ?? [],
        fields: a.fields ?? {},
        expose_to_agents: a.expose_to_agents,
      };
      try {
        return textResult(
          a.target_type === "asset"
            ? await updateManagedAssetMetadata(cwd, a.target_id, metadata)
            : await updateAssetBucketMetadata(cwd, a.target_id, metadata),
        );
      } catch (error) {
        return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
      }
    }

    if (name === "list_decisions") {
      const a = args as { status?: "open" | "resolved"; feature_item_id?: string };
      const decisions = (await listDecisions(cwd)).filter((decision) =>
        (!a.status || decision.status === a.status)
        && (!a.feature_item_id || decision.feature_item_ids.includes(a.feature_item_id)),
      );
      return textResult({ decisions });
    }

    if (name === "create_decision") {
      const a = args as {
        id?: string;
        title?: string;
        question?: string;
        context?: string;
        impact?: "low" | "medium" | "high";
        kind?: "options" | "open_ended";
        problem?: string;
        options?: Array<{
          id?: string;
          title?: string;
          description?: string;
          consequences?: string;
          creates_features?: Array<{ title?: string; description?: string; category_id?: string; phase_ids?: string[] }>;
        }>;
        feature_item_ids?: string[];
      };
      const kind = a.kind ?? "options";
      if (kind !== "options" && kind !== "open_ended") return textResult({ error: "kind must be options or open_ended" }, true);
      if (!a.title?.trim() || !a.question?.trim() || !a.impact) {
        return textResult({ error: "title, question, and impact are required" }, true);
      }
      if (kind === "open_ended" && !a.problem?.trim()) return textResult({ error: "open_ended decisions need a problem" }, true);
      if (kind === "options" && !Array.isArray(a.options)) return textResult({ error: "options are required unless kind is open_ended" }, true);
      const inputOptions = kind === "options" ? a.options ?? [] : [];
      const snap = await readStatus(cwd);
      const knownFeatures = new Set((snap?.features ?? []).flatMap((category) => category.items.map((item) => item.id)));
      const knownCategories = new Set((snap?.features ?? []).map((category) => category.id));
      const featureIds = a.feature_item_ids ?? (trustedRunContext.feature_item_id ? [trustedRunContext.feature_item_id] : []);
      const unknownFeature = featureIds.find((id) => !knownFeatures.has(id));
      if (unknownFeature) return textResult({ error: `Unknown feature item: ${unknownFeature}` }, true);
      const optionIds = new Set<string>();
      const options = [];
      for (const [index, option] of inputOptions.entries()) {
        const title = option.title?.trim();
        if (!title) return textResult({ error: `Option ${index + 1} needs a title` }, true);
        const root = (option.id?.trim() || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")) || "option";
        let id = root;
        for (let n = 2; optionIds.has(id); n += 1) id = `${root}-${n}`;
        optionIds.add(id);
        const drafts = [];
        for (const draft of option.creates_features ?? []) {
          if (!draft.title?.trim() || !draft.category_id) {
            return textResult({ error: `Option "${title}": each created feature needs a title and category_id` }, true);
          }
          if (!knownCategories.has(draft.category_id)) {
            return textResult({ error: `Unknown feature category: ${draft.category_id}` }, true);
          }
          drafts.push({
            title: draft.title.trim(),
            ...(draft.description ? { description: draft.description } : {}),
            category_id: draft.category_id,
            phase_ids: draft.phase_ids ?? [],
          });
        }
        options.push({
          id,
          title,
          ...(option.description ? { description: option.description } : {}),
          ...(option.consequences ? { consequences: option.consequences } : {}),
          creates_features: drafts,
        });
      }
      try {
        const decision = await createDecision(cwd, {
          ...(a.id?.trim() ? { id: a.id.trim() } : {}),
          title: a.title.trim(),
          question: a.question.trim(),
          ...(a.context ? { context: a.context } : {}),
          kind,
          ...(kind === "open_ended" ? { problem: a.problem!.trim() } : {}),
          impact: a.impact,
          owner: identity.label,
          options,
          feature_item_ids: featureIds,
          source: "agent",
          run_id: trustedRunContext.run_id,
        });
        await appendUpdate(cwd, {
          kind: "milestone",
          subject: "decision",
          action: "created",
          message: `Raised decision "${decision.title}" (${decision.kind === "open_ended" ? "open-ended" : `${decision.options.length} options`}).`,
          agent: identity.label,
          run_id: trustedRunContext.run_id,
          profile_id: trustedRunContext.profile_id,
          feature_item_id: decision.feature_item_ids[0] ?? trustedRunContext.feature_item_id,
          source: trustedRunContext.source,
        });
        if (trustedRunContext.run_id) {
          await incrementRunCounters(cwd, trustedRunContext.run_id, { updates: 1 });
        }
        return textResult({ decision });
      } catch (error) {
        return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
      }
    }

    if (name === "resolve_decision") {
      const a = args as { id?: string; option_id?: string; answer?: string; rationale?: string };
      if (!a.id) return textResult({ error: "id is required" }, true);
      if (!a.option_id && !a.answer?.trim()) return textResult({ error: "option_id (or answer for open-ended decisions) is required" }, true);
      try {
        const decision = await resolveDecision(cwd, a.id, {
          option_id: a.option_id ?? null,
          ...(a.answer?.trim() ? { answer: a.answer.trim() } : {}),
          ...(a.rationale ? { rationale: a.rationale } : {}),
          resolved_by: identity.label,
        });
        const chosen = decision.options.find((option) => option.id === decision.outcome?.option_id);
        await appendUpdate(cwd, {
          kind: "milestone",
          subject: "decision",
          action: "success",
          message: `Decided "${decision.title}": ${decision.outcome?.answer ?? chosen?.title ?? a.option_id}.`,
          agent: identity.label,
          run_id: trustedRunContext.run_id,
          profile_id: trustedRunContext.profile_id,
          feature_item_id: decision.feature_item_ids[0] ?? trustedRunContext.feature_item_id,
          source: trustedRunContext.source,
        });
        if (trustedRunContext.run_id) {
          await incrementRunCounters(cwd, trustedRunContext.run_id, { updates: 1 });
        }
        return textResult({ decision });
      } catch (error) {
        return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
      }
    }

    if (name === "get_current_status") {
      const snap = await readStatus(cwd);
      if (!snap) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "No current status found",
                  hint: "Run konductor init first",
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
      const allUpdates = await readUpdates(cwd);
      const recentUpdates = allUpdates.slice(-20);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ status: snap, recent_updates: recentUpdates }, null, 2),
          },
        ],
      };
    }

    if (name === "write_update") {
      const a = args as { message?: string; kind?: string; subject?: string; action?: string; phase_id?: string; session_id?: string };
      if (!a.message) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "Missing message field" }) }],
          isError: true,
        };
      }
      const subject = UpdateSubjectSchema.safeParse(a.subject);
      const action = UpdateActionSchema.safeParse(a.action);
      const entry = await appendUpdate(cwd, {
        kind: (a.kind === "milestone" ? "milestone" : "brief"),
        ...(subject.success ? { subject: subject.data } : {}),
        ...(action.success ? { action: action.data } : {}),
        message: a.message,
        agent: identity.label,
        session_id: a.session_id ?? null,
        phase_id: a.phase_id ?? null,
        run_id: trustedRunContext.run_id,
        profile_id: trustedRunContext.profile_id,
        feature_item_id: trustedRunContext.feature_item_id,
        source: trustedRunContext.source,
      });
      if (trustedRunContext.run_id) {
        await incrementRunCounters(cwd, trustedRunContext.run_id, { updates: 1 });
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, id: entry.id, at: entry.at }, null, 2),
          },
        ],
      };
    }

    if (name === "write_status") {
      const payload = (args as { payload?: unknown })?.payload;
      if (!payload) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: "Missing payload field" }),
            },
          ],
          isError: true,
        };
      }

      const result = StatusSnapshotSchema.safeParse(payload);
      if (!result.success) {
        const errors = result.error.errors.map((e) => ({
          path: e.path.join("."),
          message: e.message,
        }));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "Validation failed",
                  field_errors: errors,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      const { run: _callerSuppliedRun, ...validatedSnapshot } = result.data;
      const snapshot = {
        ...validatedSnapshot,
        schema_version: "0.2.0" as const,
        ...(trustedRunContext.run_id && trustedRunContext.profile_id
          ? { run: {
              run_id: trustedRunContext.run_id,
              profile_id: trustedRunContext.profile_id,
              feature_item_id: trustedRunContext.feature_item_id,
              source: trustedRunContext.source,
            } }
          : {}),
      };

      const previous = await readStatus(cwd);
      await writeStatus(cwd, snapshot);
      // A snapshot write is the only way agents change features, so derive the
      // per-feature feed entries from the diff; the summary milestone below stays
      // as the agent's own account of the write.
      const runContext = {
        run_id: trustedRunContext.run_id,
        profile_id: trustedRunContext.profile_id,
        source: trustedRunContext.source,
      };
      let written = 0;
      for (const draft of diffStatusSnapshots(previous, snapshot)) {
        await appendUpdate(cwd, { ...draft, agent: identity.label, ...runContext });
        written += 1;
      }
      // Older agents still raise decisions through the snapshot; mirror them into the
      // decisions table so the dashboard sees one list. Existing ids are left alone.
      const knownDecisionIds = new Set((await listDecisions(cwd)).map((decision) => decision.id));
      for (const legacy of snapshot.issues.decisions_needed) {
        if (!knownDecisionIds.has(legacy.id)) {
          await appendUpdate(cwd, {
            kind: "milestone",
            subject: "decision",
            action: "created",
            message: `Raised decision "${legacy.summary}".`,
            agent: identity.label,
            ...runContext,
            feature_item_id: trustedRunContext.feature_item_id,
          });
          written += 1;
        }
        await createDecision(cwd, {
          id: legacy.id,
          title: legacy.summary.length > 80 ? `${legacy.summary.slice(0, 77).trimEnd()}…` : legacy.summary,
          question: legacy.summary,
          impact: legacy.impact,
          owner: legacy.owner ?? identity.label,
          options: [],
          feature_item_ids: trustedRunContext.feature_item_id ? [trustedRunContext.feature_item_id] : [],
          source: "agent",
          run_id: trustedRunContext.run_id,
        }).catch(() => {});
      }
      await appendUpdate(cwd, {
        kind: "milestone",
        subject: "agent",
        action: "edited",
        message: snapshot.status.summary,
        agent: identity.label,
        session_id: snapshot.agent.session_id ?? null,
        phase_id: snapshot.status.current_phase_id ?? null,
        run_id: trustedRunContext.run_id,
        profile_id: trustedRunContext.profile_id,
        feature_item_id: trustedRunContext.feature_item_id,
        source: trustedRunContext.source,
      });
      if (trustedRunContext.run_id) {
        await incrementRunCounters(cwd, trustedRunContext.run_id, {
          updates: written + 1,
          status_writes: 1,
          last_status_at: snapshot.report.reported_at,
        });
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                written_to: repoLocal(cwd).currentStatus,
                reported_at: snapshot.report.reported_at,
                run_context: trustedRunContext,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Unknown tool: ${name}` }),
        },
      ],
      isError: true,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Start the background OTEL receiver so telemetry is collected automatically
  // while Claude Code is running. Errors are non-fatal.
  ensureReceiverRunning(cwd).catch(() => {});

  process.stderr.write(
    `[konductor mcp] server ready (stdio transport)\n` +
    `[konductor mcp] cwd: ${cwd}\n` +
    `[konductor mcp] waiting for Claude Code — press Ctrl+C to stop\n`
  );
  // Server runs until stdin closes (Claude Code disconnects)
}
