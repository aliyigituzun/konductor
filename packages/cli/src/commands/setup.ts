import { ensureRootKey, rootKeyPath, GLOBAL_DIR } from "@konductor/store";
import { fmt, header } from "../ui/format.js";

/**
 * One-time machine bootstrap: generates the 32-character root key that guards
 * `/root`, the super-admin route for creating admin accounts and project spaces.
 * Safe to re-run — an existing key is left untouched and never re-printed.
 */
export async function runSetup(): Promise<void> {
  console.log(header("konductor setup"));
  console.log(`${fmt.dim("home:")} ${GLOBAL_DIR}\n`);

  const { created, key } = ensureRootKey();
  if (created && key) {
    console.log(`${fmt.green("✓")} Generated the root key.`);
    console.log(`  ${fmt.bold("This is shown once. Store it somewhere safe.")}\n`);
    console.log(`  ${fmt.cyan(key)}\n`);
    console.log(`  It is also saved to ${fmt.dim(rootKeyPath())} (mode 600).`);
  } else {
    console.log(`${fmt.green("✓")} Root key already exists at ${fmt.dim(rootKeyPath())}.`);
    console.log(`  Delete that file and re-run ${fmt.bold("konductor setup")} to rotate it.`);
  }

  console.log(`\nNext steps:`);
  console.log(`  1. ${fmt.bold("konductor host start")}   — start the host daemon`);
  console.log(`  2. ${fmt.bold("konductor dashboard")}    — open the dashboard`);
  console.log(`  3. Visit ${fmt.cyan("/root")} in the dashboard and enter the root key above`);
  console.log(`     to create your first admin account and project space.\n`);
}
