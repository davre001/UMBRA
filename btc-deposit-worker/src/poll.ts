import { proveBtcDeposit } from "./prove";
import type { BtcDepositProofInputs } from "./types";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

function requireSecret(): string {
  const secret = process.env.BTC_DEPOSIT_INTERNAL_SECRET;
  if (!secret) throw new Error("BTC_DEPOSIT_INTERNAL_SECRET not set — see .env.example");
  return secret;
}

interface DepositSummary {
  id: string;
  status: "awaiting_proof";
}

async function fetchAwaitingDeposits(): Promise<DepositSummary[]> {
  const res = await fetch(`${BACKEND_URL}/api/btc-deposit?status=awaiting_proof`);
  if (!res.ok) throw new Error(`GET /btc-deposit failed: ${res.status}`);
  const body = (await res.json()) as { deposits: DepositSummary[] };
  return body.deposits;
}

async function fetchProofInputs(id: string): Promise<BtcDepositProofInputs> {
  const res = await fetch(`${BACKEND_URL}/api/btc-deposit/${id}/proof-inputs`, {
    headers: { "x-btc-deposit-secret": requireSecret() },
  });
  if (!res.ok) throw new Error(`GET /btc-deposit/${id}/proof-inputs failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as BtcDepositProofInputs;
}

async function submitProof(id: string, proof: `0x${string}`, publicInputs: [string, string, string]): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/api/btc-deposit/${id}/proof`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-btc-deposit-secret": requireSecret() },
    body: JSON.stringify({ proof, publicInputs }),
  });
  if (!res.ok) throw new Error(`POST /btc-deposit/${id}/proof failed: ${res.status} ${await res.text()}`);
}

async function processOne(id: string): Promise<void> {
  console.log(`[btc-deposit-worker] proving deposit ${id}...`);
  const inputs = await fetchProofInputs(id);
  const { proof, publicInputs } = await proveBtcDeposit(inputs);
  await submitProof(id, proof, publicInputs);
  console.log(`[btc-deposit-worker] completed deposit ${id}`);
}

/**
 * One pass: fetch every awaiting_proof deposit, prove and submit each. A
 * single deposit failing doesn't stop the rest. Deliberately does NOT
 * auto-report failures to POST /btc-deposit/:id/fail: unlike dark-engine's
 * NullifierAlreadySpent (an unambiguous, permanent failure), the errors
 * this can hit — most commonly the checkpoint not yet having advanced far
 * enough for this deposit's confirming block (see mempool.ts's own
 * TemplateMismatchError) — are often transient and should just be retried
 * next poll once the checkpoint catches up. Marking failed is left as a
 * manual operator action for a deposit an operator has independently
 * confirmed can never succeed (e.g. a genuinely malformed tx).
 */
export async function pollOnce(): Promise<{ attempted: number }> {
  const pending = await fetchAwaitingDeposits();
  for (const deposit of pending) {
    try {
      await processOne(deposit.id);
    } catch (err) {
      console.error(`[btc-deposit-worker] failed to complete deposit ${deposit.id}, left awaiting_proof:`, (err as Error).message);
    }
  }
  return { attempted: pending.length };
}

export { BACKEND_URL };
