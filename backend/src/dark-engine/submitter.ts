import { encodeAbiParameters, hexToBytes, type Hex } from "viem";
import { SHIELDED_VAULT_ABI } from "../shared/vaultAbi";
import { STEALTH_ANNOUNCER_ABI } from "../shared/stealthAnnouncerAbi";
import { PRIVACY_KEY_REGISTRY_ABI } from "../shared/privacyKeyRegistryAbi";
import { CONTRACTS, assertTxSuccess, getWalletClient, publicClient } from "../shared/chain";
import { ZERO_VALUE } from "../shared/merkleTree";
import { logger } from "../shared/logger";
import { encryptAnnouncement, encryptAndTagAnnouncement } from "../shared/privacyKeys";
import type { MatchProofInputs, OrderIntent } from "./types";

/** Same schemeId/metadata encoding as frontend/src/lib/noteWallet/announcer.ts — a matched note delivered this way is discoverable the same way a `pay()` note is. */
const OWNER_KEY_NOTE_SCHEME_ID = BigInt(2);
const NOTE_METADATA_PARAMS = [
  { type: "uint256", name: "assetId" },
  { type: "uint256", name: "amount" },
  { type: "uint256", name: "blinding" },
  { type: "uint256", name: "commitment" },
] as const;

/** Same schemeId/encoding as frontend/src/lib/noteWallet/announcer.ts's order-announcement support — delivers a partial fill's residual order to the trader who still owns it, the same way a matched note is delivered. */
const ORDER_SCHEME_ID = BigInt(3);
const ORDER_METADATA_PARAMS = [
  { type: "uint256", name: "assetIn" },
  { type: "uint256", name: "assetOut" },
  { type: "uint256", name: "amountIn" },
  { type: "uint256", name: "minAmountOut" },
  { type: "uint256", name: "blinding" },
  { type: "uint256", name: "commitment" },
  { type: "uint256", name: "originalAmountIn" },
] as const;

export interface MatchLeafIndices {
  outA: number;
  outB: number;
  residualA?: number;
  residualB?: number;
}

/**
 * Submits a proven match on-chain, paying gas from the backend's own wallet
 * (same relaying rationale as relayer.service.ts — the proof is already the
 * full authorization). Also derives the on-chain leaf index of every leaf
 * this call inserted (2-4: the two matched-proceeds notes always, plus a
 * residual per side that wasn't fully filled) — needed so a residual can be
 * re-rested onto the book with a real, provable leafIndex without the
 * contract emitting one directly. Read at the confirming tx's own block
 * number (not "latest") so a match submitted concurrently afterward can
 * never race this into the wrong count.
 */
