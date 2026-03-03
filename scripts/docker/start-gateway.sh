#!/bin/sh
# Ensure PORT is set for Railway/cloud health checks; default 8080.
export PORT="${PORT:-8080}"
echo "OpenClaw: starting gateway on port $PORT"
exec node /app/openclaw.mjs gateway --allow-unconfigured --bind lan --port "$PORT"
