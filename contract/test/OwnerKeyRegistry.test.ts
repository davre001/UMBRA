import { expect } from "chai";
import { ethers } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { OwnerKeyRegistry } from "../typechain-types";

describe("OwnerKeyRegistry", () => {
  let registry: OwnerKeyRegistry;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let charlie: HardhatEthersSigner;
  let dave: HardhatEthersSigner;
  let eve: HardhatEthersSigner;

  const sampleOwnerKey1 = 12345678901234567890n;
  const sampleOwnerKey2 = 98765432109876543210n;

  beforeEach(async () => {
    [alice, bob, charlie, dave, eve] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("OwnerKeyRegistry");
    registry = await Registry.deploy();
  });

  describe("Initial State & Defaults", () => {
    it("defaults any unregistered address to not registered with ownerKey 0", async () => {
      expect(await registry.isRegistered(alice.address)).to.equal(false);
      expect(await registry.ownerKeyOf(alice.address)).to.equal(0n);
      expect(await registry.isRegistered(ethers.ZeroAddress)).to.equal(false);
      expect(await registry.ownerKeyOf(ethers.ZeroAddress)).to.equal(0n);
    });
  });

  describe("Registration & Event Emission", () => {
    it("successfully registers an ownerKey and emits OwnerKeyRegistered", async () => {
      await expect(registry.connect(alice).register(sampleOwnerKey1))
        .to.emit(registry, "OwnerKeyRegistered")
        .withArgs(alice.address, sampleOwnerKey1);

      expect(await registry.isRegistered(alice.address)).to.equal(true);
      expect(await registry.ownerKeyOf(alice.address)).to.equal(sampleOwnerKey1);
    });

    it("allows a wallet to overwrite its existing ownerKey", async () => {
      // 1. First register
      await registry.connect(alice).register(sampleOwnerKey1);
      expect(await registry.ownerKeyOf(alice.address)).to.equal(sampleOwnerKey1);

      // 2. Overwrite
      await expect(registry.connect(alice).register(sampleOwnerKey2))
        .to.emit(registry, "OwnerKeyRegistered")
        .withArgs(alice.address, sampleOwnerKey2);

      expect(await registry.isRegistered(alice.address)).to.equal(true);
      expect(await registry.ownerKeyOf(alice.address)).to.equal(sampleOwnerKey2);
    });
  });

  describe("Boundary Values & Field Elements", () => {
    it("handles minimal non-zero ownerKey = 1", async () => {
      await expect(registry.connect(alice).register(1n))
        .to.emit(registry, "OwnerKeyRegistered")
        .withArgs(alice.address, 1n);

      expect(await registry.isRegistered(alice.address)).to.equal(true);
      expect(await registry.ownerKeyOf(alice.address)).to.equal(1n);
    });

    it("handles maximum uint256 ownerKey", async () => {
      const maxUint256 = ethers.MaxUint256;
      await expect(registry.connect(alice).register(maxUint256))
        .to.emit(registry, "OwnerKeyRegistered")
        .withArgs(alice.address, maxUint256);

      expect(await registry.isRegistered(alice.address)).to.equal(true);
      expect(await registry.ownerKeyOf(alice.address)).to.equal(maxUint256);
    });

    it("handles setting ownerKey to 0 (clearing registration)", async () => {
      await registry.connect(alice).register(sampleOwnerKey1);
      expect(await registry.isRegistered(alice.address)).to.equal(true);

      // Overwrite with 0
      await expect(registry.connect(alice).register(0n))
        .to.emit(registry, "OwnerKeyRegistered")
        .withArgs(alice.address, 0n);

      expect(await registry.isRegistered(alice.address)).to.equal(false);
      expect(await registry.ownerKeyOf(alice.address)).to.equal(0n);
    });
  });

  describe("Multi-User Isolation", () => {
    it("maintains strict independence across multiple accounts", async () => {
      const signers = [alice, bob, charlie, dave, eve];
      const keys = [101n, 202n, 303n, 404n, 505n];

      for (let i = 0; i < signers.length; i++) {
        await registry.connect(signers[i]).register(keys[i]);
      }

      for (let i = 0; i < signers.length; i++) {
        expect(await registry.isRegistered(signers[i].address)).to.equal(true);
        expect(await registry.ownerKeyOf(signers[i].address)).to.equal(keys[i]);
      }

      // Modifying one does not affect others
      await registry.connect(alice).register(999999n);
      expect(await registry.ownerKeyOf(alice.address)).to.equal(999999n);
      expect(await registry.ownerKeyOf(bob.address)).to.equal(keys[1]);
      expect(await registry.ownerKeyOf(charlie.address)).to.equal(keys[2]);
      expect(await registry.ownerKeyOf(dave.address)).to.equal(keys[3]);
      expect(await registry.ownerKeyOf(eve.address)).to.equal(keys[4]);
    });
  });
});
