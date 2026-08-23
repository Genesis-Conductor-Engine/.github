# x402-paid-service Deployment Status

## Overview
This document tracks the deployment status of x402-paid-service and the Alchemy autopay workflow.

## ✅ Completed Tasks

### 1. x402-paid-service Deployment
- **Status**: DEPLOYED
- **URL**: https://x402-paid-service.iholt.workers.dev
- **Version**: ae789fcf-4f06-4185-976d-ec83ff2f8ad8
- **Health**: `/health` endpoint returns OK
- **Facilitator Mode**: `cdp` (configured in wrangler.toml)
- **Tiered Pricing**: 6 tiers configured with both USDC and ETH pricing

#### Secrets Configured
- ✅ ALCHEMY_API_KEY: `pUP5ac6_MrxLEGwWQ3Lj5`
- ✅ ALCHEMY_BASE_RPC_URL: `https://base-mainnet.alchemy.com/v2/pUP5ac6_MrxLEGwWQ3Lj5`
- ✅ BASE_RPC_URL: `https://mainnet.base.org`
- ⚠️ CDP_API_KEY_ID: placeholder value (needs actual Coinbase CDP key)
- ⚠️ CDP_API_KEY_SECRET: placeholder value (needs actual Coinbase CDP Ed25519 private key)

**Note**: The CDP keys are currently using placeholder values. The worker attempts to use CDP mode but fails with "Invalid Ed25519 key length: 14 (expected 64)". To fix this, proper Coinbase CDP API keys must be obtained and set via:
```bash
cd x402-paid-service
echo "<actual_key_id>" | npx wrangler secret put CDP_API_KEY_ID --name x402-paid-service
echo "<actual_key_secret>" | npx wrangler secret put CDP_API_KEY_SECRET --name x402-paid-service
```

The CDP_API_KEY_SECRET should be a base64-encoded Ed25519 private key (64 bytes).

### 2. Autopay Workflow Files Created

#### Local Files (gc-workers repo)
- ✅ `.vibe/hooks/alchemy-autopay.hook` - Vibe hook for auto-triggering
- ✅ `scripts/alchemy-autopay.sh` - Main workflow script
- ✅ `scripts/alchemy-autopay-cron.sh` - Cron wrapper
- ✅ `.grok/workflows/x402-alchemy-autopay.rhai` - Rhai workflow definition
- ✅ `docs/X402_ALCHEMY_AUTOPAY_README.md` - Complete documentation

#### DiamondNode Files
- ✅ `~/x402-integration/autopay/alchemy-autopay.sh` - Deployed
- ✅ `~/x402-integration/autopay/alchemy-autopay-cron.sh` - Deployed
- ✅ `~/x402-integration/autopay/.env` - Environment configuration
- ✅ `~/.vault/bin/load-project-env.sh` - Updated with VAULT_PK support

### 3. DiamondNode Configuration

#### Cron Entry
- ✅ Added hourly cron: `0 * * * * bash /home/diamondnode/x402-integration/autopay/alchemy-autopay-cron.sh >> /home/diamondnode/logs/alchemy-autopay-cron.log 2>&1`
- **Log File**: `/home/diamondnode/logs/alchemy-autopay-cron.log`

#### Environment
- ✅ `.env` file created with:
  - ALCHEMY_API_KEY
  - BASE_RPC_URL
  - X402_WORKER_URL
  - VAULT_ADDRESS
  - VAULT_PRIVATE_KEY_KEYCHAIN
  - MIN_PAYMENT_USD
  - PAYMENT_THRESHOLD_USD

### 4. Vibe Hook
- ✅ Created at `.vibe/hooks/alchemy-autopay.hook`
- Triggers on commands containing: alchemy, x402, deploy, wrangler, pay, settle, refuel, fund, trade, swap
- Triggers on file changes in: x402-paid-service/, scripts/alchemy*, .grok/workflows/, alchemy-autopay
- Executes workflow with dry-run first, then actual payment

## ⚠️ Blockers & Pending Tasks

### High Priority

1. **CDP API Keys**
   - The CDP_API_KEY_ID and CDP_API_KEY_SECRET need to be replaced with actual Coinbase CDP keys
   - Current placeholders cause facilitator to fail: "Invalid Ed25519 key length: 14 (expected 64)"
   - To obtain: Visit https://portal.cdp.coinbase.com/ and create x402 API keys
   - Expected format: CDP_API_KEY_ID = UUID string, CDP_API_KEY_SECRET = base64-encoded Ed25519 private key

