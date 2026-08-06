import { bytesToHex, decodeAbiParameters, encodeAbiParameters, hexToBytes, type Hex, type PublicClient } from "viem";
import { getLogsChunked } from "./getLogsChunked";
import { decryptAnnouncement, matchStealthTag } from "./privacyKeys";

/**
 * Delivers a `pay`-created note's private data (assetId, amount, blinding,
 * commitment) to its recipient via StealthAnnouncer's generic event log.
 *
 * `metadata` is ECIES-encrypted to the recipient's `PrivacyKeyRegistry` key
 * (see privacyKeys.ts) rather than sent in the clear — a wallet whose
 * `ephemeralPubKey` is empty is a *legacy* announcement made before this
 * scheme existed, and is decoded as plain ABI-encoded bytes instead, so
 * every note announced before this change stays recoverable.
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

function isLegacyPlaintext(ephemeralPubKey: Hex): boolean {
  return hexToBytes(ephemeralPubKey).length === 0;
}

function decodeNoteMetadata(privacyPrivateKey: Uint8Array, ephemeralPubKey: Hex, metadata: Hex, blockNumber: bigint): AnnouncedNote | null {
  try {
    const plaintext = isLegacyPlaintext(ephemeralPubKey) ? metadata : decryptToHex(privacyPrivateKey, ephemeralPubKey, metadata);
    if (!plaintext) return null;
    const [assetId, amount, blinding, commitment] = decodeAbiParameters(METADATA_PARAMS, plaintext);
    return { assetId, amount, blinding, commitment, blockNumber };
  } catch {
    return null; // not one of our announcements (e.g. a real EIP-5564 schemeId 1 announcement)
  }
}

function decryptToHex(privacyPrivateKey: Uint8Array, ephemeralPubKey: Hex, metadata: Hex): Hex | null {
  const decrypted = decryptAnnouncement(privacyPrivateKey, ephemeralPubKey, metadata);
  return decrypted ? bytesToHex(decrypted) : null;
}

/**
 * Delivers a partial fill's residual order (contract/circuits/noir/
 * match_orders — see circuits/DESIGN.md) to the trader who still owns it —
 * same mechanism as `OWNER_KEY_NOTE_SCHEME_ID` above, a different scheme id
 * only because the metadata shape (order fields, not a note's) differs.
 * `stealthAddress` for this scheme stays the trader's own real address (see
 * privacyKeys.ts's `encryptAnnouncement`) — only `metadata` is encrypted,
 * since the trader's address is already public via their own placeOrder tx.
 */
export const ORDER_SCHEME_ID = BigInt(3);

const ORDER_METADATA_PARAMS = [
  { type: "uint256", name: "assetIn" },
  { type: "uint256", name: "assetOut" },
  { type: "uint256", name: "amountIn" },
  { type: "uint256", name: "minAmountOut" },
  { type: "uint256", name: "blinding" },
  { type: "uint256", name: "commitment" },
  { type: "uint256", name: "originalAmountIn" },
] as const;

export interface AnnouncedOrder {
  assetIn: bigint;
  assetOut: bigint;
  amountIn: bigint;
  minAmountOut: bigint;
  blinding: bigint;
  commitment: bigint;
  originalAmountIn: bigint;
  blockNumber: bigint;
}

/**
 * Encodes an order's own private fields for announcement — previously only
 * ever built backend-side (a residual order, announced by the matcher after
 * a partial fill). Needed here too so a trader can self-announce their own
 * freshly-placed order: without it, it exists only in this browser's local
 * IndexedDB, with no way to reconstruct it by scanning the chain from a
 * different device (unlike everything that already goes through
 * StealthAnnouncer today). A cancel-order refund uses `encodeNoteMetadata`
 * above instead — it's a regular note, not an order.
 */
export function encodeOrderMetadata(params: {
  assetIn: bigint;
  assetOut: bigint;
  amountIn: bigint;
  minAmountOut: bigint;
  blinding: bigint;
  commitment: bigint;
  originalAmountIn: bigint;
}): `0x${string}` {
  return encodeAbiParameters(ORDER_METADATA_PARAMS, [
    params.assetIn,
    params.assetOut,
    params.amountIn,
    params.minAmountOut,
    params.blinding,
    params.commitment,
    params.originalAmountIn,
  ]);
}

