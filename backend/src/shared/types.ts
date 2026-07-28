export type AssetSymbol = "WFLR" | "USDC" | "USDT";

export interface AssetBalance {
  asset: AssetSymbol;
  balance: number;
  valueUsd: number;
}

export interface VaultState {
  address: string;
  publicBalances: AssetBalance[];
  shieldedBalances: AssetBalance[];
  anonymityScore: number;
}

export interface SwapIntent {
  id: string;
  address: string;
  fromAsset: string;
  toAsset: string;
  fromAmount: number;
  toAmount: number;
  slippage: number;
  mevProtection: "maximum" | "auto";
  status: "routing" | "matching" | "settled";
}

export interface ComplianceScreenResult {
  address: string;
  clear: boolean;
  screenedLists: string[];
}

export interface ProofResult {
  proof: string;
  provingTimeMs: number;
}
