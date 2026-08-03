import { randomUUID } from "crypto";
import { OrderBook } from "./engine";
import { assembleMatchProofInputs, NoProverConfiguredError, UnavailableMatchProver, type MatchProver } from "./prover";
import { submitMatch, announceMatchedNote, announceResidualOrder, type MatchLeafIndices } from "./submitter";
import { computeFill } from "./fillSizing";
import { logger } from "../shared/logger";
import type { OrderIntent, MatchRecord, MatchOrderSide } from "./types";

const CONTRACTS_ASSET_COUNT = 3; // C2FLR / FXRP / USDT0 — see shared/chain.ts's ASSETS

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
    "spendingKey",
    "orderBlinding",
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
  // A freshly-placed order hasn't been filled at all yet — its own amountIn
  // is its original size. Only ever set to something else internally, when
  // re-listing a partial fill's residual (see `relistResidual`).
  const originalAmountIn = o.originalAmountIn ?? o.amountIn!;
  return { ...(o as OrderIntent), originalAmountIn, submittedAt: Date.now() };
}

export interface SubmitOrderResult {
  status: "resting" | "matched";
  matchId?: string;
  matchStatus?: MatchRecord["status"];
}

/**
 * First resting order that's both asset-compatible (engine.ts) and has a
 * real fillable size at the live FTSO rate (fillSizing.ts) — a candidate
 * that passes the first but fails the second is skipped, not rejected
 * outright; it stays on the book for a differently-priced counterparty
 * later, same as an incompatible one would.
 */
async function findFillableMatch(order: OrderIntent): Promise<{ counterparty: OrderIntent; fillA: bigint; fillB: bigint } | null> {
  const candidates = book.findCandidates(order);
  logger.debug(`[dark-engine] ${order.commitment}: ${candidates.length} asset-compatible candidate(s) on the book`);
  for (const candidate of candidates) {
    const fill = await computeFill(order, candidate);
    if (fill) {
      logger.info(
        `[dark-engine] fillable match found: ${order.commitment} x ${candidate.commitment} (fillA=${fill.fillA}, fillB=${fill.fillB})`
      );
      return { counterparty: candidate, fillA: fill.fillA, fillB: fill.fillB };
    }
    logger.warn(`[dark-engine] skipping match ${order.commitment}/${candidate.commitment}: no fillable size at the live rate`);
  }
  return null;
}

/** Submits an order intent, attempting an immediate match against the resting book. Real matching + real commitment assembly; on-chain submission only happens if a real prover is wired in (see prover.ts). */
export async function submitOrder(vaultAddress: `0x${string}`, body: unknown): Promise<SubmitOrderResult> {
  const order = validateOrder(body);
  logger.info(
    `[dark-engine] order submitted: ${order.commitment} (asset ${order.assetIn} -> ${order.assetOut}, amountIn=${order.amountIn}, minOut=${order.minAmountOut})`
  );
  const found = await findFillableMatch(order);
  if (!found) {
    book.rest(order);
    logger.info(`[dark-engine] ${order.commitment}: no fillable counterparty right now — resting on the book`);
    return { status: "resting" };
  }
  const { counterparty, fillA, fillB } = found;
  book.remove(counterparty.commitment);

  const matchId = randomUUID();
  const proofInputs = await assembleMatchProofInputs(vaultAddress, order, counterparty, fillA, fillB);
  const record: MatchRecord = {
    id: matchId,
    orderA: order,
    orderB: counterparty,
    proofInputs,
    status: "awaiting_proof",
    announcedNoteA: false,
    announcedResidualA: false,
    announcedNoteB: false,
    announcedResidualB: false,
    matchedAt: Date.now(),
  };
  matches.set(matchId, record);
  logger.info(`[dark-engine] match ${matchId} assembled (${order.commitment} x ${counterparty.commitment}) — attempting immediate completion`);

  try {
    await completeMatch(matchId);
  } catch (err) {
    if (err instanceof NoProverConfiguredError) {
      // Expected on this deployment — the match stays recorded as
      // awaiting_proof for the matcher-worker to pick up later; see
      // prover.ts. Logged at info, not warn/error, because that's the
      // normal path here, not a fault.
      logger.info(`[dark-engine] match ${matchId} left awaiting_proof: ${err.message}`);
    } else {
      // Anything else (e.g. matchOrders() itself reverting on-chain) is a
      // real failure, not the routine "no prover yet" case above — the
      // match correctly stays awaiting_proof (submitMatch throws before
      // settleOnChain ever marks it settled), but this deserves attention.
      logger.warn(`[dark-engine] match ${matchId} failed unexpectedly, left awaiting_proof: ${err instanceof Error ? err.message : err}`);
    }
  }

  const current = matches.get(matchId)!;
  logger.info(`[dark-engine] match ${matchId} status after submission: ${current.status}`);
  return { status: "matched", matchId, matchStatus: current.status };
}

function hexOf(value: bigint): string {
  return "0x" + value.toString(16);
}

/**
 * Re-lists a partial fill's leftover on the book with a real, on-chain
 * leafIndex, so it's immediately matchable again — same trader (same
 * spendingKey/ownerKey/walletAddress), smaller amountIn, pro-rata-scaled
 * minAmountOut. `originalAmountIn` carries through unchanged so the
 * trader's own wallet can still show "X / original filled" once they claim
 * it via the announcement `deliverAnnouncements` also sends.
 */
