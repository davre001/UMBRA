// Thin client for the backend's dark-engine matcher (backend/src/dark-engine)
// — the only backend endpoint the frontend actually calls itself; everything
// else (proving, submitting transactions) happens client-side or is relayed
// directly to the chain. See NEXT_PUBLIC_API_URL in .env.example.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface OrderIntentBody {
  commitment: string;
  leafIndex: number;
  spendingKey: string;
  orderBlinding: string;
  amountIn: string;
  assetIn: number;
  assetOut: number;
  minAmountOut: string;
  ownerKey: string;
  walletAddress: string;
}

export interface SubmitOrderResult {
  status: "resting" | "matched";
  matchId?: string;
  matchStatus?: "awaiting_proof" | "settled";
}

/**
 * Hands a just-placed order's private preimage to the matcher so it can
 * actually be matched — placeOrder() itself only puts the opaque
 * order_commitment on-chain, the matcher needs the real amounts/assets to
 * find a counterparty (same disclosure Wraith's own matcher documents: it
 * CAN see order details, CANNOT steal funds — see circuits/DESIGN.md).
 */
export async function submitOrderToMatcher(order: OrderIntentBody): Promise<SubmitOrderResult> {
  const res = await fetch(`${API_URL}/api/dark-engine/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(order),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Submitting order to matcher failed: ${res.status}`);
  }
  return res.json();
}
