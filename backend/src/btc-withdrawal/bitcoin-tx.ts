import * as bitcoin from "bitcoinjs-lib";
import { SIGNET_NETWORK } from "./wallet";
import { getReserveInfo, RESERVE_THRESHOLD } from "./reserve";
import { fetchFeeRateSatsPerVbyte, fetchUtxos, type Utxo } from "./mempool";

// Rough, standard vsize estimates — recomputed per candidate selection
// below, not a single constant, since the real fee depends on how many
// inputs end up selected. Adequate for fee *estimation* on a low-value
// signet payout, not byte-exact accounting.
const BASE_VBYTES = 10.5;
// A 2-of-3 P2WSH input's real weight: ~41 non-witness vbytes (36-byte
// outpoint + empty scriptSig + 4-byte sequence — P2WSH has no scriptSig,
// unlike legacy P2SH) plus witness data (OP_0 multisig-bug dummy + 2
// signatures ~72 bytes each + the 105-byte redeem script itself),
// discounted 4x for being witness data (~253 bytes / 4 ≈ 63 vbytes).
// Rounded up for headroom, not shaved tight.
const RESERVE_INPUT_VBYTES = 110;
const P2WPKH_OUTPUT_VBYTES = 31;
const P2WSH_OUTPUT_VBYTES = 43;

function estimateVsize(inputCount: number, outputVbytes: number[]): number {
  return Math.ceil(BASE_VBYTES + inputCount * RESERVE_INPUT_VBYTES + outputVbytes.reduce((a, b) => a + b, 0));
}

export class InsufficientFundsError extends Error {}

/**
 * Selects reserve UTXOs (largest-first — simplest correct strategy, not
 * fee-optimized) covering `amountSats` plus the fee for the resulting
 * transaction, computed iteratively since the fee itself depends on how
 * many inputs end up selected. Two outputs (payment + reserve change) are
 * always assumed for the estimate; `buildWithdrawalPsbt` below drops the
 * change output if it would be dust, which only ever makes the real fee
 * lower than this estimate, never higher.
 */
function selectUtxos(utxos: Utxo[], amountSats: bigint, feeRate: number): { selected: Utxo[]; fee: bigint } {
  const confirmed = utxos.filter((u) => u.status.confirmed).sort((a, b) => b.value - a.value);
  const selected: Utxo[] = [];
  let total = BigInt(0);
  for (const utxo of confirmed) {
    selected.push(utxo);
    total += BigInt(utxo.value);
    const fee = BigInt(Math.ceil(estimateVsize(selected.length, [P2WPKH_OUTPUT_VBYTES, P2WSH_OUTPUT_VBYTES]) * feeRate));
    if (total >= amountSats + fee) return { selected, fee };
  }
  throw new InsufficientFundsError(
    `Reserve has ${total} confirmed sats across ${confirmed.length} UTXO(s), needs ~${amountSats} + fee`
  );
}

/**
 * Builds an UNSIGNED PSBT paying `amountSats` to the P2WPKH address
 * derived from `destinationHash160`, spending the 2-of-3 reserve's own
 * UTXOs (see reserve.ts), with change (if not dust) back to the reserve.
 * Returns the PSBT base64-encoded, ready for scripts/sign-btc-withdrawal.ts's
 * signers to add their signatures to — this backend holds no reserve
 * private key, so it can build the spending request but can never
 * complete it alone.
 */
export async function buildWithdrawalPsbt(
  destinationHash160: string,
  amountSats: bigint
): Promise<{ psbt: string; feeSats: bigint }> {
  const reserve = getReserveInfo();
  const utxos = await fetchUtxos(reserve.address);
  const feeRate = await fetchFeeRateSatsPerVbyte();
  const { selected, fee } = selectUtxos(utxos, amountSats, feeRate);

  const destination = bitcoin.payments.p2wpkh({
    hash: Buffer.from(destinationHash160, "hex"),
    network: SIGNET_NETWORK,
  });
  if (!destination.address) throw new Error(`Could not derive a signet address from hash160 ${destinationHash160}`);

  const totalIn = selected.reduce((sum, u) => sum + BigInt(u.value), BigInt(0));
  const changeSats = totalIn - amountSats - fee;

  const psbt = new bitcoin.Psbt({ network: SIGNET_NETWORK });
  for (const utxo of selected) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: { script: reserve.output, value: BigInt(utxo.value) },
      // Required for a P2WSH spend: signers need the actual redeem script
      // to know what they're signing over and to build the final witness
      // stack, since witnessUtxo alone only commits to the script *hash*.
      witnessScript: reserve.redeemOutput,
    });
  }
  psbt.addOutput({ address: destination.address, value: amountSats });
  // 546 sats is Bitcoin's standard dust threshold for a P2WPKH output —
  // reused here as a conservative floor for the P2WSH change output too
  // (P2WSH's own real dust threshold is slightly higher, so this never
  // creates an actually-dust change output, only occasionally folds a
  // marginal amount into the fee that a tighter threshold wouldn't have).
  if (changeSats > BigInt(546)) {
    psbt.addOutput({ address: reserve.address, value: changeSats });
  }

  return { psbt: psbt.toBase64(), feeSats: fee };
}

/** True once every input of `psbt` has at least RESERVE_THRESHOLD partial signatures — the point at which finalizing + broadcasting becomes possible. */
export function hasEnoughSignatures(psbt: bitcoin.Psbt): boolean {
  return psbt.data.inputs.every((input) => (input.partialSig?.length ?? 0) >= RESERVE_THRESHOLD);
}

/** Finalizes a fully-signed PSBT and extracts the final raw transaction hex + txid — does NOT broadcast (see mempool.ts's broadcastTx, called separately). */
export function finalizeWithdrawalPsbt(psbtBase64: string): { rawHex: string; txid: string } {
  const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network: SIGNET_NETWORK });
  if (!hasEnoughSignatures(psbt)) {
    throw new Error(`PSBT does not yet have >= ${RESERVE_THRESHOLD} signatures on every input`);
  }
  psbt.finalizeAllInputs();
  const tx = psbt.extractTransaction();
  return { rawHex: tx.toHex(), txid: tx.getId() };
}
