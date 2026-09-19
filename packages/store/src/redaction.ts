const ACCESS_TOKEN_PATTERN = /\bknd_(?:int|ext)_[a-f0-9]{12}_[A-Za-z0-9_-]{20,}\b/g;
const SECRET_ASSIGNMENT_PATTERN = /\b([A-Za-z_][A-Za-z0-9_]*(?:token|secret|password|key)[A-Za-z0-9_]*)=([^\s]+)/gi;

/** Prevent credentials from resurfacing through stored errors, logs, or update feeds. */
export function redactSensitiveText(value: string): string {
  return value
    .replace(ACCESS_TOKEN_PATTERN, "[redacted-access-token]")
    .replace(SECRET_ASSIGNMENT_PATTERN, "$1=[redacted]");
}
