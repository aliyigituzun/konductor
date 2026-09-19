import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PROVIDER_SECRETS_DIR } from "./paths.js";

function segment(value: string): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(value)) throw new Error("Invalid provider secret reference.");
  return value;
}

function secretPath(projectId: string, providerId: string): string {
  return join(PROVIDER_SECRETS_DIR, segment(projectId), segment(providerId));
}

/** Host-only API-key storage. Values are never included in project configuration. */
export async function writeProviderSecret(projectId: string, providerId: string, key: string): Promise<void> {
  const value = key.trim();
  if (!value) return;
  const directory = join(PROVIDER_SECRETS_DIR, segment(projectId));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = secretPath(projectId, providerId);
  await writeFile(path, `${value}\n`, { encoding: "utf-8", mode: 0o600 });
  await chmod(path, 0o600);
}

export async function readProviderSecret(projectId: string, providerId: string): Promise<string | null> {
  try { return (await readFile(secretPath(projectId, providerId), "utf-8")).trim() || null; } catch { return null; }
}

export async function removeProviderSecret(projectId: string, providerId: string): Promise<void> {
  try { await unlink(secretPath(projectId, providerId)); } catch { /* absent is already removed */ }
}
