#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ -z "${T3CODE_HOME:-}" ]; then
  TREE_ID="$(printf '%s' "$REPO_ROOT" | shasum -a 256 | cut -c1-8)"
  export T3CODE_HOME="$HOME/.t3-hcode-$TREE_ID"
fi

exec pnpm run dev "$@"
