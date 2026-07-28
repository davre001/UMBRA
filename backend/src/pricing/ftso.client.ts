const MIDPOINT_RATES: Record<string, number> = {
  "USDC/uWFLR": 5,
  "WFLR/USDC": 0.2,
  "USDC/USDT": 1,
};

// Simulates an FTSO midpoint price lookup.
export async function getMidpointRate(
  fromAsset: string,
  toAsset: string
): Promise<number> {
  const key = `${fromAsset}/${toAsset}`;
  if (MIDPOINT_RATES[key]) return MIDPOINT_RATES[key];

  const inverseKey = `${toAsset}/${fromAsset}`;
  if (MIDPOINT_RATES[inverseKey]) return 1 / MIDPOINT_RATES[inverseKey];

  return 1;
}
