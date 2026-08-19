import { ethers } from "hardhat";
import type { InterfaceAbi } from "ethers";
import * as fs from "fs";
import * as path from "path";

/**
 * Generic propose/sign/execute flow for the 2-of-3 Safe deployed by
 * scripts/deploy-safe.ts — since Coston2 has no Safe Transaction Service
 * (see that script's own header comment), there's no hosted dashboard for
 * "pending transactions"; this script is that coordination layer instead,
 * done by hand across however many separate runs it takes to get 2
 * signatures collected. Reusable for ANY call the Safe needs to make
 * (grantRole/renounceRole on ShieldedVault today, but also whichever
 * ShieldedVault admin setters end up routed through the Safe later —
 * queueSetTrustedVerifier, executeInitializeCheckpoint, etc.), not
 * one-off — `to`/`data` are just parameters.
 *
 * Three modes, run as separate invocations (in general, by different
 * people on different machines):
 *
 *   # 1. Hash — anyone proposes a call and gets back the exact inputs
 *   #    (including the Safe's CURRENT nonce) every signer must sign
 *   #    against. Share this whole block with the other signers verbatim —
 *   #    if the Safe's nonce moves before they sign (e.g. another tx
 *   #    executes first), the hash changes and old signatures stop working,
 *   #    by design (that's what nonce/replay protection means here).
 *   SAFE_TX_MODE=hash SAFE_TX_TO=0x... SAFE_TX_DATA=0x... \
 *     npx hardhat run scripts/execute-safe-tx.ts --network coston2
 *
 *   # 2. Sign — each owner independently signs the EXACT SAFE_TX_HASH_INPUTS
 *   #    blob printed by step 1 (not just "to"/"data" again — nonce must
 *   #    match exactly), using their own key. Never share
 *   #    SAFE_SIGNER_PRIVATE_KEY outside this one invocation.
 *   SAFE_TX_MODE=sign SAFE_TX_TO=0x... SAFE_TX_DATA=0x... SAFE_TX_NONCE=3 \
 *   SAFE_SIGNER_PRIVATE_KEY=0x... \
 *     npx hardhat run scripts/execute-safe-tx.ts --network coston2
 *
 *   # 3. Execute — once >= threshold signatures are collected (from step
 *   #    2's output), anyone (any funded account, doesn't need to be an
 *   #    owner — Safe's own security model doesn't require the submitter
 *   #    to be a signer) submits them together.
 *   SAFE_TX_MODE=execute SAFE_TX_TO=0x... SAFE_TX_DATA=0x... SAFE_TX_NONCE=3 \
 *   SAFE_TX_SIGNATURES_JSON='[{"signer":"0x..","signature":"0x.."},{"signer":"0x..","signature":"0x.."}]' \
 *     npx hardhat run scripts/execute-safe-tx.ts --network coston2
 *
 * safeTxGas/baseGas/gasPrice/gasToken/refundReceiver are all fixed at
 * zero/address(0) throughout — this Safe only ever executes plain admin
 * calls for this project, not third-party relayed/refunded transactions,
 * so Safe's optional gas-refund machinery is unused deadweight here.
 */

function loadSafeAbi(): InterfaceAbi {
  const full = path.join(__dirname, "../node_modules/@safe-global/safe-contracts/build/artifacts/contracts/SafeL2.sol/SafeL2.json");
  return JSON.parse(fs.readFileSync(full, "utf8")).abi as InterfaceAbi;
}

