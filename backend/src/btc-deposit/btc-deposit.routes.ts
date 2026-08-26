import { Router, Request, Response } from "express";
import { logger } from "../shared/logger";
import { assembleDepositProofInputs, mempoolGet, parseDepositTx, stripWitness, SIGNET_API_BASES } from "./mempool";
import { getCurrentCheckpointHeight, setCurrentCheckpointHeight } from "./checkpoint";
import { submitExtendCheckpoint } from "./checkpoint-relay";
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

/** Called right after something registers a new checkpoint on-chain — contract/scripts/initialize-btc-checkpoint.ts for the one-time genesis, btc-checkpoint-relay-worker/ for every extendCheckpoint advance after that — keeps this backend's tracked height in sync with what's actually live (see checkpoint.ts's own doc for why this can't be inferred). */
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
 * Submits a real `checkpoint_relay` proof (see
 * `contract/circuits/noir/checkpoint_relay`) and, if it verifies on-chain,
 * advances `checkpoints[BTC_SIGNET_SOURCE_CHAIN_ID]` — `btc-checkpoint-relay-worker/`'s
 * own poll loop calls this once it's built a proof extending the currently
 * on-chain checkpoint by K real signet headers. Secret-gated purely to keep
 * this off public traffic and avoid random wasted gas from malformed
 * requests, not because the underlying `extendCheckpoint` call itself needs
 * any special permission — anyone could call it directly (see that
 * function's own NatSpec).
 */
btcDepositRouter.post("/checkpoint/extend", async (req, res, next) => {
  if (!requireBtcDepositSecret(req, res)) return;
  try {
    const { proof, newCheckpointCommitment, newHeight } = req.body ?? {};
    if (typeof proof !== "string" || !proof.startsWith("0x")) {
      res.status(400).json({ error: "Expected { proof: '0x...', newCheckpointCommitment: '0x...', newHeight: <non-negative integer> }" });
      return;
    }
    if (typeof newCheckpointCommitment !== "string" || !newCheckpointCommitment.startsWith("0x")) {
      res.status(400).json({ error: "Expected { proof: '0x...', newCheckpointCommitment: '0x...', newHeight: <non-negative integer> }" });
      return;
    }
    if (typeof newHeight !== "number" || !Number.isInteger(newHeight) || newHeight < 0) {
      res.status(400).json({ error: "Expected { proof: '0x...', newCheckpointCommitment: '0x...', newHeight: <non-negative integer> }" });
      return;
    }
    const txHash = await submitExtendCheckpoint(proof as `0x${string}`, newCheckpointCommitment as `0x${string}`, newHeight);
    res.json({ txHash, checkpointHeight: newHeight });
  } catch (err) {
    next(err);
  }
});

/**
 * Submits a confirmed BTC deposit for proving. Only does the lightweight
 * validation (fetch + parse the transaction itself against btc_deposit's
 * fixed template) up front — the heavier header-chain + Merkle-proof fetch
 * is deferred to /proof-inputs below, run once by the worker that actually
 * needs it, rather than duplicated here just to validate a submission.
 * `recipient` is read straight off the transaction itself (the OP_RETURN
 * output the depositor's own build-tx step encoded) — nothing secret to
 * submit alongside `txid` anymore, unlike the old private-note design.
 */
btcDepositRouter.post("/submit", async (req, res, next) => {
  try {
    const { txid } = req.body ?? {};
    if (typeof txid !== "string" || !/^[0-9a-f]{64}$/i.test(txid)) {
      res.status(400).json({ error: "Expected { txid: <64-char hex txid> }" });
      return;
    }
    const checkpointHeight = getCurrentCheckpointHeight();
    if (checkpointHeight === undefined) {
      res.status(503).json({ error: "No BTC checkpoint registered yet on this deployment — try again once one is set" });
      return;
    }

    let rawTxHex: string;
    try {
      rawTxHex = (await mempoolGet(`/tx/${txid}/hex`)).trim();
    } catch (err) {
      res.status(404).json({
        error: `Could not fetch ${txid} from any signet data source (tried ${SIGNET_API_BASES.join(", ")}): ${err instanceof Error ? err.message : err}`,
      });
      return;
    }
    const tx = stripWitness(rawTxHex);
    const { recipient, amountSats } = parseDepositTx(tx);

    const record = store.createRecord({
      txid,
      checkpointHeight,
      recipient,
      amountSats: amountSats.toString(),
    });
    res.status(201).json({ id: record.id, status: record.status, recipient: record.recipient, amountSats: record.amountSats });
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
    recipient: record.recipient,
    amountSats: record.amountSats,
    proof: record.proof,
    publicInputs: record.publicInputs,
    mintTxHash: record.mintTxHash,
    failureReason: record.failureReason,
  });
});

/** Full circuit-input assembly for a pending deposit — real header chain + real Merkle proof, fetched fresh here (see mempool.ts). Gated the same way dark-engine's own /proof-inputs route is, purely to keep this off public traffic — nothing it returns is actually secret anymore. */
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
    res.json({ id: record.id, ...circuitInputs });
  } catch (err) {
    next(err);
  }
});

/** Worker submits the completed proof here. Manual/offline completion also works the same way (e.g. a proof produced by hand via nargo/bb) — same shape as dark-engine's own POST /matches/:id/proof. Marking a deposit `proven` is what makes minter.ts's poll loop pick it up and auto-mint WrappedBTC — no separate claim step. */
btcDepositRouter.post("/:id/proof", (req, res) => {
  if (!requireBtcDepositSecret(req, res)) return;
  const { proof, publicInputs } = req.body ?? {};
  if (typeof proof !== "string" || !proof.startsWith("0x")) {
    res.status(400).json({ error: "Expected { proof: '0x...', publicInputs: [checkpointCommitment, recipient, amount, nullifier] }" });
    return;
  }
  if (!Array.isArray(publicInputs) || publicInputs.length !== 4 || !publicInputs.every((p) => typeof p === "string")) {
    res.status(400).json({ error: "Expected { proof: '0x...', publicInputs: [checkpointCommitment, recipient, amount, nullifier] }" });
    return;
  }
  const record = store.markProven(req.params.id, proof as `0x${string}`, publicInputs as [string, string, string, string]);
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
