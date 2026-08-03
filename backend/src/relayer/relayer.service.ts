import { SHIELDED_VAULT_ABI } from "../shared/vaultAbi";
import { CONTRACTS, assertTxSuccess, getWalletClient, publicClient } from "../shared/chain";
import { logger } from "../shared/logger";

/**
 * Real gasless relaying: every ShieldedVault write here is already
 * authorized by its own ZK proof (proof = authorization, see
 * ShieldedVault.sol's NatSpec), not by who calls the function — so this
 * backend wallet can pay gas and submit on a user's behalf without ever
 * needing their signature, an ERC-2771 forwarder, or any pre-signed
 * transaction. `shield` isn't relayable this way (it needs a real
 * `transferFrom` from the depositor), so it isn't in `RELAYABLE_ACTIONS`.
 */
const RELAYABLE_ACTIONS = {
  withdraw: { functionName: "withdraw" as const, argCount: 6 },
  pay: { functionName: "pay" as const, argCount: 5 },
  placeOrder: { functionName: "placeOrder" as const, argCount: 4 },
  cancelOrder: { functionName: "cancelOrder" as const, argCount: 4 },
};

export type RelayableAction = keyof typeof RELAYABLE_ACTIONS;

export function isRelayableAction(action: unknown): action is RelayableAction {
  return typeof action === "string" && action in RELAYABLE_ACTIONS;
}

/** Submits a pre-proven vault action, paying gas from the backend's own wallet. Returns the confirmed tx hash. */
export async function relay(action: RelayableAction, args: unknown[]): Promise<`0x${string}`> {
  const spec = RELAYABLE_ACTIONS[action];
  if (args.length !== spec.argCount) {
    throw new Error(`${action} expects ${spec.argCount} arguments, got ${args.length}`);
  }

  const wallet = getWalletClient();
  logger.info(`[relayer] relaying ${action}() from ${wallet.account!.address}`);
  const txHash = await wallet.writeContract({
    address: CONTRACTS.ShieldedVault as `0x${string}`,
    abi: SHIELDED_VAULT_ABI,
    functionName: spec.functionName,
    args: args as never,
    chain: wallet.chain,
    account: wallet.account!,
  });
  logger.info(`[relayer] ${action}() tx sent: ${txHash} — waiting for confirmation`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  assertTxSuccess(receipt);
  logger.info(`[relayer] ${action}() confirmed: ${txHash}`);
  return txHash;
}