export async function submitMatch(
  proof: `0x${string}`,
  inputs: MatchProofInputs
): Promise<{ txHash: `0x${string}`; leafIndices: MatchLeafIndices }> {
  const wallet = getWalletClient();
  logger.info(`[submitter] submitting matchOrders() tx from ${wallet.account!.address}`);
  const txHash = await wallet.writeContract({
    address: CONTRACTS.ShieldedVault as `0x${string}`,
    abi: SHIELDED_VAULT_ABI,
    functionName: "matchOrders",
    args: [
      proof,
      inputs.root,
      inputs.nullifierHashA,
      inputs.nullifierHashB,
      inputs.outCommitmentA,
      inputs.outCommitmentB,
      inputs.residualCommitmentA,
      inputs.residualCommitmentB,
    ],
    chain: wallet.chain,
    account: wallet.account!,
  });
  logger.info(`[submitter] matchOrders() tx sent: ${txHash} — waiting for confirmation`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  assertTxSuccess(receipt);
  logger.info(`[submitter] matchOrders() confirmed in block ${receipt.blockNumber}: ${txHash}`);

  const nextLeafIndex = await publicClient.readContract({
    address: CONTRACTS.ShieldedVault as `0x${string}`,
    abi: SHIELDED_VAULT_ABI,
    functionName: "nextLeafIndex",
    blockNumber: receipt.blockNumber,
  });
  const hasResidualA = inputs.residualCommitmentA !== ZERO_VALUE;
  const hasResidualB = inputs.residualCommitmentB !== ZERO_VALUE;
  const insertedCount = 2 + (hasResidualA ? 1 : 0) + (hasResidualB ? 1 : 0);
  const startIndex = Number(nextLeafIndex) - insertedCount;

  const leafIndices: MatchLeafIndices = { outA: startIndex, outB: startIndex + 1 };
  let cursor = startIndex + 2;
  if (hasResidualA) leafIndices.residualA = cursor++;
  if (hasResidualB) leafIndices.residualB = cursor++;

  return { txHash, leafIndices };
}

/**
 * Looks up `walletAddress`'s published privacy key (see PrivacyKeyRegistry.sol
 * and shared/privacyKeys.ts). Returns null if the registry isn't deployed on
 * this network yet, or if this wallet never registered one — either way the
 * caller falls back to the legacy plaintext/real-address announcement rather
 * than failing the delivery outright.
 */
async function lookupPrivacyKey(walletAddress: string): Promise<Uint8Array | null> {
  if (!CONTRACTS.PrivacyKeyRegistry) return null;
  const key = (await publicClient.readContract({
    address: CONTRACTS.PrivacyKeyRegistry as `0x${string}`,
    abi: PRIVACY_KEY_REGISTRY_ABI,
    functionName: "privacyKeyOf",
    args: [walletAddress as `0x${string}`],
  })) as Hex;
  return key && key !== "0x" ? hexToBytes(key) : null;
}

/** Delivers a matched output note's private data to its trader — same mechanism `pay()` uses, so the same Pay/Receive-page "Incoming" scan discovers it. Encrypted and stealth-tagged when the trader has a registered privacy key (see privacyKeys.ts); falls back to the legacy plaintext/real-address form otherwise. */
export async function announceMatchedNote(
  order: OrderIntent,
  assetId: bigint,
  amount: bigint,
  blinding: bigint,
  commitment: bigint
): Promise<`0x${string}`> {
  const wallet = getWalletClient();
  const plaintext = encodeAbiParameters(NOTE_METADATA_PARAMS, [assetId, amount, blinding, commitment]);
  const traderPrivacyKey = await lookupPrivacyKey(order.walletAddress);

  const [stealthAddress, ephemeralPubKey, metadata] = traderPrivacyKey
    ? (() => {
        const encrypted = encryptAndTagAnnouncement(traderPrivacyKey, hexToBytes(plaintext));
        return [encrypted.stealthAddress, encrypted.ephemeralPubKey, encrypted.metadata] as const;
      })()
    : ([order.walletAddress as `0x${string}`, "0x", plaintext] as const);

  logger.info(`[submitter] announcing matched note to ${order.walletAddress} (asset ${assetId}, amount ${amount}, encrypted ${!!traderPrivacyKey})`);
  const txHash = await wallet.writeContract({
    address: CONTRACTS.StealthAnnouncer as `0x${string}`,
    abi: STEALTH_ANNOUNCER_ABI,
    functionName: "announce",
    args: [OWNER_KEY_NOTE_SCHEME_ID, stealthAddress, ephemeralPubKey, metadata],
    chain: wallet.chain,
    account: wallet.account!,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  assertTxSuccess(receipt);
  logger.info(`[submitter] matched-note announcement confirmed: ${txHash}`);
  return txHash;
}

/** Delivers a partial fill's residual order to the trader who still owns it — same delivery mechanism as `announceMatchedNote`, discoverable via the Receive page's incoming scan (extended for order-kind announcements). Metadata is encrypted when the trader has a registered privacy key; `stealthAddress` always stays the trader's own real address (already public via their own placeOrder tx — no counterparty to hide here). */
export async function announceResidualOrder(
  order: OrderIntent,
  residual: { amountIn: bigint; minAmountOut: bigint; commitment: bigint },
  blinding: bigint
): Promise<`0x${string}`> {
  const wallet = getWalletClient();
  const plaintext = encodeAbiParameters(ORDER_METADATA_PARAMS, [
    BigInt(order.assetIn),
    BigInt(order.assetOut),
    residual.amountIn,
    residual.minAmountOut,
    blinding,
    residual.commitment,
    BigInt(order.originalAmountIn),
  ]);
  const traderPrivacyKey = await lookupPrivacyKey(order.walletAddress);
  const { ephemeralPubKey, metadata } = traderPrivacyKey
    ? encryptAnnouncement(traderPrivacyKey, hexToBytes(plaintext))
    : { ephemeralPubKey: "0x" as Hex, metadata: plaintext };

  logger.info(`[submitter] announcing residual order to ${order.walletAddress} (amountIn ${residual.amountIn}, encrypted ${!!traderPrivacyKey})`);
  const txHash = await wallet.writeContract({
    address: CONTRACTS.StealthAnnouncer as `0x${string}`,
    abi: STEALTH_ANNOUNCER_ABI,
    functionName: "announce",
    args: [ORDER_SCHEME_ID, order.walletAddress as `0x${string}`, ephemeralPubKey, metadata],
    chain: wallet.chain,
    account: wallet.account!,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  assertTxSuccess(receipt);
  logger.info(`[submitter] residual-order announcement confirmed: ${txHash}`);
  return txHash;
}
