/**
 * A tiny pattern router over the standard Request/Response types.
 *
 * Standard types are the point: the same route table serves the Vite dev server
 * (through a thin node adapter) and the host daemon (which already speaks
 * Request/Response), so the dashboard's backend exists exactly once.
 */

import type { AuthPrincipal } from "@konductor/schema";

export type RouteParams = Record<string, string>;

export type RouteContext = {
  request: Request;
  url: URL;
  params: RouteParams;
  /** The signed-in operator, or null when authentication is not required. */
  principal: AuthPrincipal | null;
};

/**
 * Runs before every matched route. It either returns the request's principal (null
 * when the route is open) or a Response that short-circuits the handler, which is
 * how a missing session or permission is refused.
 */
export type RouteGuard = (input: {
  request: Request;
  url: URL;
  params: RouteParams;
}) => Promise<AuthPrincipal | null | Response>;

export type RouteHandler = (ctx: RouteContext) => Promise<Response> | Response;

type Route = {
  method: string;
  segments: string[];
  handler: RouteHandler;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly hint: string | null;
  readonly details: string[];

  constructor(
    message: string,
    options: { status?: number; code?: string; hint?: string | null; details?: string[] } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = options.status ?? 400;
    this.code = options.code ?? "API_ERROR";
    this.hint = options.hint ?? null;
    this.details = options.details ?? [];
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** One error shape for the whole product. */
export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return json(
      { error: error.message, code: error.code, hint: error.hint, details: error.details },
      error.status,
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return json({ error: message, code: "API_ERROR", hint: null, details: [] }, 500);
}

/** `/api/project/:id/docs` — `:name` segments are captured into params. */
function parsePattern(pattern: string): string[] {
  return pattern.split("/").filter((segment) => segment.length > 0);
}

function matchRoute(route: Route, method: string, pathname: string): RouteParams | null {
  if (route.method !== method) return null;
  const parts = pathname.split("/").filter((segment) => segment.length > 0);
  if (parts.length !== route.segments.length) return null;

  const params: RouteParams = {};
  for (let i = 0; i < route.segments.length; i += 1) {
    const expected = route.segments[i]!;
    const actual = parts[i]!;
    if (expected.startsWith(":")) {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

export class Router {
  private readonly routes: Route[] = [];
  private guard: RouteGuard | null = null;

  /** Install the authorization guard. Without one every route runs unauthenticated. */
  protect(guard: RouteGuard): this {
    this.guard = guard;
    return this;
  }

  add(method: string, pattern: string, handler: RouteHandler): this {
    this.routes.push({ method, segments: parsePattern(pattern), handler });
    return this;
  }

  get(pattern: string, handler: RouteHandler): this {
    return this.add("GET", pattern, handler);
  }
  post(pattern: string, handler: RouteHandler): this {
    return this.add("POST", pattern, handler);
  }
  put(pattern: string, handler: RouteHandler): this {
    return this.add("PUT", pattern, handler);
  }
  patch(pattern: string, handler: RouteHandler): this {
    return this.add("PATCH", pattern, handler);
  }
  delete(pattern: string, handler: RouteHandler): this {
    return this.add("DELETE", pattern, handler);
  }

  /** Returns null when no route matches, so a caller can fall through. */
  async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    for (const route of this.routes) {
      const params = matchRoute(route, request.method, url.pathname);
      if (!params) continue;
      try {
        const outcome = this.guard ? await this.guard({ request, url, params }) : null;
        if (outcome instanceof Response) return outcome;
        return await route.handler({ request, url, params, principal: outcome });
      } catch (error) {
        return errorResponse(error);
      }
    }
    return null;
  }
}

/** Parse a JSON request body, with a useful message when it is not JSON. */
export async function readJsonBody<T>(request: Request): Promise<T> {
  const text = await request.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError("Request body is not valid JSON.", {
      status: 400,
      code: "INVALID_JSON",
    });
  }
}
