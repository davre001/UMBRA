import * as bitcoin from "bitcoinjs-lib";
import { SIGNET_NETWORK } from "./wallet";

/**
 * The 2-of-3 Bitcoin multisig reserve — where withdrawal payouts actually
 * come from, NOT the hot `BTC_CUSTODIAN_WIF` address. This backend process
 * only ever loads the three signers' PUBLIC keys (to derive/watch the
 * reserve address and build unsigned withdrawal PSBTs); it never holds a
 * reserve private key. Signing happens out-of-band, by whichever 2 of the
 * 3 signers respond — see `scripts/sign-btc-withdrawal.ts`'s own header
 * comment for that flow, deliberately mirroring
 * `contract/scripts/execute-safe-tx.ts`'s hash/sign/execute pattern on the
 * EVM side, applied to a real Bitcoin PSBT instead of a Safe transaction.
 *
 * Why a reserve at all, separate from the hot wallet: `BTC_CUSTODIAN_WIF`
 * is a single key that both receives deposits AND used to sign every
 * payout directly — see that key's own NatSpec in wallet.ts for why that's
 * this bridge's single biggest remaining blast radius. `sweep.ts` now
 * moves every confirmed hot-wallet balance into this reserve on each poll,
 * so the hot key's real exposure window shrinks to "between a deposit
 * confirming and the next sweep," and a leaked hot key alone can never
 * again drain the full custodian balance — draining the reserve requires
 * compromising 2 of 3 independent keys, ideally held by genuinely separate
 * people/machines (see BTC_RESERVE_SIGNER_*_WIF's own comment in
 * .env.example for why these must not all sit on one device).
 */

const RESERVE_THRESHOLD = 2;
const RESERVE_TOTAL = 3;

function getReservePubkeys(): Buffer[] {
  const pubkeys: Buffer[] = [];
  for (let i = 1; i <= RESERVE_TOTAL; i++) {
    const hex = process.env[`BTC_RESERVE_PUBKEY_${i}`];
    if (!hex) throw new Error(`BTC_RESERVE_PUBKEY_${i} not set — see .env.example. No BTC reserve address can be derived without all ${RESERVE_TOTAL}.`);
    const buf = Buffer.from(hex, "hex");
    if (buf.length !== 33) throw new Error(`BTC_RESERVE_PUBKEY_${i} must be a 33-byte compressed pubkey (66 hex chars), got ${buf.length} bytes`);
    pubkeys.push(buf);
  }
  return pubkeys;
}

interface ReserveInfo {
  address: string;
  /** The P2WSH scriptPubKey — what a UTXO paying the reserve actually looks like on-chain. */
  output: Buffer;
  /** The underlying 2-of-3 P2MS redeem script — required to build/finalize a spending PSBT (witnessScript). */
  redeemOutput: Buffer;
  pubkeys: Buffer[];
}

let cached: ReserveInfo | null = null;

/** Derives (and caches) the reserve's real P2WSH multisig address from the 3 configured pubkeys — deterministic, so every caller (this backend, the sweep loop, the signing script) always agrees on the same address without needing to store it separately anywhere. */
export function getReserveInfo(): ReserveInfo {
  if (cached) return cached;
  const pubkeys = getReservePubkeys();
  const p2ms = bitcoin.payments.p2ms({ m: RESERVE_THRESHOLD, pubkeys, network: SIGNET_NETWORK });
  const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network: SIGNET_NETWORK });
  if (!p2wsh.address || !p2wsh.output || !p2ms.output) {
    throw new Error("Failed to derive the P2WSH reserve address from the configured pubkeys");
  }
  // bitcoinjs-lib v7's payments API returns plain Uint8Arrays, not real
  // Buffer instances — confirmed the hard way (Uint8Array#toString("hex")
  // silently ignores the "hex" argument and comma-joins raw byte values
  // instead, no error). Wrapping with Buffer.from(...) here, once, so
  // every caller downstream (the sweep loop, the PSBT signing script) gets
  // real Buffers and .toString("hex") behaves the way every other hex
  // encoding in this codebase already assumes.
  cached = {
    address: p2wsh.address,
    output: Buffer.from(p2wsh.output),
    redeemOutput: Buffer.from(p2ms.output),
    pubkeys,
  };
  return cached;
}

export function getReserveAddress(): string {
  return getReserveInfo().address;
}

export { RESERVE_THRESHOLD, RESERVE_TOTAL };
