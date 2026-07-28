import { Router } from "express";
import { getPortfolio } from "./portfolio.service";

export const portfolioRouter = Router();

portfolioRouter.get("/:address", async (req, res, next) => {
  try {
    const portfolio = await getPortfolio(req.params.address);
    res.json(portfolio);
  } catch (err) {
    next(err);
  }
});
