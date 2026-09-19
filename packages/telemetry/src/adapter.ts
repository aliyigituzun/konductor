import type { TelemetrySnapshot, SignalStatus } from "@konductor/schema";
import { SIGNAL_STATUS } from "./signals.js";

/** Minimal OTLP JSON structures we care about */
interface OtlpAttribute {
  key: string;
  value: { stringValue?: string; intValue?: number; doubleValue?: number };
}

interface OtlpResource {
  attributes?: OtlpAttribute[];
}

interface OtlpSpan {
  name: string;
  attributes?: OtlpAttribute[];
}

interface OtlpResourceSpans {
  resource?: OtlpResource;
  scopeSpans?: Array<{ spans?: OtlpSpan[] }>;
}

interface OtlpMetricDataPoint {
  attributes?: OtlpAttribute[];
  asInt?: number;
  asDouble?: number;
}

interface OtlpMetric {
  name: string;
  sum?: { dataPoints?: OtlpMetricDataPoint[] };
  gauge?: { dataPoints?: OtlpMetricDataPoint[] };
}

interface OtlpResourceMetrics {
  resource?: OtlpResource;
  scopeMetrics?: Array<{ metrics?: OtlpMetric[] }>;
}

interface OtlpLogRecord {
  body?: { stringValue?: string };
  attributes?: OtlpAttribute[];
}

interface OtlpResourceLogs {
  resource?: OtlpResource;
  scopeLogs?: Array<{ logRecords?: OtlpLogRecord[] }>;
}

export interface OtlpData {
  resourceSpans?: OtlpResourceSpans[];
  resourceMetrics?: OtlpResourceMetrics[];
  resourceLogs?: OtlpResourceLogs[];
}

/**
 * Extract the working directory from OTLP resource attributes.
 */
export function findProjectCwd(data: OtlpData): string | null {
  const resources = [
    ...(data.resourceMetrics?.map((rm) => rm.resource) ?? []),
    ...(data.resourceSpans?.map((rs) => rs.resource) ?? []),
    ...(data.resourceLogs?.map((rl) => rl.resource) ?? []),
  ].filter((r): r is OtlpResource => r != null);

  const keys = ["process.cwd", "process.working_directory", "code.filepath"];
  for (const resource of resources) {
    for (const key of keys) {
      const val = getAttribute(resource.attributes ?? [], key);
      if (val && typeof val === "string") return val;
    }
  }
  return null;
}

function getAttribute(attrs: OtlpAttribute[] = [], key: string): string | number | undefined {
  const attr = attrs.find((a) => a.key === key);
  if (!attr) return undefined;
  const v = attr.value;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) return v.intValue;
  if (v.doubleValue !== undefined) return v.doubleValue;
  return undefined;
}

function getAttrString(attrs: OtlpAttribute[] = [], key: string): string | null {
  const v = getAttribute(attrs, key);
  return v !== undefined ? String(v) : null;
}

function getAttrInt(attrs: OtlpAttribute[] = [], key: string): number | null {
  const v = getAttribute(attrs, key);
  if (v === undefined) return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return isNaN(n) ? null : n;
}

