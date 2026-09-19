import type { ServerWebSocket } from "bun";
import type { PreviewManager } from "./previews.js";

/**
 * `/preview/:id/*` forwards to the preview's dev server on loopback so a single
 * exposed host port can serve customer previews. Apps that emit absolute asset URLs
 * must set their dev server `base` to `/preview/<id>/`; direct access has no such rule.
 */

export type PreviewSocketData = {
  kind: "preview";
  previewId: string;
  /** ws:// URL on the dev server this socket mirrors. */
  target: string;
  protocols: string[];
  upstream: WebSocket | null;
  /** Client frames that arrived before the upstream socket opened. */
  pending: Array<string | Uint8Array>;
};

type ProxyRoute = { id: string; rest: string; search: string; method: string };

// Hop-by-hop headers never cross a proxy; `accept-encoding` is dropped because fetch
// decompresses upstream bodies, which would leave a stale content-encoding behind.
const STRIP_REQUEST_HEADERS = new Set([
  "host", "connection", "keep-alive", "upgrade", "proxy-connection", "transfer-encoding", "te", "trailer", "accept-encoding",
]);
const STRIP_RESPONSE_HEADERS = new Set([
  "connection", "keep-alive", "transfer-encoding", "content-encoding", "content-length", "upgrade",
]);

function notRunning(status: string | null): Response {
  const body = status
    ? `<!doctype html><meta charset="utf-8"><title>Preview unavailable</title><p style="font:14px system-ui;padding:24px">This preview is ${status}. Ask the operator to restart it.</p>`
    : `<!doctype html><meta charset="utf-8"><title>Preview not found</title><p style="font:14px system-ui;padding:24px">No such preview.</p>`;
  return new Response(body, { status: status ? 503 : 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function rewriteLocation(location: string, port: number, prefix: string): string {
  if (location.startsWith("/")) return `${prefix}${location}`;
  const origin = `http://127.0.0.1:${port}`;
  const local = `http://localhost:${port}`;
  if (location.startsWith(origin)) return `${prefix}${location.slice(origin.length)}`;
  if (location.startsWith(local)) return `${prefix}${location.slice(local.length)}`;
  return location;
}

export function proxyPreviewRequest(
  req: Request,
  server: Bun.Server<{ kind: string } & Record<string, unknown>>,
  previews: PreviewManager,
  route: ProxyRoute,
): Promise<Response | undefined> {
  return previews.proxyTarget(route.id).then((target): Response | undefined | Promise<Response> => {
    if (!target) return notRunning(null);
    if (target.status !== "ready" && target.status !== "starting") return notRunning(target.status);
    const prefix = `/preview/${route.id}`;

    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const protocols = (req.headers.get("sec-websocket-protocol") ?? "")
        .split(",").map((item) => item.trim()).filter(Boolean);
      const data: PreviewSocketData = {
        kind: "preview",
        previewId: route.id,
        target: `ws://127.0.0.1:${target.port}${route.rest}${route.search}`,
        protocols,
        upstream: null,
        pending: [],
      };
      // Echo the first protocol so clients that require a match (Vite HMR) accept the handshake.
      const upgraded = protocols.length
        ? server.upgrade(req, { data, headers: { "Sec-WebSocket-Protocol": protocols[0]! } })
        : server.upgrade(req, { data });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    const headers = new Headers();
    req.headers.forEach((value, key) => {
      if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
    });
    headers.set("host", `127.0.0.1:${target.port}`);
    headers.set("x-forwarded-prefix", prefix);
    headers.set("x-forwarded-host", req.headers.get("host") ?? "");

    const hasBody = route.method !== "GET" && route.method !== "HEAD";
    return fetch(`http://127.0.0.1:${target.port}${route.rest}${route.search}`, {
      method: route.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: "manual",
    }).then((upstream) => {
      const out = new Headers();
      upstream.headers.forEach((value, key) => {
        if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) out.set(key, value);
      });
      const location = upstream.headers.get("location");
      if (location) out.set("location", rewriteLocation(location, target.port, prefix));
      return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
    }).catch(() => notRunning(target.status === "starting" ? "still starting" : "not answering"));
  });
}

/** Bridges one accepted client socket to the dev server's socket, both directions. */
export const previewSocketHandlers = {
  open(socket: ServerWebSocket<PreviewSocketData>): void {
    const data = socket.data;
    let upstream: WebSocket;
    try {
      upstream = data.protocols.length ? new WebSocket(data.target, data.protocols) : new WebSocket(data.target);
    } catch {
      socket.close(1011, "preview upstream unavailable");
      return;
    }
    upstream.binaryType = "arraybuffer";
    data.upstream = upstream;
    upstream.addEventListener("open", () => {
      for (const frame of data.pending) upstream.send(frame);
      data.pending = [];
    });
    upstream.addEventListener("message", (event) => {
      const payload = event.data;
      if (typeof payload === "string") socket.send(payload);
      else if (payload instanceof ArrayBuffer) socket.send(new Uint8Array(payload));
      else if (payload instanceof Uint8Array) socket.send(payload);
    });
    upstream.addEventListener("close", (event) => {
      try { socket.close(event.code === 1005 ? 1000 : event.code, event.reason); } catch { /* already closed */ }
    });
    upstream.addEventListener("error", () => {
      try { socket.close(1011, "preview upstream error"); } catch { /* already closed */ }
    });
  },
  message(socket: ServerWebSocket<PreviewSocketData>, message: string | Buffer): void {
    const frame = typeof message === "string" ? message : new Uint8Array(message);
    const upstream = socket.data.upstream;
    if (upstream && upstream.readyState === WebSocket.OPEN) upstream.send(frame);
    else socket.data.pending.push(frame);
  },
  close(socket: ServerWebSocket<PreviewSocketData>, code: number, reason: string): void {
    const upstream = socket.data.upstream;
    if (!upstream) return;
    try { upstream.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000, reason); } catch { /* ignore */ }
  },
};
