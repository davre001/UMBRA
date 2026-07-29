// Public, CDN-hosted brand icons (web3icons — branded/colour variants).
// Served from jsDelivr so nothing needs to be vendored into the repo.
const W3I = 'https://cdn.jsdelivr.net/gh/0xa3k5/web3icons@main/packages/core/src/svgs';

export const tokenIcon = (symbol: string) => `${W3I}/tokens/branded/${symbol}.svg`;
export const networkIcon = (slug: string) => `${W3I}/networks/branded/${slug}.svg`;
export const walletIcon = (slug: string) => `${W3I}/wallets/branded/${slug}.svg`;

// Maps a wagmi connector id to its web3icons slug.
export const CONNECTOR_ICONS: Record<string, string> = {
  metaMask: 'metamask',
  coinbaseWallet: 'coinbase',
  walletConnect: 'wallet-connect',
  rabby: 'rabby',
  trust: 'trust',
  phantom: 'phantom',
  injected: 'rabby',
};

export const SUPPORTED_CHAINS = [
  { name: 'Flare',     slug: 'flare' },
  { name: 'Ethereum',  slug: 'ethereum' },
  { name: 'BNB Chain', slug: 'binance-smart-chain' },
  { name: 'Polygon',   slug: 'polygon' },
  { name: 'Arbitrum',  slug: 'arbitrum-one' },
  { name: 'Base',      slug: 'base' },
  { name: 'Optimism',  slug: 'optimism' },
  { name: 'Avalanche', slug: 'avalanche' },
] as const;
