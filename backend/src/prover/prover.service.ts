import { ProofResult } from "../shared/types";

function randomHex(bytes: number): string {
  let out = "";
  for (let i = 0; i < bytes; i++) {
    out += Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0");
  }
  return out;
}

// Simulates Noir witness generation + WASM proving latency.
export async function generateProof(
  inputs: Record<string, unknown>
): Promise<ProofResult> {
  const start = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 150));
  const proof = `0x${randomHex(96)}`;
  return { proof, provingTimeMs: Date.now() - start };
}
