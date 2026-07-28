import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { vaultRouter } from "./vault/vault.routes";
import { portfolioRouter } from "./portfolio/portfolio.routes";
import { darkEngineRouter } from "./dark-engine/dark-engine.routes";
import { pricingRouter } from "./pricing/pricing.routes";
import { complianceRouter } from "./compliance/compliance.routes";
import { stealthRouter } from "./stealth/stealth.routes";
import { proverRouter } from "./prover/prover.routes";
import { relayerRouter } from "./relayer/relayer.routes";
import { authRouter } from "./auth/auth.routes";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api/vault", vaultRouter);
  app.use("/api/portfolio", portfolioRouter);
  app.use("/api/swap", darkEngineRouter);
  app.use("/api/pricing", pricingRouter);
  app.use("/api/compliance", complianceRouter);
  app.use("/api/stealth", stealthRouter);
  app.use("/api/prover", proverRouter);
  app.use("/api/relayer", relayerRouter);
  app.use("/api/auth", authRouter);

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(400).json({ error: err.message });
  });

  return app;
}