function getAttrFloat(attrs: OtlpAttribute[] = [], key: string): number | null {
  const v = getAttribute(attrs, key);
  if (v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? null : n;
}

/** Sum a claude_code.token.usage metric filtered by the `type` attribute. */
function sumTokenMetric(metrics: OtlpMetric[], tokenType: string): number | null {
  const m = metrics.find((x) => x.name === "claude_code.token.usage");
  if (!m) return null;
  const points = m.sum?.dataPoints ?? m.gauge?.dataPoints ?? [];
  const matching = points.filter((dp) => getAttribute(dp.attributes ?? [], "type") === tokenType);
  if (matching.length === 0) return null;
  return matching.reduce((acc, dp) => acc + (dp.asInt ?? dp.asDouble ?? 0), 0);
}

function legacyTokenMetric(metrics: OtlpMetric[], name: string): number | null {
  return sumMetric(metrics, name);
}

function sumMetric(metrics: OtlpMetric[], name: string): number | null {
  const m = metrics.find((x) => x.name === name);
  if (!m) return null;
  const points = m.sum?.dataPoints ?? m.gauge?.dataPoints ?? [];
  if (points.length === 0) return null;
  return points.reduce((acc, dp) => acc + (dp.asInt ?? dp.asDouble ?? 0), 0);
}

/**
 * Normalize OTLP export data into a TelemetrySnapshot.
 */
export function normalizeSession(
  otlpData: OtlpData,
  projectId: string,
  sessionId?: string
): TelemetrySnapshot {
  const now = new Date().toISOString();

  const allMetrics: OtlpMetric[] = [];
  for (const rm of otlpData.resourceMetrics ?? []) {
    for (const sm of rm.scopeMetrics ?? []) {
      allMetrics.push(...(sm.metrics ?? []));
    }
  }

  const allSpans: OtlpSpan[] = [];
  for (const rs of otlpData.resourceSpans ?? []) {
    for (const ss of rs.scopeSpans ?? []) {
      allSpans.push(...(ss.spans ?? []));
    }
  }

  const allLogs: OtlpLogRecord[] = [];
  for (const rl of otlpData.resourceLogs ?? []) {
    for (const sl of rl.scopeLogs ?? []) {
      allLogs.push(...(sl.logRecords ?? []));
    }
  }

  // --- Token usage ---
  // Primary: claude_code.token.usage metric with type attribute
  let inputTokens = sumTokenMetric(allMetrics, "input");
  let outputTokens = sumTokenMetric(allMetrics, "output");
  let cacheReadTokens = sumTokenMetric(allMetrics, "cacheRead");
  let cacheWriteTokens = sumTokenMetric(allMetrics, "cacheCreation");

  inputTokens = inputTokens ?? legacyTokenMetric(allMetrics, "claude_code.tokens.input");
  outputTokens = outputTokens ?? legacyTokenMetric(allMetrics, "claude_code.tokens.output");
  cacheReadTokens = cacheReadTokens ?? legacyTokenMetric(allMetrics, "claude_code.tokens.cache_read");
  cacheWriteTokens = cacheWriteTokens ?? legacyTokenMetric(allMetrics, "claude_code.tokens.cache_write");

  // Fallback: accumulate from claude_code.api_request log events
  if (inputTokens === null || outputTokens === null) {
    let logInput = 0, logOutput = 0, logCacheRead = 0, logCacheWrite = 0;
    let found = false;
    for (const log of allLogs) {
      if (log.body?.stringValue !== "claude_code.api_request") continue;
      found = true;
      logInput += getAttrInt(log.attributes, "input_tokens") ?? 0;
      logOutput += getAttrInt(log.attributes, "output_tokens") ?? 0;
      logCacheRead += getAttrInt(log.attributes, "cache_read_tokens") ?? 0;
      logCacheWrite += getAttrInt(log.attributes, "cache_creation_tokens") ?? 0;
    }
    if (found) {
      inputTokens = inputTokens ?? logInput;
      outputTokens = outputTokens ?? logOutput;
      cacheReadTokens = cacheReadTokens ?? logCacheRead;
      cacheWriteTokens = cacheWriteTokens ?? logCacheWrite;
    }
  }

  // --- Cost ---
  // Primary: claude_code.cost.usage metric
  let costUsd = sumMetric(allMetrics, "claude_code.cost.usage");
  // Fallback: sum cost_usd from api_request log events
  if (costUsd === null) {
    let logCost = 0;
    let found = false;
    for (const log of allLogs) {
      if (log.body?.stringValue !== "claude_code.api_request") continue;
      found = true;
      logCost += getAttrFloat(log.attributes, "cost_usd") ?? 0;
    }
    if (found) costUsd = logCost;
  }

  // --- Request count ---
  // claude_code.session.count is the session metric; api_request logs give per-request count
  const requestCountFromMetric = sumMetric(allMetrics, "claude_code.session.count");
  const requestCountFromLogs = allLogs.filter(
    (l) => l.body?.stringValue === "claude_code.api_request"
  ).length || null;
  const requestCount = requestCountFromLogs ?? requestCountFromMetric;

  let resolvedSessionId = sessionId ?? null;
  if (!resolvedSessionId && allLogs.length > 0) {
    resolvedSessionId = getAttrString(allLogs[0]!.attributes, "session.id");
  }

  // --- Tool usage from spans (if Claude Code ever emits them) ---
  const toolCounts = new Map<string, number>();
  const fileCounts = new Map<string, { reads: number; writes: number }>();

  for (const span of allSpans) {
    const toolName =
      (getAttribute(span.attributes, "tool.name") as string) ??
      (getAttribute(span.attributes, "gen_ai.tool.name") as string) ??
      (span.name.startsWith("tool.") ? span.name.slice(5) : null);

    if (toolName) {
      toolCounts.set(toolName, (toolCounts.get(toolName) ?? 0) + 1);

      const toolInput =
        (getAttribute(span.attributes, "tool.input") as string) ??
        (getAttribute(span.attributes, "gen_ai.tool.call.arguments") as string);

      if (toolInput) {
        try {
          const params = JSON.parse(toolInput) as Record<string, unknown>;
          const filePath =
            (params["file_path"] as string) ??
            (params["path"] as string) ??
            (params["paths"] as string);

          if (filePath && typeof filePath === "string") {
            const existing = fileCounts.get(filePath) ?? { reads: 0, writes: 0 };
            const isWrite = ["Write", "Edit", "NotebookEdit"].includes(toolName);
            if (isWrite) {
              fileCounts.set(filePath, { ...existing, writes: existing.writes + 1 });
            } else {
              fileCounts.set(filePath, { ...existing, reads: existing.reads + 1 });
            }
          }
        } catch {
          // JSON parse failed — skip
        }
      }
    }
  }

  const topTools = Array.from(toolCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({
      name,
      count,
      signal_status: SIGNAL_STATUS["tool_name"] ?? ("best_effort" as const),
    }));

  const topFiles = Array.from(fileCounts.entries())
    .sort((a, b) => b[1].reads + b[1].writes - (a[1].reads + a[1].writes))
    .slice(0, 10)
    .map(([path, { reads, writes }]) => ({
      path,
      reads,
      writes,
      signal_status: SIGNAL_STATUS["file_paths"] ?? ("best_effort" as const),
    }));

  return {
    schema_version: "0.2.0",
    captured_at: now,
    session_id: resolvedSessionId,
    project_id: projectId,
    profile_id: null,
    run_id: null,
    source: undefined,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheReadTokens,
    cache_write_tokens: cacheWriteTokens,
    request_count: requestCount,
    top_tools: topTools,
    top_files: topFiles,
    context_window: null,
    peak_context_tokens: null,
    peak_context_percent: null,
    compact_count: null,
    cost_usd: costUsd,
    signal_availability: { ...SIGNAL_STATUS },
  };
}

/**
 * Merge a new OTLP payload into an existing snapshot, accumulating counts.
 */
export function mergeSnapshot(
  existing: TelemetrySnapshot | null,
  newData: OtlpData,
  projectId: string
): TelemetrySnapshot {
  const fresh = normalizeSession(newData, projectId);
  if (!existing) return fresh;

  const addNullable = (a: number | null, b: number | null): number | null => {
    if (a === null && b === null) return null;
    return (a ?? 0) + (b ?? 0);
  };

  const toolMap = new Map<string, { count: number; signal_status: SignalStatus }>();
  for (const t of existing.top_tools) toolMap.set(t.name, t);
  for (const t of fresh.top_tools) {
    const ex = toolMap.get(t.name);
    toolMap.set(t.name, { count: (ex?.count ?? 0) + t.count, signal_status: t.signal_status });
  }

  const fileMap = new Map<string, { reads: number; writes: number; signal_status: SignalStatus }>();
  for (const f of existing.top_files) fileMap.set(f.path, f);
  for (const f of fresh.top_files) {
    const ex = fileMap.get(f.path);
    fileMap.set(f.path, {
      reads: (ex?.reads ?? 0) + f.reads,
      writes: (ex?.writes ?? 0) + f.writes,
      signal_status: f.signal_status,
    });
  }

  return {
    ...fresh,
    captured_at: new Date().toISOString(),
    session_id: existing.session_id ?? fresh.session_id,
    input_tokens: addNullable(existing.input_tokens, fresh.input_tokens),
    output_tokens: addNullable(existing.output_tokens, fresh.output_tokens),
    cache_read_tokens: addNullable(existing.cache_read_tokens, fresh.cache_read_tokens),
    cache_write_tokens: addNullable(existing.cache_write_tokens, fresh.cache_write_tokens),
    request_count: addNullable(existing.request_count, fresh.request_count),
    cost_usd: addNullable(existing.cost_usd, fresh.cost_usd),
    top_tools: Array.from(toolMap.entries())
      .map(([name, v]) => ({ name, count: v.count, signal_status: v.signal_status }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    top_files: Array.from(fileMap.entries())
      .map(([path, v]) => ({ path, reads: v.reads, writes: v.writes, signal_status: v.signal_status }))
      .sort((a, b) => (b.reads + b.writes) - (a.reads + a.writes))
      .slice(0, 10),
  };
}
