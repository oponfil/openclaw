#!/usr/bin/env bash
# Prints BlockRun/ClawRouter wallet address(es) and balance for USDC top-up.
# Usage: get_blockrun_deposit_address.sh
# Reads OPENCLAW_STATE_DIR or ~/.openclaw, then blockrun/ and/or runs clawrouter doctor.

set -euo pipefail

# Resolve state dir (same logic as OpenClaw: OPENCLAW_STATE_DIR or ~/.openclaw)
HOME="${HOME:-}"
if [[ -z "$HOME" && -n "${USERPROFILE:-}" ]]; then
  HOME="$USERPROFILE"
fi
STATE_DIR="${OPENCLAW_STATE_DIR:-${HOME}/.openclaw}"
BLOCKRUN_DIR="${STATE_DIR}/blockrun"

# 1) Look for full EVM address in blockrun dir (plugin may write address next to wallet.key)
if [[ -d "$BLOCKRUN_DIR" ]]; then
  for f in "$BLOCKRUN_DIR"/*; do
    [[ -f "$f" ]] || continue
    # Match 0x + 40 hex (full Ethereum/Base address)
    if grep -qE '0x[0-9a-fA-F]{40}' "$f" 2>/dev/null; then
      addr=$(grep -oE '0x[0-9a-fA-F]{40}' "$f" | head -1)
      if [[ -n "$addr" ]]; then
        echo "EVM (Base): $addr"
      fi
    fi
  done
fi

# 2) Run clawrouter doctor and parse Wallet section (Address, Balance)
# Doctor prints wallet info then may prompt to send to Claude; we capture first lines only.
if command -v npx >/dev/null 2>&1; then
  out=$(timeout 25 npx --yes @blockrun/clawrouter doctor 2>&1 | head -80 || true)
  if [[ -n "$out" ]]; then
    # Parse "Address: 0x..." (full or truncated)
    if echo "$out" | grep -qE 'Address:\s*0x'; then
      addr_line=$(echo "$out" | grep -E 'Address:\s*0x' | head -1 | sed 's/^[[:space:]]*//')
      echo "Wallet: $addr_line"
    fi
    # Parse "Balance: $..."
    if echo "$out" | grep -qE 'Balance:\s*\$'; then
      bal_line=$(echo "$out" | grep -E 'Balance:\s*\$' | head -1 | sed 's/^[[:space:]]*//')
      echo "Balance: $bal_line"
    fi
  fi
fi

# If we printed nothing, the agent will tell the user to run /wallet or doctor manually
exit 0
