import { flare, flareTestnet } from 'wagmi/chains';

/**
 * `wallet_addEthereumChain` params keyed by chain id. Passing these into
 * `switchChainAsync`'s `addEthereumChainParameter` means switching to a
 * network the wallet doesn't have yet adds it automatically instead of just
 * failing with "unrecognized chain ID" — the wallet only prompts to add it,
 * then switches.
 *
 * Coston2's RPC is overridden to drpc.org rather than the chain's own
 * default (`coston2-api.flare.network`), which caps `eth_getLogs` at a
 * 30-block range (see wagmi.ts). That cap doesn't actually affect this app —
 * reads always go through the app's own publicClient/transport, never the
 * wallet's configured RPC — but it keeps a wallet's Coston2 entry consistent
 * with the endpoint the app itself relies on, in case anything the wallet
 * relays (sending a tx, gas estimation) ever depends on it.
 */
export const ADD_CHAIN_PARAMS: Record<
  number,
  { chainName: string; nativeCurrency: { name: string; symbol: string; decimals: number }; rpcUrls: readonly string[]; blockExplorerUrls: string[] }
> = {
  [flareTestnet.id]: {
    chainName: flareTestnet.name,
    nativeCurrency: flareTestnet.nativeCurrency,
    rpcUrls: ['https://flare-testnet.drpc.org'],
    blockExplorerUrls: [flareTestnet.blockExplorers.default.url],
  },
  [flare.id]: {
    chainName: flare.name,
    nativeCurrency: flare.nativeCurrency,
    rpcUrls: flare.rpcUrls.default.http,
    blockExplorerUrls: [flare.blockExplorers.default.url],
  },
};
