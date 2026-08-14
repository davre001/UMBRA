import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ComplianceRegistry } from "../typechain-types";

describe("ComplianceRegistry", () => {
  let registry: ComplianceRegistry;
  let admin: HardhatEthersSigner;
  let attester: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let charlie: HardhatEthersSigner;

  let attesterRole: string;
  let defaultAdminRole: string;

  beforeEach(async () => {
    [admin, attester, alice, bob, charlie] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("ComplianceRegistry");
    registry = await Registry.deploy(admin.address);
    attesterRole = await registry.ATTESTER_ROLE();
    defaultAdminRole = await registry.DEFAULT_ADMIN_ROLE();
    await registry.connect(admin).grantRole(attesterRole, attester.address);
  });

  describe("Access Control & Role Lifecycle", () => {
    it("correctly sets admin as DEFAULT_ADMIN_ROLE holder on construction", async () => {
      expect(await registry.hasRole(defaultAdminRole, admin.address)).to.equal(true);
      expect(await registry.hasRole(defaultAdminRole, alice.address)).to.equal(false);
    });

    it("allows admin to grant and revoke ATTESTER_ROLE", async () => {
      expect(await registry.hasRole(attesterRole, alice.address)).to.equal(false);
      await registry.connect(admin).grantRole(attesterRole, alice.address);
      expect(await registry.hasRole(attesterRole, alice.address)).to.equal(true);

      await registry.connect(admin).revokeRole(attesterRole, alice.address);
      expect(await registry.hasRole(attesterRole, alice.address)).to.equal(false);
    });

    it("rejects non-admin attempting to grant ATTESTER_ROLE", async () => {
      await expect(
        registry.connect(alice).grantRole(attesterRole, bob.address)
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(alice.address, defaultAdminRole);
    });

    it("rejects non-admin attempting to revoke ATTESTER_ROLE", async () => {
      await expect(
        registry.connect(alice).revokeRole(attesterRole, attester.address)
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(alice.address, defaultAdminRole);
    });

    it("rejects screen() when called by an unprivileged account", async () => {
      await expect(
        registry.connect(alice).screen(bob.address, true)
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(alice.address, attesterRole);
    });

    it("rejects screen() immediately after ATTESTER_ROLE is revoked", async () => {
      await registry.connect(attester).screen(alice.address, true);
      expect(await registry.isScreened(alice.address)).to.equal(true);

      // Revoke role
      await registry.connect(admin).revokeRole(attesterRole, attester.address);

      // Next attempt must revert
      await expect(
        registry.connect(attester).screen(bob.address, true)
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(attester.address, attesterRole);
    });

    it("allows an attester to renounce their role", async () => {
      await registry.connect(attester).renounceRole(attesterRole, attester.address);
      expect(await registry.hasRole(attesterRole, attester.address)).to.equal(false);

      await expect(
        registry.connect(attester).screen(alice.address, true)
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(attester.address, attesterRole);
    });
  });

  describe("Screening State Transitions & Event Emissions", () => {
    it("defaults any unscreened address to not screened (clear = false, screenedAt = 0)", async () => {
      expect(await registry.isScreened(alice.address)).to.equal(false);
      const result = await registry.screenResults(alice.address);
      expect(result.clear).to.equal(false);
      expect(result.screenedAt).to.equal(0n);
    });

    it("records a clear screen (clear = true) and emits Screened with exact timestamp", async () => {
      const tx = await registry.connect(attester).screen(alice.address, true);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      await expect(tx)
        .to.emit(registry, "Screened")
        .withArgs(alice.address, true, BigInt(block!.timestamp));

      expect(await registry.isScreened(alice.address)).to.equal(true);
      const result = await registry.screenResults(alice.address);
      expect(result.clear).to.equal(true);
      expect(result.screenedAt).to.equal(BigInt(block!.timestamp));
    });

    it("records a flagged/sanctioned screen (clear = false) and emits Screened event", async () => {
      const tx = await registry.connect(attester).screen(bob.address, false);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      await expect(tx)
        .to.emit(registry, "Screened")
        .withArgs(bob.address, false, BigInt(block!.timestamp));

      expect(await registry.isScreened(bob.address)).to.equal(false);
      const result = await registry.screenResults(bob.address);
      expect(result.clear).to.equal(false);
      expect(result.screenedAt).to.equal(BigInt(block!.timestamp));
    });

    it("correctly overwrites an existing screen result and advances timestamp", async () => {
      // 1. Initially clear Alice
      await registry.connect(attester).screen(alice.address, true);
      expect(await registry.isScreened(alice.address)).to.equal(true);
      const firstResult = await registry.screenResults(alice.address);

      // Advance time by 1 hour
      await time.increase(3600);

      // 2. Blacklist / flag Alice
      const tx2 = await registry.connect(attester).screen(alice.address, false);
      const receipt2 = await tx2.wait();
      const block2 = await ethers.provider.getBlock(receipt2!.blockNumber);

      expect(await registry.isScreened(alice.address)).to.equal(false);
      const secondResult = await registry.screenResults(alice.address);
      expect(secondResult.clear).to.equal(false);
      expect(secondResult.screenedAt).to.be.greaterThan(firstResult.screenedAt);
      expect(secondResult.screenedAt).to.equal(BigInt(block2!.timestamp));

      // 3. Clear Alice again
      await time.increase(3600);
      await registry.connect(attester).screen(alice.address, true);
      expect(await registry.isScreened(alice.address)).to.equal(true);
    });

    it("maintains strict independence between multiple screened accounts", async () => {
      await registry.connect(attester).screen(alice.address, true);
      await registry.connect(attester).screen(bob.address, false);

      expect(await registry.isScreened(alice.address)).to.equal(true);
      expect(await registry.isScreened(bob.address)).to.equal(false);
      expect(await registry.isScreened(charlie.address)).to.equal(false);

      // Modifying bob does not affect alice
      await registry.connect(attester).screen(bob.address, true);
      expect(await registry.isScreened(alice.address)).to.equal(true);
      expect(await registry.isScreened(bob.address)).to.equal(true);
    });
  });

  describe("Boundary Conditions & Edge Cases", () => {
    it("handles screening address(0)", async () => {
      await registry.connect(attester).screen(ethers.ZeroAddress, true);
      expect(await registry.isScreened(ethers.ZeroAddress)).to.equal(true);

      await registry.connect(attester).screen(ethers.ZeroAddress, false);
      expect(await registry.isScreened(ethers.ZeroAddress)).to.equal(false);
    });

    it("handles screening admin and attester accounts", async () => {
      await registry.connect(attester).screen(admin.address, true);
      await registry.connect(attester).screen(attester.address, true);

      expect(await registry.isScreened(admin.address)).to.equal(true);
      expect(await registry.isScreened(attester.address)).to.equal(true);
    });

    it("handles screening contract address itself", async () => {
      const contractAddress = await registry.getAddress();
      await registry.connect(attester).screen(contractAddress, true);
      expect(await registry.isScreened(contractAddress)).to.equal(true);
    });
  });
});
