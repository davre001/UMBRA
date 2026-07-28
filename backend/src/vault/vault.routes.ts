import { Router } from "express";
import * as vaultService from "./vault.service";

export const vaultRouter = Router();

vaultRouter.get("/:address/balances", async (req, res, next) => {
  try {
    const vault = await vaultService.getBalances(req.params.address);
    res.json(vault);
  } catch (err) {
    next(err);
  }
});

vaultRouter.post("/shield", async (req, res, next) => {
  try {
    const { address, asset, amount } = req.body;
    const result = await vaultService.shield(address, asset, Number(amount));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

vaultRouter.post("/withdraw", async (req, res, next) => {
  try {
    const { address, asset, amount, destination, gasless } = req.body;
    const result = await vaultService.withdraw(
      address,
      asset,
      Number(amount),
      destination,
      Boolean(gasless)
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

vaultRouter.post("/pay", async (req, res, next) => {
  try {
    const { address, asset, amount, destination } = req.body;
    const result = await vaultService.pay(address, asset, Number(amount), destination);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
