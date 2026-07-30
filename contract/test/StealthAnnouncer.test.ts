import { expect } from "chai";
import { ethers } from "hardhat";
import { StealthAnnouncer } from "../typechain-types";

describe("StealthAnnouncer", () => {
  let announcer: StealthAnnouncer;

  beforeEach(async () => {
    const Announcer = await ethers.getContractFactory("StealthAnnouncer");
    announcer = await Announcer.deploy();
  });

  it("emits an Announcement event with the given parameters", async () => {
    const [caller] = await ethers.getSigners();
    const stealthAddress = ethers.Wallet.createRandom().address;
    const ephemeralPubKey = "0x02" + "ab".repeat(32);
    const metadata = ethers.hexlify(ethers.toUtf8Bytes("view-tag:1"));

    await expect(announcer.announce(1n, stealthAddress, ephemeralPubKey, metadata))
      .to.emit(announcer, "Announcement")
      .withArgs(1n, stealthAddress, caller.address, ephemeralPubKey, metadata);
  });
});
