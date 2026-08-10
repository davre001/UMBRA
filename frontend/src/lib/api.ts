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
  status: "resting" | "matched" | "already_settled";
  matchId?: string;
  matchStatus?: "awaiting_proof" | "settled" | "failed";
}

/**
 * Hands a just-placed order's private preimage to the matcher so it can
 * actually be matched — placeOrder() itself only puts the opaque
 * order_commitment on-chain, the matcher needs the real amounts/assets to
 * find a counterparty (a disclosed trust boundary: the matcher CAN see order
 * details, CANNOT steal funds — see circuits/DESIGN.md).
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

export interface MatcherOrderSummary {
  commitment: string;
  submittedAt: number;
}

/**
 * Every order currently resting on the matcher's book (commitments only —
 * same disclosed trust boundary as the rest of this matcher). The book is
 * in-memory on the backend with no persistence, so an order can silently
 * fall out of it (a backend restart/redeploy, or the matcher being
 * unreachable when it was first submitted) while remaining perfectly valid
 * and unspent on-chain — this is how the Swap page tells which of a
 * wallet's open orders actually still need `submitOrderToMatcher` called
 * again.
 */
export async function fetchMatcherOrders(): Promise<MatcherOrderSummary[]> {
  const res = await fetch(`${API_URL}/api/dark-engine/orders`);
  if (!res.ok) throw new Error(`Fetching the matcher's order book failed: ${res.status}`);
  const body = (await res.json()) as { orders: MatcherOrderSummary[] };
  return body.orders;
}

export interface MatchSummary {
  id: string;
  status: "awaiting_proof" | "settled" | "failed";
  txHash?: `0x${string}`;
  matchedAt: number;
}

/**
 * Every match the matcher has ever recorded, network-wide (no per-wallet
 * filtering — matches don't expose which orders belong to whom, same
 * privacy boundary as the rest of this matcher). Used purely to show that
 * matching genuinely happens: there's otherwise no feedback anywhere in the
 * UI that settlement is real, only your own balance quietly changing.
 */
export async function fetchRecentMatches(): Promise<MatchSummary[]> {
  const res = await fetch(`${API_URL}/api/dark-engine/matches`);
  if (!res.ok) throw new Error(`Fetching recent matches failed: ${res.status}`);
  const body = (await res.json()) as { matches: MatchSummary[] };
  return body.matches;
}

export interface RateResult {
  fromAsset: string;
  toAsset: string;
  rate: number;
}

/**
 * Live FTSOv2-derived rate — units of `toAsset` per unit of `fromAsset`. The
 * same rate the backend's own fill sizing (dark-engine/fillSizing.ts) uses
 * to size a match, surfaced here so a trader can see what a realistic
 * minimum actually looks like before placing an order that can never clear
 * (e.g. asking for double the real rate, which the matcher will silently
 * never fill since it only sizes fills off this same live rate).
 */
export async function fetchRate(fromAsset: string, toAsset: string): Promise<RateResult> {
  const res = await fetch(`${API_URL}/api/pricing/${fromAsset}/${toAsset}`);
  if (!res.ok) throw new Error(`Fetching the live rate failed: ${res.status}`);
  return res.json();
}

export interface ScreenAddressResult {
  address: string;
  clear: boolean;
  txHash: `0x${string}`;
}

/**
 * Screens `address` against the compliance ruleset and records the result
 * on-chain via the backend's ATTESTER_ROLE key — ShieldedVault.withdraw()
 * gates on ComplianceRegistry.isScreened(recipient), so an address that's
 * never been screened (or was previously blocked) needs this called before
 * a withdrawal to it can succeed.
 */
export async function screenAddress(address: string): Promise<ScreenAddressResult> {
  const res = await fetch(`${API_URL}/api/compliance/screen`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Compliance screening failed: ${res.status}`);
  }
  return res.json();
}

export interface BtcDepositSubmitResult {
  id: string;
  status: "awaiting_proof" | "proven" | "failed";
  ownerKey: string;
  amountSats: string;
}

/**
 * Submits a confirmed BTC signet deposit (see contract/circuits/
 * BTC_DEPOSIT_DESIGN.md's fixed OP_RETURN+P2WPKH template) for proving.
 * `blinding` should come from `noteWallet.prepareDepositNote` — same
 * deterministic, recoverable derivation shield() deposits already use —
 * not a throwaway random value, so this note can be recovered later the
 * same way a shielded ERC20 deposit can.
 */
export async function submitBtcDeposit(txid: string, blinding: string): Promise<BtcDepositSubmitResult> {
  const res = await fetch(`${API_URL}/api/btc-deposit/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txid, blinding }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Submitting BTC deposit failed: ${res.status}`);
  }
  return res.json();
}

export interface BtcDepositStatus {
  id: string;
  status: "awaiting_proof" | "proven" | "failed";
  txid: string;
  ownerKey: string;
  amountSats: string;
  /** [checkpointCommitment, noteCommitment, nullifier] — set once status is "proven". */
  publicInputs?: [string, string, string];
  proof?: `0x${string}`;
  failureReason?: string;
}

/** Polls a submitted BTC deposit's proving status — see `frontend/src/app/deposit-btc/page.tsx`'s TanStack Query usage. */
export async function fetchBtcDepositStatus(id: string): Promise<BtcDepositStatus> {
  const res = await fetch(`${API_URL}/api/btc-deposit/${id}`);
  if (!res.ok) throw new Error(`Fetching BTC deposit status failed: ${res.status}`);
  return res.json();
}
