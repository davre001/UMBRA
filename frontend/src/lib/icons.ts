// Brand icons vendored into `public/icons` — no CDN dependency, no hotlinking.
// Tokens/networks are the standard circular badge logos; wallets are their
// official marks on a transparent background.

export const tokenIcon = (symbol: string) => `/icons/tokens/${symbol.toLowerCase()}.svg`;
export const networkIcon = (slug: string) => `/icons/networks/${slug}.svg`;
export const walletIcon = (slug: string) => `/icons/wallets/${slug}.svg`;

// Maps a wagmi connector id to its icon file name.
export const CONNECTOR_ICONS: Record<string, string> = {
  metaMask: 'metamask',
  coinbaseWallet: 'coinbase',
  walletConnect: 'wallet-connect',
  rabby: 'rabby',
  trust: 'trust',
  phantom: 'phantom',
};

// Umbra runs on Flare only (Coston2 for testing, Flare mainnet for production).
export const SUPPORTED_CHAINS = [
  { name: 'Flare', slug: 'flare' },
] as const;
