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

# So cloud health checks (e.g. Railway) reach the app. gosu does not pass env to the
# child; we must pass PORT explicitly or the gateway would listen on 8080 while the
# platform probes a different port and health check fails.
export PORT="${PORT:-8080}"

if [ "$RUN_AS_ROOT" = "1" ]; then
  if [ -n "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
    exec env PORT="$PORT" PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH" gosu node "$@"
  else
    exec env PORT="$PORT" gosu node "$@"
  fi
else
  exec "$@"
fi
