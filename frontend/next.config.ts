import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the workspace root to frontend/ — without this Turbopack falls back to
    // scanning the monorepo root (backend/ + root node_modules included) because
    // of the extra package-lock.json there, which massively slows cold compiles.
    root: path.join(__dirname),
  },
  // Cross-origin isolation — required for SharedArrayBuffer, which is what
  // lets @aztec/bb.js's WASM UltraHonk backend run multi-threaded in the
  // browser (withdraw/pay/placeOrder/cancelOrder/matchOrders all prove
  // client-side — see lib/proving/prove.ts). Without this, bb.js silently
  // falls back to a single-threaded WASM build, typically 2-4x slower.
  // COEP "credentialless" (not the stricter "require-corp") on purpose:
  // wagmi.ts's WalletConnect connector renders its own QR modal pulling
  // images/fonts from WalletConnect's own CDN, which don't send
  // Cross-Origin-Resource-Policy headers — "require-corp" would silently
  // block those subresources. "credentialless" still unlocks
  // cross-origin isolation (it just strips credentials from cross-origin
  // requests instead of demanding an opt-in header from every one).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};

export default nextConfig;
