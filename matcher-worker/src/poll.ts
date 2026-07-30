import { proveMatchOrders } from "./prove";
import { deserializeMatchProofInputs } from "./types";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

function requireSecret(): string {
  const secret = process.env.MATCHER_INTERNAL_SECRET;
  if (!secret) throw new Error("MATCHER_INTERNAL_SECRET not set — see .env.example");
  return secret;
}

interface MatchSummary {
  id: string;
  status: "awaiting_proof" | "settled";
}

async function fetchAwaitingMatches(): Promise<MatchSummary[]> {
  const res = await fetch(`${BACKEND_URL}/api/dark-engine/matches?status=awaiting_proof`);
  if (!res.ok) throw new Error(`GET /matches failed: ${res.status}`);
  const body = (await res.json()) as { matches: MatchSummary[] };
  return body.matches;
}

async function fetchProofInputs(matchId: string) {
  const res = await fetch(`${BACKEND_URL}/api/dark-engine/matches/${matchId}/proof-inputs`, {
    headers: { "x-matcher-secret": requireSecret() },
  });
  if (!res.ok) throw new Error(`GET /matches/${matchId}/proof-inputs failed: ${res.status}`);
  return deserializeMatchProofInputs(await res.json());
}

async function submitProof(matchId: string, proof: `0x${string}`): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/api/dark-engine/matches/${matchId}/proof`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proof }),
  });
  if (!res.ok) throw new Error(`POST /matches/${matchId}/proof failed: ${res.status} ${await res.text()}`);
}

async function processOne(matchId: string): Promise<void> {
  console.log(`[matcher-worker] proving match ${matchId}...`);
  const inputs = await fetchProofInputs(matchId);
  const proof = await proveMatchOrders(inputs);
  await submitProof(matchId, proof);
  console.log(`[matcher-worker] completed match ${matchId}`);
}

/** One pass: fetch every awaiting_proof match, prove and submit each. A single match failing doesn't stop the rest — it's just logged and left for the next poll. */
export async function pollOnce(): Promise<{ attempted: number }> {
  const pending = await fetchAwaitingMatches();
  for (const match of pending) {
    try {
      await processOne(match.id);
    } catch (err) {
      console.error(`[matcher-worker] failed to complete match ${match.id}:`, (err as Error).message);
    }
  }
  return { attempted: pending.length };
}

export { BACKEND_URL };
