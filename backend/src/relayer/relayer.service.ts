function randomHex(bytes: number): string {
  let out = "";
  for (let i = 0; i < bytes; i++) {
    out += Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0");
  }
  return out;
}

// Simulates a gasless relayer broadcasting a pre-signed transaction.
export async function relay(
  payload: Record<string, unknown>
): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 200));
  return `0x${randomHex(32)}`;
}
