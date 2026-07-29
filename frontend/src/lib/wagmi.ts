import { createConfig, http } from 'wagmi';
import { flare, flareTestnet } from 'wagmi/chains';
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors';

// WalletConnect Cloud project ID — replace with your own at https://cloud.walletconnect.com/
const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo-project-id';

export const wagmiConfig = createConfig({
  chains: [flareTestnet, flare],
  connectors: [
    injected({ target: 'metaMask' }),
    coinbaseWallet({ appName: 'Umbra Protocol', appLogoUrl: '' }),
    walletConnect({ projectId: WC_PROJECT_ID, showQrModal: true }),
    injected({ target: 'rabby' }),
    injected({ target: 'trust' }),
    injected({ target: 'phantom' }),
  ],
  transports: {
    [flareTestnet.id]: http('https://coston2-api.flare.network/ext/C/rpc'),
    [flare.id]:        http('https://flare-api.flare.network/ext/C/rpc'),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