function loadSafeDeployment(): { safeAddress: string; owners: string[]; threshold: number } {
  const full = path.join(__dirname, "../deployments/coston2-safe.json");
  if (!fs.existsSync(full)) throw new Error(`${full} not found — run scripts/deploy-safe.ts first`);
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

const ZERO_GAS_PARAMS = {
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: ethers.ZeroAddress,
  refundReceiver: ethers.ZeroAddress,
};

async function main() {
  const mode = process.env.SAFE_TX_MODE;
  if (mode !== "hash" && mode !== "sign" && mode !== "execute") {
    throw new Error('SAFE_TX_MODE must be "hash", "sign", or "execute"');
  }

  const to = process.env.SAFE_TX_TO;
  const data = process.env.SAFE_TX_DATA;
  const value = BigInt(process.env.SAFE_TX_VALUE ?? "0");
  const operation = Number(process.env.SAFE_TX_OPERATION ?? "0"); // 0 = Call, 1 = DelegateCall
  if (!to || !data) throw new Error("SAFE_TX_TO and SAFE_TX_DATA are required");

  const deployment = loadSafeDeployment();
  const safeAbi = loadSafeAbi();
  const [signer] = await ethers.getSigners();
  const safe = new ethers.Contract(deployment.safeAddress, safeAbi, signer);

  const nonce = process.env.SAFE_TX_NONCE !== undefined ? BigInt(process.env.SAFE_TX_NONCE) : ((await safe.nonce()) as bigint);

  const safeTxHash: string = await safe.getTransactionHash(
    to,
    value,
    data,
    operation,
    ZERO_GAS_PARAMS.safeTxGas,
    ZERO_GAS_PARAMS.baseGas,
    ZERO_GAS_PARAMS.gasPrice,
    ZERO_GAS_PARAMS.gasToken,
    ZERO_GAS_PARAMS.refundReceiver,
    nonce
  );

  if (mode === "hash") {
    console.log("Safe:", deployment.safeAddress, `(${deployment.threshold}-of-${deployment.owners.length})`);
    console.log("\nShare this EXACT block with every signer — nonce must match or the hash (and every signature) changes:");
    console.log(
      JSON.stringify(
        { to, data, value: value.toString(), operation, nonce: nonce.toString(), safeTxHash },
        null,
        2
      )
    );
    return;
  }

  if (mode === "sign") {
    const privateKey = process.env.SAFE_SIGNER_PRIVATE_KEY;
    if (!privateKey) throw new Error("SAFE_SIGNER_PRIVATE_KEY not set");
    const signingKey = new ethers.SigningKey(privateKey);
    // Safe's checkSignatures treats v in {27, 28} as: the signature covers
    // safeTxHash DIRECTLY, not the eth_sign-prefixed
    // ("\x19Ethereum Signed Message:\n32" + hash) digest — this is a raw
    // ECDSA sign over the hash bytes, exactly what SigningKey.sign(digest)
    // produces, deliberately NOT wallet.signMessage (which would add that
    // prefix and make execTransaction reject it).
    const sig = signingKey.sign(safeTxHash);
    const signerAddress = ethers.computeAddress(signingKey.publicKey);
    if (!deployment.owners.some((o) => o.toLowerCase() === signerAddress.toLowerCase())) {
      throw new Error(`${signerAddress} is not an owner of this Safe (${deployment.owners.join(", ")})`);
    }
    console.log("Signer:", signerAddress);
    console.log("safeTxHash:", safeTxHash, "(nonce", nonce.toString() + ")");
    console.log("\nShare this signature entry with whoever collects them for execute:");
    console.log(JSON.stringify({ signer: signerAddress, signature: sig.serialized }));
    return;
  }

  // mode === "execute"
  const signaturesJson = process.env.SAFE_TX_SIGNATURES_JSON;
  if (!signaturesJson) throw new Error("SAFE_TX_SIGNATURES_JSON not set");
  const provided: { signer: string; signature: string }[] = JSON.parse(signaturesJson);
  if (provided.length < deployment.threshold) {
    throw new Error(`Need >= ${deployment.threshold} signatures, got ${provided.length}`);
  }

  // Recover each signature against safeTxHash directly (same raw-digest
  // convention "sign" mode used) and confirm it actually recovers to the
  // claimed owner — fail loudly here with a specific reason rather than
  // let execTransaction revert opaquely on-chain for a malformed/mismatched
  // signature.
  for (const { signer: claimedSigner, signature } of provided) {
    const recovered = ethers.recoverAddress(safeTxHash, signature);
    if (recovered.toLowerCase() !== claimedSigner.toLowerCase()) {
      throw new Error(`Signature claimed for ${claimedSigner} actually recovers to ${recovered} — wrong hash/nonce or tampered signature`);
    }
    if (!deployment.owners.some((o) => o.toLowerCase() === claimedSigner.toLowerCase())) {
      throw new Error(`${claimedSigner} is not an owner of this Safe`);
    }
  }

  // Safe requires signatures concatenated in ascending signer-address
  // order — not signing order.
  const sorted = [...provided].sort((a, b) => (a.signer.toLowerCase() < b.signer.toLowerCase() ? -1 : 1));
  const concatenatedSignatures = "0x" + sorted.map((s) => s.signature.slice(2)).join("");

  console.log("Executing via Safe", deployment.safeAddress, "as", signer.address);
  console.log("to:", to, "nonce:", nonce.toString(), "signers:", sorted.map((s) => s.signer));
  const tx = await safe.execTransaction(
    to,
    value,
    data,
    operation,
    ZERO_GAS_PARAMS.safeTxGas,
    ZERO_GAS_PARAMS.baseGas,
    ZERO_GAS_PARAMS.gasPrice,
    ZERO_GAS_PARAMS.gasToken,
    ZERO_GAS_PARAMS.refundReceiver,
    concatenatedSignatures
  );
  const receipt = await (tx as { wait: () => Promise<{ hash: string; status: number }> }).wait();
  if (receipt.status !== 1) throw new Error(`execTransaction reverted: ${receipt.hash}`);
  console.log("Executed:", receipt.hash);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
