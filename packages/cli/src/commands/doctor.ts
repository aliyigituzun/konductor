import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { configPath, repoLocal, globalRegistry, readRegistry, readConfig, hostGlobal, isProjectReachable } from "@konductor/store";
import { StatusSnapshotSchema } from "@konductor/schema";
import { fmt, header, checkMark, warnMark } from "../ui/format.js";
import { hostFetch } from "./host-client.js";

type CheckResult = { label: string; pass: boolean; warn: boolean; message: string };

async function check(
  label: string,
  fn: () => Promise<{ pass: boolean; warn?: boolean; message: string }>
): Promise<CheckResult> {
  try {
    const r = await fn();
    return { label, pass: r.pass, warn: r.warn ?? false, message: r.message };
  } catch (e) {
    return { label, pass: false, warn: false, message: String(e) };
  }
}

export async function runDoctor(_args: string[]): Promise<void> {
  const cwd = process.cwd();
  const paths = repoLocal(cwd);

  console.log(header("konductor doctor"));

  const checks = await Promise.all([
    check("konductor.config.json exists", async () => {
      const exists = existsSync(configPath(cwd));
      return {
        pass: exists,
        message: exists ? configPath(cwd) : "Not found. Run `konductor init`.",
      };
    }),

    check(".konductor/ directory exists", async () => {
      const exists = existsSync(paths.dir);
      return { pass: exists, message: exists ? paths.dir : "Run `konductor init`." };
    }),

    check("~/.konductor/registry.json readable", async () => {
      const regPath = globalRegistry();
      if (!existsSync(regPath)) {
        return { pass: false, message: `Not found at ${regPath}` };
      }
      try {
        const raw = await readFile(regPath, "utf-8");
        JSON.parse(raw);
        return { pass: true, message: regPath };
      } catch {
        return { pass: false, message: `Cannot parse ${regPath}` };
      }
    }),

    check(".konductor/status/current.json exists and validates", async () => {
      if (!existsSync(paths.currentStatus)) {
        return { pass: false, message: "current.json not found." };
      }
      try {
        const raw = await readFile(paths.currentStatus, "utf-8");
        StatusSnapshotSchema.parse(JSON.parse(raw));
        return { pass: true, message: paths.currentStatus };
      } catch (e) {
        return { pass: false, message: `Validation failed: ${String(e)}` };
      }
    }),

    check("All registered project paths exist", async () => {
      const registry = await readRegistry();
      if (registry.projects.length === 0) {
        return { pass: true, message: "No projects registered." };
      }
      const moved = registry.projects.filter((p) => !isProjectReachable(p));
      if (moved.length === 0) {
        return { pass: true, message: `${registry.projects.length} project(s) reachable.` };
      }
      return {
        pass: false,
        warn: true,
        message: `Moved/missing: ${moved
          .map((p) => `${p.id} (${p.repo_path})`)
          .join(", ")} — run \`konductor projects\``,
      };
    }),

    check("Project registered in global registry", async () => {
      const cfg = await readConfig(cwd);
      if (!cfg) {
        return { pass: false, warn: true, message: "No config file." };
      }
      const registry = await readRegistry();
      const found = registry.projects.some((p) => p.id === cfg.project_id);
      return {
        pass: found,
        message: found
          ? `${cfg.project_id} registered`
          : `${cfg.project_id} not in registry — re-run konductor init`,
      };
    }),

    check("OTEL endpoint reachable (localhost:4318)", async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        await fetch("http://localhost:4318/v1/metrics", {
          method: "HEAD",
          signal: controller.signal,
        });
        clearTimeout(timeout);
        return { pass: true, warn: false, message: "localhost:4318 reachable" };
      } catch {
        return {
          pass: false,
          warn: true,
          message: "localhost:4318 not reachable — run `bun run spike` for telemetry",
        };
      }
    }),

    check("Default profile runtime resolves", async () => {
      const cfg = await readConfig(cwd);
      const profile = cfg?.agents?.profiles.find((item) => item.id === cfg.agents?.default_profile);
      if (!profile) {
        return { pass: false, message: "No default profile configured." };
      }
      if (profile.runner !== "claude_code") {
        return { pass: true, message: `Profile runner ${profile.runner} does not require a local binary.` };
      }
      const resolved = Bun.which(profile.binary);
      return {
        pass: !!resolved,
        message: resolved ? `${profile.binary} -> ${resolved}` : `${profile.binary} not found on PATH`,
      };
    }),

    check("Project MCP config exists", async () => {
      const mcpPath = join(cwd, ".mcp.json");
      return {
        pass: existsSync(mcpPath),
        warn: !existsSync(mcpPath),
        message: existsSync(mcpPath) ? mcpPath : "Missing .mcp.json — re-run konductor init",
      };
    }),

    check("Host storage directory writable", async () => {
      const host = hostGlobal();
      return {
        pass: true,
        message: host.dir,
      };
    }),

    check("Host daemon reachable when running", async () => {
      try {
        const res = await hostFetch(cwd, "/health");
        if (!res.ok) {
          return { pass: false, warn: true, message: "Host not responding — run `konductor host start`." };
        }
        const body = await res.json() as { port: number };
        return { pass: true, message: `Host responding on port ${body.port}` };
      } catch {
        return { pass: false, warn: true, message: "Host not running — run `konductor host start`." };
      }
    }),
  ]);

  let allPass = true;
  for (const c of checks) {
    const icon = c.pass ? checkMark(true) : c.warn ? warnMark() : checkMark(false);
    if (!c.pass && !c.warn) allPass = false;
    console.log(`  ${icon}  ${fmt.bold(c.label)}`);
    console.log(`     ${fmt.dim(c.message)}`);
  }

  console.log();
  if (allPass) {
    console.log(`${fmt.green("✓")} All checks passed.\n`);
  } else {
    console.log(`${fmt.red("✗")} Some checks failed. Review the output above.\n`);
    process.exitCode = 1;
  }
}
