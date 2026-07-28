import { Router } from "express";
import { generateProof } from "./prover.service";

export const proverRouter = Router();

proverRouter.post("/prove", async (req, res, next) => {
  try {
    const result = await generateProof(req.body ?? {});
    res.json(result);
  } catch (err) {
    next(err);
  }
});
