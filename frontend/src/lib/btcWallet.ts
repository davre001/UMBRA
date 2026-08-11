"use client";

import * as bitcoin from "bitcoinjs-lib";
import ECPairFactory, { type ECPairInterface } from "ecpair";
import * as ecc from "tiny-secp256k1";
import { keccak256, toBytes, type Hex } from "viem";
import { secp256k1 } from "@noble/curves/secp256k1.js";

/**
 * Client-side signet Bitcoin wallet — derives a real, deterministic
 * secp256k1 keypair from the same wallet signature `keys.ts`/`privacyKeys.ts`
 * already use for spendingKey/privacyKey (same signature, a different
 * domain-separated label; no new signature prompt, no separate wallet to
 * create or back up). This is what removes the "go install a Bitcoin
 * wallet, learn to build a raw OP_RETURN transaction" step — the user's
 * existing EVM wallet becomes the root of their signet deposit address
 * too (see the Faucet page's BTC card, which auto-derives it on connect
 * and drives this whole build/sign/broadcast flow from one button), same
 * as it already is for their UMBRA spending key. See BTC_DEPOSIT_DESIGN.md and
 * backend/src/btc-withdrawal/{wallet.ts,bitcoin-tx.ts} for the equivalent
 * server-side pattern this mirrors (custodian key + Psbt signing) — same
 * bitcoinjs-lib/ecpair/tiny-secp256k1 stack, same signet network object,
 * same fee-estimation formula, run here in the browser instead.
 */

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

// Signet reuses testnet's address version bytes — same convention used
// throughout backend/ and contract/circuits (confirmed empirically there,
// not assumed).
export const SIGNET_NETWORK = bitcoin.networks.testnet;

const SECP256K1_ORDER = secp256k1.Point.Fn.ORDER;

function scalarFromHash(hash: Uint8Array): bigint {
  let scalar = BigInt("0x" + Buffer.from(hash).toString("hex")) % SECP256K1_ORDER;
  if (scalar === BigInt(0)) scalar = BigInt(1); // astronomically unlikely, keeps the scalar a valid private key
  return scalar;
}

/** This wallet's persistent signet deposit keypair — same derivation pattern as derivePrivacyKeyPair (privacyKeys.ts), own domain-separated label. Never leaves the caller. */
export function deriveSignetKeyPair(walletSignature: Hex): ECPairInterface {
  const hash = keccak256(toBytes(`umbra-note:${walletSignature}:signet-btc-key:`));
  const scalar = scalarFromHash(Buffer.from(hash.slice(2), "hex"));
  const privateKeyBytes = Buffer.from(scalar.toString(16).padStart(64, "0"), "hex");
  return ECPair.fromPrivateKey(privateKeyBytes, { network: SIGNET_NETWORK });
}

export function getSignetAddress(keyPair: ECPairInterface): string {
  const { address } = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(keyPair.publicKey), network: SIGNET_NETWORK });
  if (!address) throw new Error("Could not derive a P2WPKH address from this keypair");
  return address;
}

// Same dual-source fallback pattern contract/scripts/refresh-btc-checkpoint.ts
// uses — mempool.space proved unreachable from Render's own network this
// session (a server-side hosting issue, not expected to affect a real
// user's browser, but the fallback costs nothing and the CORS-friendliness
// of both is why client-side signet calls are viable here at all).
const SIGNET_API_BASES = ["https://mempool.space/signet/api", "https://blockstream.info/signet/api"];

