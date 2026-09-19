import {
  TOKEN_PERMISSIONS,
  TokenPermissionSchema,
  TokenRoleSchema,
  type TokenPermission,
  type TokenRole,
} from "@konductor/schema";
import {
  createAccessToken,
  getProject,
  listAccessTokens,
  listTokenAuditEvents,
  readConfig,
  reconcileInternalProfileTokens,
  revokeAccessToken,
} from "@konductor/store";
import { fmt, header } from "../ui/format.js";

function option(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function options(args: string[], name: string): string[] {
  return args.flatMap((arg, index) => arg === name && args[index + 1] ? [args[index + 1]!] : []);
}

function parseExpiry(args: string[]): string | null {
  const absolute = option(args, "--expires-at");
  if (absolute) {
    const parsed = new Date(absolute);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      throw new Error("--expires-at must be a future ISO date/time.");
    }
    return parsed.toISOString();
  }
  const relative = option(args, "--expires-in");
  if (!relative) return null;
  const match = relative.match(/^(\d+)(m|h|d|w)$/);
  if (!match) throw new Error("--expires-in must look like 30m, 12h, 7d, or 4w.");
  const amount = Number.parseInt(match[1]!, 10);
  const units = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 } as const;
  return new Date(Date.now() + amount * units[match[2] as keyof typeof units]).toISOString();
}

async function currentProjectId(cwd: string, args: string[]): Promise<string> {
  const explicit = option(args, "--project");
  const id = explicit ?? (await readConfig(cwd))?.project_id;
  if (!id) throw new Error("Select a project with --project or run this inside an initialized project.");
  if (!(await getProject(id))) throw new Error(`Project ${id} is not registered with Konductor.`);
  return id;
}

async function createExternal(cwd: string, args: string[]): Promise<void> {
  const projectId = await currentProjectId(cwd, args);
  const name = option(args, "--name")?.trim();
  if (!name) throw new Error("External tokens require --name.");
  const roleResult = TokenRoleSchema.safeParse(option(args, "--role") ?? "contributor");
  if (!roleResult.success) throw new Error("--role must be observer, contributor, operator, administrator, or custom.");
  const role = roleResult.data as TokenRole;
  const rawPermissions = options(args, "--permission");
  const permissions: TokenPermission[] = rawPermissions.map((value) => {
    const parsed = TokenPermissionSchema.safeParse(value);
    if (!parsed.success) throw new Error(`Unknown permission ${value}.`);
    return parsed.data;
  });
  if (role === "custom" && permissions.length === 0) {
    throw new Error("A custom role needs at least one --permission.");
  }
  if (role !== "custom" && permissions.length > 0) {
    throw new Error("Use --role custom when supplying --permission.");
  }

  const issued = await createAccessToken({
    kind: "external",
    name,
    grants: [{ project_id: projectId, role, permissions }],
    created_by: "local-operator",
    expires_at: parseExpiry(args),
  });
  console.log(`${fmt.green("✓")} External token created for ${fmt.bold(projectId)}`);
  console.log(`  ${fmt.dim("id:")}      ${issued.record.id}`);
  console.log(`  ${fmt.dim("role:")}    ${role}`);
  console.log(`  ${fmt.dim("expires:")} ${issued.record.expires_at ?? "never"}`);
  console.log(`\n${fmt.yellow("Copy this token now. It is not stored in recoverable form:")}`);
  console.log(`\n${issued.token}\n`);
}

async function list(cwd: string, args: string[]): Promise<void> {
  const projectId = args.includes("--all") ? undefined : await currentProjectId(cwd, args);
  const records = await listAccessTokens(projectId);
  if (records.length === 0) {
    console.log(`${fmt.dim("No access tokens found.")}\n`);
    return;
  }
  for (const record of records) {
    const state = record.revoked_at
      ? `revoked ${record.revoked_at}`
      : record.expires_at && Date.parse(record.expires_at) <= Date.now()
        ? `expired ${record.expires_at}`
        : "active";
    console.log(`${record.id}  ${record.kind.padEnd(8)}  ${state}`);
    console.log(`  ${record.name} · ${record.prefix}… · uses ${record.use_count}`);
    for (const grant of record.grants) {
      console.log(`  ${grant.project_id}: ${grant.role} [${grant.permissions.join(", ")}]`);
    }
  }
  console.log();
}

async function syncInternal(cwd: string): Promise<void> {
  const config = await readConfig(cwd);
  if (!config?.agents) throw new Error("This project has no configured agent profiles.");
  const issued = await reconcileInternalProfileTokens(config.project_id, config.agents.profiles);
  console.log(`${fmt.green("✓")} Internal identities synchronized for ${issued.size} agent profile(s).`);
  for (const [profileId, token] of issued) {
    console.log(`  ${profileId}: ${token.record.id}`);
  }
  console.log();
}

async function revoke(args: string[]): Promise<void> {
  const tokenId = args[1];
  if (!tokenId) throw new Error("Usage: konductor tokens revoke <token-id> [--reason <text>]");
  const revoked = await revokeAccessToken(tokenId, {
    revoked_by: "local-operator",
    reason: option(args, "--reason"),
  });
  if (!revoked) throw new Error(`Token ${tokenId} was not found.`);
  console.log(`${fmt.green("✓")} Revoked ${revoked.id}.\n`);
}

async function audit(cwd: string, args: string[]): Promise<void> {
  const projectId = args.includes("--all") ? undefined : await currentProjectId(cwd, args);
  const rawLimit = Number.parseInt(option(args, "--limit") ?? "50", 10);
  const events = await listTokenAuditEvents({
    ...(projectId ? { project_id: projectId } : {}),
    limit: Number.isFinite(rawLimit) ? rawLimit : 50,
  });
  for (const event of events) {
    console.log(`${event.at}  ${event.outcome.padEnd(7)}  ${event.actor_label}  ${event.action}`);
    console.log(`  project=${event.project_id ?? "—"} permission=${event.permission ?? "—"} target=${event.target ?? "—"}`);
  }
  if (events.length === 0) console.log(fmt.dim("No audit events found."));
  console.log();
}

function help(): void {
  console.log(`Usage:
  konductor tokens list [--project <id> | --all]
  konductor tokens create --name <label> [--project <id>] [--role <role>]
                          [--permission <permission> ...] [--expires-in 7d]
  konductor tokens revoke <token-id> [--reason <text>]
  konductor tokens sync
  konductor tokens audit [--project <id> | --all] [--limit 50]

Roles:
  observer       Read project state, runs, assets, and files
  contributor    Observer access plus status, update, and asset writes
  operator       Contributor access plus run control, file writes, configuration,
                 audit visibility, and token visibility
  administrator  Every capability, including token creation and revocation
  custom         Only the explicitly supplied --permission values
Permissions: ${TOKEN_PERMISSIONS.join(", ")}`);
}

export async function runTokens(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const subcommand = args[0] ?? "list";
  console.log(header(`konductor tokens ${subcommand}`));
  switch (subcommand) {
    case "list": await list(cwd, args.slice(1)); break;
    case "create": await createExternal(cwd, args.slice(1)); break;
    case "revoke": await revoke(args); break;
    case "sync": await syncInternal(cwd); break;
    case "audit": await audit(cwd, args.slice(1)); break;
    case "help":
    case "--help":
    case "-h": help(); break;
    default: throw new Error(`Unknown tokens subcommand: ${subcommand}`);
  }
}
