// A single explicit override (MEMPOOL_SIGNET_API_BASE) means exactly that
// source, no fallback — otherwise try three real public signet indexers in
// turn. Same fallback chain as ../btc-deposit/mempool.ts's SIGNET_API_BASES
// — see that export's own comment for the three distinct real failure
// modes (Render can't reach mempool.space at all, blockstream.info
// rate-limited Render's IP for minutes at a time, mempool.emzy.de is a
// community mirror confirmed serving the same real signet chain). A single
// hardcoded base made every real withdrawal fulfillment (and the public
// solvency check) depend on whichever one happened to be up.
const SIGNET_API_BASES = process.env.MEMPOOL_SIGNET_API_BASE
  ? [process.env.MEMPOOL_SIGNET_API_BASE]
  : ["https://mempool.space/signet/api", "https://blockstream.info/signet/api", "https://mempool.emzy.de/signet/api"];

async function signetFetch(path: string, init?: RequestInit): Promise<Response> {
  let lastErr: unknown;
  for (const base of SIGNET_API_BASES) {
    try {
      const res = await fetch(`${base}${path}`, init);
      if (res.ok) return res;
      lastErr = new Error(`${base}${path} -> HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export interface Utxo {
  txid: string;
  vout: number;
  value: number; // satoshis
  status: { confirmed: boolean };
}

/** The custodian address's own spendable UTXOs — same public, free signet indexer API the deposit side already uses (see ../btc-deposit/mempool.ts). */
export async function fetchUtxos(address: string): Promise<Utxo[]> {
  const res = await signetFetch(`/address/${address}/utxo`);
  return res.json();
}

/** The custodian address's real current balance (confirmed UTXOs only) — the ground truth the solvency check compares against. */
export async function fetchConfirmedBalanceSats(address: string): Promise<bigint> {
  const utxos = await fetchUtxos(address);
  return utxos.filter((u) => u.status.confirmed).reduce((sum, u) => sum + BigInt(u.value), BigInt(0));
}

/** Recommended fee rate (sat/vByte) — signet has no real fee market, but this still needs *some* rate for a transaction to relay/confirm. Falls back to a conservative flat rate if every source is unavailable. */
export async function fetchFeeRateSatsPerVbyte(): Promise<number> {
  try {
    const res = await signetFetch("/v1/fees/recommended");
    const body = (await res.json()) as { halfHourFee?: number };
    return body.halfHourFee && body.halfHourFee > 0 ? body.halfHourFee : 2;
  } catch {
    return 2; // sat/vB — a conservative flat fallback, fine on a low-traffic testnet
  }
}

/** Broadcasts a raw signed transaction — same free, no-node-required endpoints the withdrawal design doc's own research confirmed earlier. Stops at the first source that accepts it (broadcasting the same valid tx to a second source too would be redundant, not harmful, but there's no need). */
export async function broadcastTx(rawHex: string): Promise<string> {
  const res = await signetFetch("/tx", { method: "POST", body: rawHex });
  return (await res.text()).trim(); // returns the raw txid as the response body
}
