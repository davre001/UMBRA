import { Router } from "express";
import { getMidpointRate } from "./ftso.client";

export const pricingRouter = Router();

pricingRouter.get("/:fromAsset/:toAsset", async (req, res, next) => {
  try {
    const rate = await getMidpointRate(req.params.fromAsset, req.params.toAsset);
    res.json({ fromAsset: req.params.fromAsset, toAsset: req.params.toAsset, rate });
  } catch (err) {
    next(err);
  }
});
