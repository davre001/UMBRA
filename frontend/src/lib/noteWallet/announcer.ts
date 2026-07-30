import { decodeAbiParameters, encodeAbiParameters, type PublicClient } from "viem";

/**
 * Delivers a `pay`-created note's private data (assetId, amount, blinding,
 * commitment) to its recipient via StealthAnnouncer's generic event log.
 *
 * This is NOT full EIP-5564 stealth addressing (schemeId 1, reserved by the
 * contract's own doc comment) — there's no ephemeral-keypair ECDH here, and
 * `stealthAddress` is just the recipient's ordinary wallet address, not a
 * fresh one-time destination. That tradeoff follows directly from adopting
 * Wraith's reused-ownerKey note scheme (circuits/DESIGN.md) instead of full
 * per-payment stealth addresses: metadata is announced in the clear rather
 * than ECDH-encrypted. This adds no new privacy loss beyond what `pay`
 * already exposes on-chain — assetId/amount/commitment are already public
 * inputs on the `pay()` call itself (see DESIGN.md's "known simplification,
 * v1"); `blinding` is the only genuinely new value this reveals, and on its
 * own it doesn't let anyone but the ownerKey's spendingKey holder spend the
 * note.
 */
export const OWNER_KEY_NOTE_SCHEME_ID = BigInt(2);

const METADATA_PARAMS = [
  { type: "uint256", name: "assetId" },
  { type: "uint256", name: "amount" },
  { type: "uint256", name: "blinding" },
  { type: "uint256", name: "commitment" },
] as const;

export function encodeNoteMetadata(params: {
  assetId: bigint;
  amount: bigint;
  blinding: bigint;
  commitment: bigint;
}): `0x${string}` {
  return encodeAbiParameters(METADATA_PARAMS, [params.assetId, params.amount, params.blinding, params.commitment]);
}

export interface AnnouncedNote {
  assetId: bigint;
  amount: bigint;
  blinding: bigint;
  commitment: bigint;
  blockNumber: bigint;
}

function decodeNoteMetadata(metadata: `0x${string}`, blockNumber: bigint): AnnouncedNote | null {
  try {
    const [assetId, amount, blinding, commitment] = decodeAbiParameters(METADATA_PARAMS, metadata);
    return { assetId, amount, blinding, commitment, blockNumber };
  } catch {
    return null; // not one of our announcements (e.g. a real EIP-5564 schemeId 1 announcement)
  }
}

type AnnouncerClient = Pick<PublicClient, "getLogs">;

const ANNOUNCEMENT_EVENT = {
  type: "event",
  name: "Announcement",
  inputs: [
    { indexed: true, name: "schemeId", type: "uint256" },
    { indexed: true, name: "stealthAddress", type: "address" },
    { indexed: true, name: "caller", type: "address" },
    { indexed: false, name: "ephemeralPubKey", type: "bytes" },
    { indexed: false, name: "metadata", type: "bytes" },
  ],
} as const;

/** Every owner_key-scheme note ever announced to `recipient` on this announcer. */
export async function fetchIncomingAnnouncements(
  client: AnnouncerClient,
  announcerAddress: `0x${string}`,
  recipient: `0x${string}`,
  fromBlock: bigint = BigInt(0)
): Promise<AnnouncedNote[]> {
  const logs = await client.getLogs({
    address: announcerAddress,
    event: ANNOUNCEMENT_EVENT,
    args: { schemeId: OWNER_KEY_NOTE_SCHEME_ID, stealthAddress: recipient },
    fromBlock,
    toBlock: "latest",
  });

  const notes: AnnouncedNote[] = [];
  for (const log of logs) {
    const decoded = decodeNoteMetadata(log.args.metadata as `0x${string}`, log.blockNumber);
    if (decoded) notes.push(decoded);
  }
  return notes;
}
