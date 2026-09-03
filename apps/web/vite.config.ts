import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
// Imported by relative path, not by package name: Vite loads this config under node
// and marks anything resolved through node_modules external, which would leave the
// workspace package's TypeScript source unloadable. A relative import gets bundled
// into the config instead.
import { createApiRouter, errorResponse } from "../../packages/api/src/index.js";

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

  return {
    name: "konductor-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        void handle(req, res).catch(() => next());
      });

      async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const request = await toRequest(req);
        const response = (await router.handle(request)) ?? errorResponse(notFound(request));
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(await response.text());
      }
    },
  };
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
    const statePath = join(homedir(), ".konductor", "host", "state.json");
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
      },
    },
  },
});
