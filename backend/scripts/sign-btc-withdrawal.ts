import "dotenv/config";
import * as bitcoin from "bitcoinjs-lib";
import ECPairFactory from "ecpair";
import * as ecc from "tiny-secp256k1";

/**
 * The signer-side half of the 2-of-3 reserve withdrawal flow (see
 * src/btc-withdrawal/reserve.ts's own doc for why the reserve exists at
 * all). Run this yourself, with your own BTC_RESERVE_SIGNER_N_WIF, never
 * shared with this backend or the other signers — same "never centralize
 * the keys that are supposed to be independent" reasoning
 * contract/scripts/execute-safe-tx.ts follows on the EVM side.
 *
 * Simpler than that EVM Safe flow, though: there, signatures had to be
 * collected off-chain by hand and submitted together in one execute call,
 * because there was no shared place to merge them. Here, the backend
 * combines each signer's partial signature into the stored PSBT as soon as
 * it arrives (bitcoinjs-lib's Psbt.combine — real PSBTs support this
 * incremental-merge pattern natively), and finalizes+broadcasts
 * automatically the moment enough are present. So each signer just runs
 * this once, whenever convenient — no coordination with the other signers
 * needed at all.
 *
 *   BTC_WITHDRAWAL_NULLIFIER_HASH=<hash> \
 *   BTC_RESERVE_SIGNER_WIF=<your own WIF — never anyone else's> \
 *     npx tsx scripts/sign-btc-withdrawal.ts
 *
 *   # Check status without signing:
 *   MODE=status BTC_WITHDRAWAL_NULLIFIER_HASH=<hash> npx tsx scripts/sign-btc-withdrawal.ts
 *
 * BACKEND_URL / BTC_WITHDRAWAL_INTERNAL_SECRET come from the environment
 * the same way every other script/worker in this repo reads its own
 * secrets — see .env.example.
 */

const ECPair = ECPairFactory(ecc);
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

function requireSecret(): string {
  const secret = process.env.BTC_WITHDRAWAL_INTERNAL_SECRET;
  if (!secret) throw new Error("BTC_WITHDRAWAL_INTERNAL_SECRET not set — see .env.example");
  return secret;
}

function requireNullifierHash(): string {
  const hash = process.env.BTC_WITHDRAWAL_NULLIFIER_HASH;
  if (!hash) throw new Error("BTC_WITHDRAWAL_NULLIFIER_HASH not set — which withdrawal are you signing for?");
  return hash;
}

async function fetchPsbt(nullifierHash: string): Promise<{ status: string; psbt?: string }> {
  const res = await fetch(`${BACKEND_URL}/api/btc-withdrawal/${nullifierHash}/psbt`, {
    headers: { "x-btc-withdrawal-secret": requireSecret() },
  });
  if (res.status === 409) {
    const body = (await res.json()) as { error: string };
    console.log(body.error);
    return { status: "not-awaiting-signatures" };
  }
  if (!res.ok) throw new Error(`GET /psbt failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { status: string; psbt: string };
  return body;
}

async function submitSignedPsbt(nullifierHash: string, psbtBase64: string): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/api/btc-withdrawal/${nullifierHash}/psbt`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-btc-withdrawal-secret": requireSecret() },
    body: JSON.stringify({ psbt: psbtBase64 }),
  });
  if (!res.ok) throw new Error(`POST /psbt failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { status: string; payoutTxid?: string; signatureCounts?: number[] };
  if (body.status === "broadcast") {
    console.log(`Fully signed — broadcast: ${body.payoutTxid}`);
  } else {
    console.log(`Signature submitted. Per-input signature counts so far: ${JSON.stringify(body.signatureCounts)}`);
  }
}

async function main() {
  const mode = process.env.MODE ?? "sign";
  const nullifierHash = requireNullifierHash();

  const { status, psbt } = await fetchPsbt(nullifierHash);
  if (status === "not-awaiting-signatures") return;
  console.log(`Withdrawal ${nullifierHash} is ${status}.`);

  if (mode === "status") return;
  if (mode !== "sign") throw new Error(`MODE must be "sign" or "status", got ${mode}`);

  const wif = process.env.BTC_RESERVE_SIGNER_WIF;
  if (!wif) throw new Error("BTC_RESERVE_SIGNER_WIF not set — your own reserve signer key, never anyone else's");
  const keyPair = ECPair.fromWIF(wif, bitcoin.networks.testnet);

  const parsed = bitcoin.Psbt.fromBase64(psbt!, { network: bitcoin.networks.testnet });
  parsed.signAllInputs(keyPair);
  console.log(`Signed with pubkey ${Buffer.from(keyPair.publicKey).toString("hex")}. Submitting...`);
  await submitSignedPsbt(nullifierHash, parsed.toBase64());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
