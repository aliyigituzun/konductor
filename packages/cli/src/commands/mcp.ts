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
import { StatusSnapshotSchema } from "@konductor/schema";
import {
  writeStatus,
  readStatus,
  repoLocal,
  RECEIVER_PID,
  RECEIVER_LOG,
  appendUpdate,
  readUpdates,
  readConfig,
  importantProjectPaths,
  incrementRunCounters,
} from "@konductor/store";
import { RECEIVER_SCRIPT } from "@konductor/telemetry";

async function ensureReceiverRunning(cwd: string): Promise<void> {
  // Check if already running
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

export async function runMcpServe(_args: string[]): Promise<void> {
  const cwd = process.cwd();
  const runContext = {
    run_id: process.env["KONDUCTOR_RUN_ID"] ?? null,
    profile_id: process.env["KONDUCTOR_PROFILE_ID"] ?? null,
    feature_item_id: process.env["KONDUCTOR_FEATURE_ITEM_ID"] ?? null,
    source: (process.env["KONDUCTOR_RUN_SOURCE"] as "dashboard" | "cli" | undefined) ?? "cli",
  };

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
            "Returns the current Konductor run metadata injected by the host or caller, including run_id, profile_id, selected feature_item_id, and source.",
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
          },
        },
        {
          name: "write_update",
          description:
            "Append a brief timestamped update to the project's update feed (.konductor/updates.jsonl). Call this after every action — reading files, making a decision, completing a small task, finding an issue, finishing a spike, or any other incremental progress. Keep the message to 1–3 sentences describing what just happened or what was found. For major state changes (a phase completes, a new blocker appears, a significant milestone is reached) also call write_status.",
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
            "Validates and writes a full StatusSnapshot to .konductor/status/current.json, and automatically appends a milestone entry to the update feed. Use this only when project state changes significantly: a phase transitions to done or blocked, a new blocker is added or resolved, or a major milestone is reached. For routine progress notes use write_update instead. The payload must conform to the schema returned by get_status_schema.",
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
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

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
      const [config, snap] = await Promise.all([readConfig(cwd), readStatus(cwd)]);
      const feature =
        runContext.feature_item_id && snap?.features
          ? snap.features
              .flatMap((category) =>
                category.items.map((item) => ({
                  category_id: category.id,
                  category_title: category.title,
                  ...item,
                })),
              )
              .find((item) => item.id === runContext.feature_item_id) ?? null
          : null;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                config,
                run_context: runContext,
                important_paths: importantProjectPaths(cwd),
                available_prompt_packs: config?.agents?.prompt_packs ?? [],
                selected_feature: feature,
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
            text: JSON.stringify(runContext, null, 2),
          },
        ],
      };
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
      const a = args as { message?: string; kind?: string; phase_id?: string; session_id?: string };
      if (!a.message) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "Missing message field" }) }],
          isError: true,
        };
      }
      const entry = await appendUpdate(cwd, {
        kind: (a.kind === "milestone" ? "milestone" : "brief"),
        message: a.message,
        agent: "claude-code",
        session_id: a.session_id ?? null,
        phase_id: a.phase_id ?? null,
        run_id: runContext.run_id,
        profile_id: runContext.profile_id,
        feature_item_id: runContext.feature_item_id,
        source: runContext.source,
      });
      if (runContext.run_id) {
        await incrementRunCounters(cwd, runContext.run_id, { updates: 1 });
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

      const snapshot = {
        ...result.data,
        schema_version: "0.2.0" as const,
        run: runContext.run_id && runContext.profile_id
          ? {
              run_id: runContext.run_id,
              profile_id: runContext.profile_id,
              feature_item_id: runContext.feature_item_id,
              source: runContext.source,
            }
          : result.data.run,
      };

      await writeStatus(cwd, snapshot);
      await appendUpdate(cwd, {
        kind: "milestone",
        message: snapshot.status.summary,
        agent: "claude-code",
        session_id: snapshot.agent.session_id ?? null,
        phase_id: snapshot.status.current_phase_id ?? null,
        run_id: runContext.run_id,
        profile_id: runContext.profile_id,
        feature_item_id: runContext.feature_item_id,
        source: runContext.source,
      });
      if (runContext.run_id) {
        await incrementRunCounters(cwd, runContext.run_id, {
          updates: 1,
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
                run_context: runContext,
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
