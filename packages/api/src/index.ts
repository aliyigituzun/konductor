import { Router } from "./router.js";
import { registerFeatureRoutes } from "./routes/features.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerRunRoutes } from "./routes/runs.js";

export * from "./router.js";
export * from "./host-client.js";

/**
 * The dashboard's backend, as one route table.
 *
 * It used to live inside apps/web/vite.config.ts, where it re-implemented
 * @konductor/store without the schema validation the store applies — and, because
 * it was a Vite plugin, the dashboard could only run under a dev server. Here it is
 * mounted by both the dev server and the host daemon, which is what lets Konductor
 * ship as an installable package.
 *
 * Patterns match on an exact segment count, so `/api/project/:id` cannot swallow
 * `/api/project/:id/agents`; it is still registered last to keep that obvious.
 */
export function createApiRouter(): Router {
  const router = new Router();
  registerRunRoutes(router);
  registerFeatureRoutes(router);
  registerProjectRoutes(router);
  return router;
}
