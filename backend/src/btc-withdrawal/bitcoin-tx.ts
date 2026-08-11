import * as bitcoin from "bitcoinjs-lib";
import { getCustodianAddress, getKeyPairForSigning, SIGNET_NETWORK } from "./wallet";
import { fetchFeeRateSatsPerVbyte, fetchUtxos, type Utxo } from "./mempool";

// Rough, standard P2WPKH-only vsize estimate (input/output counts affect
// this — recomputed per candidate selection below, not a single constant).
// These per-item costs are the commonly-cited approximate SegWit P2WPKH
// weights (input ~68 vbytes incl. witness discount, output ~31 vbytes,
// ~10.5 vbytes of fixed overhead) — adequate for fee *estimation* on a
// low-value signet payout, not a byte-exact accounting.
const BASE_VBYTES = 10.5;
const INPUT_VBYTES = 68;
const OUTPUT_VBYTES = 31;

function estimateVsize(inputCount: number, outputCount: number): number {
  return Math.ceil(BASE_VBYTES + inputCount * INPUT_VBYTES + outputCount * OUTPUT_VBYTES);
}

export class InsufficientFundsError extends Error {}

/**
 * Selects UTXOs (largest-first — simplest correct strategy, not
 * fee-optimized) covering `amountSats` plus the fee for the resulting
 * transaction, computed iteratively since the fee itself depends on how
 * many inputs end up selected. Two outputs are always assumed (payment +
 * change) for the fee estimate; `buildAndSignWithdrawal` below drops the
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
    const fee = BigInt(Math.ceil(estimateVsize(selected.length, 2) * feeRate));
    if (total >= amountSats + fee) return { selected, fee };
  }
  throw new InsufficientFundsError(
    `Custodian has ${total} confirmed sats across ${confirmed.length} UTXO(s), needs ~${amountSats} + fee`
  );
}

/**
 * Builds and signs a real P2WPKH transaction paying `amountSats` to the
 * P2WPKH address derived from `destinationHash160`, from the custodian's
 * own UTXOs, with change (if not dust) back to the custodian. Returns the
 * raw signed hex and its txid — does NOT broadcast (see mempool.ts's
 * broadcastTx, called separately so a caller can log/record before
 * committing to the network call).
 */
export async function buildAndSignWithdrawal(
  destinationHash160: string,
  amountSats: bigint
): Promise<{ rawHex: string; txid: string; feeSats: bigint }> {
  const custodianAddress = getCustodianAddress();
  const utxos = await fetchUtxos(custodianAddress);
  const feeRate = await fetchFeeRateSatsPerVbyte();
  const { selected, fee } = selectUtxos(utxos, amountSats, feeRate);

  const destination = bitcoin.payments.p2wpkh({
    hash: Buffer.from(destinationHash160, "hex"),
    network: SIGNET_NETWORK,
  });
  if (!destination.address) throw new Error(`Could not derive a signet address from hash160 ${destinationHash160}`);

  const custodianScript = bitcoin.payments.p2wpkh({ address: custodianAddress, network: SIGNET_NETWORK }).output!;
  const totalIn = selected.reduce((sum, u) => sum + BigInt(u.value), BigInt(0));
  const changeSats = totalIn - amountSats - fee;

  const psbt = new bitcoin.Psbt({ network: SIGNET_NETWORK });
  for (const utxo of selected) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: { script: custodianScript, value: BigInt(utxo.value) },
    });
  }
  psbt.addOutput({ address: destination.address, value: amountSats });
  // 546 sats is Bitcoin's standard dust threshold for a P2WPKH output —
  // below that, the change isn't worth its own future spending cost and is
  // folded into the fee instead (a slightly higher real fee than estimated
  // above, never a shortfall).
  if (changeSats > BigInt(546)) {
    psbt.addOutput({ address: custodianAddress, value: changeSats });
  }

  const keyPair = getKeyPairForSigning();
  for (let i = 0; i < selected.length; i++) {
    psbt.signInput(i, keyPair);
  }
  psbt.finalizeAllInputs();

  const tx = psbt.extractTransaction();
  return { rawHex: tx.toHex(), txid: tx.getId(), feeSats: fee };
}
