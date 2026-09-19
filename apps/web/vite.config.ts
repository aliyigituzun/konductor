import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
// Imported by relative path, not by package name: Vite loads this config under node
// and marks anything resolved through node_modules external, which would leave the
// workspace package's TypeScript source unloadable. A relative import gets bundled
// into the config instead.
import { createApiRouter, errorResponse, SESSION_COOKIE, readCookie } from "../../packages/api/src/index.js";
import { isAuthenticationRequired, resolveAuthSession } from "../../packages/store/src/index.js";

/**
 * Mount Konductor's API on the dev server.
 *
 * The route table itself lives in @konductor/api and is shared with the host
 * daemon, so the dashboard behaves identically whether it is served by Vite in
 * development or by the host from a production build. All this plugin does is
 * translate between node's req/res and the standard Request/Response the router
 * speaks.
 */
function konductorApiPlugin(): Plugin {
  const router = createApiRouter();
  // The router is bundled into this config when Vite starts, so an edit to the API
  // package is invisible until the server restarts. Vite only auto-restarts on
  // changes to the config file itself, not to what it imports; watch the package
  // source and restart explicitly so a new route works without a manual restart.
  const apiSrcDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/api/src") + sep;

  return {
    name: "konductor-api",
    configureServer(server) {
      server.watcher.add(apiSrcDir);
      server.watcher.on("change", (file) => {
        if (file.startsWith(apiSrcDir)) void server.restart();
      });
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        void handle(req, res).catch(() => next());
      });

      async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const request = await toRequest(req);
        const response = (await router.handle(request)) ?? errorResponse(notFound(request));
        res.statusCode = response.status;
        response.headers.forEach((value, key) => { if (key !== "set-cookie") res.setHeader(key, value); });
        // Set-Cookie must not be comma-joined like other headers.
        const cookies = response.headers.getSetCookie();
        if (cookies.length) res.setHeader("set-cookie", cookies);
        // Raw bytes, not text(): binary assets (png/mp4/mp3/blend) would otherwise be
        // UTF-8 decoded and re-encoded, corrupting them.
        res.end(Buffer.from(await response.arrayBuffer()));
      }
    },
  };
}

/**
 * The terminal stream proxy bypasses the API guard, so it checks the session cookie
 * itself. Vite's HTTP middlewares never see WebSocket upgrades; the proxy event is
 * the only hook, and closing the socket there is how an unauthenticated stream is
 * refused.
 */
function guardWebSocket(req: IncomingMessage, socket: { destroy: () => void }): void {
  void (async () => {
    if (!(await isAuthenticationRequired())) return;
    const request = new Request("http://localhost/", { headers: { cookie: req.headers.cookie ?? "" } });
    if (await resolveAuthSession(readCookie(request, SESSION_COOKIE))) return;
    socket.destroy();
  })().catch(() => socket.destroy());
}

function notFound(request: Request): Error {
  return Object.assign(new Error(`No API route for ${request.method} ${new URL(request.url).pathname}`), {
    name: "ApiError",
  });
}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
  const method = req.method ?? "GET";
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
  }
  if (method === "GET" || method === "HEAD") return new Request(url, { method, headers });

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return new Request(url, { method, headers, body: Buffer.concat(chunks) });
}

/**
 * The host's port, read once at dev-server start.
 *
 * WebSocket proxying needs a static target, so a host started on a non-default port
 * after Vite is already running needs the dashboard restarted. HTTP calls resolve
 * the port per request and are unaffected.
 */
function hostPortAtStartup(): number {
  try {
    const statePath = join(process.env["KONDUCTOR_HOME"] ?? join(homedir(), ".konductor"), "host", "state.json");
    if (!existsSync(statePath)) return 4096;
    const state = JSON.parse(readFileSync(statePath, "utf-8")) as { port?: number };
    return typeof state.port === "number" ? state.port : 4096;
  } catch {
    return 4096;
  }
}

export default defineConfig({
  plugins: [react(), konductorApiPlugin()],
  server: {
    port: 5173,
    proxy: {
      // Live terminal stream. The host is loopback-only, so this proxy is how the
      // browser reaches it at all.
      "/hostws": {
        target: `ws://127.0.0.1:${hostPortAtStartup()}`,
        ws: true,
        rewrite: (path) => path.replace(/^\/hostws/, ""),
        configure: (proxy) => {
          proxy.on("proxyReqWs", (_proxyReq, req, socket) => guardWebSocket(req, socket));
        },
      },
      // Proxied customer previews: same path on the host, HTTP and HMR websockets alike.
      "/preview": {
        target: `http://127.0.0.1:${hostPortAtStartup()}`,
        ws: true,
      },
    },
  },
});
