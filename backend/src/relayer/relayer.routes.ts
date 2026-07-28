import { Router } from "express";
import { relay } from "./relayer.service";

export const relayerRouter = Router();

relayerRouter.post("/relay", async (req, res, next) => {
  try {
    const relayTxHash = await relay(req.body ?? {});
    res.json({ relayTxHash });
  } catch (err) {
    next(err);
  }
});
