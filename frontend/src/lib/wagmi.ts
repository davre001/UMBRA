import { createConfig, http } from 'wagmi';
import { flare, flareTestnet, mainnet, bsc, polygon, arbitrum, base, optimism, avalanche } from 'wagmi/chains';
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors';

// WalletConnect Cloud project ID — replace with your own at https://cloud.walletconnect.com/
const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo-project-id';

export const wagmiConfig = createConfig({
  chains: [flareTestnet, flare, mainnet, bsc, polygon, arbitrum, base, optimism, avalanche],
  connectors: [
    injected({ target: 'metaMask' }),
    coinbaseWallet({ appName: 'Umbra Protocol', appLogoUrl: '' }),
    walletConnect({ projectId: WC_PROJECT_ID, showQrModal: true }),
    injected({ target: 'rabby' }),
    injected({ target: 'trust' }),
    injected({ target: 'phantom' }),
    injected(), // catches any other injected wallet
  ],
  transports: {
    // The official coston2-api.flare.network RPC caps eth_getLogs to a
    // 30-block range per request, which breaks the note wallet's full-
    // history scan (scan.ts) outright — drpc.org doesn't impose that limit.
    [flareTestnet.id]: http('https://flare-testnet.drpc.org'),
    [flare.id]:        http('https://flare-api.flare.network/ext/C/rpc'),
    [mainnet.id]:      http(),
    [bsc.id]:          http(),
    [polygon.id]:      http(),
    [arbitrum.id]:     http(),
    [base.id]:         http(),
    [optimism.id]:     http(),
    [avalanche.id]:    http(),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
