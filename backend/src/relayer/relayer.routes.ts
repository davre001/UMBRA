import { Router } from "express";
import { isRelayableAction, relay } from "./relayer.service";

export const relayerRouter = Router();

relayerRouter.post("/relay", async (req, res, next) => {
  try {
    const { action, args } = req.body ?? {};
    if (!isRelayableAction(action) || !Array.isArray(args)) {
      res.status(400).json({ error: "Expected { action: 'withdraw'|'pay'|'placeOrder'|'cancelOrder', args: [...] }" });
      return;
    }
    const relayTxHash = await relay(action, args);
    res.json({ relayTxHash });
  } catch (err) {
    next(err);
  }
});
