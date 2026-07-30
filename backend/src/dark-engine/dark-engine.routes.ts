import { Router } from "express";
import { CONTRACTS } from "../shared/chain";
import { submitOrder, listOpenOrders, getMatch, listMatches, submitExternalProof } from "./matcher";

export const darkEngineRouter = Router();

const VAULT = CONTRACTS.ShieldedVault as `0x${string}`;

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

darkEngineRouter.get("/matches", (_req, res) => {
  res.json({ matches: listMatches() });
});

darkEngineRouter.get("/matches/:id", (req, res) => {
  const match = getMatch(req.params.id);
  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }
  res.json({ id: match.id, status: match.status, txHash: match.txHash, matchedAt: match.matchedAt });
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
    res.json({ id: record.id, status: record.status, txHash: record.txHash });
  } catch (err) {
    next(err);
  }
});
