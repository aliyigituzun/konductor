import { HOST_SCOPE_ID, PortSettingsSchema, type PortRange, type PortSettings } from "@konductor/schema";
import { readConfigurationState, updatePortSettings } from "./configuration.js";

/**
 * Reserved-port bookkeeping for the host machine. The allocator in the host consults
 * these so a preview never lands on a port the operator wrote down as taken.
 */

export class PortSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortSettingsError";
  }
}

function normalizeRange(range: PortRange): PortRange {
  return range.start <= range.end ? range : { start: range.end, end: range.start };
}

export function isReservedPort(port: number, settings: PortSettings): boolean {
  return settings.reserved.some((range) => {
    const { start, end } = normalizeRange(range);
    return port >= start && port <= end;
  });
}

/** Every port the preview range can still offer, in ascending order. */
export function availablePreviewPorts(settings: PortSettings): number[] {
  const { start, end } = normalizeRange(settings.preview_range);
  const ports: number[] = [];
  for (let port = start; port <= end; port += 1) {
    if (!isReservedPort(port, settings)) ports.push(port);
  }
  return ports;
}

/** Returns a normalized copy or throws a PortSettingsError with an operator-facing message. */
export function validatePortSettings(input: unknown): PortSettings {
  const parsed = PortSettingsSchema.safeParse(input);
  if (!parsed.success) {
    throw new PortSettingsError("Ports must be whole numbers between 1 and 65535.");
  }
  const settings: PortSettings = {
    preview_range: normalizeRange(parsed.data.preview_range),
    reserved: parsed.data.reserved.map((range) => ({ ...normalizeRange(range), label: range.label.trim() })),
  };
  if (availablePreviewPorts(settings).length === 0) {
    throw new PortSettingsError("The preview range is fully reserved; widen the range or release a port.");
  }
  return settings;
}

export function formatPortRange(range: PortRange): string {
  return range.start === range.end ? String(range.start) : `${range.start}-${range.end}`;
}

/** Accepts `4096` or `4100-4110`. */
export function parsePortRange(value: string): PortRange {
  const match = value.trim().match(/^(\d{1,5})(?:\s*-\s*(\d{1,5}))?$/);
  if (!match) throw new PortSettingsError(`"${value}" is not a port or a start-end range.`);
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : start;
  return normalizeRange({ start, end });
}

export async function readHostPortSettings(): Promise<PortSettings> {
  return (await readConfigurationState("host", HOST_SCOPE_ID)).settings.ports;
}

export async function saveHostPortSettings(settings: PortSettings): Promise<PortSettings> {
  return (await updatePortSettings("host", HOST_SCOPE_ID, validatePortSettings(settings))).settings.ports;
}

export async function reserveHostPorts(range: PortRange, label = ""): Promise<PortSettings> {
  const current = await readHostPortSettings();
  return saveHostPortSettings({ ...current, reserved: [...current.reserved, { ...range, label }] });
}

/** Drops every reserved entry that exactly matches the range. */
export async function releaseHostPorts(range: PortRange): Promise<PortSettings> {
  const current = await readHostPortSettings();
  const target = normalizeRange(range);
  const reserved = current.reserved.filter((item) => item.start !== target.start || item.end !== target.end);
  if (reserved.length === current.reserved.length) {
    throw new PortSettingsError(`${formatPortRange(target)} is not reserved.`);
  }
  return saveHostPortSettings({ ...current, reserved });
}
