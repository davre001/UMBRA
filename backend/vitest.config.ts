import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // Several test files submit real transactions from the same shared
    // operator wallet (see shared/chain.ts) — running files in parallel
    // races their nonces against each other ("replacement transaction
    // underpriced"). Real production traffic doesn't hit this (requests
    // arrive from many different callers over time, not simultaneously
    // from one wallet), so this is purely a test-run concern.
    fileParallelism: false,
  },
});
