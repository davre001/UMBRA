import { encodeAbiParameters } from "viem";
import { SHIELDED_VAULT_ABI } from "../shared/vaultAbi";
import { STEALTH_ANNOUNCER_ABI } from "../shared/stealthAnnouncerAbi";
import { CONTRACTS, getWalletClient, publicClient } from "../shared/chain";
import type { MatchProofInputs, OrderIntent } from "./types";

/** Same schemeId/metadata encoding as frontend/src/lib/noteWallet/announcer.ts — a matched note delivered this way is discoverable the same way a `pay()` note is. */
const OWNER_KEY_NOTE_SCHEME_ID = BigInt(2);
const METADATA_PARAMS = [
  { type: "uint256", name: "assetId" },
  { type: "uint256", name: "amount" },
  { type: "uint256", name: "blinding" },
  { type: "uint256", name: "commitment" },
] as const;

/** Submits a proven match on-chain, paying gas from the backend's own wallet (same relaying rationale as relayer.service.ts — the proof is already the full authorization). */
export async function submitMatch(proof: `0x${string}`, inputs: MatchProofInputs): Promise<`0x${string}`> {
  const wallet = getWalletClient();
  const txHash = await wallet.writeContract({
    address: CONTRACTS.ShieldedVault as `0x${string}`,
    abi: SHIELDED_VAULT_ABI,
    functionName: "matchOrders",
    args: [proof, inputs.root, inputs.nullifierHashA, inputs.nullifierHashB, inputs.outCommitmentA, inputs.outCommitmentB],
    chain: wallet.chain,
    account: wallet.account!,
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

/** Delivers a matched output note's private data to its trader — same mechanism `pay()` uses, so the same Pay/Receive-page "Incoming" scan discovers it. */
export async function announceMatchedNote(
  order: OrderIntent,
  assetId: bigint,
  amount: bigint,
  blinding: bigint,
  commitment: bigint
): Promise<`0x${string}`> {
  const wallet = getWalletClient();
  const metadata = encodeAbiParameters(METADATA_PARAMS, [assetId, amount, blinding, commitment]);
  const txHash = await wallet.writeContract({
    address: CONTRACTS.StealthAnnouncer as `0x${string}`,
    abi: STEALTH_ANNOUNCER_ABI,
    functionName: "announce",
    args: [OWNER_KEY_NOTE_SCHEME_ID, order.walletAddress as `0x${string}`, "0x", metadata],
    chain: wallet.chain,
    account: wallet.account!,
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}
