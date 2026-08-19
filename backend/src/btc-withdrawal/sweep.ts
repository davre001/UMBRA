import * as bitcoin from "bitcoinjs-lib";
import { getCustodianAddress, getKeyPairForSigning, SIGNET_NETWORK } from "./wallet";
import { getReserveAddress } from "./reserve";
import { fetchUtxos, fetchFeeRateSatsPerVbyte, broadcastTx } from "./mempool";
import { logger } from "../shared/logger";

/**
 * Moves the hot wallet's ENTIRE confirmed balance into the 2-of-3 reserve
 * (see reserve.ts) on every poll — not a partial/threshold sweep. The
 * whole point is bounding `BTC_CUSTODIAN_WIF`'s real exposure to "whatever
 * has confirmed since the last sweep," so leaving any deliberate balance
 * behind in the hot wallet would just reopen the gap this closes. A single
 * spend, all confirmed UTXOs as inputs, one output (the reserve address),
 * no change — there's nothing to keep, everything moves.
 *
 * Same "leave it for the next poll, don't hard-fail" philosophy
 * `btc-deposit-worker`/`watcher.ts` already use: a transient fetch/relay
 * failure just means this cycle's sweep didn't happen, tried again next
 * `BTC_SWEEP_POLL_INTERVAL_MS`.
 */

// Same rough per-item vbyte estimates bitcoin-tx.ts's own selectUtxos uses
// for its P2WPKH inputs; the destination here is P2WSH, not P2WPKH — a
// bech32 P2WSH output has no segwit discount to apply (only witness DATA
// is discounted, and an output has none), so its real size is exactly
// 8 (value) + 1 (script length) + 34 (0x0020 + 32-byte hash) = 43 bytes.
const BASE_VBYTES = 10.5;
const INPUT_VBYTES = 68;
const P2WSH_OUTPUT_VBYTES = 43;

function estimateVsize(inputCount: number): number {
  return Math.ceil(BASE_VBYTES + inputCount * INPUT_VBYTES + P2WSH_OUTPUT_VBYTES);
}

export class NothingToSweepError extends Error {}

/** Builds, signs, and broadcasts one sweep transaction. Throws NothingToSweepError (not a failure — see pollOnce) if there's nothing confirmed worth moving right now. */
export async function sweepOnce(): Promise<{ txid: string; sweptSats: bigint; feeSats: bigint }> {
  const custodianAddress = getCustodianAddress();
  const reserveAddress = getReserveAddress();

  const utxos = await fetchUtxos(custodianAddress);
  const confirmed = utxos.filter((u) => u.status.confirmed);
  if (confirmed.length === 0) throw new NothingToSweepError("no confirmed hot-wallet UTXOs to sweep");

  const totalIn = confirmed.reduce((sum, u) => sum + BigInt(u.value), BigInt(0));
  const feeRate = await fetchFeeRateSatsPerVbyte();
  const fee = BigInt(Math.ceil(estimateVsize(confirmed.length) * feeRate));

  // 546 sats is the standard P2WPKH dust threshold — reused here as the
  // simplest "not worth it yet" floor for a P2WSH output too (P2WSH's real
  // dust threshold is slightly higher given its larger output size, so
  // this is deliberately a bit conservative, never accidentally under).
  if (totalIn <= fee + BigInt(546)) {
    throw new NothingToSweepError(`confirmed balance (${totalIn} sats) doesn't clear the fee (~${fee} sats) + dust — waiting for more to accumulate`);
  }
  const sweptSats = totalIn - fee;

  const custodianScript = bitcoin.payments.p2wpkh({ address: custodianAddress, network: SIGNET_NETWORK }).output!;
  const psbt = new bitcoin.Psbt({ network: SIGNET_NETWORK });
  for (const utxo of confirmed) {
    psbt.addInput({ hash: utxo.txid, index: utxo.vout, witnessUtxo: { script: custodianScript, value: BigInt(utxo.value) } });
  }
  psbt.addOutput({ address: reserveAddress, value: sweptSats });

  const keyPair = getKeyPairForSigning();
  for (let i = 0; i < confirmed.length; i++) psbt.signInput(i, keyPair);
  psbt.finalizeAllInputs();

  const tx = psbt.extractTransaction();
  const rawHex = tx.toHex();
  const localTxid = tx.getId();

  logger.info(`[btc-sweep] sweeping ${sweptSats} sats (${confirmed.length} UTXO(s), fee ${fee}) from ${custodianAddress} -> ${reserveAddress}`);
  const broadcastTxid = await broadcastTx(rawHex);
  if (broadcastTxid !== localTxid) {
    logger.warn(`[btc-sweep] locally-computed txid ${localTxid} != broadcast-returned ${broadcastTxid}, trusting the broadcast response`);
  }
  logger.info(`[btc-sweep] swept: ${broadcastTxid}`);
  return { txid: broadcastTxid, sweptSats, feeSats: fee };
}

/** One poll pass — a no-op (not an error) when there's nothing worth sweeping yet. */
export async function pollOnce(): Promise<{ swept: boolean; txid?: string; sweptSats?: string }> {
  try {
    const { txid, sweptSats } = await sweepOnce();
    return { swept: true, txid, sweptSats: sweptSats.toString() };
  } catch (err) {
    if (err instanceof NothingToSweepError) {
      logger.debug(`[btc-sweep] ${err.message}`);
      return { swept: false };
    }
    logger.error(`[btc-sweep] sweep failed, will retry next poll: ${err instanceof Error ? err.message : err}`);
    return { swept: false };
  }
}
