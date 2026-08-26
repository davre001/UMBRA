/**
 * Fetches real Bitcoin signet header data from mempool.space (or a
 * configured mirror) — the same two endpoints
 * `contract/scripts/initialize-btc-checkpoint.ts` and
 * `backend/src/btc-deposit/mempool.ts` already use
 * (`/block-height/{h}` for a hash, `/block/{hash}/header` for the raw
 * 80-byte header), reimplemented locally rather than imported from either
 * (same self-contained-package reasoning as poseidon2.ts's own comment).
 */

export const HEADER_SIZE = 80;
export const K = 6;

const SIGNET_API_BASES = process.env.MEMPOOL_SIGNET_API_BASE
  ? [process.env.MEMPOOL_SIGNET_API_BASE]
  : ["https://mempool.space/signet/api", "https://blockstream.info/signet/api"];

async function signetGet(path: string): Promise<string> {
  let lastErr: unknown;
  for (const base of SIGNET_API_BASES) {
    try {
      const res = await fetch(`${base}${path}`);
      if (!res.ok) throw new Error(`${base}${path} -> HTTP ${res.status}`);
      return (await res.text()).trim();
    } catch (err) {
      lastErr = err;
      console.warn(`  ${base}${path} failed (${(err as Error).message}), trying next source...`);
    }
  }
  throw new Error(`All signet data sources failed for ${path}: ${(lastErr as Error)?.message}`);
}

function reverseHex(hex: string): string {
  return Buffer.from(hex, "hex").reverse().toString("hex");
}

export async function currentSignetTipHeight(): Promise<number> {
  return Number(await signetGet("/blocks/tip/height"));
}

/**
 * Returns the checkpoint height's own header hash (native byte order — see
 * bitcoin_headers.nr's own comment on why this matters) and the K real
 * headers immediately following it, ready to feed `checkpoint_relay`'s
 * `main()` as (`old_checkpoint_hash`, `headers`).
 */
export async function fetchExtensionHeaders(
  checkpointHeight: number
): Promise<{ checkpointHashHex: string; headersHex: string[] }> {
  const checkpointDisplayHash = await signetGet(`/block-height/${checkpointHeight}`);
  const checkpointHashHex = reverseHex(checkpointDisplayHash);

  const headersHex: string[] = [];
  for (let h = checkpointHeight + 1; h <= checkpointHeight + K; h++) {
    const hash = await signetGet(`/block-height/${h}`);
    const headerHex = await signetGet(`/block/${hash}/header`);
    if (Buffer.from(headerHex, "hex").length !== HEADER_SIZE) {
      throw new Error(`header at height ${h} was not ${HEADER_SIZE} bytes`);
    }
    headersHex.push(headerHex);
  }
  return { checkpointHashHex, headersHex };
}