function relistResidual(original: OrderIntent, side: MatchOrderSide, leafIndex: number): void {
  if (!side.residual) return;
  logger.info(
    `[dark-engine] relisting residual for ${original.commitment}: amountIn=${side.residual.amountIn} at leaf ${leafIndex}`
  );
  book.rest({
    commitment: hexOf(side.residual.commitment),
    leafIndex,
    spendingKey: original.spendingKey,
    orderBlinding: side.residualBlinding.toString(),
    amountIn: side.residual.amountIn.toString(),
    assetIn: original.assetIn,
    assetOut: original.assetOut,
    minAmountOut: side.residual.minAmountOut.toString(),
    ownerKey: original.ownerKey,
    walletAddress: original.walletAddress,
    originalAmountIn: original.originalAmountIn,
    submittedAt: Date.now(),
  });
}

/** Submits a proven match on-chain and transitions it to `settled` — only ever runs once per match (both callers guard on `status === "awaiting_proof"` first). Re-lists any residuals onto the book immediately, before announcing, so they're matchable right away rather than waiting on the trader to notice and reclaim them. */
async function settleOnChain(record: MatchRecord, proof: `0x${string}`): Promise<void> {
  const { txHash, leafIndices } = await submitMatch(proof, record.proofInputs);
  record.status = "settled";
  record.txHash = txHash;
  logger.info(`[dark-engine] match ${record.id} settled on-chain: ${txHash}`);
  relistResidualsFor(record, leafIndices);
}

function relistResidualsFor(record: MatchRecord, leafIndices: MatchLeafIndices): void {
  if (leafIndices.residualA !== undefined) relistResidual(record.orderA, record.proofInputs.a, leafIndices.residualA);
  if (leafIndices.residualB !== undefined) relistResidual(record.orderB, record.proofInputs.b, leafIndices.residualB);
}

/**
 * Announces whichever deliveries for a settled match haven't gone out yet —
 * idempotent and safe to call repeatedly (e.g. on retry after a partial
 * failure). Each side needs its matched-proceeds note announced always,
 * plus a residual order announced if that side wasn't fully filled.
 * Sequenced, not concurrent: every announcement here comes from the same
 * operator wallet, and firing them via Promise.all races them for the same
 * nonce (confirmed the hard way — see session notes).
 */
async function deliverAnnouncements(record: MatchRecord): Promise<void> {
  logger.info(`[dark-engine] match ${record.id}: delivering pending announcements`);
  if (!record.announcedNoteA) {
    await announceMatchedNote(
      record.orderA,
      BigInt(record.orderB.assetIn),
      record.proofInputs.fillB,
      record.proofInputs.a.outBlinding,
      record.proofInputs.outCommitmentA
    );
    record.announcedNoteA = true;
  }
  if (record.proofInputs.a.residual && !record.announcedResidualA) {
    await announceResidualOrder(record.orderA, record.proofInputs.a.residual, record.proofInputs.a.residualBlinding);
    record.announcedResidualA = true;
  }
  if (!record.announcedNoteB) {
    await announceMatchedNote(
      record.orderB,
      BigInt(record.orderA.assetIn),
      record.proofInputs.fillA,
      record.proofInputs.b.outBlinding,
      record.proofInputs.outCommitmentB
    );
    record.announcedNoteB = true;
  }
  if (record.proofInputs.b.residual && !record.announcedResidualB) {
    await announceResidualOrder(record.orderB, record.proofInputs.b.residual, record.proofInputs.b.residualBlinding);
    record.announcedResidualB = true;
  }
}

/** Attempts to prove (via the currently-wired prover) and submit a pending match, then delivers every side's announcement(s) via StealthAnnouncer. */
export async function completeMatch(matchId: string): Promise<MatchRecord> {
  const record = matches.get(matchId);
  if (!record) throw new Error(`No such match: ${matchId}`);

  if (record.status === "awaiting_proof") {
    logger.info(`[dark-engine] match ${matchId}: requesting proof from the wired MatchProver`);
    const proof = await prover.proveMatch(record.proofInputs);
    // Settlement is real and final the instant the on-chain call confirms,
    // inside settleOnChain — regardless of whether announcing succeeds next.
    await settleOnChain(record, proof);
  }

  await deliverAnnouncements(record);
  return record;
}

/** Accepts an externally-generated proof (e.g. produced offline by nargo/bb, or by a separate proving worker) for a pending match, then submits + announces it — the manual completion path for `UnavailableMatchProver`. Also the retry path for a settled match whose announcements previously failed (submitMatch is skipped once already settled). */
export async function submitExternalProof(matchId: string, proof: `0x${string}`): Promise<MatchRecord> {
  const record = matches.get(matchId);
  if (!record) throw new Error(`No such match: ${matchId}`);
  logger.info(`[dark-engine] external proof received for match ${matchId} (current status: ${record.status})`);

  if (record.status === "awaiting_proof") {
    await settleOnChain(record, proof);
  }

  await deliverAnnouncements(record);
  return record;
}

export function listOpenOrders() {
  return book.list();
}

export function getMatch(matchId: string): MatchRecord | undefined {
  return matches.get(matchId);
}

export function listMatches(status?: MatchRecord["status"]): { id: string; status: MatchRecord["status"]; txHash?: `0x${string}`; matchedAt: number }[] {
  return [...matches.values()]
    .filter((m) => !status || m.status === status)
    .map((m) => ({ id: m.id, status: m.status, txHash: m.txHash, matchedAt: m.matchedAt }));
}

function bigintReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

/**
 * Full proof-input details for a pending match, serialized (bigints as
 * decimal strings) — everything a real prover needs to actually run the
 * match_orders circuit. Same trust boundary as the matcher itself already
 * has (it already holds both traders' order preimages in memory to get this
 * far — see prover.ts's own disclosure) — gated by a shared secret since,
 * unlike the public order-book/match-status endpoints, this exposes private
 * order details, not just commitments.
 */
export function getMatchProofInputsSerialized(matchId: string): string | undefined {
  const record = matches.get(matchId);
  if (!record) return undefined;
  return JSON.stringify(record.proofInputs, bigintReplacer);
}
