import {
  ALCHEMY_ROLLUP_NETWORKS,
  alchemyDataV1,
  alchemyHttps,
  alchemyNftV3,
  assertAlchemyKey,
} from './urls';

export interface AlchemyProbe {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface AlchemySurfaceReport {
  ok: boolean;
  key_configured: boolean;
  probes: AlchemyProbe[];
}

async function rpc(
  url: string,
  method: string,
  params: unknown[],
): Promise<{ result?: unknown; error?: { message?: string } }> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return (await resp.json()) as { result?: unknown; error?: { message?: string } };
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = await resp.json().catch(() => null);
  return { status: resp.status, body };
}

async function postJson(url: string, payload: unknown): Promise<{ status: number; body: unknown }> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await resp.json().catch(() => null);
  return { status: resp.status, body };
}

function probeOk(name: string, ok: boolean, detail?: string): AlchemyProbe {
  return { name, ok, ...(detail ? { detail } : {}) };
}

/** Live surface check. Never returns the API key or full RPC URLs. */
export async function probeAlchemySurfaces(
  key: string | undefined,
  owner: string,
): Promise<AlchemySurfaceReport> {
  if (!key?.trim()) {
    return {
      ok: false,
      key_configured: false,
      probes: [probeOk('key', false, 'ALCHEMY_API_KEY missing')],
    };
  }
  const k = assertAlchemyKey(key);
  const probes: AlchemyProbe[] = [];

  for (const network of ALCHEMY_ROLLUP_NETWORKS) {
    try {
      const json = await rpc(alchemyHttps(network, k), 'eth_blockNumber', []);
      probes.push(probeOk(`rollup_rpc:${network}`, Boolean(json.result), json.error?.message));
    } catch (e) {
      probes.push(probeOk(`rollup_rpc:${network}`, false, String(e)));
    }
  }

  try {
    const json = await rpc(alchemyHttps('base-mainnet', k), 'alchemy_getTokenBalances', [owner]);
    probes.push(probeOk('token_api', Boolean(json.result) && !json.error, json.error?.message));
  } catch (e) {
    probes.push(probeOk('token_api', false, String(e)));
  }

  try {
    const json = await rpc(alchemyHttps('base-mainnet', k), 'alchemy_getAssetTransfers', [{
      fromBlock: '0x0',
      toBlock: 'latest',
      toAddress: owner,
      category: ['erc20'],
      maxCount: '0x2',
    }]);
    probes.push(probeOk('transfers_api', Boolean(json.result) && !json.error, json.error?.message));
  } catch (e) {
    probes.push(probeOk('transfers_api', false, String(e)));
  }

  try {
    const { status, body } = await getJson(
      `${alchemyNftV3('eth-mainnet', k)}/getNFTsForOwner?owner=${owner}&pageSize=1`,
    );
    const rec = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    probes.push(probeOk('nft_api', status === 200 && !rec.error, typeof rec.error === 'string' ? rec.error : `http_${status}`));
  } catch (e) {
    probes.push(probeOk('nft_api', false, String(e)));
  }

  try {
    const { status, body } = await postJson(`${alchemyDataV1(k)}/assets/tokens/by-address`, {
      addresses: [{ address: owner, networks: ['eth-mainnet', 'base-mainnet', 'arb-mainnet'] }],
      withMetadata: false,
      withPrices: false,
    });
    const rec = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    probes.push(probeOk('portfolio_api', status === 200 && Boolean(rec.data), `http_${status}`));
  } catch (e) {
    probes.push(probeOk('portfolio_api', false, String(e)));
  }

  try {
    const json = await rpc(alchemyHttps('solana-mainnet', k), 'getHealth', []);
    const healthy = json.result === 'ok' || json.result === 'Ok';
    probes.push(probeOk('solana_rpc', healthy || Boolean(json.result) && !json.error, json.error?.message ?? String(json.result)));
  } catch (e) {
    probes.push(probeOk('solana_rpc', false, String(e)));
  }

  try {
    const json = await rpc(alchemyHttps('solana-mainnet', k), 'getSlot', []);
    probes.push(probeOk('solana_slot', typeof json.result === 'number' && !json.error, json.error?.message));
  } catch (e) {
    probes.push(probeOk('solana_slot', false, String(e)));
  }

  probes.push(probeOk(
    'swarm_wss',
    true,
    'wss://{eth,base,arb,solana}-mainnet.g.alchemy.com/v2/$ALCHEMY_API_KEY — subscribe logs, not newPendingTransactions',
  ));
  probes.push(probeOk(
    'webhooks',
    true,
    'Ingest is POST /webhooks/treasury. Notify create needs ALCHEMY_NOTIFY_AUTH_TOKEN (dashboard), not the RPC key.',
  ));
  probes.push(probeOk(
    'rollups_product',
    true,
    'Custom L2/L3 Alchemy Rollups is a sales/infra product. This worker uses ETH+Base+Arb public rollup RPCs.',
  ));

  return {
    ok: probes.filter((p) => !['swarm_wss', 'webhooks', 'rollups_product'].includes(p.name)).every((p) => p.ok),
    key_configured: true,
    probes,
  };
}
