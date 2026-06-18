#!/bin/bash
# SessionStart hook — Claude Code on the web.
#
# Installs JS deps (+ Playwright Chromium with system deps) so the test suite,
# eslint, and tsc actually run inside a web session instead of failing on a
# missing node_modules. No-op outside remote web sessions — locally you already
# have your deps.
#
# Synchronous (no async block): the session waits until deps are ready, which
# avoids a race where the agent runs `bun run test` before install finishes.
set -euo pipefail

# Only do work in Claude Code on the web. Locally this is a no-op.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

echo "[session-start] bun install…"
if ! bun install; then
  echo "[session-start] bun install FAILED — most likely the environment's network policy is blocking the npm registry (HTTP 403). Loosen the egress policy for this environment: https://code.claude.com/docs/en/claude-code-on-the-web" >&2
  exit 1
fi

# Browser-backed tests (snapshot / render-canary). Best-effort: if network/apt
# is unavailable those tests self-skip anyway, and the pure unit tests only need
# `bun install`. We have root + apt here, so --with-deps installs the sysdeps
# Chromium needs to actually launch.
echo "[session-start] playwright chromium + system deps (best-effort)…"
bunx playwright install --with-deps chromium \
  || echo "[session-start] playwright install skipped — browser-backed tests will self-skip"

echo "[session-start] done — \`bun run test\` / \`bun run typecheck\` / \`bun run lint\` are ready."
