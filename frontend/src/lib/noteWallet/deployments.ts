import coston2 from "./coston2Addresses.json";
import localDev from "./localDevAddresses.json";

export interface AssetConfig {
  assetId: number;
  token: `0x${string}`;
  decimals: number;
}

export interface ChainDeployment {
  chainId: number;
  vault: `0x${string}`;
  compliance: `0x${string}`;
  ownerKeyRegistry?: `0x${string}`;
  stealthAnnouncer?: `0x${string}`;
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
