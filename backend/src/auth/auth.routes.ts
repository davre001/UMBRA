import { Router } from "express";
import { createChallenge, verifyChallenge } from "./webauthn.service";

export const authRouter = Router();

authRouter.post("/passkey/challenge", (_req, res) => {
  const challengeId = createChallenge();
  res.json({ challengeId });
});

authRouter.post("/passkey/verify", (req, res) => {
  const { challengeId } = req.body;
  const verified = verifyChallenge(challengeId);
  res.json({ verified });
});
