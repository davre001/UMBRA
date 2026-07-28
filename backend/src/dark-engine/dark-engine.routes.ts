import { Router } from "express";
import { submitIntent, getIntent } from "./matcher";

export const darkEngineRouter = Router();

darkEngineRouter.post("/intent", async (req, res, next) => {
  try {
    const { address, fromAsset, toAsset, fromAmount, toAmount, slippage, mevProtection } = req.body;
    const intent = await submitIntent({
      address,
      fromAsset,
      toAsset,
      fromAmount: Number(fromAmount),
      toAmount: Number(toAmount),
      slippage: Number(slippage),
      mevProtection,
    });
    res.json(intent);
  } catch (err) {
    next(err);
  }
});

darkEngineRouter.get("/:id", (req, res) => {
  const intent = getIntent(req.params.id);
  if (!intent) {
    res.status(404).json({ error: "Intent not found" });
    return;
  }
  res.json(intent);
});
