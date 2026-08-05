import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { TransactionReceipt } from "viem";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** viem's waitForTransactionReceipt resolves on a reverted tx too — it only rejects for things like a timeout, never for on-chain failure. Callers must check `status` themselves, which is what this centralizes. */
export function assertTxSuccess(receipt: TransactionReceipt): void {
  if (receipt.status !== "success") {
    throw new Error(`Transaction reverted on-chain (${receipt.transactionHash}).`);
  }
}

export function formatAddress(address: string): string {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

const MAX_ERROR_MESSAGE_LENGTH = 200;

/**
 * A clean, one-line message for user-facing error notifications. viem's own
 * `err.message` for a rejected/reverted call packs in the full request args
 * (including raw proof calldata — can run to tens of thousands of
 * characters) plus a docs link, meant for a developer console, not a toast.
 * viem errors carry a `shortMessage` specifically for this ("User rejected
 * the request.") — used when present, with a hard length cap as a backstop
 * for anything else (a non-viem Error, or a viem error missing it).
 */
export function getErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "shortMessage" in err && typeof err.shortMessage === "string") {
    return err.shortMessage;
  }
  if (err instanceof Error) {
    return err.message.length > MAX_ERROR_MESSAGE_LENGTH ? `${err.message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…` : err.message;
  }
  return fallback;
}
