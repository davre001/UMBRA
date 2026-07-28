import { SwapIntent } from "../shared/types";
import { getMidpointRate } from "../pricing/ftso.client";

let intentCounter = 0;
const intents = new Map<string, SwapIntent>();

// Simulates TEE batch-matching: routes the intent, prices it at the
// oracle midpoint, then settles it.
export async function submitIntent(
  input: Omit<SwapIntent, "id" | "status">
): Promise<SwapIntent> {
  const id = `intent_${++intentCounter}`;
  const intent: SwapIntent = { ...input, id, status: "routing" };
  intents.set(id, intent);

  await new Promise((resolve) => setTimeout(resolve, 300));
  intent.status = "matching";
  const rate = await getMidpointRate(input.fromAsset, input.toAsset);
  intent.toAmount = Number((input.fromAmount * rate).toFixed(4));

  await new Promise((resolve) => setTimeout(resolve, 300));
  intent.status = "settled";

  return intent;
}

export function getIntent(id: string): SwapIntent | undefined {
  return intents.get(id);
}
