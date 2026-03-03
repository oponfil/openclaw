#!/bin/sh
# Ensure PORT is set for Railway/cloud health checks; default 8080.
export PORT="${PORT:-8080}"
echo "OpenClaw: starting gateway on port $PORT"
# Use full path so this works when gosu does not pass PATH (e.g. Railway).
exec /usr/local/bin/node /app/openclaw.mjs gateway --allow-unconfigured --bind lan --port "$PORT"
