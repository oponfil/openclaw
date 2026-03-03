#!/usr/bin/env bash
# When container runs as root, installs Chromium and Xvfb into the node user's
# cache (if not already present), then runs CMD as node. Otherwise exec CMD as-is.
set -euo pipefail

RUN_AS_ROOT=0
if [ "$(id -u)" = "0" ]; then
  RUN_AS_ROOT=1
fi

if [ "$RUN_AS_ROOT" = "1" ]; then
  CACHE_DIR="${PLAYWRIGHT_BROWSERS_PATH:-/home/node/.cache/ms-playwright}"
  chromium_installed=false
  for d in "$CACHE_DIR"/chromium-*; do
    if [ -d "$d" ]; then
      chromium_installed=true
      break
    fi
  done
  if [ "$chromium_installed" = false ]; then
    echo "OpenClaw: installing Chromium and Xvfb..."
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends xvfb
    mkdir -p "$CACHE_DIR"
    PLAYWRIGHT_BROWSERS_PATH="$CACHE_DIR" node /app/node_modules/playwright-core/cli.js install --with-deps chromium
    chown -R node:node "$CACHE_DIR"
    apt-get clean
    rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*
    echo "OpenClaw: Chromium installed."
  fi
  export PLAYWRIGHT_BROWSERS_PATH="$CACHE_DIR"
fi

# So cloud health checks (e.g. Railway) reach the app; gosu may not pass all env.
export PORT="${PORT:-8080}"

if [ "$RUN_AS_ROOT" = "1" ]; then
  exec gosu node "$@"
else
  exec "$@"
fi
