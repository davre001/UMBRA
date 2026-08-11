import { Router, Request, Response } from "express";
import { logger } from "../shared/logger";
import { assembleDepositProofInputs, parseDepositTx, stripWitness } from "./mempool";
import { getCurrentCheckpointHeight, setCurrentCheckpointHeight } from "./checkpoint";
import * as store from "./store";

export const btcDepositRouter = Router();

function requireBtcDepositSecret(req: Request, res: Response): boolean {
  const configured = process.env.BTC_DEPOSIT_INTERNAL_SECRET;
  if (!configured) {
    logger.error("[btc-deposit] rejecting worker request: BTC_DEPOSIT_INTERNAL_SECRET not configured on this deployment");
    res.status(503).json({ error: "BTC_DEPOSIT_INTERNAL_SECRET not configured on this deployment" });
    return false;
  }
  if (req.header("x-btc-deposit-secret") !== configured) {
    logger.warn(`[btc-deposit] rejecting request to ${req.originalUrl}: invalid or missing x-btc-deposit-secret header`);
    res.status(401).json({ error: "Invalid or missing x-btc-deposit-secret header" });
    return false;
  }
  return true;
}

btcDepositRouter.get("/checkpoint", (_req, res) => {
  res.json({ checkpointHeight: getCurrentCheckpointHeight() ?? null });
});

/** Called by scripts/refresh-btc-checkpoint.ts right after it registers a new checkpoint on-chain — keeps this backend's tracked height in sync with what's actually live (see checkpoint.ts's own doc for why this can't be inferred). */
btcDepositRouter.post("/checkpoint", (req, res) => {
  if (!requireBtcDepositSecret(req, res)) return;
  const { height } = req.body ?? {};
  if (typeof height !== "number" || !Number.isInteger(height) || height < 0) {
    res.status(400).json({ error: "Expected { height: <non-negative integer> }" });
    return;
  }
  setCurrentCheckpointHeight(height);
  res.json({ checkpointHeight: height });
});

/**
 * Submits a confirmed BTC deposit for proving. Only does the lightweight
 * validation (fetch + parse the transaction itself against btc_deposit's
 * fixed template) up front — the heavier header-chain + Merkle-proof fetch
 * is deferred to /proof-inputs below, run once by the worker that actually
 * needs it, rather than duplicated here just to validate a submission.
 */
btcDepositRouter.post("/submit", async (req, res, next) => {
  try {
    const { txid, blinding } = req.body ?? {};
    if (typeof txid !== "string" || !/^[0-9a-f]{64}$/i.test(txid)) {
      res.status(400).json({ error: "Expected { txid: <64-char hex txid>, blinding: <decimal string> }" });
      return;
    }
    if (typeof blinding !== "string" || blinding.length === 0) {
      res.status(400).json({ error: "Expected { txid: <64-char hex txid>, blinding: <decimal string> }" });
      return;
    }
    const checkpointHeight = getCurrentCheckpointHeight();
    if (checkpointHeight === undefined) {
      res.status(503).json({ error: "No BTC checkpoint registered yet on this deployment — try again once one is set" });
      return;
    }

    const rawHexRes = await fetch(`https://mempool.space/signet/api/tx/${txid}/hex`);
    if (!rawHexRes.ok) {
      res.status(404).json({ error: `Could not fetch ${txid} from mempool.space (HTTP ${rawHexRes.status})` });
      return;
    }
    const tx = stripWitness((await rawHexRes.text()).trim());
    const { ownerKey, amountSats } = parseDepositTx(tx);

    const record = store.createRecord({
      txid,
      checkpointHeight,
      ownerKey: ownerKey.toString(),
      amountSats: amountSats.toString(),
      blinding,
    });
    res.status(201).json({ id: record.id, status: record.status, ownerKey: record.ownerKey, amountSats: record.amountSats });
  } catch (err) {
    next(err);
  }
});

/** Commitments + statuses only, same public/no-secret shape as dark-engine's own GET /matches — the proving worker uses this to discover pending work. Only ever lists awaiting_proof (no store.listAll() exists — nothing else needs listing yet). */
btcDepositRouter.get("/", (req, res) => {
  if (req.query.status !== undefined && req.query.status !== "awaiting_proof") {
    res.status(400).json({ error: "status, if given, must be 'awaiting_proof'" });
    return;
  }
  const deposits = store.listAwaitingProof();
  res.json({ deposits: deposits.map((d) => ({ id: d.id, status: d.status, txid: d.txid, submittedAt: d.submittedAt })) });
});

btcDepositRouter.get("/:id", (req, res) => {
  const record = store.getRecord(req.params.id);
  if (!record) {
    res.status(404).json({ error: "Deposit not found" });
    return;
  }
  res.json({
    id: record.id,
    status: record.status,
    txid: record.txid,
    ownerKey: record.ownerKey,
    amountSats: record.amountSats,
    proof: record.proof,
    publicInputs: record.publicInputs,
    failureReason: record.failureReason,
  });
});

/** Full circuit-input assembly for a pending deposit — real header chain + real Merkle proof, fetched fresh here (see mempool.ts). Exposes the private `blinding` witness alongside them, unlike the public status route, so it's gated the same way dark-engine's own /proof-inputs route is. */
btcDepositRouter.get("/:id/proof-inputs", async (req, res, next) => {
  if (!requireBtcDepositSecret(req, res)) return;
  try {
    const record = store.getRecord(req.params.id);
    if (!record) {
      res.status(404).json({ error: "Deposit not found" });
      return;
    }
    if (record.status !== "awaiting_proof") {
      res.status(409).json({ error: `Deposit ${record.id} is ${record.status}, not awaiting_proof` });
      return;
    }
    const circuitInputs = await assembleDepositProofInputs(record.txid, record.checkpointHeight);
    res.json({ id: record.id, blinding: record.blinding, ...circuitInputs });
  } catch (err) {
    next(err);
  }
});

/** Worker submits the completed proof here. Manual/offline completion also works the same way (e.g. a proof produced by hand via nargo/bb) — same shape as dark-engine's own POST /matches/:id/proof. */
btcDepositRouter.post("/:id/proof", (req, res) => {
  if (!requireBtcDepositSecret(req, res)) return;
  const { proof, publicInputs } = req.body ?? {};
  if (typeof proof !== "string" || !proof.startsWith("0x")) {
    res.status(400).json({ error: "Expected { proof: '0x...', publicInputs: [checkpointCommitment, noteCommitment, nullifier] }" });
    return;
  }
  if (!Array.isArray(publicInputs) || publicInputs.length !== 3 || !publicInputs.every((p) => typeof p === "string")) {
    res.status(400).json({ error: "Expected { proof: '0x...', publicInputs: [checkpointCommitment, noteCommitment, nullifier] }" });
    return;
  }
  const record = store.markProven(req.params.id, proof as `0x${string}`, publicInputs as [string, string, string]);
  if (!record) {
    res.status(404).json({ error: "Deposit not found" });
    return;
  }
  res.json({ id: record.id, status: record.status });
});

/** Worker reports a proving failure here (e.g. checkpoint moved on, template mismatch discovered late) so the frontend's poll stops showing "awaiting_proof" forever. */
btcDepositRouter.post("/:id/fail", (req, res) => {
  if (!requireBtcDepositSecret(req, res)) return;
  const { reason } = req.body ?? {};
  const record = store.markFailed(req.params.id, typeof reason === "string" ? reason : "unknown");
  if (!record) {
    res.status(404).json({ error: "Deposit not found" });
    return;
  }
  res.json({ id: record.id, status: record.status });
});
