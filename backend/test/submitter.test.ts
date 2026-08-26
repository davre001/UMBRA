import { describe, it, expect } from "vitest";
import ECPairFactory from "ecpair";
import * as ecc from "tiny-secp256k1";
import { announceMatchedNote, announceResidualOrder, submitMatch } from "../src/dark-engine/submitter";
import { getWalletClient, publicClient, CONTRACTS } from "../src/shared/chain";
import { PRIVACY_KEY_REGISTRY_ABI } from "../src/shared/privacyKeyRegistryAbi";
import type { OrderIntent, MatchProofInputs, MatchOrderSide } from "../src/dark-engine/types";
import { ZERO_VALUE } from "../src/shared/merkleTree";

const ECPair = ECPairFactory(ecc);

/**
 * Real end-to-end StealthAnnouncer calls against live Coston2 — same
 * "needs a funded PRIVATE_KEY, no-op in CI" convention as relayer.test.ts/
 * dark-engine.test.ts. `submitMatch`'s own happy path is deliberately NOT
 * covered here: it needs a vault Merkle tree in a state only reachable via
 * live in-test proving, which contract/test/ShieldedVault.test.ts already
 * disclosed as out of scope for the exact same reason (see that file's own
 * comment above its match_orders/cancelOrder section) — this instead
 * covers submitMatch's real revert path, which needs no special tree state
 * at all (any garbage proof reverts regardless of what's on-chain).
 */

function order(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return {
    commitment: "0x1",
    leafIndex: 0,
    spendingKey: "1",
    orderBlinding: "1",
    amountIn: "1000",
    originalAmountIn: "1000",
    assetIn: 0,
    assetOut: 1,
    minAmountOut: "1",
    ownerKey: "1",
    walletAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // real, checksummed Hardhat test address — must pass viem's checksum validation for a real on-chain readContract/writeContract call
    submittedAt: Date.now(),
    ...overrides,
  };
}

describe("dark-engine / submitter", () => {
  it.skipIf(!!process.env.CI)(
    "announceMatchedNote submits a real StealthAnnouncer.announce() tx and confirms",
    async () => {
      const txHash = await announceMatchedNote(order(), BigInt(1), BigInt(500), BigInt(42), BigInt(99));
      expect(txHash).toMatch(/^0x[0-9a-f]{64}$/);
    },
    30_000
  );

  it.skipIf(!!process.env.CI)(
    "announceResidualOrder submits a real StealthAnnouncer.announce() tx and confirms",
    async () => {
      const txHash = await announceResidualOrder(
        order(),
        { amountIn: BigInt(200), minAmountOut: BigInt(1), commitment: BigInt(77) },
        BigInt(55)
      );
      expect(txHash).toMatch(/^0x[0-9a-f]{64}$/);
    },
    30_000
  );

  it.skipIf(!!process.env.CI)(
    "submitMatch propagates a real on-chain revert for a structurally-invalid proof, regardless of vault tree state",
    async () => {
      const zeroSide: MatchOrderSide = {
        spendingKey: BigInt(1),
        orderBlinding: BigInt(1),
        amountIn: BigInt(1),
        assetIn: BigInt(0),
        assetOut: BigInt(1),
        minAmountOut: BigInt(1),
        pathElements: [],
        pathIndices: [],
        outBlinding: BigInt(1),
        residualBlinding: BigInt(1),
      };
      const inputs: MatchProofInputs = {
        root: BigInt(1),
        nullifierHashA: BigInt(2),
        nullifierHashB: BigInt(3),
        outCommitmentA: BigInt(4),
        outCommitmentB: BigInt(5),
        residualCommitmentA: ZERO_VALUE,
        residualCommitmentB: ZERO_VALUE,
        fillA: BigInt(1),
        fillB: BigInt(1),
        a: zeroSide,
        b: zeroSide,
      };
      await expect(submitMatch("0xdeadbeef" as `0x${string}`, inputs)).rejects.toThrow();
    },
    30_000
  );

  it.skipIf(!!process.env.CI || !CONTRACTS.PrivacyKeyRegistry)(
    "announceMatchedNote/announceResidualOrder take the encrypted branch for a trader with a real registered privacy key",
    async () => {
      // Registers a real privacy key for the OPERATOR's own address (the
      // only account this test process holds a real private key for) rather
      // than a well-known Hardhat address it doesn't control — register()
      // requires msg.sender to be the wallet registering its own key. A
      // real, valid secp256k1 compressed pubkey (same curve Bitcoin uses —
      // reused via ecpair/tiny-secp256k1, same as this repo's own BTC
      // reserve tests), not a synthetic 33-byte buffer: submitter.ts's
      // encryption path does real elliptic-curve math with this key, which
      // a garbage-but-right-length buffer would fail on.
      const wallet = getWalletClient();
      const traderAddress = wallet.account!.address;
      const keyPair = ECPair.makeRandom();
      const privacyKeyHex = ("0x" + Buffer.from(keyPair.publicKey).toString("hex")) as `0x${string}`;

      const registerTx = await wallet.writeContract({
        address: CONTRACTS.PrivacyKeyRegistry as `0x${string}`,
        abi: PRIVACY_KEY_REGISTRY_ABI,
        functionName: "register",
        args: [privacyKeyHex],
        chain: wallet.chain,
        account: wallet.account!,
      });
      await publicClient.waitForTransactionReceipt({ hash: registerTx });

      const traderOrder = order({ walletAddress: traderAddress });
      const noteTx = await announceMatchedNote(traderOrder, BigInt(1), BigInt(500), BigInt(42), BigInt(99));
      expect(noteTx).toMatch(/^0x[0-9a-f]{64}$/);

      const residualTx = await announceResidualOrder(
        traderOrder,
        { amountIn: BigInt(200), minAmountOut: BigInt(1), commitment: BigInt(77) },
        BigInt(55)
      );
      expect(residualTx).toMatch(/^0x[0-9a-f]{64}$/);
    },
    60_000
  );
});
