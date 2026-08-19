import { keccak256, toBytes } from "viem";
import { SHIELDED_VAULT_ABI } from "../shared/vaultAbi";
import { CONTRACTS, assertTxSuccess, getWalletClient, publicClient } from "../shared/chain";
import { logger } from "../shared/logger";
import { setCurrentCheckpointHeight } from "./checkpoint";

/**
 * Submits a `checkpoint_relay` proof (built by `btc-checkpoint-relay-worker/`)
 * to `ShieldedVault.extendCheckpoint` using this backend's existing operator
 * key (see `shared/chain.ts`) — same reasoning as `btc-deposit/minter.ts`'s
 * own `depositExternal` submission: `extendCheckpoint` itself needs no
 * special role at all (see that function's own NatSpec — "anyone can call
 * this, same as anyone being able to relay a signed meta-transaction"), this
 * backend is just a convenient, already-funded place to submit from rather
 * than requiring a brand-new worker package to hold its own gas key
 * (mirroring how `btc-deposit-worker`/`matcher-worker` never hold keys
 * either — they prove, this backend submits).
 */

const BTC_SIGNET_SOURCE_CHAIN_ID = keccak256(toBytes("BTC_SIGNET"));

export async function submitExtendCheckpoint(
  proof: `0x${string}`,
  newCheckpointCommitment: `0x${string}`,
  newHeight: number
): Promise<`0x${string}`> {
  const wallet = getWalletClient();
  logger.info(`[btc-checkpoint-relay] extending checkpoint to height ${newHeight} (${newCheckpointCommitment})`);
  const txHash = await wallet.writeContract({
    address: CONTRACTS.ShieldedVault as `0x${string}`,
    abi: SHIELDED_VAULT_ABI,
    functionName: "extendCheckpoint",
    args: [BTC_SIGNET_SOURCE_CHAIN_ID, proof, newCheckpointCommitment],
    chain: wallet.chain,
    account: wallet.account!,
  });
  logger.info(`[btc-checkpoint-relay] extend tx sent: ${txHash} — waiting for confirmation`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  assertTxSuccess(receipt);
  setCurrentCheckpointHeight(newHeight);
  logger.info(`[btc-checkpoint-relay] confirmed ${txHash}, tracked height now ${newHeight}`);
  return txHash;
}
