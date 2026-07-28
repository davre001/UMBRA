import { SANCTION_LISTS } from "../shared/constants";
import { ComplianceScreenResult } from "../shared/types";

// Simulates an FDC-backed sanction/AML screen.
export async function screenAddress(
  address: string
): Promise<ComplianceScreenResult> {
  await new Promise((resolve) => setTimeout(resolve, 250));
  return { address, clear: true, screenedLists: SANCTION_LISTS };
}

export async function getViewingKey(address: string): Promise<string> {
  return `umbra_vkey_flare_${address.slice(2, 10)}`;
}
