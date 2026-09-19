export const SESSION_COOKIE = "konductor_session";
export const ROOT_SESSION_COOKIE = "konductor_root_session";

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  return new URL(request.url).protocol === "https:" || forwarded === "https";
}

/** HttpOnly + SameSite=Lax keeps the cookie off scripts and off cross-site POSTs. */
function cookie(name: string, request: Request, value: string, maxAgeSeconds: number): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    ...(isSecureRequest(request) ? ["Secure"] : []),
  ].join("; ");
}

export function sessionCookie(request: Request, value: string, maxAgeSeconds: number): string {
  return cookie(SESSION_COOKIE, request, value, maxAgeSeconds);
}

export function clearedSessionCookie(request: Request): string {
  return sessionCookie(request, "", 0);
}

export function rootSessionCookie(request: Request, value: string, maxAgeSeconds: number): string {
  return cookie(ROOT_SESSION_COOKIE, request, value, maxAgeSeconds);
}

export function clearedRootSessionCookie(request: Request): string {
  return rootSessionCookie(request, "", 0);
}
