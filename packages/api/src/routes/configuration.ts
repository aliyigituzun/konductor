import { randomUUID } from "node:crypto";
import {
  ConfigurationScopeTypeSchema,
  FeatureFlagsSchema,
  HOST_SCOPE_ID,
  RemoteAccessSettingsSchema,
  ThemePreferenceSchema,
  TokenPermissionSchema,
  TokenRoleSchema,
  UserPermissionSetSchema,
  validatePermissionSets,
  type ConfigurationScopeType,
  type TokenPermission,
  type UserPermissionSet,
} from "@konductor/schema";
import {
  createAccessToken,
  createAuthUser,
  connectGitHub,
  disconnectGitHub,
  getProject,
  listAccessTokens,
  listPreviews,
  PortSettingsError,
  updatePortSettings,
  validatePortSettings,
  readConfigurationState,
  revokeAccessToken,
  setAuthenticationEnabled,
  updateFeatureFlags,
  updateGeneralConfiguration,
  updateRemoteConfiguration,
  updateAuthUserPermissionSets,
  updateAuthUserTodoPins,
  removeProviderSecret,
  writeProviderSecret,
} from "@konductor/store";
import { ApiError, json, readJsonBody, type Router } from "../router.js";

async function resolveScope(rawType: string, scopeId: string): Promise<ConfigurationScopeType> {
  const parsed = ConfigurationScopeTypeSchema.safeParse(rawType);
  if (!parsed.success) {
    throw new ApiError("Configuration scope must be project, project_space, or host.", {
      status: 400,
      code: "CONFIG_SCOPE_INVALID",
    });
  }
  if (parsed.data === "project" && !(await getProject(scopeId))) {
    throw new ApiError(`Project ${scopeId} not found.`, {
      status: 404,
      code: "PROJECT_NOT_FOUND",
    });
  }
  if (parsed.data === "host" && scopeId !== HOST_SCOPE_ID) {
    throw new ApiError(`The host scope id is always "${HOST_SCOPE_ID}".`, {
      status: 400,
      code: "HOST_SCOPE_INVALID",
    });
  }
  if (parsed.data === "project_space" && !/^[a-z0-9][a-z0-9-]*$/.test(scopeId)) {
    throw new ApiError("Project-space id is invalid.", {
      status: 400,
      code: "PROJECT_SPACE_INVALID",
    });
  }
  return parsed.data;
}

/** Authentication and remote access belong to a Project Space, never to one project. */
function requireProjectSpace(scopeType: ConfigurationScopeType, what: string): void {
  if (scopeType === "project") {
    throw new ApiError(`${what} is configured per Project Space, not per project.`, {
      status: 400,
      code: "SCOPE_PROJECT_SPACE_REQUIRED",
      hint: "Open the Project Space configuration from the portfolio page.",
    });
  }
}

function scopedProjectIds(
  scopeType: ConfigurationScopeType,
  scopeId: string,
  rawProjects: string | null,
): string[] {
  if (scopeType === "project") return [scopeId];
  return (rawProjects ?? "").split(",").map((id) => id.trim()).filter(Boolean);
}

/**
 * Validates the permission sets a user form submits. Ids are assigned here when the
 * client omits them, projects must be registered, and no project may sit in two sets.
 */
async function resolvePermissionSets(raw: unknown): Promise<UserPermissionSet[]> {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new ApiError("Permission sets must be a list.", { status: 400, code: "PERMISSION_SETS_INVALID" });
  }
  const sets: UserPermissionSet[] = [];
  const details: string[] = [];
  raw.forEach((entry, index) => {
    const candidate = typeof entry === "object" && entry !== null ? entry as Record<string, unknown> : {};
    const parsed = UserPermissionSetSchema.safeParse({ id: randomUUID(), ...candidate });
    if (parsed.success) sets.push(parsed.data);
    else details.push(...parsed.error.errors.map((issue) => `Set ${index + 1} ${issue.path.join(".")}: ${issue.message}`));
  });
  details.push(...validatePermissionSets(sets));
  if (details.length > 0) {
    throw new ApiError("Permission sets are invalid.", { status: 400, code: "PERMISSION_SETS_INVALID", details });
  }
  const projectIds = [...new Set(sets.flatMap((set) => set.project_ids))];
  const missing = (await Promise.all(projectIds.map(async (id) => await getProject(id) ? null : id)))
    .filter((id): id is string => id !== null);
  if (missing.length > 0) {
    throw new ApiError("One or more permission-set projects are not registered.", {
      status: 400,
      code: "PERMISSION_SET_PROJECT_INVALID",
      details: missing,
    });
  }
  return sets;
}