2. **VAULT Wallet Funding**
   - VAULT_ADDRESS: `0x60C4499870f115664d7FfD8411b023DBEf3377d9`
   - Needs USDC on Base network (chain ID 8453)
   - Required for x402 settlements and autopay workflow
   - Recommended: Fund with at least $100 USDC
   - **Note**: This address was previously the MAIN wallet and was flagged as compromised in LAUNCH_PLAN.md. However, it's now being used as VAULT in the rotated configuration.

3. **VAULT Private Key in Keychain**
   - The autopay script expects the VAULT private key at: `vault:x402-worker:VAULT_PRIVATE_KEY`
   - This needs to be added to macOS Keychain on diamondnode
   - Command: `security add-generic-password -a diamondnode -s "vault:x402-worker:VAULT_PRIVATE_KEY" -w "<private_key_hex>"`
   - **WARNING**: The private key for 0x60C4499870f115664d7FfD8411b023DBEf3377d9 is compromised according to LAUNCH_PLAN.md. A new VAULT wallet should be created and the address updated.

## 📋 Recommended Next Steps

### Immediate (to make x402-paid-service functional)
1. Generate new CDP API keys from Coinbase
2. Set them via wrangler secret put
3. Redeploy worker (or wait for automatic update)
4. Verify facilitator mode works: `curl https://x402-paid-service.iholt.workers.dev/health/facilitator`

### For Autopay Loop
1. Create new VAULT wallet (do NOT use compromised 0x60C4... address)
2. Update VAULT_ADDRESS in wrangler.toml
3. Fund new VAULT with USDC on Base
4. Add VAULT private key to Keychain on diamondnode
5. Test autopay workflow: `bash ~/x402-integration/autopay/alchemy-autopay.sh --dry-run`

### For Production Readiness
1. Rotate ALL compromised keys (MAIN, CDP, VAULT)
2. Update all references in code and configuration
3. Audit all key storage locations
4. Verify all secrets are properly scoped

## 🔗 Useful Commands

### Check Worker Health
```bash
curl https://x402-paid-service.iholt.workers.dev/health | jq
curl https://x402-paid-service.iholt.workers.dev/health/facilitator | jq
```

### Set CDP Secrets
```bash
cd x402-paid-service
echo "<key_id>" | npx wrangler secret put CDP_API_KEY_ID --name x402-paid-service
echo "<key_secret>" | npx wrangler secret put CDP_API_KEY_SECRET --name x402-paid-service
```

### Redeploy Worker
```bash
cd x402-paid-service
npx wrangler deploy
```

### Test Autopay Workflow
```bash
# On diamondnode
bash ~/x402-integration/autopay/alchemy-autopay.sh --dry-run
```

### View Cron Logs
```bash
# On diamondnode
tail -f ~/logs/alchemy-autopay-cron.log
```

## 📊 Current State Summary

| Component | Status | Notes |
|-----------|--------|-------|
| x402-paid-service | ✅ Deployed | Health OK, facilitator needs CDP keys |
| CDP_API_KEY_ID | ⚠️ Placeholder | Needs actual value |
| CDP_API_KEY_SECRET | ⚠️ Placeholder | Needs actual Ed25519 key |
| ALCHEMY_API_KEY | ✅ Set | Working |
| BASE_RPC_URL | ✅ Set | Working |
| VAULT wallet | ⚠️ Needs funding | 0x60C4...77d9 on Base |
| Autopay scripts | ✅ Deployed | On diamondnode |
| Cron entry | ✅ Configured | Hourly at :00 |
| Vibe hook | ✅ Created | Auto-triggers on relevant commands |
| Keychain entry | ❌ Missing | Needs VAULT private key |

## 🎯 Key Files and Locations

- **Worker**: https://x402-paid-service.iholt.workers.dev
- **Autopay scripts**: diamondnode:~/x402-integration/autopay/
- **Vibe hook**: gc-workers/.vibe/hooks/alchemy-autopay.hook
- **Rhai workflow**: gc-workers/.grok/workflows/x402-alchemy-autopay.rhai
- **Documentation**: gc-workers/docs/X402_ALCHEMY_AUTOPAY_README.md
