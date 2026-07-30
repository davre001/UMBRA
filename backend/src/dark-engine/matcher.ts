import { randomUUID } from "crypto";
import { OrderBook } from "./engine";
import { assembleMatchProofInputs, UnavailableMatchProver, type MatchProver } from "./prover";
import { submitMatch, announceMatchedNote } from "./submitter";
import type { OrderIntent, MatchRecord } from "./types";

const CONTRACTS_ASSET_COUNT = 3; // WFLR / FXRP / USDT0 — see shared/chain.ts's ASSETS

const book = new OrderBook();
const matches = new Map<string, MatchRecord>();

// Swappable so a future deployment with real proving capacity can wire one
// in without touching the rest of this file — see prover.ts's own comment.
let prover: MatchProver = new UnavailableMatchProver();
export function setMatchProver(next: MatchProver): void {
  prover = next;
}

function validateOrder(body: unknown): OrderIntent {
  const o = body as Partial<OrderIntent>;
  const required: (keyof OrderIntent)[] = [
    "commitment",
    "leafIndex",
    "nullifier",
    "secret",
    "amountIn",
    "assetIn",
    "assetOut",
    "minAmountOut",
    "ownerKey",
    "walletAddress",
  ];
  for (const key of required) {
    if (o[key] === undefined || o[key] === null) throw new Error(`Missing field: ${key}`);
  }
  if (typeof o.assetIn !== "number" || o.assetIn < 0 || o.assetIn >= CONTRACTS_ASSET_COUNT) {
    throw new Error(`Invalid assetIn: ${o.assetIn}`);
  }
  if (typeof o.assetOut !== "number" || o.assetOut < 0 || o.assetOut >= CONTRACTS_ASSET_COUNT) {
    throw new Error(`Invalid assetOut: ${o.assetOut}`);
  }
  if (typeof o.leafIndex !== "number" || o.leafIndex < 0) {
    throw new Error(`Invalid leafIndex: ${o.leafIndex}`);
  }
  return { ...(o as OrderIntent), submittedAt: Date.now() };
}

export interface SubmitOrderResult {
  status: "resting" | "matched";
  matchId?: string;
  matchStatus?: MatchRecord["status"];
}

/** Submits an order intent, attempting an immediate match against the resting book. Real matching + real commitment assembly; on-chain submission only happens if a real prover is wired in (see prover.ts). */
export async function submitOrder(vaultAddress: `0x${string}`, body: unknown): Promise<SubmitOrderResult> {
  const order = validateOrder(body);
  const counterparty = book.submit(order);
  if (!counterparty) return { status: "resting" };

  const matchId = randomUUID();
  const proofInputs = await assembleMatchProofInputs(vaultAddress, order, counterparty);
  const record: MatchRecord = { id: matchId, orderA: order, orderB: counterparty, proofInputs, status: "awaiting_proof", matchedAt: Date.now() };
  matches.set(matchId, record);

  try {
    await completeMatch(matchId);
  } catch {
    // Expected when no real prover is wired in (UnavailableMatchProver) —
    // the match stays recorded as awaiting_proof; see prover.ts.
  }

  const current = matches.get(matchId)!;
  return { status: "matched", matchId, matchStatus: current.status };
}

/** Attempts to prove (via the currently-wired prover) and submit a pending match, then delivers both output notes via StealthAnnouncer. */
export async function completeMatch(matchId: string): Promise<MatchRecord> {
  const record = matches.get(matchId);
  if (!record) throw new Error(`No such match: ${matchId}`);
  if (record.status === "submitted") return record;

  const proof = await prover.proveMatch(record.proofInputs);
  const txHash = await submitMatch(proof, record.proofInputs);

  await Promise.all([
    announceMatchedNote(
      record.orderA,
      BigInt(record.orderB.assetIn),
      BigInt(record.orderB.amountIn),
      record.proofInputs.a.outBlinding,
      record.proofInputs.outCommitmentA
    ),
    announceMatchedNote(
      record.orderB,
      BigInt(record.orderA.assetIn),
      BigInt(record.orderA.amountIn),
      record.proofInputs.b.outBlinding,
      record.proofInputs.outCommitmentB
    ),
  ]);

  record.status = "submitted";
  record.txHash = txHash;
  return record;
}

/** Accepts an externally-generated proof (e.g. produced offline by nargo/bb, or by a separate proving worker) for a pending match, then submits + announces it — the manual completion path for `UnavailableMatchProver`. */
export async function submitExternalProof(matchId: string, proof: `0x${string}`): Promise<MatchRecord> {
  const record = matches.get(matchId);
  if (!record) throw new Error(`No such match: ${matchId}`);
  if (record.status === "submitted") return record;

  const txHash = await submitMatch(proof, record.proofInputs);
  await Promise.all([
    announceMatchedNote(
      record.orderA,
      BigInt(record.orderB.assetIn),
      BigInt(record.orderB.amountIn),
      record.proofInputs.a.outBlinding,
      record.proofInputs.outCommitmentA
    ),
    announceMatchedNote(
      record.orderB,
      BigInt(record.orderA.assetIn),
      BigInt(record.orderA.amountIn),
      record.proofInputs.b.outBlinding,
      record.proofInputs.outCommitmentB
    ),
  ]);
  record.status = "submitted";
  record.txHash = txHash;
  return record;
}

export function listOpenOrders() {
  return book.list();
}

export function getMatch(matchId: string): MatchRecord | undefined {
  return matches.get(matchId);
}

export function listMatches(): { id: string; status: MatchRecord["status"]; txHash?: `0x${string}`; matchedAt: number }[] {
  return [...matches.values()].map((m) => ({ id: m.id, status: m.status, txHash: m.txHash, matchedAt: m.matchedAt }));
}
