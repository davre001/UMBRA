import { Router } from "express";
import { CONTRACTS } from "../shared/chain";
import { submitOrder, listOpenOrders, getMatch, listMatches, submitExternalProof, getMatchProofInputsSerialized } from "./matcher";
import type { MatchRecord } from "./types";

export const darkEngineRouter = Router();

const VAULT = CONTRACTS.ShieldedVault as `0x${string}`;
const MATCH_STATUSES: MatchRecord["status"][] = ["awaiting_proof", "settled"];

/** True once every announcement due for that side (matched note, plus a residual order if a partial fill left one) has gone out. */
function sideFullyAnnounced(record: MatchRecord, side: "A" | "B"): boolean {
  if (side === "A") return record.announcedNoteA && (!record.proofInputs.a.residual || record.announcedResidualA);
  return record.announcedNoteB && (!record.proofInputs.b.residual || record.announcedResidualB);
}

function requireMatcherSecret(req: import("express").Request, res: import("express").Response): boolean {
  const configured = process.env.MATCHER_INTERNAL_SECRET;
  if (!configured) {
    res.status(503).json({ error: "MATCHER_INTERNAL_SECRET not configured on this deployment" });
    return false;
  }
  if (req.header("x-matcher-secret") !== configured) {
    res.status(401).json({ error: "Invalid or missing x-matcher-secret header" });
    return false;
  }
  return true;
}

darkEngineRouter.post("/orders", async (req, res, next) => {
  try {
    const result = await submitOrder(VAULT, req.body ?? {});
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

/** Commitments + timestamps only — never order details, same disclosure boundary Wraith's matcher documents for its own book. */
darkEngineRouter.get("/orders", (_req, res) => {
  res.json({ orders: listOpenOrders() });
});

darkEngineRouter.get("/matches", (req, res) => {
  const status = req.query.status;
  if (status !== undefined && !MATCH_STATUSES.includes(status as MatchRecord["status"])) {
    res.status(400).json({ error: `status must be one of ${MATCH_STATUSES.join(", ")}` });
    return;
  }
  res.json({ matches: listMatches(status as MatchRecord["status"] | undefined) });
});

darkEngineRouter.get("/matches/:id", (req, res) => {
  const match = getMatch(req.params.id);
  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }
  res.json({
    id: match.id,
    status: match.status,
    txHash: match.txHash,
    announcedA: sideFullyAnnounced(match, "A"),
    announcedB: sideFullyAnnounced(match, "B"),
    matchedAt: match.matchedAt,
  });
});

/**
 * Full proof-input details for a pending match — everything a real prover
 * (e.g. the standalone matcher-worker package, run separately from this
 * deployment) needs to generate a real match_orders proof. Exposes private
 * order details, unlike every other route here, so it's gated behind a
 * shared secret rather than left open like the public order-book endpoints.
 */
darkEngineRouter.get("/matches/:id/proof-inputs", (req, res) => {
  if (!requireMatcherSecret(req, res)) return;
  const serialized = getMatchProofInputsSerialized(req.params.id);
  if (!serialized) {
    res.status(404).json({ error: "Match not found" });
    return;
  }
  res.type("application/json").send(serialized);
});

/** Manual completion path when no MatchProver is wired in — accepts a proof produced elsewhere (offline nargo/bb, or a separate proving worker) for an awaiting_proof match. */
darkEngineRouter.post("/matches/:id/proof", async (req, res, next) => {
  try {
    const { proof } = req.body ?? {};
    if (typeof proof !== "string" || !proof.startsWith("0x")) {
      res.status(400).json({ error: "Expected { proof: '0x...' }" });
      return;
    }
    const record = await submitExternalProof(req.params.id, proof as `0x${string}`);
    res.json({
      id: record.id,
      status: record.status,
      txHash: record.txHash,
      announcedA: sideFullyAnnounced(record, "A"),
      announcedB: sideFullyAnnounced(record, "B"),
    });
  } catch (err) {
    next(err);
  }
});
