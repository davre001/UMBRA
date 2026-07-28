import { Router } from "express";
import { deriveStealthAddress, buildPaymentLink, resolveRecipient } from "./stealth.service";

export const stealthRouter = Router();

stealthRouter.post("/derive", async (req, res, next) => {
  try {
    const { asset, amount } = req.body ?? {};
    const stealthAddress = await deriveStealthAddress();
    const paymentLink = buildPaymentLink(stealthAddress, asset, amount);
    res.json({ stealthAddress, paymentLink });
  } catch (err) {
    next(err);
  }
});

stealthRouter.post("/resolve", async (req, res, next) => {
  try {
    const { recipientType, recipient } = req.body;
    const stealthAddress = await resolveRecipient(recipientType, recipient);
    res.json({ stealthAddress });
  } catch (err) {
    next(err);
  }
});
