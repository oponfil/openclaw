#!/bin/sh
# Ensure PORT is set for Railway/cloud health checks; default 8080.
export PORT="${PORT:-8080}"

# Ensure config exists on persistent storage (first boot with a fresh volume).
/usr/local/bin/node -e '
const fs = require("node:fs");
const path = require("node:path");
const stateDir = (process.env.OPENCLAW_STATE_DIR || "/app/.openclaw").trim();
const configPath = (process.env.OPENCLAW_CONFIG_PATH || `${stateDir}/openclaw.json`).trim();
const fallbackConfigCandidates = [
  "/app/.openclaw/openclaw.json",
  "/app/config/openclaw.railway.json",
];
const fallbackExtensionsDir = "/app/.openclaw/extensions";
const runtimeExtensionsDir = path.join(stateDir, "extensions");
try {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  if (!fs.existsSync(configPath)) {
    const fallbackConfigPath = fallbackConfigCandidates.find((p) => fs.existsSync(p));
    if (fallbackConfigPath) {
      fs.copyFileSync(fallbackConfigPath, configPath);
      console.log(`OpenClaw: bootstrapped config at ${configPath} from ${fallbackConfigPath}`);
    } else {
      fs.writeFileSync(configPath, "{}\n", "utf8");
      console.log(`OpenClaw: created empty config at ${configPath} (no fallback template found)`);
    }
  }

  if (!fs.existsSync(runtimeExtensionsDir) && fs.existsSync(fallbackExtensionsDir)) {
    fs.cpSync(fallbackExtensionsDir, runtimeExtensionsDir, { recursive: true });
    console.log(
      `OpenClaw: bootstrapped extensions at ${runtimeExtensionsDir} from ${fallbackExtensionsDir}`,
    );
  }
} catch (err) {
  console.warn(`OpenClaw: failed to bootstrap state (${String(err)}); continuing.`);
}
'

# Runtime config overlays for Railway deploy:
# - Ensure Control UI host-header fallback is enabled for non-loopback bind.
# - Optionally apply TELEGRAM_ALLOW_FROM to channels.telegram.allowFrom.
/usr/local/bin/node -e '
const fs = require("node:fs");
const stateDir = (process.env.OPENCLAW_STATE_DIR || "/app/.openclaw").trim();
const configPath = (process.env.OPENCLAW_CONFIG_PATH || `${stateDir}/openclaw.json`).trim();
const rawAllowFrom = (process.env.TELEGRAM_ALLOW_FROM || "").trim();
try {
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
  cfg.gateway = cfg.gateway || {};
  cfg.gateway.controlUi = cfg.gateway.controlUi || {};
  const allowedOrigins = Array.isArray(cfg.gateway.controlUi.allowedOrigins)
    ? cfg.gateway.controlUi.allowedOrigins
    : [];
  if (
    cfg.gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback !== true &&
    allowedOrigins.length === 0
  ) {
    cfg.gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback = true;
    console.log(
      "OpenClaw: enabled gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback for Railway runtime",
    );
  }

  cfg.channels = cfg.channels || {};
  cfg.channels.telegram = cfg.channels.telegram || {};
  if (rawAllowFrom) {
    if (/^\d+$/.test(rawAllowFrom)) {
      cfg.channels.telegram.allowFrom = [rawAllowFrom];
      console.log("OpenClaw: applied TELEGRAM_ALLOW_FROM to channels.telegram.allowFrom");
    } else {
      console.warn("OpenClaw: TELEGRAM_ALLOW_FROM is not numeric; skipping allowFrom injection.");
    }
  }

  fs.writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  console.log(`OpenClaw: runtime config overlays saved to ${configPath}`);
} catch (err) {
  console.warn(`OpenClaw: failed to apply runtime config overlays (${String(err)}); continuing.`);
}
'

echo "OpenClaw: starting gateway on port $PORT"
# Use full path so this works when gosu does not pass PATH (e.g. Railway).
exec /usr/local/bin/node /app/openclaw.mjs gateway --allow-unconfigured --bind lan --port "$PORT"
