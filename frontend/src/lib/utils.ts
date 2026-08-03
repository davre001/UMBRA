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
