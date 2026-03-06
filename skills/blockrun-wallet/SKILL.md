---
name: blockrun-wallet
description: Show the real BlockRun/ClawRouter wallet address and balance for USDC top-up. Use when the user asks for wallet address for top-up, deposit address, where to send USDC, how to fund BlockRun/ClawRouter, or to check wallet balance.
metadata:
  {
    "openclaw":
      {
        "emoji": "💰",
        "requires": { "plugins": ["@blockrun/clawrouter"] }
      }
  }
---

# BlockRun wallet address for top-up

## When to use

Trigger when the user asks for:
- Wallet address for top-up or deposit
- Where to send USDC for OpenClaw/BlockRun/ClawRouter
- "Address for funding" / "Where to send USDC"
- Wallet balance (e.g. "what's my balance", "check balance")

## What to do

1. Run the script to get the real address and balance (do **not** invent or guess addresses). The script lives in the **same directory as this SKILL.md**, under `scripts/`. If you read this file from path `.../blockrun-wallet/SKILL.md`, run `.../blockrun-wallet/scripts/get_blockrun_deposit_address.sh` (replace the path prefix with the actual directory; e.g. `/app/skills/blockrun-wallet/scripts/get_blockrun_deposit_address.sh` when the skill is at `/app/skills/blockrun-wallet/SKILL.md`).

```bash
<skill_dir>/scripts/get_blockrun_deposit_address.sh
```

Where `<skill_dir>` is the directory containing this SKILL.md (strip `/SKILL.md` from the path you used to read this file).

2. If the script prints an address: reply with that address and short instructions.
3. If the script fails or reports "not found": tell the user to run `/wallet` in the same chat (Telegram/Discord) where the bot is connected, or run `npx @blockrun/clawrouter doctor` locally to see the wallet section.

## Reply template

When you have the address, reply in the user's language. Include:

- **EVM (Base):** the `0x...` address — "Send USDC on **Base** to this address."
- **Solana:** if the script shows a Solana address — "Or send USDC on **Solana** to this address."
- **Balance** (if shown): current USDC balance.
- **Note:** "One wallet, pay-per-request. No API keys. Fund with $5+ USDC (enough for thousands of requests)."

Never send the user to third-party or invented wallet addresses. Only use the address returned by the script or from `/wallet` / `clawrouter doctor`.

If the script shows a truncated address (e.g. `0x1234...abcd`), tell the user to run **`/wallet`** in the same chat to see the full address, or run `npx @blockrun/clawrouter doctor` locally.
