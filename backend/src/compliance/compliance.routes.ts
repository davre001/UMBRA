import { Router } from "express";
import { screenAddress, getViewingKey } from "./fdc.client";

export const complianceRouter = Router();

complianceRouter.post("/screen", async (req, res, next) => {
  try {
    const { address } = req.body;
    const result = await screenAddress(address);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

complianceRouter.get("/viewing-key/:address", async (req, res, next) => {
  try {
    const viewingKey = await getViewingKey(req.params.address);
    res.json({ viewingKey });
  } catch (err) {
    next(err);
  }
});
