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
}

/**
 * A dark-pool order commitment. Unlike a regular note, an order's
 * nullifier/secret pair is per-order (not split into a persistent
 * spendingKey + owner_key) — see circuits/DESIGN.md's "Paying a different
 * recipient" section for why orders don't need that split.
 */
export interface StoredOrderNote extends StoredNoteBase {
  kind: "order";
  secret: string;
  nullifier: string;
  assetOut: string;
  minAmountOut: string;
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
