#!/usr/bin/env bash
set -euo pipefail

# Move to the repo root (handles being run from subdirs or worktrees).
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Use an isolated data directory so this dev server does not corrupt
# a separately-running T3 Code instance (they share ~/.t3 by default).
# Each worktree/location gets its own subdirectory.
if [ -z "${T3CODE_HOME:-}" ]; then
  TREE_ID="$(echo "$REPO_ROOT" | md5 -q | head -c 8)"
  export T3CODE_HOME="$HOME/.t3-$TREE_ID"
fi

exec bun run dev "$@"
