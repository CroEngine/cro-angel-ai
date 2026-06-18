#!/bin/bash
# SessionStart hook — Claude Code on the web.
#
# Installs JS deps (+ Playwright Chromium with system deps) so the test suite,
# eslint, and tsc actually run inside a web session instead of failing on a
# missing node_modules. No-op outside remote web sessions — locally you already
# have your deps.
#
# Why npm, not bun: this repo's bun.lock pins every tarball to Lovable's PRIVATE
# Artifact Registry (europe-west1-npm.pkg.dev), which the Claude-Code-on-web
# environment can't authenticate to (HTTP 403). Public npm (registry.npmjs.org)
# IS reachable and proxy-compatible here, and the docs flag bun as having known
# proxy issues. So we resolve from package.json via npm against public npm.
# --no-package-lock keeps the working tree clean (no stray lockfile committed).
#
# Synchronous (no async block): the session waits until deps are ready, which
# avoids a race where the agent runs `bun run test` before install finishes.
set -euo pipefail

# Only do work in Claude Code on the web. Locally this is a no-op.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

# Environment caching persists node_modules across resumes — skip if present.
if [ -d node_modules/vitest ]; then
  echo "[session-start] node_modules present — skipping install."
else
  echo "[session-start] npm install (public npm; bun.lock targets Lovable's private registry)…"
  if ! npm install --no-package-lock --no-audit --no-fund; then
    echo "[session-start] npm install FAILED — verify the environment's Network access allows registry.npmjs.org (the default 'Trusted' level does). https://code.claude.com/docs/en/claude-code-on-the-web" >&2
    exit 1
  fi
fi

# Browser-backed tests (snapshot / render-canary). Best-effort: if the browser
# CDN / apt isn't reachable those tests self-skip, and the pure unit tests only
# need node_modules. Root + apt are available here, so --with-deps installs the
# system libraries Chromium needs to actually launch.
echo "[session-start] playwright chromium + system deps (best-effort)…"
npx --yes playwright install --with-deps chromium \
  || echo "[session-start] playwright install skipped — browser-backed tests will self-skip"

echo "[session-start] done — \`bun run test\` / \`bun run typecheck\` / \`bun run lint\` are ready."
