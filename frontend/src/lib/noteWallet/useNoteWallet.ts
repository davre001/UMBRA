"use client";

import { useCallback, useMemo, useRef } from "react";
import { useAccount, usePublicClient, useSignMessage } from "wagmi";
import type { Hex } from "viem";
import { DERIVATION_MESSAGE, deriveBlinding, deriveDepositBlinding, deriveSpendingKey, randomBlinding } from "./keys";
import {
  commitment as computeCommitment,
  nullifierHash as computeNullifierHash,
  orderCommitment as computeOrderCommitment,
  ownerKey as computeOwnerKey,
} from "./poseidon2";
import {
  countDepositNotes,
  getNextDerivationIndex,
  getNotesForWallet,
  getUnspentNotesForWallet,
  markNoteSpent,
  saveNote,
  setNoteLeafIndex,
  type StoredNote,
  type StoredOrderNote,
} from "./store";
import { fetchAllLeaves, isNullifierSpentOnChain, scanShieldedDeposits } from "./scan";
import { fetchIncomingAnnouncements, fetchIncomingOrderAnnouncements, type AnnouncedOrder } from "./announcer";
import { MerkleTree, type MerkleProof } from "./merkleTree";

function toHex(value: bigint): `0x${string}` {
  return ("0x" + value.toString(16).padStart(64, "0")) as `0x${string}`;
}

interface PreparedNote {
  kind: "note";
  blinding: bigint;
  commitment: bigint;
  amount: bigint;
  assetId: bigint;
  derivationIndex: number;
  /** Set only by prepareDepositNote — see store.ts's StoredRegularNote.source. */
  source?: "deposit";
}

interface PreparedOrder {
  kind: "order";
  blinding: bigint;
  commitment: bigint;
  amount: bigint;
  assetId: bigint;
  assetOut: bigint;
  minAmountOut: bigint;
  derivationIndex: number;
}

/**
 * Ties together key derivation, local storage, and chain scanning into the
 * operations a page actually needs. Doesn't generate ZK proofs itself — see
 * lib/proving/prove.ts for that, built separately from this file.
 */
