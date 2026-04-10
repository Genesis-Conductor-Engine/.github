/**
 * Genesis Conductor — Shared Gas Oracle
 * Fetches live gas prices from Etherscan gasoracle endpoint.
 * Falls back to ethers provider.getFeeData() on failure.
 * Logs every fetch to D1 audit_log (when binding is provided).
 *
 * @module lib/gas-oracle
 */

const ETHERSCAN_ENDPOINT = 'https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=';
const CACHE_TTL_MS = 30_000; // 30-second TTL — keeps calls well under 100K/day at Base rate (18K/day max)
const FETCH_TIMEOUT_MS = 5_000;

/**
 * @typedef {{ fastGasPrice: number, proposeGasPrice: number, safeGasPrice: number }} GasPriceResult
 * @typedef {{ prepare(sql: string): { bind(...args: unknown[]): { run(): Promise<unknown> } } }} D1Binding
 */

/** @type {{ data: GasPriceResult, expiresAt: number } | null} */
let _cache = null;

/**
 * Fetch current gas prices from Etherscan gasoracle, with fallback to provider.getFeeData().
 * Logs every fetch (success and failure) to D1 audit_log when a binding is provided.
 *
 * @param {string} etherscanApiKey
 * @param {D1Binding | null | undefined} d1Database  — CF D1 binding, or null/undefined in Node.js contexts
 * @param {{ getFeeData(): Promise<{ gasPrice?: bigint|null, maxFeePerGas?: bigint|null, maxPriorityFeePerGas?: bigint|null }> } | null} [provider]  — ethers provider for fallback
 * @returns {Promise<GasPriceResult>}
 */
export async function getGasPrice(etherscanApiKey, d1Database, provider = null) {
  // Return cached value if still fresh
  if (_cache && Date.now() < _cache.expiresAt) {
    return _cache.data;
  }

  let resultRaw = null;

  try {
    const resp = await fetch(
      ETHERSCAN_ENDPOINT + encodeURIComponent(etherscanApiKey),
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const json = await resp.json();
    resultRaw = JSON.stringify(json);

    if (json.status !== '1') throw new Error(`Etherscan API error: ${json.message}`);

    const fastGasPrice    = Number(json.result.FastGasPrice);
    const proposeGasPrice = Number(json.result.ProposeGasPrice);
    const safeGasPrice    = Number(json.result.SafeGasPrice);

    if (!fastGasPrice || fastGasPrice <= 0) throw new Error('Invalid FastGasPrice from Etherscan');

    await _insertAuditLog(d1Database, 'etherscan', fastGasPrice, resultRaw, 'ok');

    const result = { fastGasPrice, proposeGasPrice, safeGasPrice };
    _cache = { data: result, expiresAt: Date.now() + CACHE_TTL_MS };
    return result;

  } catch (err) {
    // Log the Etherscan failure before attempting fallback
    await _insertAuditLog(
      d1Database,
      'etherscan',
      null,
      resultRaw ?? JSON.stringify({ error: err.message }),
      'error',
    );

    if (!provider) throw err;

    // Fallback: provider.getFeeData()
    let fallbackRaw = null;
    try {
      const feeData = await provider.getFeeData();
      const fallbackWei  = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
      const fallbackGwei = Number(fallbackWei) / 1e9;

      fallbackRaw = JSON.stringify({
        gasPrice:     fallbackWei.toString(),
        maxFeePerGas: feeData.maxFeePerGas?.toString() ?? null,
      });

      await _insertAuditLog(d1Database, 'provider_fallback', fallbackGwei, fallbackRaw, 'ok');

      const result = { fastGasPrice: fallbackGwei, proposeGasPrice: fallbackGwei, safeGasPrice: fallbackGwei };
      _cache = { data: result, expiresAt: Date.now() + CACHE_TTL_MS };
      return result;

    } catch (fallbackErr) {
      await _insertAuditLog(
        d1Database,
        'provider_fallback',
        null,
        JSON.stringify({ error: fallbackErr.message }),
        'error',
      );
      throw fallbackErr;
    }
  }
}

/**
 * @param {D1Binding | null | undefined} db
 * @param {string} source
 * @param {number | null} gasPriceGwei
 * @param {string} resultRaw
 * @param {'ok' | 'error'} status
 */
async function _insertAuditLog(db, source, gasPriceGwei, resultRaw, status) {
  if (!db) return;
  try {
    await db
      .prepare(
        `INSERT INTO audit_log (event_type, source, endpoint, gas_price_gwei, result_raw, status)
         VALUES ('gas_oracle', ?, 'gasoracle', ?, ?, ?)`,
      )
      .bind(source, gasPriceGwei, resultRaw, status)
      .run();
  } catch (dbErr) {
    // Don't let audit logging failures disrupt the pipeline
    console.error('[gas-oracle] D1 audit_log insert failed:', dbErr.message);
  }
}
