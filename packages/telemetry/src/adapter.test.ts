import { test, expect } from "bun:test";
import { normalizeSession, type OtlpData } from "./adapter.js";

const fixtureOtlp: OtlpData = {
  resourceMetrics: [
    {
      scopeMetrics: [
        {
          metrics: [
            {
              name: "claude_code.tokens.input",
              sum: {
                dataPoints: [{ attributes: [], asInt: 12000 }],
              },
            },
            {
              name: "claude_code.tokens.output",
              sum: {
                dataPoints: [{ attributes: [], asInt: 3400 }],
              },
            },
          ],
        },
      ],
    },
  ],
  resourceSpans: [
    {
      scopeSpans: [
        {
          spans: [
            {
              name: "tool.Read",
              attributes: [
                { key: "tool.name", value: { stringValue: "Read" } },
                {
                  key: "tool.input",
                  value: { stringValue: JSON.stringify({ file_path: "src/index.ts" }) },
                },
              ],
            },
            {
              name: "tool.Read",
              attributes: [
                { key: "tool.name", value: { stringValue: "Read" } },
                {
                  key: "tool.input",
                  value: { stringValue: JSON.stringify({ file_path: "src/index.ts" }) },
                },
              ],
            },
            {
              name: "tool.Write",
              attributes: [
                { key: "tool.name", value: { stringValue: "Write" } },
                {
                  key: "tool.input",
                  value: { stringValue: JSON.stringify({ file_path: "src/output.ts" }) },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

test("normalizeSession extracts token counts", () => {
  const snap = normalizeSession(fixtureOtlp, "test-project");
  expect(snap.input_tokens).toBe(12000);
  expect(snap.output_tokens).toBe(3400);
  expect(snap.project_id).toBe("test-project");
  expect(snap.schema_version).toBe("0.2.0");
});

test("normalizeSession extracts tool usage", () => {
  const snap = normalizeSession(fixtureOtlp, "test-project");
  const readTool = snap.top_tools.find((t) => t.name === "Read");
  expect(readTool?.count).toBe(2);
  const writeTool = snap.top_tools.find((t) => t.name === "Write");
  expect(writeTool?.count).toBe(1);
});

test("normalizeSession extracts file activity", () => {
  const snap = normalizeSession(fixtureOtlp, "test-project");
  const indexFile = snap.top_files.find((f) => f.path === "src/index.ts");
  expect(indexFile?.reads).toBe(2);
  const outputFile = snap.top_files.find((f) => f.path === "src/output.ts");
  expect(outputFile?.writes).toBe(1);
});

test("normalizeSession marks unavailable fields as null", () => {
  const snap = normalizeSession(fixtureOtlp, "test-project");
  expect(snap.context_window).toBeNull();
  expect(snap.peak_context_tokens).toBeNull();
  expect(snap.compact_count).toBeNull();
});

test("normalizeSession handles empty OTLP data", () => {
  const snap = normalizeSession({}, "empty-project", "sess-1");
  expect(snap.input_tokens).toBeNull();
  expect(snap.top_tools).toHaveLength(0);
  expect(snap.top_files).toHaveLength(0);
  expect(snap.session_id).toBe("sess-1");
});