function githubSecretScope(scopeType: ConfigurationScopeType, scopeId: string): string {
  return `integration-${scopeType}-${scopeId}`;
}

export function registerConfigurationRoutes(router: Router): void {
  router.get("/api/config/:scopeType/:scopeId", async ({ params }) => {
    const scopeType = await resolveScope(params["scopeType"]!, params["scopeId"]!);
    return json(await readConfigurationState(scopeType, params["scopeId"]!));
  });

  router.put("/api/config/:scopeType/:scopeId/general", async ({ params, request }) => {
    const scopeId = params["scopeId"]!;
    const scopeType = await resolveScope(params["scopeType"]!, scopeId);
    const body = await readJsonBody<{ theme?: unknown }>(request);
    const theme = ThemePreferenceSchema.safeParse(body.theme);
    if (!theme.success) {
      throw new ApiError("Theme must be system, light, or dark.", {
        status: 400,
        code: "THEME_INVALID",
      });
    }
    return json(await updateGeneralConfiguration(scopeType, scopeId, theme.data));
  });

  router.put("/api/config/:scopeType/:scopeId/remote", async ({ params, request }) => {
    const scopeId = params["scopeId"]!;
    const scopeType = await resolveScope(params["scopeType"]!, scopeId);
    requireProjectSpace(scopeType, "Remote access");
    const parsed = RemoteAccessSettingsSchema.safeParse(await readJsonBody<unknown>(request));
    if (!parsed.success) {
      throw new ApiError("Remote port-forwarding settings are invalid.", {
        status: 400,
        code: "REMOTE_SETTINGS_INVALID",
        details: parsed.error.errors.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
    }
    try {
      return json(await updateRemoteConfiguration(scopeType, scopeId, parsed.data));
    } catch (error) {
      throw new ApiError(error instanceof Error ? error.message : String(error), {
        status: 409,
        code: "REMOTE_AUTH_REQUIRED",
      });
    }
  });

  // Ports are a property of the machine, so only the host scope accepts them.
  router.put("/api/config/:scopeType/:scopeId/ports", async ({ params, request }) => {
    const scopeId = params["scopeId"]!;
    const scopeType = await resolveScope(params["scopeType"]!, scopeId);
    if (scopeType !== "host") {
      throw new ApiError("Port reservations are host-wide; use the host/local scope.", {
        status: 400,
        code: "PORTS_SCOPE_INVALID",
      });
    }
    let ports;
    try {
      ports = validatePortSettings(await readJsonBody<unknown>(request));
    } catch (error) {
      if (error instanceof PortSettingsError) {
        throw new ApiError(error.message, { status: 400, code: "PORT_SETTINGS_INVALID" });
      }
      throw error;
    }
    const clash = (await listPreviews({ live: true })).find((preview) =>
      ports.reserved.some((range) => preview.port >= range.start && preview.port <= range.end));
    if (clash) {
      throw new ApiError(`Port ${clash.port} is in use by a running preview (${clash.branch}).`, {
        status: 409,
        code: "PORT_IN_USE",
        hint: "Stop that preview first, then reserve the port.",
        details: [`Preview: ${clash.id}`],
      });
    }
    return json(await updatePortSettings(scopeType, scopeId, ports));
  });

  // Which tabs show up in the dashboard is host-wide, same as ports.
  router.put("/api/config/:scopeType/:scopeId/features", async ({ params, request }) => {
    const scopeId = params["scopeId"]!;
    const scopeType = await resolveScope(params["scopeType"]!, scopeId);
    if (scopeType !== "host") {
      throw new ApiError("Feature toggles are host-wide; use the host/local scope.", {
        status: 400,
        code: "FEATURES_SCOPE_INVALID",
      });
    }
    const parsed = FeatureFlagsSchema.safeParse(await readJsonBody<unknown>(request));
    if (!parsed.success) {
      throw new ApiError("Feature toggles are invalid.", {
        status: 400,
        code: "FEATURES_INVALID",
        details: parsed.error.errors.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
    }
    return json(await updateFeatureFlags(scopeType, scopeId, parsed.data));
  });

  router.put("/api/config/:scopeType/:scopeId/auth", async ({ params, request }) => {
    const scopeId = params["scopeId"]!;
    const scopeType = await resolveScope(params["scopeType"]!, scopeId);
    requireProjectSpace(scopeType, "Authentication");
    const body = await readJsonBody<{ enabled?: unknown }>(request);
    if (typeof body.enabled !== "boolean") {
      throw new ApiError("Authentication enabled must be a boolean.", {
        status: 400,
        code: "AUTH_SETTINGS_INVALID",
      });
    }
    try {
      return json(await setAuthenticationEnabled(scopeType, scopeId, body.enabled));
    } catch (error) {
      throw new ApiError(error instanceof Error ? error.message : String(error), {
        status: 409,
        code: "AUTH_ADMIN_REQUIRED",
      });
    }
  });

  router.post("/api/config/:scopeType/:scopeId/integrations/github", async ({ params, request }) => {
    const scopeId = params["scopeId"]!;
    const scopeType = await resolveScope(params["scopeType"]!, scopeId);
    const body = await readJsonBody<{ token?: unknown }>(request);
    if (typeof body.token !== "string" || !body.token.trim()) {
      throw new ApiError("A GitHub personal access token is required.", {
        status: 400,
        code: "GITHUB_TOKEN_REQUIRED",
      });
    }
    let profile: { login?: unknown; name?: unknown; avatar_url?: unknown };
    try {
      const response = await fetch("https://api.github.com/user", {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${body.token.trim()}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "Konductor",
        },
      });
      if (response.status === 401) {
        throw new ApiError("GitHub did not accept that token.", { status: 401, code: "GITHUB_TOKEN_INVALID" });
      }
      if (!response.ok) throw new Error(`GitHub returned ${response.status}.`);
      profile = await response.json() as { login?: unknown; name?: unknown; avatar_url?: unknown };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("Could not verify the GitHub connection. Check your network and try again.", {
        status: 502,
        code: "GITHUB_VERIFICATION_FAILED",
      });
    }
    if (typeof profile.login !== "string" || !profile.login) {
      throw new ApiError("GitHub returned an invalid account profile.", { status: 502, code: "GITHUB_PROFILE_INVALID" });
    }
    const connection = {
      login: profile.login,
      name: typeof profile.name === "string" ? profile.name : null,
      avatar_url: typeof profile.avatar_url === "string" ? profile.avatar_url : null,
      connected_at: new Date().toISOString(),
    };
    const state = await connectGitHub(scopeType, scopeId, connection);
    try {
      await writeProviderSecret(githubSecretScope(scopeType, scopeId), "github", body.token);
    } catch (error) {
      await disconnectGitHub(scopeType, scopeId);
      throw new ApiError("GitHub was verified, but Konductor could not store its token.", {
        status: 500,
        code: "GITHUB_SECRET_STORE_FAILED",
      });
    }
    return json(state, 201);
  });

  router.delete("/api/config/:scopeType/:scopeId/integrations/github", async ({ params }) => {
    const scopeId = params["scopeId"]!;
    const scopeType = await resolveScope(params["scopeType"]!, scopeId);
    await removeProviderSecret(githubSecretScope(scopeType, scopeId), "github");
    return json(await disconnectGitHub(scopeType, scopeId));
  });

  router.post("/api/config/:scopeType/:scopeId/auth/users", async ({ params, request }) => {
    const scopeId = params["scopeId"]!;
    const scopeType = await resolveScope(params["scopeType"]!, scopeId);
    requireProjectSpace(scopeType, "User management");
    const body = await readJsonBody<{
      display_name?: string;
      email?: string;
      password?: string;
      role?: "admin" | "member";
      permission_sets?: unknown;
    }>(request);
    if (!body.display_name?.trim() || !body.email?.trim() || !body.password) {
      throw new ApiError("Name, email, and password are required.", {
        status: 400,
        code: "AUTH_USER_FIELDS_REQUIRED",
      });
    }
    const permissionSets = await resolvePermissionSets(body.permission_sets);
    try {
      return json(await createAuthUser({
        scope_type: scopeType,
        scope_id: scopeId,
        display_name: body.display_name,
        email: body.email,
        password: body.password,
        ...(body.role ? { role: body.role } : {}),
        permission_sets: permissionSets,
      }), 201);
    } catch (error) {
      throw new ApiError(error instanceof Error ? error.message : String(error), {
        status: 400,
        code: "AUTH_USER_INVALID",
      });
    }
  });

  router.put("/api/config/:scopeType/:scopeId/auth/users/:userId/permission-sets", async ({ params, request }) => {
    const scopeId = params["scopeId"]!;
    const scopeType = await resolveScope(params["scopeType"]!, scopeId);
    requireProjectSpace(scopeType, "User management");
    const body = await readJsonBody<{ permission_sets?: unknown }>(request);
    const permissionSets = await resolvePermissionSets(body.permission_sets ?? []);
    try {
      return json(await updateAuthUserPermissionSets({
        scope_type: scopeType,
        scope_id: scopeId,
        user_id: params["userId"]!,
        permission_sets: permissionSets,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ApiError(message, message.includes("not found")
        ? { status: 404, code: "AUTH_USER_NOT_FOUND" }
        : { status: 400, code: "PERMISSION_SETS_INVALID" });
    }
  });

  router.put("/api/config/:scopeType/:scopeId/auth/users/:userId/todo-pins", async ({ params, request }) => {
    const scopeId = params["scopeId"]!;
    const scopeType = await resolveScope(params["scopeType"]!, scopeId);
    requireProjectSpace(scopeType, "User management");
    const body = await readJsonBody<{ pinned_todo_phase_ids?: unknown }>(request);
    if (!Array.isArray(body.pinned_todo_phase_ids) || body.pinned_todo_phase_ids.some((id) => typeof id !== "string")) {
      throw new ApiError("Pinned to-do phases must be a list of phase IDs.", { status: 400, code: "TODO_PINS_INVALID" });
    }
    try {
      return json(await updateAuthUserTodoPins({
        scope_type: scopeType,
        scope_id: scopeId,
        user_id: params["userId"]!,
        pinned_todo_phase_ids: body.pinned_todo_phase_ids,
      }));
    } catch (error) {
      throw new ApiError(error instanceof Error ? error.message : String(error), { status: 404, code: "AUTH_USER_NOT_FOUND" });
    }
  });

  router.get("/api/config/:scopeType/:scopeId/tokens", async ({ params, url }) => {
    const scopeId = params["scopeId"]!;
    const scopeType = await resolveScope(params["scopeType"]!, scopeId);
    const projectIds = scopedProjectIds(scopeType, scopeId, url.searchParams.get("projects"));
    const records = await listAccessTokens();
    return json({
      tokens: projectIds.length === 0
        ? []
        : records.filter((token) => token.grants.some((grant) => projectIds.includes(grant.project_id))),
    });
  });

  router.post("/api/config/:scopeType/:scopeId/tokens", async ({ params, request }) => {
    const scopeId = params["scopeId"]!;
    await resolveScope(params["scopeType"]!, scopeId);
    const body = await readJsonBody<{
      name?: string;
      project_ids?: string[];
      role?: string;
      permissions?: string[];
      expires_at?: string | null;
    }>(request);
    if (!body.name?.trim() || !body.project_ids?.length) {
      throw new ApiError("Token name and at least one valid project are required.", {
        status: 400,
        code: "TOKEN_FIELDS_REQUIRED",
      });
    }
    const role = TokenRoleSchema.safeParse(body.role ?? "contributor");
    const permissions = (body.permissions ?? []).map((permission) => TokenPermissionSchema.safeParse(permission));
    if (!role.success || permissions.some((permission) => !permission.success)) {
      throw new ApiError("Token role or permissions are invalid.", {
        status: 400,
        code: "TOKEN_GRANT_INVALID",
      });
    }
    if (role.data === "custom" && permissions.length === 0) {
      throw new ApiError("A custom token role needs at least one permission.", {
        status: 400,
        code: "TOKEN_PERMISSIONS_REQUIRED",
      });
    }
    if (role.data !== "custom" && permissions.length > 0) {
      throw new ApiError("Explicit permissions require the custom token role.", {
        status: 400,
        code: "TOKEN_ROLE_INVALID",
      });
    }
    const projectIds = [...new Set(body.project_ids)];
    const missing = (await Promise.all(projectIds.map(async (id) => await getProject(id) ? null : id)))
      .filter((id): id is string => id !== null);
    if (missing.length > 0) {
      throw new ApiError("One or more token projects are not registered.", {
        status: 400,
        code: "TOKEN_PROJECT_INVALID",
        details: missing,
      });
    }
    const expiresAt = body.expires_at ?? null;
    if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) {
      throw new ApiError("Token expiry must be a future date/time.", {
        status: 400,
        code: "TOKEN_EXPIRY_INVALID",
      });
    }
    const issued = await createAccessToken({
      kind: "external",
      name: body.name.trim(),
      grants: projectIds.map((projectId) => ({
        project_id: projectId,
        role: role.data,
        permissions: permissions.map((permission) => permission.data as TokenPermission),
      })),
      created_by: "local-dashboard",
      expires_at: expiresAt,
    });
    return json(issued, 201);
  });

  router.delete("/api/access-tokens/:tokenId", async ({ params }) => {
    const revoked = await revokeAccessToken(params["tokenId"]!, {
      revoked_by: "local-dashboard",
      reason: "Revoked from configuration UI.",
    });
    if (!revoked) {
      throw new ApiError("Access token not found.", {
        status: 404,
        code: "TOKEN_NOT_FOUND",
      });
    }
    return json({ token: revoked });
  });
}