export function useNoteWallet(vaultAddress: `0x${string}` | undefined, deployBlock: bigint = BigInt(0)) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const publicClient = usePublicClient();

  // Persisted per-address in localStorage, not memory-only — a deliberate
  // tradeoff: the signature never authorizes a transaction by itself (see
  // DERIVATION_MESSAGE) and now that a vault session survives a reload too
  // (see app-provider.tsx's ENTERED_STORAGE_KEY), re-prompting on every
  // reload anyway would just be friction with no real security benefit left
  // to protect. Keyed by address so switching wallets can't reuse a stale
  // signature for the wrong one.
  const signatureRef = useRef<{ address: string; signature: Hex } | null>(null);

  const getSignature = useCallback(async (): Promise<Hex> => {
    if (!address) throw new Error("Wallet not connected");
    if (signatureRef.current?.address === address) return signatureRef.current.signature;

    const storageKey = `umbra:signature:${address.toLowerCase()}`;
    const stored = localStorage.getItem(storageKey) as Hex | null;
    if (stored) {
      signatureRef.current = { address, signature: stored };
      return stored;
    }

    const sig = await signMessageAsync({ message: DERIVATION_MESSAGE });
    signatureRef.current = { address, signature: sig };
    localStorage.setItem(storageKey, sig);
    return sig;
  }, [address, signMessageAsync]);

  /** This wallet's persistent private spending key — never leaves this function's caller. */
  const getSpendingKey = useCallback(async (): Promise<bigint> => {
    const signature = await getSignature();
    return deriveSpendingKey(signature);
  }, [getSignature]);

  /** This wallet's public ownerKey — safe to publish (e.g. via OwnerKeyRegistry) so others can pay it. */
  const getOwnerKey = useCallback(async (): Promise<bigint> => {
    return computeOwnerKey(await getSpendingKey());
  }, [getSpendingKey]);

  /** Derives a fresh regular note credited to this wallet's own ownerKey, ready to use in a `shield` call. Not yet persisted — call `confirmNote` once the tx succeeds. */
  const prepareNote = useCallback(
    async (amount: bigint, assetId: bigint): Promise<PreparedNote> => {
      if (!address) throw new Error("Wallet not connected");
      const signature = await getSignature();
      const spendingKey = deriveSpendingKey(signature);
      const index = await getNextDerivationIndex(address);
      const blinding = deriveBlinding(signature, index);
      const commitment = computeCommitment(assetId, amount, computeOwnerKey(spendingKey), blinding);
      return { kind: "note", blinding, commitment, amount, assetId, derivationIndex: index };
    },
    [address, getSignature]
  );

  /**
   * Like `prepareNote`, but specifically for a Shield deposit: uses
   * deterministic, recoverable blinding (deriveDepositBlinding) instead of
   * the plain local-index one, so this exact note can be found again by
   * `recoverDepositNotes` from a different browser/device. `derivationIndex`
   * here is still just a local unique-id source (confirmNote's `id`), not
   * part of the blinding itself.
   */
  const prepareDepositNote = useCallback(
    async (amount: bigint, assetId: bigint): Promise<PreparedNote> => {
      if (!address) throw new Error("Wallet not connected");
      const signature = await getSignature();
      const spendingKey = deriveSpendingKey(signature);
      const salt = await countDepositNotes(address, assetId.toString(), amount.toString());
      const blinding = deriveDepositBlinding(signature, assetId, amount, salt);
      const commitment = computeCommitment(assetId, amount, computeOwnerKey(spendingKey), blinding);
      const derivationIndex = await getNextDerivationIndex(address);
      return { kind: "note", blinding, commitment, amount, assetId, derivationIndex, source: "deposit" };
    },
    [address, getSignature]
  );

  /**
   * Derives a fresh order commitment, ready to use in a `placeOrder` call.
   * Owned by this wallet's same persistent spendingKey as a regular note
   * (circuits/DESIGN.md's "an order" section) — only the blinding is fresh
   * per order, same role as a note's own blinding.
   */
  const prepareOrderNote = useCallback(
    async (amountIn: bigint, assetIn: bigint, assetOut: bigint, minAmountOut: bigint): Promise<PreparedOrder> => {
      if (!address) throw new Error("Wallet not connected");
      const signature = await getSignature();
      const spendingKey = deriveSpendingKey(signature);
      const index = await getNextDerivationIndex(address);
      const blinding = deriveBlinding(signature, index);
      const commitment = computeOrderCommitment(computeOwnerKey(spendingKey), blinding, amountIn, assetIn, assetOut, minAmountOut);
      return {
        kind: "order",
        blinding,
        commitment,
        amount: amountIn,
        assetId: assetIn,
        assetOut,
        minAmountOut,
        derivationIndex: index,
      };
    },
    [address, getSignature]
  );

  /** Builds a note credited to someone else's published ownerKey — the output side of a `pay` call. Not saved locally (it isn't spendable by this wallet); deliver it to the recipient via announceNote. */
  const buildRecipientNote = useCallback((amount: bigint, assetId: bigint, recipientOwnerKey: bigint) => {
    const blinding = randomBlinding();
    const commitment = computeCommitment(assetId, amount, recipientOwnerKey, blinding);
    return { blinding, ownerKey: recipientOwnerKey, commitment, amount, assetId };
  }, []);

  /** Persists a note this wallet created for itself, after its creating transaction confirmed. `leafIndex` should come straight from the emitted event, not a scan — it's already known. */
  const confirmNote = useCallback(
    async (prepared: PreparedNote | PreparedOrder, leafIndex: number): Promise<StoredNote> => {
      if (!address) throw new Error("Wallet not connected");
      const base = {
        id: `${address}:${prepared.derivationIndex}`,
        walletAddress: address,
        derivationIndex: prepared.derivationIndex,
        commitment: toHex(prepared.commitment),
        amount: prepared.amount.toString(),
        assetId: prepared.assetId.toString(),
        leafIndex,
        spent: false,
        createdAt: Date.now(),
      };
      const stored: StoredNote =
        prepared.kind === "note"
          ? { ...base, kind: "note", blinding: prepared.blinding.toString(), ...(prepared.source ? { source: prepared.source } : {}) }
          : {
              ...base,
              kind: "order",
              blinding: prepared.blinding.toString(),
              assetOut: prepared.assetOut.toString(),
              minAmountOut: prepared.minAmountOut.toString(),
              // A freshly-placed order hasn't been filled at all yet.
              originalAmountIn: prepared.amount.toString(),
            };
      await saveNote(stored);
      return stored;
    },
    [address]
  );

  /** Unspent notes for the connected wallet, as currently known locally. */
  const listUnspentNotes = useCallback(async (): Promise<StoredNote[]> => {
    if (!address) return [];
    return getUnspentNotesForWallet(address);
  }, [address]);

  /** Re-checks each note's nullifier on-chain and marks it spent locally if it no longer is — covers a note spent from another session. */
  const refreshSpentStatus = useCallback(async (): Promise<void> => {
    if (!address || !publicClient || !vaultAddress) return;
    const notes = await listUnspentNotes();
    if (notes.length === 0) return;
    // Orders now use this wallet's same persistent spendingKey as a regular
    // note (circuits/DESIGN.md's "an order" section) — one key covers both.
    const spendingKey = deriveSpendingKey(await getSignature());
    await Promise.all(
      notes.map(async (note) => {
        const nh = computeNullifierHash(BigInt(note.commitment), spendingKey);
        const spent = await isNullifierSpentOnChain(publicClient, vaultAddress, nh);
        if (spent) await markNoteSpent(note.id);
      })
    );
  }, [address, publicClient, vaultAddress, listUnspentNotes, getSignature]);

  /**
   * Notes announced (via StealthAnnouncer) to this wallet's address that
   * aren't already saved locally. Verifies each candidate before returning
   * it: recomputes the commitment from the announced (assetId, amount,
   * blinding) against this wallet's own ownerKey — an announcement that
   * doesn't reproduce a real on-chain commitment is either corrupted or not
   * really addressed to this wallet, and is silently skipped rather than
   * surfaced as claimable.
   */
  const scanIncomingNotes = useCallback(
    async (announcerAddress: `0x${string}`): Promise<{ assetId: bigint; amount: bigint; blinding: bigint; commitment: bigint }[]> => {
      if (!address || !publicClient) return [];
      const [announcements, ownOwnerKey, known] = await Promise.all([
        fetchIncomingAnnouncements(publicClient, announcerAddress, address as `0x${string}`, deployBlock),
        getOwnerKey(),
        // Every locally-known note, not just unspent ones — the announcement
        // itself never leaves StealthAnnouncer's event log once claimed and
        // later spent, so filtering to unspent-only would make an
        // already-claimed-and-spent note look claimable again, and re-saving
        // it would collide with the store's own commitment uniqueness index.
        getNotesForWallet(address),
      ]);
      const knownCommitments = new Set(known.map((n) => n.commitment.toLowerCase()));

      const claimable: { assetId: bigint; amount: bigint; blinding: bigint; commitment: bigint }[] = [];
      for (const note of announcements) {
        if (knownCommitments.has(toHex(note.commitment).toLowerCase())) continue;
        const expected = computeCommitment(note.assetId, note.amount, ownOwnerKey, note.blinding);
        if (expected !== note.commitment) continue; // not really addressed to us, or corrupted metadata
        claimable.push(note);
      }
      return claimable;
    },
    [address, publicClient, getOwnerKey, deployBlock]
  );

  /** Saves a note verified by `scanIncomingNotes` into local storage, so it becomes spendable like any other owned note. Looks up its on-chain leafIndex by matching commitments in the full leaf history. */
  const claimIncomingNote = useCallback(
    async (note: { assetId: bigint; amount: bigint; blinding: bigint; commitment: bigint }): Promise<StoredNote> => {
      if (!address || !publicClient || !vaultAddress) throw new Error("Wallet or vault not ready");
      const leaves = await fetchAllLeaves(publicClient, vaultAddress, deployBlock);
      const leafIndex = leaves.findIndex((leaf) => leaf === note.commitment);
      if (leafIndex === -1) throw new Error("Announced note's commitment wasn't found on-chain yet");

      const index = await getNextDerivationIndex(address);
      const stored: StoredNote = {
        id: `${address}:${index}`,
        walletAddress: address,
        derivationIndex: index,
        kind: "note",
        blinding: note.blinding.toString(),
        commitment: toHex(note.commitment),
        amount: note.amount.toString(),
        assetId: note.assetId.toString(),
        leafIndex,
        spent: false,
        createdAt: Date.now(),
      };
      await saveNote(stored);
      return stored;
    },
    [address, publicClient, vaultAddress, deployBlock]
  );

  /**
   * Residual orders announced (via StealthAnnouncer) to this wallet's
   * address that aren't already saved locally — a partial fill's leftover
   * (circuits/DESIGN.md's "an order" section), delivered the same way a
   * matched note is. Verified the same way: recomputes the order commitment
   * from the announced fields against this wallet's own ownerKey.
   */
  const scanIncomingOrders = useCallback(
    async (announcerAddress: `0x${string}`): Promise<AnnouncedOrder[]> => {
      if (!address || !publicClient) return [];
      const [announcements, ownOwnerKey, known] = await Promise.all([
        fetchIncomingOrderAnnouncements(publicClient, announcerAddress, address as `0x${string}`, deployBlock),
        getOwnerKey(),
        // See scanIncomingNotes's own comment — same reasoning applies to
        // residual orders that were claimed and have since matched/settled.
        getNotesForWallet(address),
      ]);
      const knownCommitments = new Set(known.map((n) => n.commitment.toLowerCase()));

      const claimable: AnnouncedOrder[] = [];
      for (const order of announcements) {
        if (knownCommitments.has(toHex(order.commitment).toLowerCase())) continue;
        const expected = computeOrderCommitment(ownOwnerKey, order.blinding, order.amountIn, order.assetIn, order.assetOut, order.minAmountOut);
        if (expected !== order.commitment) continue; // not really addressed to us, or corrupted metadata
        claimable.push(order);
      }
      return claimable;
    },
    [address, publicClient, getOwnerKey, deployBlock]
  );

  /** Saves a residual order verified by `scanIncomingOrders` into local storage, so it shows up in "My Orders" like any other owned order. Looks up its on-chain leafIndex the same way `claimIncomingNote` does. */
  const claimIncomingOrder = useCallback(
    async (order: AnnouncedOrder): Promise<StoredOrderNote> => {
      if (!address || !publicClient || !vaultAddress) throw new Error("Wallet or vault not ready");
      const leaves = await fetchAllLeaves(publicClient, vaultAddress, deployBlock);
      const leafIndex = leaves.findIndex((leaf) => leaf === order.commitment);
      if (leafIndex === -1) throw new Error("Announced order's commitment wasn't found on-chain yet");

      const index = await getNextDerivationIndex(address);
      const stored: StoredOrderNote = {
        id: `${address}:${index}`,
        walletAddress: address,
        derivationIndex: index,
        kind: "order",
        blinding: order.blinding.toString(),
        commitment: toHex(order.commitment),
        amount: order.amountIn.toString(),
        assetId: order.assetIn.toString(),
        assetOut: order.assetOut.toString(),
        minAmountOut: order.minAmountOut.toString(),
        originalAmountIn: order.originalAmountIn.toString(),
        leafIndex,
        spent: false,
        createdAt: Date.now(),
      };
      await saveNote(stored);
      return stored;
    },
    [address, publicClient, vaultAddress, deployBlock]
  );

  /** Merkle proof for a note that's already known to be on-chain (leafIndex set). Rebuilds the tree from the full on-chain leaf history each call — see scan.ts for why that's the deliberate, self-checking tradeoff. */
  const getMerkleProof = useCallback(
    async (note: StoredNote, asOfLeafIndex?: number): Promise<MerkleProof & { root: bigint }> => {
      if (!publicClient || !vaultAddress) throw new Error("No public client / vault address");
      if (note.leafIndex === null) throw new Error("Note has no leafIndex yet — call setNoteLeafIndex first");
      const leaves = await fetchAllLeaves(publicClient, vaultAddress, deployBlock);
      const tree = new MerkleTree(leaves, asOfLeafIndex);
      const proof = tree.path(note.leafIndex);
      return { ...proof, root: tree.root };
    },
    [publicClient, vaultAddress, deployBlock]
  );

  /**
   * Recovers this wallet's own Shield deposit notes from on-chain data alone
   * — the point of prepareDepositNote's deterministic blinding. For every
   * distinct `(assetId, amount)` any deposit into this vault ever used,
   * tries salt 0, 1, 2, ... recomputing the candidate commitment this
   * wallet's key would have produced at that salt, and checks it against
   * the real on-chain commitments for that pair; stops at the first salt
   * with no match (salts are assigned strictly sequentially, so a gap means
   * there are no more). Newly-found notes are saved locally exactly like a
   * fresh deposit would be, backfilling `spent` from the real nullifier
   * state. Returns how many new notes were recovered.
   */
  const recoverDepositNotes = useCallback(async (): Promise<number> => {
    if (!address || !publicClient || !vaultAddress) return 0;
    const [signature, deposits, known] = await Promise.all([
      getSignature(),
      scanShieldedDeposits(publicClient, vaultAddress, deployBlock),
      getNotesForWallet(address),
    ]);
    const spendingKey = deriveSpendingKey(signature);
    const ownOwnerKey = computeOwnerKey(spendingKey);
    const knownCommitments = new Set(known.map((n) => n.commitment.toLowerCase()));

    const groups = new Map<string, typeof deposits>();
    for (const d of deposits) {
      const key = `${d.assetId}:${d.amount}`;
      const list = groups.get(key);
      if (list) list.push(d);
      else groups.set(key, [d]);
    }

    let recovered = 0;
    for (const [key, group] of groups) {
      const [assetIdStr, amountStr] = key.split(":");
      const assetId = BigInt(assetIdStr);
      const amount = BigInt(amountStr);
      const byCommitment = new Map(group.map((d) => [d.commitment, d]));

      for (let salt = 0; ; salt += 1) {
        const blinding = deriveDepositBlinding(signature, assetId, amount, salt);
        const candidateCommitment = computeCommitment(assetId, amount, ownOwnerKey, blinding);
        const match = byCommitment.get(candidateCommitment);
        if (!match) break;

        if (knownCommitments.has(toHex(candidateCommitment).toLowerCase())) continue;
        const nh = computeNullifierHash(candidateCommitment, spendingKey);
        const spent = await isNullifierSpentOnChain(publicClient, vaultAddress, nh);
        const derivationIndex = await getNextDerivationIndex(address);
        const stored: StoredNote = {
          id: `${address}:${derivationIndex}`,
          walletAddress: address,
          derivationIndex,
          kind: "note",
          blinding: blinding.toString(),
          commitment: toHex(candidateCommitment),
          amount: amount.toString(),
          assetId: assetId.toString(),
          leafIndex: match.leafIndex,
          spent,
          createdAt: Date.now(),
          source: "deposit",
        };
        await saveNote(stored);
        recovered += 1;
      }
    }
    return recovered;
  }, [address, publicClient, vaultAddress, deployBlock, getSignature]);

  return useMemo(
    () => ({
      getSignature,
      getSpendingKey,
      getOwnerKey,
      prepareNote,
      prepareDepositNote,
      prepareOrderNote,
      buildRecipientNote,
      confirmNote,
      listUnspentNotes,
      refreshSpentStatus,
      scanIncomingNotes,
      claimIncomingNote,
      scanIncomingOrders,
      claimIncomingOrder,
      getMerkleProof,
      recoverDepositNotes,
      setNoteLeafIndex,
    }),
    [
      getSignature,
      getSpendingKey,
      getOwnerKey,
      prepareNote,
      prepareDepositNote,
      prepareOrderNote,
      buildRecipientNote,
      confirmNote,
      listUnspentNotes,
      refreshSpentStatus,
      scanIncomingNotes,
      claimIncomingNote,
      scanIncomingOrders,
      claimIncomingOrder,
      getMerkleProof,
      recoverDepositNotes,
    ]
  );
}
