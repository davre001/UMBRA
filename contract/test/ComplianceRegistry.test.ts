import { expect } from "chai";
import { ethers } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ComplianceRegistry } from "../typechain-types";

describe("ComplianceRegistry", () => {
  let registry: ComplianceRegistry;
  let admin: HardhatEthersSigner;
  let attester: HardhatEthersSigner;
  let alice: HardhatEthersSigner;

  beforeEach(async () => {
    [admin, attester, alice] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("ComplianceRegistry");
    registry = await Registry.deploy(admin.address);
    await registry.grantRole(await registry.ATTESTER_ROLE(), attester.address);
  });

  it("defaults an unscreened address to not screened", async () => {
    expect(await registry.isScreened(alice.address)).to.equal(false);
  });

  it("lets an attester record a clear screen", async () => {
    await expect(registry.connect(attester).screen(alice.address, true))
      .to.emit(registry, "Screened");
    expect(await registry.isScreened(alice.address)).to.equal(true);
  });

  it("rejects screening from a non-attester", async () => {
    await expect(registry.connect(alice).screen(alice.address, true)).to.be.reverted;
  });
});
