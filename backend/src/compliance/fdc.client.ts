import { COMPLIANCE_REGISTRY_ABI } from "../shared/complianceRegistryAbi";
import { CONTRACTS, assertTxSuccess, getWalletClient, publicClient } from "../shared/chain";
import { logger } from "../shared/logger";

/**
 * INTERIM TRUST MODEL — matches ComplianceRegistry.sol's own NatSpec: a real
 * deployment verifies each screen result via an FDC attestation proof
 * before recording it on-chain. That verification isn't wired up here
 * either — this is a simple, disclosed placeholder ruleset (not a real AML
 * vendor integration) standing in for it, submitted through the backend's
 * ATTESTER_ROLE key exactly the way a real attestation service would.
 */
const BLOCKLIST = new Set<string>(
  (process.env.COMPLIANCE_BLOCKLIST ?? "").split(",").map((a) => a.trim().toLowerCase()).filter(Boolean)
);

export interface ComplianceScreenResult {
  address: string;
  clear: boolean;
  txHash: `0x${string}`;
}

/** Screens `address` against the placeholder ruleset and records the real result on-chain via ATTESTER_ROLE. */
export async function screenAddress(address: string): Promise<ComplianceScreenResult> {
  const clear = !BLOCKLIST.has(address.toLowerCase());
  logger.info(`[compliance] screening ${address}: ${clear ? "clear" : "BLOCKED"} — recording on-chain`);
  const wallet = getWalletClient();
  const txHash = await wallet.writeContract({
    address: CONTRACTS.ComplianceRegistry as `0x${string}`,
    abi: COMPLIANCE_REGISTRY_ABI,
    functionName: "screen",
    args: [address as `0x${string}`, clear],
    chain: wallet.chain,
    account: wallet.account!,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  assertTxSuccess(receipt);
  logger.info(`[compliance] screen result for ${address} recorded: ${txHash}`);
  return { address, clear, txHash };
}

/** Real on-chain screening status — same read the frontend already does directly, exposed here for server-side callers (e.g. the matcher, before crediting a matched trader). */
export async function isScreened(address: string): Promise<boolean> {
  return publicClient.readContract({
    address: CONTRACTS.ComplianceRegistry as `0x${string}`,
    abi: COMPLIANCE_REGISTRY_ABI,
    functionName: "isScreened",
    args: [address as `0x${string}`],
  });
}