async function signetGet(path: string): Promise<Response> {
  let lastErr: unknown;
  for (const base of SIGNET_API_BASES) {
    try {
      const res = await fetch(`${base}${path}`);
      if (res.ok) return res;
      lastErr = new Error(`${base}${path} -> HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export interface SignetUtxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean };
}

export async function fetchSignetUtxos(address: string): Promise<SignetUtxo[]> {
  const res = await signetGet(`/address/${address}/utxo`);
  return res.json();
}

export async function fetchSignetFeeRate(): Promise<number> {
  try {
    const res = await signetGet("/v1/fees/recommended");
    const body = (await res.json()) as { halfHourFee?: number };
    return body.halfHourFee && body.halfHourFee > 0 ? body.halfHourFee : 2;
  } catch {
    return 2; // sat/vB — conservative flat fallback, fine on a low-traffic signet
  }
}

export async function broadcastSignetTx(rawHex: string): Promise<string> {
  let lastErr: unknown;
  for (const base of SIGNET_API_BASES) {
    try {
      const res = await fetch(`${base}/tx`, { method: "POST", body: rawHex });
      if (res.ok) return (await res.text()).trim(); // returns the raw txid as the response body
      lastErr = new Error(`${base}/tx -> HTTP ${res.status} ${await res.text()}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export class InsufficientFundsError extends Error {}

// The fixed btc_deposit template is exactly 125 non-witness bytes
// (mempool.ts's TX_SIZE / bitcoin.nr's parse_deposit_tx) — 1 P2WPKH input,
// one 0-value OP_RETURN(push32) output, one P2WPKH output, no change (the
// template has no room for a 3rd output, so this always spends an entire
// UTXO rather than an arbitrary sub-amount of one). Confirmed empirically
// (not just formula-derived) by building and decoding a real signed
// instance of this exact template: base=125 bytes, total=235 bytes
// (witness ≈110 bytes for one P2WPKH input), vsize = ceil((125*3+235)/4)
// = 153 exactly — this shape never varies, so unlike
// backend/src/btc-withdrawal/bitcoin-tx.ts's estimateVsize (which has to
// handle a variable input/output count), a single fixed constant is
// actually exact here, not just an estimate.
const ESTIMATED_DEPOSIT_VSIZE = 153;

export interface BuiltDepositTx {
  rawHex: string;
  txid: string;
  amountSats: bigint;
  feeSats: bigint;
}

/**
 * Builds and signs the fixed-template deposit tx spending `utxo` in full:
 * output 0 is a 0-value OP_RETURN carrying `recipientAddress` (12
 * zero-padding bytes + the 20-byte EVM address — bitcoin.nr's
 * `parse_deposit_tx` reads it as "address as bytes32"), output 1 pays
 * `utxo.value - fee` to the vault (no change output — see
 * ESTIMATED_DEPOSIT_VSIZE's own comment for why). `recipientAddress` is
 * the depositor's own connected EVM wallet address — WrappedBTC mints
 * straight there once proven, with no separate note/claim step (see
 * ShieldedVault.sol's depositExternal). Does not broadcast — call
 * broadcastSignetTx separately so a caller can inspect/log first.
 */
export function buildDepositTx(
  keyPair: ECPairInterface,
  utxo: SignetUtxo,
  vaultPubkeyHashHex: string,
  recipientAddress: `0x${string}`,
  feeRateSatsPerVb: number
): BuiltDepositTx {
  const feeSats = BigInt(Math.ceil(ESTIMATED_DEPOSIT_VSIZE * feeRateSatsPerVb));
  const amountSats = BigInt(utxo.value) - feeSats;
  if (amountSats <= BigInt(0)) {
    throw new InsufficientFundsError(`Selected UTXO has ${utxo.value} sats, needs > ${feeSats} sats to cover the estimated fee`);
  }

  const ownScript = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(keyPair.publicKey), network: SIGNET_NETWORK }).output!;
  const vaultAddress = bitcoin.payments.p2wpkh({
    hash: Buffer.from(vaultPubkeyHashHex, "hex"),
    network: SIGNET_NETWORK,
  }).address;
  if (!vaultAddress) throw new Error(`Could not derive a signet address from vault pubkey hash ${vaultPubkeyHashHex}`);

  const psbt = new bitcoin.Psbt({ network: SIGNET_NETWORK });
  psbt.addInput({ hash: utxo.txid, index: utxo.vout, witnessUtxo: { script: ownScript, value: BigInt(utxo.value) } });

  const recipientBytes = Buffer.from(recipientAddress.slice(2), "hex");
  if (recipientBytes.length !== 20) throw new Error(`recipientAddress must be a 20-byte address, got ${recipientBytes.length} bytes`);
  const push32 = Buffer.concat([Buffer.alloc(12, 0), recipientBytes]);
  const opReturnScript = bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, push32]);
  psbt.addOutput({ script: opReturnScript, value: BigInt(0) });
  psbt.addOutput({ address: vaultAddress, value: amountSats });

  psbt.signInput(0, keyPair);
  psbt.finalizeAllInputs();

  const tx = psbt.extractTransaction();
  return { rawHex: tx.toHex(), txid: tx.getId(), amountSats, feeSats };
}
