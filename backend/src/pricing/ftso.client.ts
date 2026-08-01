import { publicClient, type AssetSymbol } from "../shared/chain";
import { logger } from "../shared/logger";

const FTSO_V2 = "0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d" as const;

const FTSO_V2_ABI = [
  {
    inputs: [{ name: "_feedId", type: "bytes21" }],
    name: "getFeedById",
    outputs: [
      { name: "_value", type: "uint256" },
      { name: "_decimals", type: "int8" },
      { name: "_timestamp", type: "uint64" },
    ],
    // Declared `payable` on-chain (FtsoV2 can charge a fee in some configs),
    // but we only ever `eth_call` it with zero value — typed `view` here so
    // viem's readContract accepts it; doesn't change on-chain behavior.
    stateMutability: "view",
    type: "function",
  },
] as const;

/**
 * Real block-latency feed IDs (category 0x01 = Crypto, then the feed name
 * ASCII-encoded, zero-padded to 21 bytes) — confirmed live against FtsoV2 on
 * Coston2 (not assumed from the encoding scheme alone), see PR history.
 * USDT0 uses the USDT/USD feed — same peg, no separate USDT0 feed exists.
 * The on-chain feed itself is named "FLR/USD" — it prices the native asset
 * directly, which is exactly what `C2FLR` (assetId 0, held natively — see
 * ShieldedVault.sol's nativeAssetId) actually is.
 */
const FEED_IDS: Record<AssetSymbol, `0x${string}`> = {
  C2FLR: "0x01464c522f55534400000000000000000000000000",
  FXRP: "0x015852502f55534400000000000000000000000000",
  USDT0: "0x01555344542f555344000000000000000000000000",
};

export interface UsdPrice {
  value: number;
  decimals: number;
  timestampMs: number;
}

async function getUsdPrice(asset: AssetSymbol): Promise<UsdPrice> {
  try {
    const [value, decimals, timestamp] = await publicClient.readContract({
      address: FTSO_V2,
      abi: FTSO_V2_ABI,
      functionName: "getFeedById",
      args: [FEED_IDS[asset]],
    });
    return { value: Number(value) / 10 ** decimals, decimals, timestampMs: Number(timestamp) * 1000 };
  } catch (err) {
    logger.error(`[pricing] FTSOv2 feed read failed for ${asset}: ${err instanceof Error ? err.message : err}`);
    throw err;
  }
}

/** Real FTSOv2 midpoint cross-rate: 1 unit of `fromAsset` in units of `toAsset`, via each side's USD feed. */
export async function getMidpointRate(fromAsset: string, toAsset: string): Promise<number> {
  if (!(fromAsset in FEED_IDS) || !(toAsset in FEED_IDS)) {
    throw new Error(`Unsupported asset pair: ${fromAsset}/${toAsset}`);
  }
  const [from, to] = await Promise.all([
    getUsdPrice(fromAsset as AssetSymbol),
    getUsdPrice(toAsset as AssetSymbol),
  ]);
  return from.value / to.value;
}

export async function getAllUsdPrices(): Promise<Record<AssetSymbol, UsdPrice>> {
  const symbols = Object.keys(FEED_IDS) as AssetSymbol[];
  const prices = await Promise.all(symbols.map((s) => getUsdPrice(s)));
  return Object.fromEntries(symbols.map((s, i) => [s, prices[i]])) as Record<AssetSymbol, UsdPrice>;
}