function decodeOrderMetadata(
  privacyPrivateKey: Uint8Array,
  ephemeralPubKey: Hex,
  metadata: Hex,
  blockNumber: bigint
): AnnouncedOrder | null {
  try {
    const plaintext = isLegacyPlaintext(ephemeralPubKey) ? metadata : decryptToHex(privacyPrivateKey, ephemeralPubKey, metadata);
    if (!plaintext) return null;
    const [assetIn, assetOut, amountIn, minAmountOut, blinding, commitment, originalAmountIn] = decodeAbiParameters(
      ORDER_METADATA_PARAMS,
      plaintext
    );
    return { assetIn, assetOut, amountIn, minAmountOut, blinding, commitment, originalAmountIn, blockNumber };
  } catch {
    return null;
  }
}

type AnnouncerClient = Pick<PublicClient, "getLogs" | "getBlockNumber">;

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

type RawAnnouncement = { args: { stealthAddress: `0x${string}`; ephemeralPubKey: Hex; metadata: Hex }; blockNumber: bigint };

/**
 * Every owner_key-scheme note ever announced to `recipient` on this
 * announcer. `stealthAddress` is a one-time tag for anything announced after
 * this scheme shipped (see privacyKeys.ts's `deriveStealthTag`), not
 * `recipient` itself, so this can no longer filter by address on-chain —
 * it fetches every scheme-2 log and checks each one locally, falling back to
 * a direct address match for legacy (pre-tagging) announcements. Same
 * "scan everything, verify locally" shape `scan.ts`'s deposit/leaf scanning
 * already uses.
 */
export async function fetchIncomingAnnouncements(
  client: AnnouncerClient,
  announcerAddress: `0x${string}`,
  recipient: `0x${string}`,
  privacyPrivateKey: Uint8Array,
  fromBlock: bigint = BigInt(0)
): Promise<AnnouncedNote[]> {
  const toBlock = await client.getBlockNumber();
  const logs = (await getLogsChunked(
    client,
    announcerAddress,
    ANNOUNCEMENT_EVENT,
    fromBlock,
    toBlock,
    { schemeId: OWNER_KEY_NOTE_SCHEME_ID }
  )) as RawAnnouncement[];

  const notes: AnnouncedNote[] = [];
  for (const log of logs) {
    const { stealthAddress, ephemeralPubKey, metadata } = log.args;
    const mine = isLegacyPlaintext(ephemeralPubKey)
      ? stealthAddress.toLowerCase() === recipient.toLowerCase()
      : matchStealthTag(privacyPrivateKey, ephemeralPubKey, stealthAddress);
    if (!mine) continue;
    const decoded = decodeNoteMetadata(privacyPrivateKey, ephemeralPubKey, metadata, log.blockNumber);
    if (decoded) notes.push(decoded);
  }
  return notes;
}

/**
 * Every residual order ever announced to `recipient` on this announcer — a
 * partial fill's leftover, delivered the same way a matched note is.
 * `stealthAddress` for this scheme is always the trader's own real address
 * (see `ORDER_SCHEME_ID`'s own doc comment), so this keeps the cheap
 * address-filtered query — only `metadata` needs decrypting.
 */
export async function fetchIncomingOrderAnnouncements(
  client: AnnouncerClient,
  announcerAddress: `0x${string}`,
  recipient: `0x${string}`,
  privacyPrivateKey: Uint8Array,
  fromBlock: bigint = BigInt(0)
): Promise<AnnouncedOrder[]> {
  const toBlock = await client.getBlockNumber();
  const logs = (await getLogsChunked(
    client,
    announcerAddress,
    ANNOUNCEMENT_EVENT,
    fromBlock,
    toBlock,
    { schemeId: ORDER_SCHEME_ID, stealthAddress: recipient }
  )) as RawAnnouncement[];

  const orders: AnnouncedOrder[] = [];
  for (const log of logs) {
    const decoded = decodeOrderMetadata(privacyPrivateKey, log.args.ephemeralPubKey, log.args.metadata, log.blockNumber);
    if (decoded) orders.push(decoded);
  }
  return orders;
}
