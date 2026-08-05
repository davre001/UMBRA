import { createPublicClient, createWalletClient, http, type TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { flareTestnet } from "viem/chains";
import deployment from "./coston2Deployment.json";

/**
 * Every backend service that touches the chain (compliance attester,
 * relayer, dark-engine matcher) shares one operator key on purpose — this
 * is a testnet setup with a single funded deployer wallet, not a
 * production trust model. A real deployment would give each service its
 * own minimally-privileged key (the attester only needs ATTESTER_ROLE, the
 * relayer/matcher need none — every vault action they submit is already
 * authorized by its own ZK proof, not by who calls the function).
 */
function requireOperatorKey(): `0x${string}` {
  const key = process.env.PRIVATE_KEY;
  if (!key) throw new Error("PRIVATE_KEY not set — see backend/.env.example");
  return key.startsWith("0x") ? (key as `0x${string}`) : (`0x${key}` as `0x${string}`);
}

export const publicClient = createPublicClient({
  chain: flareTestnet,
  transport: http(deployment.rpcUrl),
});

let walletClientSingleton: ReturnType<typeof createWalletClient> | null = null;

export function getWalletClient() {
  if (!walletClientSingleton) {
    const account = privateKeyToAccount(requireOperatorKey());
    walletClientSingleton = createWalletClient({
      account,
      chain: flareTestnet,
      transport: http(deployment.rpcUrl),
    });
  }
  return walletClientSingleton;
}

export const CONTRACTS = deployment.contracts;
export const ASSETS = deployment.assets;
export const DEPLOY_BLOCK = BigInt(deployment.deployBlock);

export type AssetSymbol = keyof typeof ASSETS;

export function assetById(assetId: number | bigint) {
  const id = Number(assetId);
  const entry = Object.entries(ASSETS).find(([, a]) => a.assetId === id);
  if (!entry) throw new Error(`Unknown assetId: ${assetId}`);
  return { symbol: entry[0] as AssetSymbol, ...entry[1] };
}

/** waitForTransactionReceipt resolves on a reverted tx too — it only rejects for things like a timeout, never for on-chain failure. Every backend service submitting a real transaction (compliance attester, relayer, dark-engine matcher) must check `status` itself, which is what this centralizes. */
export function assertTxSuccess(receipt: TransactionReceipt): void {
  if (receipt.status !== "success") {
    throw new Error(`Transaction reverted on-chain (${receipt.transactionHash}).`);
  }
}
