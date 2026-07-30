"use client";

import React, { useState } from 'react';
import { useApp } from '@/providers/app-provider';
import { Navbar } from '@/components/shared/navbar';
import { GlassCard } from '@/components/ui/glass-card';
import { AnimatedButton } from '@/components/ui/animated-button';
import { GlowBorder } from '@/components/ui/glow-border';
import {
  Droplets,
  Wallet,
  Check,
  Info,
  ArrowLeft,
  ShieldCheck,
  ExternalLink,
  Clock,
} from 'lucide-react';
import Link from 'next/link';
import { tokenIcon, networkIcon, SUPPORTED_CHAINS } from '@/lib/icons';
import { formatAddress } from '@/lib/utils';

const FLARE_FAUCET_URL = 'https://faucet.flare.network/';

// These are real assets minted by Flare's own Coston2 faucet — we deep-link
// rather than simulate a mint, since the whole point of this app is genuine
// FAssets integration, not a fake token.
const REAL_ASSETS = [
  { symbol: 'C2FLR', name: 'Coston2 Flare (native gas)', icon: 'FLR' },
  { symbol: 'FXRP', name: 'FAssets XRP (real bridge)', icon: 'XRP' },
  { symbol: 'USDT0', name: 'Tether USD (testnet)', icon: 'USDT' },
] as const;

export default function FaucetPage() {
  const { isEntered, isWalletConnected, walletAddress, connectWallet } = useApp();
  const [copied, setCopied] = useState(false);

  const handleCopyAddress = () => {
    if (!walletAddress) return;
    navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Reachable from the landing header too, so no vault gate — only a wallet gate.
  return (
    <div className={`flex min-h-screen flex-col z-10 relative ${isEntered ? 'pt-16' : 'pt-8'}`}>
      <Navbar />

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
        <div className="mb-8 rounded-2xl border border-white/15 bg-black/60 backdrop-blur-xl shadow-[0_8px_40px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.08)] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-text-primary font-display uppercase flex items-center gap-2.5">
              <Droplets size={22} className="text-accent-primary" />
              Testnet Faucet
            </h1>
            <p className="text-text-secondary text-xs font-light mt-1 tracking-wider uppercase">
              Real Coston2 testnet assets, straight from Flare — no simulated mints
            </p>
          </div>

          {/* Wallet action — pinned top right */}
          <div className="flex-shrink-0">
            {isWalletConnected ? (
              <button
                onClick={handleCopyAddress}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-success-state/20 bg-black/40 backdrop-blur-xl text-xs text-success-state font-mono cursor-pointer hover:bg-success-state/10 transition-colors"
              >
                {copied ? <Check size={14} /> : <ShieldCheck size={14} />}
                {formatAddress(walletAddress || '')}
                {copied ? '· Copied' : ''}
              </button>
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
          <GlassCard className="p-5 mb-8 flex flex-col sm:flex-row sm:items-center gap-4 justify-between rounded-2xl border-white/15 bg-black/60 backdrop-blur-xl" hoverGlow={false}>
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg border border-accent-primary/20 bg-accent-primary/5 flex-shrink-0">
                <Wallet size={16} className="text-accent-primary" />
              </div>
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-text-primary font-display">Wallet Required</h2>
                <p className="text-[11px] text-text-secondary font-light mt-0.5 leading-relaxed">
                  Connect an EVM wallet so you can copy your address into Flare&apos;s official faucet.
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

        {/* Asset grid — nested inside an outer black glass shell, real Coston2 assets deep-linked to Flare's faucet */}
        <div className="rounded-3xl border border-white/15 bg-black/60 backdrop-blur-xl shadow-[0_8px_40px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.08)] p-5 sm:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {REAL_ASSETS.map((asset) => (
              <GlowBorder key={asset.symbol} active={false} glowColor="cyan">
                <GlassCard className="p-5 flex flex-col h-full rounded-2xl border-white/10 bg-white/[0.07] backdrop-blur-md">
                  <div className="flex items-center gap-3 mb-5">
                    <img
                      src={tokenIcon(asset.icon)}
                      alt={asset.symbol}
                      className="h-10 w-10 flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-bold text-text-primary">{asset.symbol}</div>
                      <div className="text-[10px] text-text-secondary uppercase tracking-wider truncate">{asset.name}</div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-3 mb-5">
                    <span className="text-[9px] text-text-secondary uppercase tracking-widest block mb-1">Source</span>
                    <span className="font-mono text-xs font-semibold text-accent-primary">Official Flare Faucet</span>
                  </div>

                  <div className="mt-auto">
                    <a href={FLARE_FAUCET_URL} target="_blank" rel="noopener noreferrer">
                      <AnimatedButton variant="primary" size="sm" fullWidth className="rounded-lg">
                        <span className="flex items-center gap-1.5">
                          <ExternalLink size={13} />
                          Open Faucet
                        </span>
                      </AnimatedButton>
                    </a>
                  </div>
                </GlassCard>
              </GlowBorder>
            ))}
          </div>
        </div>

        {/* USDC — not yet available on Coston2 */}
        <GlowBorder active={false} glowColor="cyan">
          <GlassCard className="p-5 mt-5 flex items-center gap-4" hoverGlow={false}>
            <div className="p-2 rounded-lg border border-border-custom bg-surface/20 flex-shrink-0">
              <Clock size={18} className="text-text-secondary" />
            </div>
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-text-primary font-display">USDC — Coming Soon</h2>
              <p className="text-[10px] text-text-secondary font-light mt-0.5 leading-relaxed max-w-xl">
                There&apos;s no official USDC on Coston2 yet. We&apos;ll ship a clearly-labeled testnet mock once the vault
                contracts deploy, rather than fake a mint for it here.
              </p>
            </div>
          </GlassCard>
        </GlowBorder>

        {/* Footnote */}
        <div className="mt-8 flex items-start gap-2.5 rounded-lg border border-border-custom/60 bg-surface/10 p-4">
          <Info size={14} className="text-text-secondary flex-shrink-0 mt-0.5" />
          <p className="text-[10px] text-text-secondary font-light leading-relaxed">
            These are real assets issued on the Coston2 test network by Flare&apos;s own faucet — FXRP comes from the actual
            FAssets bridge, not a simulated mint. Use them to trial shielding, private payments and dark swaps before
            moving to mainnet.
          </p>
        </div>
      </div>
    </div>
  );
}
