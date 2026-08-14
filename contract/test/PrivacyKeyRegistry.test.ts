import { expect } from "chai";
import { ethers } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { PrivacyKeyRegistry } from "../typechain-types";

describe("PrivacyKeyRegistry", () => {
  let registry: PrivacyKeyRegistry;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let charlie: HardhatEthersSigner;
  let dave: HardhatEthersSigner;
  let eve: HardhatEthersSigner;

  const validKey1 = "0x02" + "11".repeat(32); // 33 bytes compressed (even parity)
  const validKey2 = "0x03" + "22".repeat(32); // 33 bytes compressed (odd parity)
  const validKey3 = "0x02" + "33".repeat(32);

  beforeEach(async () => {
    [alice, bob, charlie, dave, eve] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("PrivacyKeyRegistry");
    registry = await Registry.deploy();
  });

  describe("Initial State & Defaults", () => {
    it("defaults any unregistered address to not registered with empty bytes key", async () => {
      expect(await registry.isRegistered(alice.address)).to.equal(false);
      expect(await registry.privacyKeyOf(alice.address)).to.equal("0x");
      expect(await registry.isRegistered(ethers.ZeroAddress)).to.equal(false);
      expect(await registry.privacyKeyOf(ethers.ZeroAddress)).to.equal("0x");
    });

    it("reports KEY_LENGTH constant as 33", async () => {
      expect(await registry.KEY_LENGTH()).to.equal(33n);
    });
  });

  describe("Registration & Events", () => {
    it("successfully registers a 33-byte key and emits PrivacyKeyRegistered", async () => {
      await expect(registry.connect(alice).register(validKey1))
        .to.emit(registry, "PrivacyKeyRegistered")
        .withArgs(alice.address, validKey1);

      expect(await registry.isRegistered(alice.address)).to.equal(true);
      expect(await registry.privacyKeyOf(alice.address)).to.equal(validKey1);
    });

    it("allows registering keys with 0x03 prefix", async () => {
      await expect(registry.connect(bob).register(validKey2))
        .to.emit(registry, "PrivacyKeyRegistered")
        .withArgs(bob.address, validKey2);

      expect(await registry.isRegistered(bob.address)).to.equal(true);
      expect(await registry.privacyKeyOf(bob.address)).to.equal(validKey2);
    });

    it("allows a wallet to overwrite its existing registration", async () => {
      // 1. Initial register
      await registry.connect(alice).register(validKey1);
      expect(await registry.privacyKeyOf(alice.address)).to.equal(validKey1);

      // 2. Overwrite
      await expect(registry.connect(alice).register(validKey2))
        .to.emit(registry, "PrivacyKeyRegistered")
        .withArgs(alice.address, validKey2);

      expect(await registry.isRegistered(alice.address)).to.equal(true);
      expect(await registry.privacyKeyOf(alice.address)).to.equal(validKey2);
    });
  });

  describe("Multi-User Isolation", () => {
    it("keeps registrations completely isolated across multiple accounts", async () => {
      const signers = [alice, bob, charlie, dave, eve];
      const keys = [
        "0x02" + "aa".repeat(32),
        "0x03" + "bb".repeat(32),
        "0x02" + "cc".repeat(32),
        "0x03" + "dd".repeat(32),
        "0x02" + "ee".repeat(32),
      ];

      for (let i = 0; i < signers.length; i++) {
        await registry.connect(signers[i]).register(keys[i]);
      }

      for (let i = 0; i < signers.length; i++) {
        expect(await registry.isRegistered(signers[i].address)).to.equal(true);
        expect(await registry.privacyKeyOf(signers[i].address)).to.equal(keys[i]);
      }

      // Overwriting one account's key does not mutate others
      await registry.connect(charlie).register(validKey3);
      expect(await registry.privacyKeyOf(charlie.address)).to.equal(validKey3);
      expect(await registry.privacyKeyOf(alice.address)).to.equal(keys[0]);
      expect(await registry.privacyKeyOf(bob.address)).to.equal(keys[1]);
      expect(await registry.privacyKeyOf(dave.address)).to.equal(keys[3]);
      expect(await registry.privacyKeyOf(eve.address)).to.equal(keys[4]);
    });
  });

  describe("Key Length Validation & Boundary Rejections", () => {
    it("rejects an empty key (0 bytes)", async () => {
      await expect(registry.connect(alice).register("0x"))
        .to.be.revertedWithCustomError(registry, "InvalidKeyLength")
        .withArgs(0);
    });

    it("rejects a single-byte key (1 byte)", async () => {
      await expect(registry.connect(alice).register("0x02"))
        .to.be.revertedWithCustomError(registry, "InvalidKeyLength")
        .withArgs(1);
    });

    it("rejects a 32-byte key (missing parity prefix)", async () => {
      const key32 = "0x" + "11".repeat(32);
      await expect(registry.connect(alice).register(key32))
        .to.be.revertedWithCustomError(registry, "InvalidKeyLength")
        .withArgs(32);
    });

    it("rejects a 34-byte key (1 byte too long)", async () => {
      const key34 = "0x02" + "11".repeat(33);
      await expect(registry.connect(alice).register(key34))
        .to.be.revertedWithCustomError(registry, "InvalidKeyLength")
        .withArgs(34);
    });

    it("rejects a 64-byte key", async () => {
      const key64 = "0x" + "11".repeat(64);
      await expect(registry.connect(alice).register(key64))
        .to.be.revertedWithCustomError(registry, "InvalidKeyLength")
        .withArgs(64);
    });

    it("rejects a 65-byte uncompressed public key", async () => {
      const uncompressedKey = "0x04" + "11".repeat(64); // 65 bytes
      await expect(registry.connect(alice).register(uncompressedKey))
        .to.be.revertedWithCustomError(registry, "InvalidKeyLength")
        .withArgs(65);
    });

    it("rejects an excessively large 100-byte payload", async () => {
      const key100 = "0x" + "aa".repeat(100);
      await expect(registry.connect(alice).register(key100))
        .to.be.revertedWithCustomError(registry, "InvalidKeyLength")
        .withArgs(100);
    });
  });
});
