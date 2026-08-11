const MEMPOOL_BASE = process.env.MEMPOOL_SIGNET_API_BASE ?? "https://mempool.space/signet/api";

export interface Utxo {
  txid: string;
  vout: number;
  value: number; // satoshis
  status: { confirmed: boolean };
}

/** The custodian address's own spendable UTXOs — same public, free mempool.space API the deposit side already uses (see ../btc-deposit/mempool.ts). */
export async function fetchUtxos(address: string): Promise<Utxo[]> {
  const res = await fetch(`${MEMPOOL_BASE}/address/${address}/utxo`);
  if (!res.ok) throw new Error(`mempool.space UTXO fetch for ${address} failed: HTTP ${res.status}`);
  return res.json();
}

/** The custodian address's real current balance (confirmed UTXOs only) — the ground truth the solvency check compares against. */
export async function fetchConfirmedBalanceSats(address: string): Promise<bigint> {
  const utxos = await fetchUtxos(address);
  return utxos.filter((u) => u.status.confirmed).reduce((sum, u) => sum + BigInt(u.value), BigInt(0));
}

/** Recommended fee rate (sat/vByte) — signet has no real fee market, but this still needs *some* rate for a transaction to relay/confirm. Falls back to a conservative flat rate if the endpoint is unavailable. */
export async function fetchFeeRateSatsPerVbyte(): Promise<number> {
  try {
    const res = await fetch(`${MEMPOOL_BASE}/v1/fees/recommended`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { halfHourFee?: number };
    return body.halfHourFee && body.halfHourFee > 0 ? body.halfHourFee : 2;
  } catch {
    return 2; // sat/vB — a conservative flat fallback, fine on a low-traffic testnet
  }
}

/** Broadcasts a raw signed transaction — same free, no-node-required endpoint the withdrawal design doc's own research confirmed earlier. */
export async function broadcastTx(rawHex: string): Promise<string> {
  const res = await fetch(`${MEMPOOL_BASE}/tx`, { method: "POST", body: rawHex });
  const text = await res.text();
  if (!res.ok) throw new Error(`mempool.space broadcast failed: HTTP ${res.status} ${text}`);
  return text.trim(); // mempool.space returns the raw txid as the response body
}
