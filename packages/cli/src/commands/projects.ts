import { readRegistryWithReachability, globalRegistry } from "@konductor/store";
import { fmt, header, relativeTime } from "../ui/format.js";

export async function runProjects(_args: string[]): Promise<void> {
  console.log(header("konductor projects"));

  const registry = await readRegistryWithReachability();

  if (registry.projects.length === 0) {
    console.log(
      `${fmt.dim("No projects registered yet.")}\n` +
        `Run ${fmt.bold("konductor init")} in a project directory to register one.\n`,
    );
    return;
  }

  const moved = registry.projects.filter((p) => !p.reachable);

  for (const entry of registry.projects) {
    const marker = entry.reachable ? fmt.green("●") : fmt.yellow("⚠");
    const label = entry.reachable
      ? fmt.bold(entry.name)
      : `${fmt.bold(entry.name)} ${fmt.yellow("(moved — not found)")}`;
    console.log(`  ${marker}  ${label}  ${fmt.dim(`[${entry.id}]`)}`);
    console.log(`     ${fmt.dim(entry.repo_path)}`);
    if (!entry.reachable) {
      console.log(
        `     ${fmt.yellow("Path no longer exists.")} ${fmt.dim(
          "Re-run `konductor init` from the new location, or remove it with `konductor delete --project " +
            entry.id +
            "`.",
        )}`,
      );
    } else {
      console.log(
        `     ${fmt.dim(`last sync ${entry.last_sync ? relativeTime(entry.last_sync) : "never"}`)}`,
      );
    }
  }

  console.log();
  const total = registry.projects.length;
  if (moved.length > 0) {
    console.log(
      `${fmt.yellow("⚠")} ${moved.length} of ${total} project${total === 1 ? "" : "s"} can't be found at their recorded path.`,
    );
    console.log(`${fmt.dim(`Registry: ${globalRegistry()}`)}\n`);
    process.exitCode = 1;
  } else {
    console.log(`${fmt.green("✓")} All ${total} registered project${total === 1 ? "" : "s"} reachable.\n`);
  }
}
