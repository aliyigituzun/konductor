import { Router } from "./router.js";
import { registerFeatureRoutes } from "./routes/features.js";
import { registerDecisionRoutes } from "./routes/decisions.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerRunRoutes } from "./routes/runs.js";
import { registerAssetRoutes } from "./routes/assets.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerConfigurationRoutes } from "./routes/configuration.js";
import { registerReviewRoutes } from "./routes/reviews.js";
import { registerTodoRoutes } from "./routes/todos.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerRootRoutes } from "./routes/root.js";
import { authorizeRequest } from "./auth/guard.js";

export * from "./router.js";
export * from "./host-client.js";
export { SESSION_COOKIE, readCookie } from "./auth/cookies.js";
export { isPublicRoute, requiredPermission } from "./auth/policy.js";

/**
 * The dashboard's backend, as one route table, mounted by both the Vite dev server
 * and the host daemon.
 *
 * Patterns match on an exact segment count, so `/api/project/:id` cannot swallow
 * `/api/project/:id/agents`; it is still registered last to keep that obvious.
 */
export function createApiRouter(): Router {
  const router = new Router().protect(authorizeRequest);
  registerAuthRoutes(router);
  registerRootRoutes(router);
  registerRunRoutes(router);
  registerFeatureRoutes(router);
  registerTodoRoutes(router);
  registerDecisionRoutes(router);
  registerAssetRoutes(router);
  registerFileRoutes(router);
  registerConfigurationRoutes(router);
  registerReviewRoutes(router);
  registerProjectRoutes(router);
  return router;
}
