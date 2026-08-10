import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Registers (or rotates) `ShieldedVault.checkpoints[BTC_SIGNET_SOURCE_CHAIN_ID]`
 * with a real, currently-live signet header — the tooling
 * `contract/scripts/deploy.ts` and `circuits/BTC_DEPOSIT_DESIGN.md` both
 * defer to this script rather than baking in a stale value at deploy time.
 *
 * Fixed header-chain length K=6 (bitcoin.nr's own `K`) means a deposit's
 * confirming block must land at EXACTLY `checkpointHeight + K` — see
 * backend/src/btc-deposit/mempool.ts's own `assembleDepositProofInputs`
 * doc for the same constraint from the proving side. In practice this
 * script gets run once per real deposit (or once per bootstrap/smoke
 * test), not on a fixed schedule:
 *
 *   # Bootstrap — anchor to the current signet tip, before any deposit exists:
 *   npx hardhat run scripts/refresh-btc-checkpoint.ts --network coston2
 *
 *   # Once a specific deposit tx has confirmed, anchor 6 blocks behind it
 *   # so that tx's own confirming block becomes checkpoint+K:
 *   TXID=<64-char hex txid> npx hardhat run scripts/refresh-btc-checkpoint.ts --network coston2
 *
 *   # Or target an exact height directly:
 *   HEIGHT=317022 npx hardhat run scripts/refresh-btc-checkpoint.ts --network coston2
 *
 * Computes the checkpoint COMMITMENT (not the raw hash — see
 * `ShieldedVault.setCheckpoint`'s own NatSpec) via the already-deployed
 * Poseidon2_BN254 contract's `hash_2(lo, hi)`, a real on-chain read-only
 * call — deliberately not a reimplemented JS Poseidon2, so this can never
 * silently diverge from what the circuit/verifier actually computes.
 *
 * After registering on-chain, also POSTs the resulting height to the
 * backend's `/api/btc-deposit/checkpoint` (secret-gated) so its own
 * in-memory tracker (`backend/src/btc-deposit/checkpoint.ts`) stays in
 * sync — required for `/api/btc-deposit/submit` to record the right
 * `checkpointHeight` on new deposits. Skipped (with a warning) if
 * `BACKEND_URL`/`BTC_DEPOSIT_INTERNAL_SECRET` aren't set, since a local
 * dry run against coston2 shouldn't hard-require a running backend.
 */

const SIGNET_API_BASES = ["https://mempool.space/signet/api", "https://blockstream.info/signet/api"];

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

async function signetGetJson<T>(path: string): Promise<T> {
  return JSON.parse(await signetGet(path)) as T;
}

function reverseHex(hex: string): string {
  return Buffer.from(hex, "hex").reverse().toString("hex");
}

/** Mirrors bitcoin.nr's `bytes32_to_u128_limbs` / btc-deposit-worker's `bytes32ToLimbs` exactly. */
function bytes32ToLimbs(buf: Buffer): { lo: bigint; hi: bigint } {
  let lo = 0n;
  let mul = 1n;
  for (let i = 0; i < 16; i++) {
    lo += BigInt(buf[i]) * mul;
    mul *= 256n;
  }
  let hi = 0n;
  mul = 1n;
  for (let i = 16; i < 32; i++) {
    hi += BigInt(buf[i]) * mul;
    mul *= 256n;
  }
  return { lo, hi };
}

async function resolveTargetHeight(): Promise<number> {
  if (process.env.HEIGHT) {
    const h = Number(process.env.HEIGHT);
    if (!Number.isInteger(h) || h < 0) throw new Error(`HEIGHT must be a non-negative integer, got ${process.env.HEIGHT}`);
    return h;
  }
  if (process.env.TXID) {
    const txid = process.env.TXID;
    if (!/^[0-9a-f]{64}$/i.test(txid)) throw new Error(`TXID must be a 64-char hex txid, got ${txid}`);
    const K = 6;
    const txInfo = await signetGetJson<{ status: { confirmed: boolean; block_height?: number } }>(`/tx/${txid}`);
    if (!txInfo.status.confirmed || txInfo.status.block_height === undefined) {
      throw new Error(`${txid} is not yet confirmed — wait for it to confirm before targeting it`);
    }
    const targetHeight = txInfo.status.block_height - K;
    console.log(`TXID ${txid} confirmed at height ${txInfo.status.block_height} -> targeting checkpoint height ${targetHeight} (K=${K} behind)`);
    return targetHeight;
  }
  const tipHeight = Number(await signetGet("/blocks/tip/height"));
  console.log(`No HEIGHT/TXID given — bootstrapping to the current signet tip (${tipHeight}).`);
  return tipHeight;
}

async function main() {
  const deployment = JSON.parse(fs.readFileSync(path.join(__dirname, "../deployments/coston2.json"), "utf8"));
  const poseidon2Address = process.env.POSEIDON2_ADDRESS ?? deployment.contracts.Poseidon2_BN254;
  const vaultAddress = process.env.VAULT_ADDRESS ?? deployment.contracts.ShieldedVault;
  if (!poseidon2Address || !vaultAddress) {
    throw new Error("Missing Poseidon2_BN254/ShieldedVault address — set POSEIDON2_ADDRESS/VAULT_ADDRESS or check deployments/coston2.json");
  }

  const [signer] = await ethers.getSigners();
  console.log("Refreshing BTC checkpoint with:", signer.address);

  const targetHeight = await resolveTargetHeight();

  console.log(`Fetching real signet header at height ${targetHeight}...`);
  const displayHash = await signetGet(`/block-height/${targetHeight}`);
  // mempool.space/blockstream.info return the display (RPC getblockhash /
  // explorer) byte order; bitcoin.nr's checkpoint_hash uses the native
  // (double_sha256 output) order throughout — same reversal
  // backend/src/btc-deposit/mempool.ts's own assembleDepositProofInputs
  // applies to its checkpoint hash.
  const nativeHash = Buffer.from(reverseHex(displayHash), "hex");
  if (nativeHash.length !== 32) throw new Error(`expected a 32-byte block hash, got ${nativeHash.length} bytes`);
  console.log(`  display hash: ${displayHash}`);
  console.log(`  native hash:  ${nativeHash.toString("hex")}`);

  const { lo, hi } = bytes32ToLimbs(nativeHash);
  const hasher = await ethers.getContractAt("Poseidon2_BN254", poseidon2Address);
  const checkpointCommitment: bigint = await hasher.hash_2(lo, hi);
  const checkpointCommitmentBytes32 = ethers.zeroPadValue(ethers.toBeHex(checkpointCommitment), 32);
  console.log(`  checkpoint_commitment: ${checkpointCommitmentBytes32}`);

  const sourceChainId = ethers.keccak256(ethers.toUtf8Bytes("BTC_SIGNET"));
  const vault = await ethers.getContractAt("ShieldedVault", vaultAddress);
  console.log(`Calling setCheckpoint(${sourceChainId}, ${checkpointCommitmentBytes32}) on ${vaultAddress}...`);
  const tx = await vault.setCheckpoint(sourceChainId, checkpointCommitmentBytes32);
  const receipt = await tx.wait();
  console.log(`  confirmed: ${receipt?.hash}`);

  const backendUrl = process.env.BACKEND_URL;
  const secret = process.env.BTC_DEPOSIT_INTERNAL_SECRET;
  if (backendUrl && secret) {
    console.log(`Syncing backend's tracked checkpoint height (${backendUrl})...`);
    const res = await fetch(`${backendUrl}/api/btc-deposit/checkpoint`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-btc-deposit-secret": secret },
      body: JSON.stringify({ height: targetHeight }),
    });
    if (!res.ok) {
      console.warn(`  backend sync failed: HTTP ${res.status} ${await res.text()} — call it manually once the backend is reachable.`);
    } else {
      console.log(`  backend now tracks checkpoint height ${targetHeight}.`);
    }
  } else {
    console.warn("BACKEND_URL/BTC_DEPOSIT_INTERNAL_SECRET not set — skipped syncing the backend's tracked checkpoint height.");
    console.warn(`Once the backend is reachable, sync it manually: POST ${"{BACKEND_URL}"}/api/btc-deposit/checkpoint { "height": ${targetHeight} }`);
  }

  console.log(`\nDone. Deposits confirming at exactly height ${targetHeight + 6} can now be proven.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
