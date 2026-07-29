"use client";

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '@/providers/app-provider';
import { Navbar } from '@/components/shared/navbar';
import { Sidebar } from '@/components/shared/sidebar';
import { GlassCard } from '@/components/ui/glass-card';
import { AnimatedButton } from '@/components/ui/animated-button';
import { GlowBorder } from '@/components/ui/glow-border';
import {
  Droplets,
  Wallet,
  Check,
  RefreshCw,
  Info,
  ArrowLeft,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { tokenIcon, networkIcon, SUPPORTED_CHAINS } from '@/lib/icons';
import { formatAddress } from '@/lib/utils';

const MINT_AMOUNT = 10;

// Contract wiring lands here once the faucet tokens are deployed.
// `icon` is the underlying asset's icon name, which differs from the wrapped symbol.
const TOKENS = [
  { symbol: 'WFLR', name: 'Wrapped Flare', icon: 'FLR' },
  { symbol: 'WXRP', name: 'Wrapped XRP',   icon: 'XRP' },
  { symbol: 'USDT', name: 'Tether USD',    icon: 'USDT' },
  { symbol: 'USDC', name: 'USD Coin',      icon: 'USDC' },
] as const;

type MintStatus = 'idle' | 'minting' | 'minted';

export default function FaucetPage() {
  const { isEntered, isWalletConnected, walletAddress, connectWallet, addNotification } = useApp();
  const [statuses, setStatuses] = useState<Record<string, MintStatus>>({});

  const handleMint = (symbol: string) => {
    if (!isWalletConnected) {
      connectWallet();
      return;
    }
    setStatuses((prev) => ({ ...prev, [symbol]: 'minting' }));

    setTimeout(() => {
      setStatuses((prev) => ({ ...prev, [symbol]: 'minted' }));
      addNotification(
        'Test Tokens Minted',
        `${MINT_AMOUNT} ${symbol} sent to your wallet.`,
        'success'
      );
    }, 1600);
  };

  // Reachable from the landing header too, so no vault gate — only a wallet gate.
  return (
    <div className={`flex min-h-screen flex-col z-10 relative ${isEntered ? 'pt-16 md:pl-16' : 'pt-8'}`}>
      <Navbar />
      <Sidebar />

      <div className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {/* Back to gateway — only when the vault chrome is hidden */}
        {!isEntered && (
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-[10px] text-text-secondary hover:text-text-primary uppercase tracking-widest mb-6 transition-colors"
          >
            <ArrowLeft size={12} />
            Back to Gateway
          </Link>
        )}

        {/* Header — black glass panel */}
        <div className="mb-8 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl shadow-[0_8px_40px_rgba(0,0,0,0.55)] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-text-primary font-display uppercase flex items-center gap-2.5">
              <Droplets size={22} className="text-accent-primary" />
              Testnet Faucet
            </h1>
            <p className="text-text-secondary text-xs font-light mt-1 tracking-wider uppercase">
              Mint free test tokens to explore the protocol — no real value, testnet only
            </p>
          </div>

          {/* Wallet action — pinned top right */}
          <div className="flex-shrink-0">
            {isWalletConnected ? (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-success-state/20 bg-black/40 backdrop-blur-xl text-xs text-success-state font-mono">
                <ShieldCheck size={14} />
                {formatAddress(walletAddress || '')}
              </div>
            ) : (
              <AnimatedButton variant="primary" size="sm" onClick={connectWallet}>
                <Wallet size={14} />
                Connect Wallet
              </AnimatedButton>
            )}
          </div>
        </div>

        {/* Wallet gate banner */}
        {!isWalletConnected && (
          <GlassCard className="p-5 mb-8 flex flex-col sm:flex-row sm:items-center gap-4 justify-between rounded-2xl border-white/10 bg-black/40 backdrop-blur-xl" hoverGlow={false}>
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg border border-accent-primary/20 bg-accent-primary/5 flex-shrink-0">
                <Wallet size={16} className="text-accent-primary" />
              </div>
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-text-primary font-display">Wallet Required</h2>
                <p className="text-[11px] text-text-secondary font-light mt-0.5 leading-relaxed">
                  Connect an EVM wallet to receive test tokens at your address.
                </p>
              </div>
            </div>

            {/* Supported network */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-[9px] text-text-secondary uppercase tracking-widest hidden sm:inline">Network</span>
              {SUPPORTED_CHAINS.map((chain) => (
                <div
                  key={chain.slug}
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/40 backdrop-blur-xl px-2.5 py-1.5"
                >
                  <img src={networkIcon(chain.slug)} alt={chain.name} className="h-5 w-5" />
                  <span className="text-[10px] text-text-primary uppercase tracking-widest">{chain.name}</span>
                </div>
              ))}
            </div>
          </GlassCard>
        )}

        {/* Token grid — nested inside an outer black glass shell */}
        <div className="rounded-3xl border border-white/10 bg-black/40 backdrop-blur-xl shadow-[0_8px_40px_rgba(0,0,0,0.55)] p-5 sm:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {TOKENS.map((token) => {
            const status = statuses[token.symbol] ?? 'idle';
            const isMinting = status === 'minting';
            const isMinted = status === 'minted';

            return (
              <GlowBorder key={token.symbol} active={isMinted} glowColor="success">
                <GlassCard className="p-5 flex flex-col h-full rounded-2xl border-white/10 bg-white/[0.04] backdrop-blur-md">
                  {/* Token identity */}
                  <div className="flex items-center gap-3 mb-5">
                    <img
                      src={tokenIcon(token.icon)}
                      alt={token.symbol}
                      className="h-10 w-10 flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-bold text-text-primary">{token.symbol}</div>
                      <div className="text-[10px] text-text-secondary uppercase tracking-wider truncate">{token.name}</div>
                    </div>
                  </div>

                  {/* Amount */}
                  <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-3 mb-5">
                    <span className="text-[9px] text-text-secondary uppercase tracking-widest block mb-1">Mint Amount</span>
                    <span className="font-mono text-lg font-bold text-text-primary">
                      {MINT_AMOUNT} <span className="text-xs text-text-secondary font-normal">{token.symbol}</span>
                    </span>
                  </div>

                  {/* Action */}
                  <div className="mt-auto">
                    <AnimatedButton
                      variant={isMinted ? 'glass' : 'primary'}
                      size="sm"
                      fullWidth
                      disabled={isMinting}
                      onClick={() => handleMint(token.symbol)}
                      className="rounded-lg"
                    >
                      <AnimatePresence mode="wait" initial={false}>
                        {isMinting ? (
                          <motion.span
                            key="minting"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex items-center gap-1.5"
                          >
                            <RefreshCw size={13} className="animate-spin" />
                            Minting...
                          </motion.span>
                        ) : isMinted ? (
                          <motion.span
                            key="minted"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex items-center gap-1.5 text-success-state"
                          >
                            <Check size={13} />
                            Mint Again
                          </motion.span>
                        ) : (
                          <motion.span
                            key="idle"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex items-center gap-1.5"
                          >
                            <Droplets size={13} />
                            Mint {MINT_AMOUNT}
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </AnimatedButton>
                  </div>
                </GlassCard>
              </GlowBorder>
            );
          })}
          </div>
        </div>

        {/* Footnote */}
        <div className="mt-8 flex items-start gap-2.5 rounded-lg border border-border-custom/60 bg-surface/10 p-4">
          <Info size={14} className="text-text-secondary flex-shrink-0 mt-0.5" />
          <p className="text-[10px] text-text-secondary font-light leading-relaxed">
            Faucet tokens exist solely on the Flare test network and carry no monetary value. Use them to trial shielding,
            private payments and dark swaps before moving to mainnet.
          </p>
        </div>
      </div>
    </div>
  );
}
