import { Router } from "express";
import { getAllUsdPrices, getMidpointRate } from "./ftso.client";

export const pricingRouter = Router();

/** Real FTSOv2 USD prices for every supported asset. */
pricingRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await getAllUsdPrices());
  } catch (err) {
    next(err);
  }
});

pricingRouter.get("/:fromAsset/:toAsset", async (req, res, next) => {
  try {
    const rate = await getMidpointRate(req.params.fromAsset, req.params.toAsset);
    res.json({ fromAsset: req.params.fromAsset, toAsset: req.params.toAsset, rate });
  } catch (err) {
    next(err);
  }
});
