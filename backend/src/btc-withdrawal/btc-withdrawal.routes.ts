import { Router, Request, Response } from "express";
import * as bitcoin from "bitcoinjs-lib";
import { logger } from "../shared/logger";
import { computeSolvency } from "./solvency";
import { listOverdue } from "./overdue";
import { finalizeWithdrawalPsbt, hasEnoughSignatures } from "./bitcoin-tx";
import { broadcastTx } from "./mempool";
import { SIGNET_NETWORK } from "./wallet";
import * as store from "./store";

export const btcWithdrawalRouter = Router();

/** Gates the PSBT sign/collect routes — a different secret than BTC_DEPOSIT_INTERNAL_SECRET on purpose: this one is meant to circulate among the 2-of-3 reserve signers specifically (see scripts/sign-btc-withdrawal.ts), a different trust boundary than the deposit-proving worker's own secret. Not gating against real theft (a leaked PSBT reveals nothing a private key would — see the GET route's own doc), just keeping this off random public traffic. */
function requireBtcWithdrawalSecret(req: Request, res: Response): boolean {
  const configured = process.env.BTC_WITHDRAWAL_INTERNAL_SECRET;
  if (!configured) {
    logger.error("[btc-withdrawal] rejecting signer request: BTC_WITHDRAWAL_INTERNAL_SECRET not configured on this deployment");
    res.status(503).json({ error: "BTC_WITHDRAWAL_INTERNAL_SECRET not configured on this deployment" });
    return false;
  }
  if (req.header("x-btc-withdrawal-secret") !== configured) {
    logger.warn(`[btc-withdrawal] rejecting request to ${req.originalUrl}: invalid or missing x-btc-withdrawal-secret header`);
    res.status(401).json({ error: "Invalid or missing x-btc-withdrawal-secret header" });
    return false;
  }
  return true;
}

/** Publicly checkable — no secret gating, matching the "solvency should be visible to anyone, not just claimed" design goal. See solvency.ts's own doc for exactly what this does and doesn't prove. */
btcWithdrawalRouter.get("/solvency", async (_req, res, next) => {
  try {
    res.json(await computeSolvency());
  } catch (err) {
    next(err);
  }
});

/**
 * Per-record detail for withdrawals stuck past overdue.ts's threshold —
 * `/solvency` only exposes the count + oldest age (enough for an alert to
 * fire on), this is the drill-down docs/RUNBOOK_BTC_WITHDRAWAL.md's triage
 * steps expect once that alert does fire. Secret-gated (not public like
 * `/solvency`): this is an operator/signer tool, same trust boundary as the
 * PSBT sign routes below, not a "prove solvency to any observer" one.
 */
btcWithdrawalRouter.get("/overdue", (req, res) => {
  if (!requireBtcWithdrawalSecret(req, res)) return;
  res.json({ overdue: listOverdue() });
});

/**
 * The staged, not-yet-fully-signed PSBT for a withdrawal awaiting reserve
 * signatures — scripts/sign-btc-withdrawal.ts's own `MODE=fetch` reads
 * this. Secret-gated to keep it off random traffic, but not because the
 * PSBT itself is sensitive: it reveals only what's already public on-chain
 * anyway (the ExternalWithdrawalRequested event's own destination/amount),
 * and holding a partially-signed PSBT lets you contribute a signature, not
 * steal anything.
 */
btcWithdrawalRouter.get("/:nullifierHash/psbt", (req, res) => {
  if (!requireBtcWithdrawalSecret(req, res)) return;
  const record = store.getRecord(req.params.nullifierHash);
  if (!record) {
    res.status(404).json({ error: "No withdrawal request observed for this nullifierHash" });
    return;
  }
  if (record.status !== "awaiting_signatures" || !record.psbt) {
    res.status(409).json({ error: `Withdrawal ${record.nullifierHash} is ${record.status}, not awaiting_signatures` });
    return;
  }
  res.json({ nullifierHash: record.nullifierHash, status: record.status, psbt: record.psbt });
});

/**
 * A reserve signer submits their own partially-signed PSBT here —
 * combined with whatever's already stored (bitcoinjs-lib's Psbt.combine,
 * which merges independently-collected partial signatures for the SAME
 * underlying transaction) rather than requiring signers to coordinate
 * collecting each other's signatures out of band first. Once every input
 * has >= the reserve's threshold signatures, this route finalizes and
 * broadcasts immediately — the last signer to submit is the one that
 * completes the payout, no separate "now execute" step needed (unlike the
 * EVM Safe flow, which needs a distinct execute call — real PSBTs support
 * this incremental-merge pattern natively).
 */
btcWithdrawalRouter.post("/:nullifierHash/psbt", async (req, res, next) => {
  if (!requireBtcWithdrawalSecret(req, res)) return;
  try {
    const record = store.getRecord(req.params.nullifierHash);
    if (!record) {
      res.status(404).json({ error: "No withdrawal request observed for this nullifierHash" });
      return;
    }
    if (record.status !== "awaiting_signatures" || !record.psbt) {
      res.status(409).json({ error: `Withdrawal ${record.nullifierHash} is ${record.status}, not awaiting_signatures` });
      return;
    }
    const { psbt: incomingPsbtBase64 } = req.body ?? {};
    if (typeof incomingPsbtBase64 !== "string") {
      res.status(400).json({ error: "Expected { psbt: '<base64-encoded PSBT>' }" });
      return;
    }

    const stored = bitcoin.Psbt.fromBase64(record.psbt, { network: SIGNET_NETWORK });
    const incoming = bitcoin.Psbt.fromBase64(incomingPsbtBase64, { network: SIGNET_NETWORK });
    stored.combine(incoming);
    const combinedBase64 = stored.toBase64();

    if (!hasEnoughSignatures(stored)) {
      await store.updatePsbt(record.nullifierHash, combinedBase64);
      const signatureCounts = stored.data.inputs.map((input) => input.partialSig?.length ?? 0);
      res.json({ nullifierHash: record.nullifierHash, status: "awaiting_signatures", signatureCounts });
      return;
    }

    const { rawHex, txid } = finalizeWithdrawalPsbt(combinedBase64);
    logger.info(`[btc-withdrawal] ${record.nullifierHash}: fully signed, broadcasting ${txid}`);
    const broadcastTxid = await broadcastTx(rawHex);
    if (broadcastTxid !== txid) {
      logger.warn(`[btc-withdrawal] ${record.nullifierHash}: locally-computed txid ${txid} != broadcast-returned ${broadcastTxid}, trusting the broadcast response`);
    }
    await store.markBroadcast(record.nullifierHash, broadcastTxid);
    res.json({ nullifierHash: record.nullifierHash, status: "broadcast", payoutTxid: broadcastTxid });
  } catch (err) {
    next(err);
  }
});

btcWithdrawalRouter.get("/:nullifierHash", (req, res) => {
  const record = store.getRecord(req.params.nullifierHash);
  if (!record) {
    res.status(404).json({ error: "No withdrawal request observed for this nullifierHash" });
    return;
  }
  res.json(record);
});
