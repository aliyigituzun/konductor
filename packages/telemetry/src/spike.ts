#!/usr/bin/env bun
/**
 * Konductor Telemetry Spike
 *
 * Starts a minimal OTLP HTTP receiver on localhost:4318.
 * Logs all incoming spans, metrics, and attributes as formatted JSON.
 * Writes a summary to spike-output.json when you Ctrl-C.
 *
 * Usage:
 *   bun run packages/telemetry/src/spike.ts
 *
 * Then in another terminal:
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 claude-code <command>
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const PORT = 4318;
const OUTPUT_FILE = join(process.cwd(), "spike-output.json");

interface IncomingSpan {
  name: string;
  attributes: Record<string, unknown>;
  timestamp: string;
}

interface IncomingMetric {
  name: string;
  dataPoints: Array<{ attributes: Record<string, unknown>; value: number }>;
  timestamp: string;
}

interface OtlpDataPoint {
  attributes?: Array<{ key: string; value: unknown }>;
  asInt?: number;
  asDouble?: number;
}

interface OtlpMetric {
  name: string;
  sum?: { dataPoints?: OtlpDataPoint[] };
  gauge?: { dataPoints?: OtlpDataPoint[] };
}

interface OtlpScopeMetrics {
  metrics?: OtlpMetric[];
}

interface OtlpResourceMetrics {
  scopeMetrics?: OtlpScopeMetrics[];
}

interface IncomingLog {
  body: unknown;
  attributes: Record<string, unknown>;
  timestamp: string;
}

const receivedSpans: IncomingSpan[] = [];
const receivedMetrics: IncomingMetric[] = [];
const receivedLogs: IncomingLog[] = [];
const observedFields = new Set<string>();

function extractAttributes(attrs: Array<{ key: string; value: unknown }>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const { key, value } of attrs) {
    result[key] = value;
    observedFields.add(key);
  }
  return result;
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const body = await req.json().catch(() => null);
  const ts = new Date().toISOString();

  if (url.pathname === "/v1/traces" && body) {
    console.log(`\n[${ts}] TRACES received`);
    const resourceSpans = (body as { resourceSpans?: unknown[] }).resourceSpans ?? [];
    for (const rs of resourceSpans as Array<{ scopeSpans?: Array<{ spans?: Array<{ name: string; attributes?: Array<{ key: string; value: unknown }> }> }> }>) {
      for (const ss of rs.scopeSpans ?? []) {
        for (const span of ss.spans ?? []) {
          const attrs = extractAttributes(span.attributes ?? []);
          receivedSpans.push({ name: span.name, attributes: attrs, timestamp: ts });
          console.log(`  span: ${span.name}`, JSON.stringify(attrs, null, 2));
        }
      }
    }
  } else if (url.pathname === "/v1/metrics" && body) {
    console.log(`\n[${ts}] METRICS received`);
    const resourceMetrics = (body as { resourceMetrics?: unknown[] }).resourceMetrics ?? [];
    for (const rm of resourceMetrics as OtlpResourceMetrics[]) {
      for (const sm of rm.scopeMetrics ?? []) {
        for (const metric of sm.metrics ?? []) {
          const points = metric.sum?.dataPoints ?? metric.gauge?.dataPoints ?? [];
          const dataPoints = points.map((dp) => ({
            attributes: extractAttributes(dp.attributes ?? []),
            value: dp.asInt ?? dp.asDouble ?? 0,
          }));
          receivedMetrics.push({ name: metric.name, dataPoints, timestamp: ts });
          console.log(`  metric: ${metric.name}`, dataPoints.map((dp) => dp.value).join(", "));
        }
      }
    }
  } else if (url.pathname === "/v1/logs" && body) {
    const resourceLogs = (body as { resourceLogs?: unknown[] }).resourceLogs ?? [];
    let count = 0;
    for (const rl of resourceLogs as Array<{ scopeLogs?: Array<{ logRecords?: Array<{ body?: unknown; attributes?: Array<{ key: string; value: unknown }> }> }> }>) {
      for (const sl of rl.scopeLogs ?? []) {
        for (const record of sl.logRecords ?? []) {
          const attrs = extractAttributes(record.attributes ?? []);
          receivedLogs.push({ body: record.body, attributes: attrs, timestamp: ts });
          count++;
        }
      }
    }
    console.log(`\n[${ts}] LOGS received — ${count} records`);
    receivedLogs.slice(-count).forEach((l) => console.log("  log:", JSON.stringify(l.body), JSON.stringify(l.attributes)));
  }

  return new Response("", { status: 200 });
}

async function writeSummary() {
  const fieldList = Array.from(observedFields).sort();
  const summary = {
    generated_at: new Date().toISOString(),
    total_spans: receivedSpans.length,
    total_metrics: receivedMetrics.length,
    total_logs: receivedLogs.length,
    observed_attribute_keys: fieldList,
    token_metrics: receivedMetrics
      .filter((m) => m.name.includes("token") || m.name.includes("usage"))
      .map((m) => m.name),
    tool_spans: receivedSpans
      .filter((s) => s.name.includes("tool") || s.attributes["tool.name"])
      .map((s) => ({ name: s.name, attrs: Object.keys(s.attributes) })),
    raw_spans: receivedSpans,
    raw_metrics: receivedMetrics,
    raw_logs: receivedLogs,
  };

  await writeFile(OUTPUT_FILE, JSON.stringify(summary, null, 2), "utf-8");
  console.log(`\n✓ Spike output written to ${OUTPUT_FILE}`);
  console.log(`\nObserved fields (${fieldList.length}):`);
  fieldList.forEach((f) => console.log(`  ${f}`));
}

const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
});

console.log(`Konductor Telemetry Spike receiver running on http://localhost:${PORT}`);
console.log(`Waiting for Claude Code OTEL data...`);
console.log(`Set: OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:${PORT}`);
console.log(`Press Ctrl-C to stop and write spike-output.json\n`);

process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  server.stop();
  await writeSummary();
  process.exit(0);
});
