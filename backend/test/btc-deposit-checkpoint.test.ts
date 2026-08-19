import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("btc-deposit / checkpoint", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.BTC_CHECKPOINT_HEIGHT;
  });
  afterEach(() => {
    delete process.env.BTC_CHECKPOINT_HEIGHT;
  });

  it("is undefined when BTC_CHECKPOINT_HEIGHT isn't set", async () => {
    const { getCurrentCheckpointHeight } = await import("../src/btc-deposit/checkpoint");
    expect(getCurrentCheckpointHeight()).toBeUndefined();
  });

  it("seeds from BTC_CHECKPOINT_HEIGHT when set", async () => {
    process.env.BTC_CHECKPOINT_HEIGHT = "317022";
    const { getCurrentCheckpointHeight } = await import("../src/btc-deposit/checkpoint");
    expect(getCurrentCheckpointHeight()).toBe(317022);
  });

  it("setCurrentCheckpointHeight updates the in-memory tracked height", async () => {
    const { getCurrentCheckpointHeight, setCurrentCheckpointHeight } = await import("../src/btc-deposit/checkpoint");
    expect(getCurrentCheckpointHeight()).toBeUndefined();
    setCurrentCheckpointHeight(318107);
    expect(getCurrentCheckpointHeight()).toBe(318107);
    setCurrentCheckpointHeight(318113);
    expect(getCurrentCheckpointHeight()).toBe(318113);
  });
});
