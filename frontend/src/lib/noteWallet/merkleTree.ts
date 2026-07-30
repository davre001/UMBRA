import { hashLeftRight } from "./poseidon2";

// Mirrors contract/contracts/lib/MerkleTreeWithHistory.sol exactly — same
// LEVELS, same ZERO_VALUE. On-chain, the tree is built incrementally
// (filled-subtrees algorithm); here it's rebuilt as full layers from
// scratch each time, which is simpler to get right and produces identical
// roots/paths — verified against real on-chain fixtures below.
export const LEVELS = 20;
export const ZERO_VALUE = BigInt("6553590586423608260410254385500912220875115508942847723390064418770335574135");

function computeZeros(): bigint[] {
  const zeros: bigint[] = [ZERO_VALUE];
  for (let i = 1; i <= LEVELS; i++) {
    zeros.push(hashLeftRight(zeros[i - 1], zeros[i - 1]));
  }
  return zeros;
}

const ZEROS = computeZeros();

export interface MerkleProof {
  pathElements: bigint[];
  pathIndices: boolean[];
}

/**
 * A tree over `leaves[0..asOfIndex]` (leaves beyond `asOfIndex` don't exist
 * yet, as far as this instance is concerned). Its root matches whatever
 * ShieldedVault.currentRoot() was on-chain right after `asOfIndex` was
 * inserted — a root the contract accepts forever (isKnownRoot never
 * expires, see MerkleTreeWithHistory.sol), so an older `asOfIndex` than the
 * tree's real current size is still a fully valid proof, not an
 * approximation.
 *
 * `matchOrders` needs two leaves proven against the *same* root: build one
 * instance with `asOfIndex = max(indexA, indexB)` and call `.path()` for
 * both, rather than building two separate instances.
 */
export class MerkleTree {
  private readonly layers: bigint[][];

  constructor(leaves: bigint[], asOfIndex: number = leaves.length - 1) {
    if (asOfIndex < 0 || asOfIndex >= leaves.length) {
      throw new Error(`asOfIndex ${asOfIndex} out of range for ${leaves.length} leaves`);
    }
    this.layers = [leaves.slice(0, asOfIndex + 1)];
    for (let level = 0; level < LEVELS; level++) {
      const current = this.layers[level];
      const next: bigint[] = [];
      const pairCount = Math.ceil(Math.max(current.length, 1) / 2);
      for (let i = 0; i < pairCount; i++) {
        const left = current[2 * i] ?? ZEROS[level];
        const right = current[2 * i + 1] ?? ZEROS[level];
        next.push(hashLeftRight(left, right));
      }
      this.layers.push(next);
    }
  }

  get root(): bigint {
    return this.layers[LEVELS][0] ?? ZEROS[LEVELS];
  }

  path(index: number): MerkleProof {
    const pathElements: bigint[] = [];
    const pathIndices: boolean[] = [];
    let idx = index;
    for (let level = 0; level < LEVELS; level++) {
      const isRight = idx % 2 === 1;
      const siblingIndex = isRight ? idx - 1 : idx + 1;
      const sibling = this.layers[level][siblingIndex] ?? ZEROS[level];
      pathElements.push(sibling);
      pathIndices.push(isRight);
      idx = Math.floor(idx / 2);
    }
    return { pathElements, pathIndices };
  }
}
