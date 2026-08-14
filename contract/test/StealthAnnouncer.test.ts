import { expect } from "chai";
import { ethers } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { StealthAnnouncer } from "../typechain-types";

describe("StealthAnnouncer", function () {
  this.timeout(300_000);

  let announcer: StealthAnnouncer;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let charlie: HardhatEthersSigner;

  beforeEach(async () => {
    [alice, bob, charlie] = await ethers.getSigners();
    const Announcer = await ethers.getContractFactory("StealthAnnouncer");
    announcer = await Announcer.deploy();
  });

  describe("Event emission and parameter fidelity", () => {
    it("emits an Announcement event with exact parameters for standard scheme 1", async () => {
      const stealthAddress = ethers.Wallet.createRandom().address;
      const ephemeralPubKey = "0x02" + "ab".repeat(32);
      const metadata = ethers.hexlify(ethers.toUtf8Bytes("view-tag:1"));

      await expect(announcer.connect(alice).announce(1n, stealthAddress, ephemeralPubKey, metadata))
        .to.emit(announcer, "Announcement")
        .withArgs(1n, stealthAddress, alice.address, ephemeralPubKey, metadata);
    });

    it("correctly records caller as msg.sender across different callers", async () => {
      const stealthAddress = ethers.Wallet.createRandom().address;
      const ephemeralPubKey = "0x03" + "cd".repeat(32);
      const metadata = "0x1234";

      await expect(announcer.connect(bob).announce(1n, stealthAddress, ephemeralPubKey, metadata))
        .to.emit(announcer, "Announcement")
        .withArgs(1n, stealthAddress, bob.address, ephemeralPubKey, metadata);

      await expect(announcer.connect(charlie).announce(1n, stealthAddress, ephemeralPubKey, metadata))
        .to.emit(announcer, "Announcement")
        .withArgs(1n, stealthAddress, charlie.address, ephemeralPubKey, metadata);
    });
  });

  describe("Boundary conditions: scheme IDs", () => {
    it("handles schemeId = 0", async () => {
      const stealthAddress = ethers.Wallet.createRandom().address;
      const pubKey = "0x02" + "00".repeat(32);
      const meta = "0x00";

      await expect(announcer.connect(alice).announce(0n, stealthAddress, pubKey, meta))
        .to.emit(announcer, "Announcement")
        .withArgs(0n, stealthAddress, alice.address, pubKey, meta);
    });

    it("handles maximum uint256 schemeId", async () => {
      const maxUint256 = ethers.MaxUint256;
      const stealthAddress = ethers.Wallet.createRandom().address;
      const pubKey = "0x02" + "ff".repeat(32);
      const meta = "0xffff";

      await expect(announcer.connect(alice).announce(maxUint256, stealthAddress, pubKey, meta))
        .to.emit(announcer, "Announcement")
        .withArgs(maxUint256, stealthAddress, alice.address, pubKey, meta);
    });
  });

  describe("Boundary conditions: stealth addresses", () => {
    it("allows announcement for address(0)", async () => {
      const pubKey = "0x02" + "11".repeat(32);
      const meta = "0x";

      await expect(announcer.connect(alice).announce(1n, ethers.ZeroAddress, pubKey, meta))
        .to.emit(announcer, "Announcement")
        .withArgs(1n, ethers.ZeroAddress, alice.address, pubKey, meta);
    });

    it("allows announcement where stealthAddress is caller address", async () => {
      const pubKey = "0x02" + "22".repeat(32);
      const meta = "0xaa";

      await expect(announcer.connect(alice).announce(1n, alice.address, pubKey, meta))
        .to.emit(announcer, "Announcement")
        .withArgs(1n, alice.address, alice.address, pubKey, meta);
    });

    it("allows announcement for contract address", async () => {
      const contractAddress = await announcer.getAddress();
      const pubKey = "0x02" + "33".repeat(32);
      const meta = "0xbb";

      await expect(announcer.connect(alice).announce(1n, contractAddress, pubKey, meta))
        .to.emit(announcer, "Announcement")
        .withArgs(1n, contractAddress, alice.address, pubKey, meta);
    });
  });

  describe("Boundary conditions: payloads and sizes", () => {
    it("handles empty ephemeralPubKey (0x)", async () => {
      const stealthAddress = ethers.Wallet.createRandom().address;
      await expect(announcer.connect(alice).announce(1n, stealthAddress, "0x", "0x"))
        .to.emit(announcer, "Announcement")
        .withArgs(1n, stealthAddress, alice.address, "0x", "0x");
    });

    it("handles 65-byte uncompressed ephemeral public key", async () => {
      const stealthAddress = ethers.Wallet.createRandom().address;
      const uncompressedKey = "0x04" + "44".repeat(64); // 65 bytes
      const meta = "0x123456";

      await expect(announcer.connect(alice).announce(1n, stealthAddress, uncompressedKey, meta))
        .to.emit(announcer, "Announcement")
        .withArgs(1n, stealthAddress, alice.address, uncompressedKey, meta);
    });

    it("handles large 1024-byte ephemeralPubKey and 2048-byte metadata", async () => {
      const stealthAddress = ethers.Wallet.createRandom().address;
      const largePubKey = "0x" + "aa".repeat(1024);
      const largeMetadata = "0x" + "bb".repeat(2048);

      await expect(announcer.connect(alice).announce(1n, stealthAddress, largePubKey, largeMetadata))
        .to.emit(announcer, "Announcement")
        .withArgs(1n, stealthAddress, alice.address, largePubKey, largeMetadata);
    });

    it("handles multiple rapid sequential announcements in a single block without state corruption", async () => {
      const recipient1 = ethers.Wallet.createRandom().address;
      const recipient2 = ethers.Wallet.createRandom().address;
      const key1 = "0x02" + "01".repeat(32);
      const key2 = "0x02" + "02".repeat(32);

      const tx1 = await announcer.connect(alice).announce(1n, recipient1, key1, "0x01");
      const tx2 = await announcer.connect(bob).announce(1n, recipient2, key2, "0x02");

      await expect(tx1).to.emit(announcer, "Announcement").withArgs(1n, recipient1, alice.address, key1, "0x01");
      await expect(tx2).to.emit(announcer, "Announcement").withArgs(1n, recipient2, bob.address, key2, "0x02");
    });
  });
});
