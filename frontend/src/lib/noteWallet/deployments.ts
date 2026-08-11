import coston2 from "./coston2Addresses.json";
import localDev from "./localDevAddresses.json";

export interface AssetConfig {
  assetId: number;
  /** Native assets (see `native`) have no token contract — shield()/withdraw() hold/pay them directly. */
  token?: `0x${string}`;
  decimals: number;
  /** True for the one asset (C2FLR) that shield()/withdraw() treat as native value instead of an ERC20. */
  native?: boolean;
  /** True for an isExternalSourceAsset (currently: BTC) — no EVM token contract and no public wallet balance to query at all; the asset only ever exists as a shielded note (minted via depositExternal, paid out via withdraw()'s ExternalWithdrawalRequested branch). Pages must skip their usual balanceOf/getBalance public-balance query for these. */
  external?: boolean;
}

export interface ChainDeployment {
  chainId: number;
  vault: `0x${string}`;
  compliance: `0x${string}`;
  ownerKeyRegistry?: `0x${string}`;
  stealthAnnouncer?: `0x${string}`;
  /** Optional — "Unshield All" batches N withdraw() calls into one signature through this when set, falling back to one signature per note otherwise. */
  batchWithdrawer?: `0x${string}`;
  /** Optional — lets Pay/Swap encrypt announce() metadata and (Pay only) derive a one-time stealthAddress when set; falls back to the legacy plaintext/real-address behavior otherwise. See PrivacyKeyRegistry.sol. */
  privacyKeyRegistry?: `0x${string}`;
  /** Optional — the deployed BtcDepositHonkVerifier, passed as depositExternal's `verifier` argument (see ShieldedVault.sol — it's a per-call parameter, not a fixed immutable, so a future chain's verifier doesn't need a new entrypoint). Unset until BTC deposits are actually live on this chain — see contract/circuits/BTC_DEPOSIT_DESIGN.md. */
  btcDepositVerifier?: `0x${string}`;
  /** The real signet P2WPKH pubkey hash (hash160, 20 bytes hex, no 0x prefix) deposit transactions must pay — must match bitcoin.nr's VAULT_PUBKEY_HASH and backend's BTC_VAULT_PUBKEY_HASH exactly, or every deposit tx a depositor builds gets silently rejected by parseDepositTx. */
  btcVaultPubkeyHash?: string;
  /** Block the vault was deployed at — bounds event scans (scan.ts, announcer.ts) so they don't needlessly scan pre-deployment history. */
  deployBlock?: number;
  assets: Record<string, AssetConfig>;
}

const DEPLOYMENTS: Record<number, ChainDeployment> = {
  [coston2.chainId]: coston2 as ChainDeployment,
  [localDev.chainId]: localDev as ChainDeployment,
};

/** Vault/asset addresses for a connected chain, or undefined if Umbra isn't deployed there. */
export function getDeployment(chainId: number | undefined): ChainDeployment | undefined {
  if (chainId === undefined) return undefined;
  return DEPLOYMENTS[chainId];
}
