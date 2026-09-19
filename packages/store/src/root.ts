import { createCipheriv, createDecipheriv, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ROOT_KEY_FILE, ROOT_SESSION_KEY_FILE } from "./paths.js";

const ROOT_KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const ROOT_KEY_LENGTH = 32;
/** Root sessions are short-lived: this is a break-glass surface, not a daily one. */
export const ROOT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const ROOT_COOKIE_VERSION = "r1";

function generateRootKey(): string {
  let key = "";
  for (let i = 0; i < ROOT_KEY_LENGTH; i += 1) {
    key += ROOT_KEY_ALPHABET[randomInt(ROOT_KEY_ALPHABET.length)];
  }
  return key;
}

/** Creates the root key file the first time it is needed. Returns the key only when
 * this call created it; an existing key is never re-read back out for display. */
export function ensureRootKey(): { created: boolean; key: string | null } {
  if (existsSync(ROOT_KEY_FILE)) return { created: false, key: null };
  mkdirSync(dirname(ROOT_KEY_FILE), { recursive: true, mode: 0o700 });
  const key = generateRootKey();
  writeFileSync(ROOT_KEY_FILE, `${key}\n`, { mode: 0o600 });
  chmodSync(ROOT_KEY_FILE, 0o600);
  return { created: true, key };
}

export function rootKeyExists(): boolean {
  return existsSync(ROOT_KEY_FILE);
}

export function rootKeyPath(): string {
  return ROOT_KEY_FILE;
}

export async function verifyRootKey(candidate: string): Promise<boolean> {
  if (!existsSync(ROOT_KEY_FILE)) return false;
  const expected = Buffer.from(readFileSync(ROOT_KEY_FILE, "utf-8").trim(), "utf-8");
  const actual = Buffer.from(candidate.trim(), "utf-8");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

function rootSessionKey(): Buffer {
  if (existsSync(ROOT_SESSION_KEY_FILE)) {
    const key = Buffer.from(readFileSync(ROOT_SESSION_KEY_FILE, "utf-8").trim(), "base64url");
    if (key.length === 32) return key;
    throw new Error(`Root session key at ${ROOT_SESSION_KEY_FILE} is corrupt; delete it to sign root out everywhere.`);
  }
  mkdirSync(dirname(ROOT_SESSION_KEY_FILE), { recursive: true, mode: 0o700 });
  const key = randomBytes(32);
  writeFileSync(ROOT_SESSION_KEY_FILE, `${key.toString("base64url")}\n`, { mode: 0o600 });
  chmodSync(ROOT_SESSION_KEY_FILE, 0o600);
  return key;
}

/**
 * The root cookie is stateless: no database row backs it. The plaintext just carries
 * an expiry, so revocation means deleting `root-session.key` (signs every browser
 * out) rather than tracking individual sessions for a single shared credential.
 */
export function sealRootSession(): string {
  const expiresAt = Date.now() + ROOT_SESSION_TTL_MS;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", rootSessionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(String(expiresAt), "utf-8")), cipher.final()]);
  return [ROOT_COOKIE_VERSION, iv, ciphertext, cipher.getAuthTag()]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function resolveRootSession(cookieValue: string | null | undefined): boolean {
  if (!cookieValue) return false;
  const [version, ivText, cipherText, tagText] = cookieValue.split(".");
  if (version !== ROOT_COOKIE_VERSION || !ivText || !cipherText || !tagText) return false;
  try {
    const decipher = createDecipheriv("aes-256-gcm", rootSessionKey(), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(cipherText, "base64url")),
      decipher.final(),
    ]).toString("utf-8");
    const expiresAt = Number(plaintext);
    return Number.isFinite(expiresAt) && expiresAt > Date.now();
  } catch {
    return false;
  }
}
