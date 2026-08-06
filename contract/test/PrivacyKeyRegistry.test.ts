import { expect } from "chai";
import { ethers } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { PrivacyKeyRegistry } from "../typechain-types";

describe("PrivacyKeyRegistry", () => {
  let registry: PrivacyKeyRegistry;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  const fakeCompressedKey = "0x02" + "11".repeat(32); // 33 bytes, shape only — no real curve math needed on-chain

  beforeEach(async () => {
    [alice, bob] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("PrivacyKeyRegistry");
    registry = await Registry.deploy();
  });

  it("defaults an unregistered address to not registered", async () => {
    expect(await registry.isRegistered(alice.address)).to.equal(false);
    expect(await registry.privacyKeyOf(alice.address)).to.equal("0x");
  });

  it("lets a wallet publish its own privacy key", async () => {
    await expect(registry.connect(alice).register(fakeCompressedKey))
      .to.emit(registry, "PrivacyKeyRegistered")
      .withArgs(alice.address, fakeCompressedKey);

    expect(await registry.isRegistered(alice.address)).to.equal(true);
    expect(await registry.privacyKeyOf(alice.address)).to.equal(fakeCompressedKey);
  });

  it("keeps registrations independent per account", async () => {
    await registry.connect(alice).register(fakeCompressedKey);
    expect(await registry.isRegistered(bob.address)).to.equal(false);
  });

  it("lets a wallet overwrite its own entry with a fresh key", async () => {
    const secondKey = "0x03" + "22".repeat(32);
    await registry.connect(alice).register(fakeCompressedKey);
    await registry.connect(alice).register(secondKey);
    expect(await registry.privacyKeyOf(alice.address)).to.equal(secondKey);
  });

  it("rejects a key shorter than 33 bytes", async () => {
    const tooShort = "0x02" + "11".repeat(31); // 32 bytes
    await expect(registry.connect(alice).register(tooShort))
      .to.be.revertedWithCustomError(registry, "InvalidKeyLength")
      .withArgs(32);
  });

  it("rejects a key longer than 33 bytes", async () => {
    const tooLong = "0x02" + "11".repeat(33); // 34 bytes
    await expect(registry.connect(alice).register(tooLong))
      .to.be.revertedWithCustomError(registry, "InvalidKeyLength")
      .withArgs(34);
  });

  it("rejects an empty key", async () => {
    await expect(registry.connect(alice).register("0x"))
      .to.be.revertedWithCustomError(registry, "InvalidKeyLength")
      .withArgs(0);
  });
});
