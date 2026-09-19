import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { availablePreviewPorts, isReservedPort, parsePortRange, validatePortSettings } from "./ports.js";

test("reservation math and range parsing", () => {
  const settings = validatePortSettings({
    reserved: [{ start: 4210, end: 4205, label: " db " }, { start: 4250, end: 4250, label: "" }],
    preview_range: { start: 4200, end: 4210 },
  });
  expect(settings.reserved[0]).toEqual({ start: 4205, end: 4210, label: "db" });
  expect(isReservedPort(4207, settings)).toBe(true);
  expect(isReservedPort(4204, settings)).toBe(false);
  expect(availablePreviewPorts(settings)).toEqual([4200, 4201, 4202, 4203, 4204]);
  expect(parsePortRange("4096")).toEqual({ start: 4096, end: 4096 });
  expect(parsePortRange(" 4110 - 4100 ")).toEqual({ start: 4100, end: 4110 });
  expect(() => parsePortRange("abc")).toThrow("not a port");
  expect(() => validatePortSettings({ reserved: [{ start: 4200, end: 4210 }], preview_range: { start: 4200, end: 4210 } }))
    .toThrow("fully reserved");
  expect(() => validatePortSettings({ reserved: [{ start: 0, end: 5 }], preview_range: { start: 1, end: 2 } })).toThrow("between 1 and 65535");
});

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "konductor-ports-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

// Host-level settings live in the global database, so this runs in an isolated home.
test("host reservations persist through the host configuration scope", async () => {
  const child = Bun.spawn([process.execPath, "-e", `
    import * as store from ${JSON.stringify(new URL("./index.ts", import.meta.url).href)};
    import { expect } from "bun:test";
    expect((await store.readHostPortSettings()).preview_range).toEqual({ start: 4200, end: 4299 });
    await store.reserveHostPorts({ start: 4250, end: 4260 }, "grafana");
    const settings = await store.readHostPortSettings();
    expect(settings.reserved).toEqual([{ start: 4250, end: 4260, label: "grafana" }]);
    expect(store.availablePreviewPorts(settings)).toHaveLength(89);
    await store.releaseHostPorts({ start: 4260, end: 4250 });
    expect((await store.readHostPortSettings()).reserved).toEqual([]);
    await expect(store.releaseHostPorts({ start: 1, end: 1 })).rejects.toThrow("not reserved");
    expect((await store.readConfigurationState("host", "local")).settings.scope_type).toBe("host");
  `], { env: { ...process.env, KONDUCTOR_HOME: join(dir, "home") }, stdout: "pipe", stderr: "pipe" });
  const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (exit !== 0) throw new Error(stderr);
});
