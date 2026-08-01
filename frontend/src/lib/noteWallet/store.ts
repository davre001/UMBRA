import { openDB, type DBSchema, type IDBPDatabase } from "idb";

interface StoredNoteBase {
  /** `${walletAddress}:${derivationIndex}` — unique per wallet+index */
  id: string;
  walletAddress: string;
  derivationIndex: number;
  commitment: string; // 0x-prefixed hex
  amount: string;
  assetId: string;
  /** filled in once discovered on-chain via event scanning */
  leafIndex: number | null;
  spent: boolean;
  createdAt: number;
}

/**
 * A regular spendable note. Its owner is this wallet's persistent
 * spendingKey (derived from a wallet signature, never stored — see
 * keys.ts); only the per-note `blinding` needs to live here.
 */
export interface StoredRegularNote extends StoredNoteBase {
  kind: "note";
  blinding: string; // bigint as decimal string
  /** Set only for deposit notes (deterministic blinding, see keys.ts's deriveDepositBlinding) — undefined for everything else (cancel-order refunds, claimed pay/match notes), which stay randomly/index-blinded. */
  source?: "deposit";
}

/**
 * A dark-pool order commitment. Owned by this wallet's same persistent
 * spendingKey as a regular note (circuits/DESIGN.md's "an order" section) —
 * `blinding` here is the order's own, separate from any note's.
 */
export interface StoredOrderNote extends StoredNoteBase {
  kind: "order";
  blinding: string;
  assetOut: string;
  minAmountOut: string;
  /** This order's size before any partial fills ever reduced it — equal to `amount` for a freshly-placed order, larger than it for a residual. Lets the UI show fill progress. */
  originalAmountIn: string;
}

export type StoredNote = StoredRegularNote | StoredOrderNote;

interface UmbraNotesDB extends DBSchema {
  notes: {
    key: string;
    value: StoredNote;
    indexes: {
      byWallet: string;
      byCommitment: string;
      byWalletSpent: [string, number]; // [walletAddress, spent as 0|1]
    };
  };
}

let dbPromise: Promise<IDBPDatabase<UmbraNotesDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<UmbraNotesDB>("umbra-notes", 1, {
      upgrade(db) {
        const store = db.createObjectStore("notes", { keyPath: "id" });
        store.createIndex("byWallet", "walletAddress");
        store.createIndex("byCommitment", "commitment", { unique: true });
        store.createIndex("byWalletSpent", ["walletAddress", "spent"]);
      },
    });
  }
  return dbPromise;
}

export async function saveNote(note: StoredNote): Promise<void> {
  const db = await getDB();
  await db.put("notes", note);
}

export async function getNoteByCommitment(commitment: string): Promise<StoredNote | undefined> {
  const db = await getDB();
  return db.getFromIndex("notes", "byCommitment", commitment);
}

export async function getNotesForWallet(walletAddress: string): Promise<StoredNote[]> {
  const db = await getDB();
  return db.getAllFromIndex("notes", "byWallet", walletAddress);
}

export async function getUnspentNotesForWallet(walletAddress: string): Promise<StoredNote[]> {
  const notes = await getNotesForWallet(walletAddress);
  return notes.filter((n) => !n.spent && n.leafIndex !== null);
}

export async function markNoteSpent(id: string): Promise<void> {
  const db = await getDB();
  const note = await db.get("notes", id);
  if (!note) return;
  note.spent = true;
  await db.put("notes", note);
}

export async function setNoteLeafIndex(commitment: string, leafIndex: number): Promise<void> {
  const db = await getDB();
  const note = await db.getFromIndex("notes", "byCommitment", commitment);
  if (!note) return;
  note.leafIndex = leafIndex;
  await db.put("notes", note);
}

/** Highest derivation index already saved for this wallet, so scanning knows where to resume. */
export async function getNextDerivationIndex(walletAddress: string): Promise<number> {
  const notes = await getNotesForWallet(walletAddress);
  if (notes.length === 0) return 0;
  return Math.max(...notes.map((n) => n.derivationIndex)) + 1;
}

/** How many deposit notes of this exact `(assetId, amount)` pair this wallet already has locally — the next deterministic deposit blinding's `salt` (see keys.ts's deriveDepositBlinding). Counts every locally-known deposit note regardless of spent status, since salt assignment must never be reused even after a note is spent. */
export async function countDepositNotes(walletAddress: string, assetId: string, amount: string): Promise<number> {
  const notes = await getNotesForWallet(walletAddress);
  return notes.filter((n) => n.kind === "note" && n.source === "deposit" && n.assetId === assetId && n.amount === amount).length;
}
