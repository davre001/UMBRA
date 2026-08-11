import { Router } from "express";
import { computeSolvency } from "./solvency";
import * as store from "./store";

export const btcWithdrawalRouter = Router();

/** Publicly checkable — no secret gating, matching the "solvency should be visible to anyone, not just claimed" design goal. See solvency.ts's own doc for exactly what this does and doesn't prove. */
btcWithdrawalRouter.get("/solvency", async (_req, res, next) => {
  try {
    res.json(await computeSolvency());
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
