import { Router } from "express";
import { isAddress } from "viem";
import { screenAddress, isScreened } from "./fdc.client";

export const complianceRouter = Router();

/** Screens an address and records the real result on ComplianceRegistry — needed before that address can pass ShieldedVault.withdraw()'s screening gate. */
complianceRouter.post("/screen", async (req, res, next) => {
  try {
    const { address } = req.body ?? {};
    if (typeof address !== "string" || !isAddress(address)) {
      res.status(400).json({ error: "Invalid address" });
      return;
    }
    const result = await screenAddress(address);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

complianceRouter.get("/:address", async (req, res, next) => {
  try {
    if (!isAddress(req.params.address)) {
      res.status(400).json({ error: "Invalid address" });
      return;
    }
    res.json({ address: req.params.address, clear: await isScreened(req.params.address) });
  } catch (err) {
    next(err);
  }
});
