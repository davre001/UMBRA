import { Router } from "express";
import rateLimit from "express-rate-limit";
import { isRelayableAction, relay } from "./relayer.service";

export const relayerRouter = Router();

// Every call here pays real Coston2 gas from the backend's own operator key
// (see chain.ts) — proof-gated, so it can't move funds, but an unthrottled
// caller could still burn the operator's gas balance or spam the RPC. Keyed
// by IP rather than any request field, since a relay call carries no wallet
// identity of its own to key on (the proof is the only authorization).
const relayRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many relay requests — try again shortly." },
});

relayerRouter.post("/relay", relayRateLimit, async (req, res, next) => {
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
