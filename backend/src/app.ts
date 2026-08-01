import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import swaggerUi from "swagger-ui-express";
import { logger } from "./shared/logger";
import { openapiSpec } from "./docs/openapi";
import { darkEngineRouter } from "./dark-engine/dark-engine.routes";
import { pricingRouter } from "./pricing/pricing.routes";
import { complianceRouter } from "./compliance/compliance.routes";
import { relayerRouter } from "./relayer/relayer.routes";
import { authRouter } from "./auth/auth.routes";

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // One line per request (method, path, status, response time), plus a
  // request id every downstream `req.log.*` call is automatically tagged
  // with — this is what makes "why did X fail" traceable in Render's log
  // stream instead of just "something 400'd at some point".
  app.use(
    pinoHttp({
      logger,
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
      customSuccessMessage: (req, res) => `${req.method} ${req.url} -> ${res.statusCode}`,
      customErrorMessage: (req, res, err) => `${req.method} ${req.url} -> ${res.statusCode} (${err.message})`,
      // Health checks (Render's own uptime pings) would otherwise dominate
      // the log stream with zero information value.
      autoLogging: { ignore: (req) => req.url === "/health" },
    })
  );

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));

  app.use("/api/dark-engine", darkEngineRouter);
  app.use("/api/pricing", pricingRouter);
  app.use("/api/compliance", complianceRouter);
  app.use("/api/relayer", relayerRouter);
  app.use("/api/auth", authRouter);

  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    req.log.error({ err }, `Unhandled error on ${req.method} ${req.url}: ${err.message}`);
    res.status(400).json({ error: err.message });
  });

  return app;
}
