function randomHex(bytes: number): string {
  let out = "";
  for (let i = 0; i < bytes; i++) {
    out += Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0");
  }
  return out;
}

export async function deriveStealthAddress(): Promise<string> {
  return `st_flare_0x${randomHex(20)}`;
}

export function buildPaymentLink(
  stealthAddress: string,
  asset?: string,
  amount?: string
): string {
  const params = new URLSearchParams();
  if (asset) params.set("asset", asset);
  if (amount) params.set("amount", amount);
  params.set("stealth", stealthAddress);
  return `https://umbra.finance/pay?${params.toString()}`;
}

export async function resolveRecipient(
  recipientType: "ens" | "wallet" | "stealth",
  recipient: string
): Promise<string> {
  if (recipientType === "stealth") return recipient;
  // ENS names and standard wallet addresses resolve to a fresh stealth
  // destination so the payment stays unlinkable on-chain.
  return deriveStealthAddress();
}
