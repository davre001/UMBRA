import { AssetSymbol } from "./types";

export const DEFAULT_PORT = 4000;

export const SUPPORTED_ASSETS: AssetSymbol[] = ["WFLR", "USDC", "USDT"];

export const SANCTION_LISTS = [
  "OFAC Sanctioned Pools",
  "EU Restricted Addresses",
  "Flare Compliance Oracles",
];
