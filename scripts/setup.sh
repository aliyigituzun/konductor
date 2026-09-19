#!/usr/bin/env bash
# One-time Konductor bootstrap: installs dependencies, builds every package, and
# generates the root key that guards /root (the super-admin route). Safe to re-run.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required. Install it from https://bun.sh and re-run this script." >&2
  exit 1
fi

echo "==> Installing dependencies"
bun install

echo "==> Building packages"
bun run build

echo "==> Generating root key (if needed)"
bun run packages/cli/src/index.ts setup

echo ""
echo "Setup complete. Run 'bun run packages/cli/src/index.ts host start' and"
echo "'bun run packages/cli/src/index.ts dashboard' to bring Konductor up, then"
echo "open /root in the dashboard with the key printed above."
