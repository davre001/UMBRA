import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Registers the ONE-TIME genesis checkpoint for
 * `ShieldedVault.checkpoints[BTC_SIGNET_SOURCE_CHAIN_ID]` — the one
 * remaining admin-trusted value in the checkpoint system (a real, currently
 * live signet header a real deployer picks). Every checkpoint update after
 * this one is a permissionless, proof-gated `extendCheckpoint` call instead
 * (see ShieldedVault.sol's own NatSpec and circuits/noir/checkpoint_relay) —
 * this script's predecessor, `refresh-btc-checkpoint.ts`, used to be re-run
 * once per real deposit to jump the checkpoint straight to
 * `depositHeight - K`; that job now belongs entirely to
 * `btc-checkpoint-relay-worker/`, which advances the checkpoint 6 headers at
 * a time with a real proof instead of an admin write. Run THIS script
 * exactly once per source chain, ever.
 *
 * `executeInitializeCheckpoint` is timelocked (ADMIN_TIMELOCK_DELAY,
 * currently 48h) and write-once, so this script has two modes:
 *
 *   # 1. Queue — resolves a real signet header (bootstraps to the current
 *   #    tip if HEIGHT isn't given) and queues it. PRINTS the resolved
 *   #    HEIGHT — pass that exact value to step 2, don't let it re-resolve
 *   #    "current tip" again (which will have moved by then and produce a
 *   #    DIFFERENT commitment than what got queued, causing execute to
 *   #    revert with AdminActionNotQueued):
 *   MODE=queue npx hardhat run scripts/initialize-btc-checkpoint.ts --network coston2
 *
 *   #    Or target an exact height directly:
 *   MODE=queue HEIGHT=317022 npx hardhat run scripts/initialize-btc-checkpoint.ts --network coston2
 *
 *   # 2. Execute — same HEIGHT, at least ADMIN_TIMELOCK_DELAY later:
 *   MODE=execute HEIGHT=317022 npx hardhat run scripts/initialize-btc-checkpoint.ts --network coston2
 *
 * SAFE_MODE=true — for a vault whose DEFAULT_ADMIN_ROLE is held by a Safe
 * (see contract/deployments/coston2-safe.json), not a single EOA: a direct
 * `vault.queueInitializeCheckpoint(...)` call from this script's own signer
 * would just revert (that signer isn't the admin anymore). Instead, prints
 * the `to`/`data` for scripts/execute-safe-tx.ts's own hash/sign/execute
 * flow, computed the identical way, rather than attempting the call itself:
 *   SAFE_MODE=true MODE=queue npx hardhat run scripts/initialize-btc-checkpoint.ts --network coston2
 *
 * Computes the checkpoint COMMITMENT (not the raw hash — see
 * `ShieldedVault.executeInitializeCheckpoint`'s own NatSpec) via the
 * already-deployed Poseidon2_BN254 contract's `hash_2(lo, hi)`, a real
 * on-chain read-only call — deliberately not a reimplemented JS Poseidon2,
 * so this can never silently diverge from what the circuit/verifier
 * actually computes.
 *
 * After executing, also POSTs the resulting height to the backend's
 * `/api/btc-deposit/checkpoint` (secret-gated) so its own tracker
 * (`backend/src/btc-deposit/checkpoint.ts`) — and `btc-checkpoint-relay-worker`'s
 * own reconciliation, which reads that same tracker — starts from the right
 * place. Skipped (with a warning) if `BACKEND_URL`/`BTC_DEPOSIT_INTERNAL_SECRET`
 * aren't set.
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
  const tipHeight = Number(await signetGet("/blocks/tip/height"));
  console.log(`No HEIGHT given — bootstrapping to the current signet tip (${tipHeight}).`);
  return tipHeight;
}

async function main() {
  const mode = process.env.MODE ?? "queue";
  if (mode !== "queue" && mode !== "execute") throw new Error(`MODE must be "queue" or "execute", got ${mode}`);

  const deployment = JSON.parse(fs.readFileSync(path.join(__dirname, "../deployments/coston2.json"), "utf8"));
  const poseidon2Address = process.env.POSEIDON2_ADDRESS ?? deployment.contracts.Poseidon2_BN254;
  const vaultAddress = process.env.VAULT_ADDRESS ?? deployment.contracts.ShieldedVault;
  if (!poseidon2Address || !vaultAddress) {
    throw new Error("Missing Poseidon2_BN254/ShieldedVault address — set POSEIDON2_ADDRESS/VAULT_ADDRESS or check deployments/coston2.json");
  }

  const [signer] = await ethers.getSigners();
  console.log(`[${mode}] Initializing BTC checkpoint with:`, signer.address);

  const targetHeight = await resolveTargetHeight();

  console.log(`Fetching real signet header at height ${targetHeight}...`);
  const displayHash = await signetGet(`/block-height/${targetHeight}`);
  // mempool.space/blockstream.info return the display (RPC getblockhash /
  // explorer) byte order; bitcoin.nr's checkpoint_hash uses the native
  // (double_sha256 output) order throughout.
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

  const safeMode = process.env.SAFE_MODE === "true";
  if (safeMode) {
    const fnName = mode === "queue" ? "queueInitializeCheckpoint" : "executeInitializeCheckpoint";
    const data = vault.interface.encodeFunctionData(fnName as never, [sourceChainId, checkpointCommitmentBytes32]);
    console.log(`\nVault admin is a Safe — not calling ${fnName} directly. Feed this into scripts/execute-safe-tx.ts:\n`);
    console.log(`SAFE_TX_MODE=hash SAFE_TX_TO=${vaultAddress} SAFE_TX_DATA=${data} \\`);
    console.log(`  npx hardhat run scripts/execute-safe-tx.ts --network coston2`);
    console.log(`\n(then SAFE_TX_MODE=sign per owner, then SAFE_TX_MODE=execute with >= threshold signatures — see that script's own header comment)`);
    if (mode === "queue") {
      console.log(`\nRemember HEIGHT=${targetHeight} for the later MODE=execute SAFE_MODE=true run — don't let it re-resolve "current tip".`);
    } else {
      console.log(`\nAfter that Safe execution lands on-chain, sync the backend's tracked height directly (this script's own POST step doesn't run in SAFE_MODE, since it never actually submitted the on-chain call itself):`);
      console.log(`  curl -X POST \${BACKEND_URL}/api/btc-deposit/checkpoint -H "content-type: application/json" -H "x-btc-deposit-secret: \${BTC_DEPOSIT_INTERNAL_SECRET}" -d '{"height": ${targetHeight}}'`);
    }
    return;
  }

  if (mode === "queue") {
    console.log(`Calling queueInitializeCheckpoint(${sourceChainId}, ${checkpointCommitmentBytes32}) on ${vaultAddress}...`);
    const tx = await vault.queueInitializeCheckpoint(sourceChainId, checkpointCommitmentBytes32);
    const receipt = await tx.wait();
    console.log(`  confirmed: ${receipt?.hash}`);
    const delay = await vault.ADMIN_TIMELOCK_DELAY();
    console.log(`\nQueued. In >= ${delay}s, run:`);
    console.log(`  MODE=execute HEIGHT=${targetHeight} npx hardhat run scripts/initialize-btc-checkpoint.ts --network coston2`);
    return;
  }

  console.log(`Calling executeInitializeCheckpoint(${sourceChainId}, ${checkpointCommitmentBytes32}) on ${vaultAddress}...`);
  const tx = await vault.executeInitializeCheckpoint(sourceChainId, checkpointCommitmentBytes32);
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

  console.log(`\nDone. checkpoints[BTC_SIGNET_SOURCE_CHAIN_ID] genesis is set at height ${targetHeight}.`);
  console.log("From here, btc-checkpoint-relay-worker's own permissionless extendCheckpoint calls keep it moving —");
  console.log("this script never needs to run again for this source chain.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
