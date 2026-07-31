"use client";

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useApp } from '@/providers/app-provider';
import { GlassCard } from '@/components/ui/glass-card';
import { AnimatedButton } from '@/components/ui/animated-button';
import { CountUp } from '@/components/ui/count-up';
import {
  Shield,
  Cpu,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  GitBranch,
  BookOpen,
  Droplets,
  Send,
  EyeOff,
  ArrowDown,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { UmbraLogo } from '@/components/shared/logo';

// Fade-in-up animation wrapper — hook-free, uses framer-motion whileInView
function FadeUp({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export default function Home() {
  const { isEntered, setIsEntered, isWalletConnected, connectWallet } = useApp();
  const [transitioning, setTransitioning] = useState(false);
  const router = useRouter();

  // Once entered (via the button below, or an already-active session
  // navigating back to "/"), head straight into the real app — this page
  // has no in-place dashboard of its own, just the marketing landing.
  useEffect(() => {
    if (isEntered) router.replace('/portfolio');
  }, [isEntered, router]);

  const handleEnterVault = () => {
    setTransitioning(true);
    setIsEntered(true);
  };

  if (isEntered) return null;

  return (
    <main className="relative min-h-screen w-full overflow-x-hidden">

      {/* ── LANDING PAGE ── */}
      <motion.div
        initial={{ opacity: 1 }}
        className="relative w-full"
      >

        {/* ── TOP NAV ── */}
        <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-2 px-3 sm:px-10 py-3 sm:py-4 border-b border-white/5 backdrop-blur-xl bg-black/40">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <UmbraLogo size={28} textClassName="text-base sm:text-lg" />
          </div>

          <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
            <a
              href="https://docs.umbraprotocol.io"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border-custom text-[11px] text-text-secondary hover:text-text-primary hover:border-accent-primary/40 transition-all duration-200 font-sans uppercase tracking-wider"
            >
              <BookOpen size={11} />
              Docs
            </a>
            <Link
              href="/faucet"
              className="flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg border border-border-custom text-[10px] sm:text-[11px] text-text-secondary hover:text-text-primary hover:border-accent-primary/40 transition-all duration-200 font-sans uppercase tracking-wider whitespace-nowrap"
            >
              <Droplets size={11} />
              Faucet
            </Link>
            <AnimatedButton
              variant="primary"
              size="sm"
              onClick={handleEnterVault}
              disabled={transitioning}
              className="px-2 sm:px-2.5 py-1 text-[10px] sm:text-[11px] whitespace-nowrap"
            >
              {transitioning ? (
                <span className="flex items-center gap-1"><RefreshCw size={11} className="animate-spin" />Loading</span>
              ) : (
                <span className="flex items-center gap-1">Launch App <ArrowRight size={11} /></span>
              )}
            </AnimatedButton>
          </div>
        </header>

        {/* ── HERO ── */}
        <section className="relative flex flex-col items-center justify-start sm:justify-center min-h-screen px-4 pt-24 sm:pt-20 z-10 overflow-x-hidden">
          <div className="absolute inset-0 grid-overlay opacity-20 z-0 pointer-events-none" />

          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 25, repeat: Infinity, ease: 'linear' }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[320px] h-[320px] sm:w-[500px] sm:h-[500px] rounded-full border border-dashed border-accent-primary/10 opacity-30 pointer-events-none blur-[1px]"
          />

          <div className="relative text-center flex flex-col items-center w-full max-w-3xl z-10">

            {/* Lock icon */}
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 1, ease: 'easeOut' }}
              className="mb-4 sm:mb-8 p-3 sm:p-6 rounded-full border border-border-custom bg-surface/30 backdrop-blur-xl relative group"
            >
              <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-accent-secondary/20 to-accent-primary/20 opacity-0 group-hover:opacity-100 transition-opacity duration-700 blur" />
              <div className="h-12 w-12 sm:h-20 sm:w-20 rounded-full border border-accent-primary/30 flex items-center justify-center bg-bg-base relative">
                <UmbraLogo iconOnly size={36} className="sm:hidden" />
                <UmbraLogo iconOnly size={48} className="hidden sm:flex" />
              </div>
            </motion.div>

            <motion.h1
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.8 }}
              className="font-display text-[2.1rem] leading-[1.05] sm:text-7xl sm:leading-none font-extrabold tracking-tighter text-text-primary mb-4 sm:mb-6 uppercase cursor-default select-none break-words max-w-full filter drop-shadow-[0_4px_12px_rgba(0,0,0,0.95)] drop-shadow-[0_12px_24px_rgba(0,0,0,0.95)]"
            >
              Private Trading.<br />
              <span className="text-accent-primary">Without Compromise.</span>
            </motion.h1>

            <motion.p
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.8 }}
              className="font-sans text-sm sm:text-base text-text-primary max-w-2xl mb-6 sm:mb-10 font-light leading-relaxed select-none filter drop-shadow-[0_2px_4px_rgba(0,0,0,1)]"
            >
              Trade without leaving a trace. Umbra pairs zero-knowledge proofs with stealth addresses and a privately-matched dark pool, so your positions, counterparties, and balances stay private — while match correctness and settlement are verified openly on Flare.
            </motion.p>

            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.8 }}
              className="flex flex-col sm:flex-row items-center gap-4"
            >
              <AnimatedButton
                variant="primary"
                size="sm"
                onClick={handleEnterVault}
                disabled={transitioning}
                className="px-5 py-2.5 text-xs font-bold uppercase tracking-widest border border-accent-primary/30 rounded-xl"
              >
                {transitioning ? (
                  <span className="flex items-center gap-1.5">
                    <RefreshCw className="animate-spin" size={13} />
                    Opening Secure Vault...
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    Initiate Protocol Session
                    <ArrowRight size={13} />
                  </span>
                )}
              </AnimatedButton>
              <a
                href="https://docs.umbraprotocol.io"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-border-custom text-xs text-text-secondary hover:text-text-primary hover:border-accent-primary/40 transition-all"
              >
                <BookOpen size={13} />
                Read the Docs
              </a>
            </motion.div>
          </div>

          {/* Scroll cue */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.4, duration: 1 }}
            className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
          >
            <span className="text-[9px] text-text-secondary uppercase tracking-widest">Scroll to explore</span>
            <motion.div animate={{ y: [0, 6, 0] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}>
              <ArrowDown size={14} className="text-accent-primary/60" />
            </motion.div>
          </motion.div>
        </section>

        {/* ── STATS STRIP ── */}
        <section className="relative z-10 border-y border-border-custom/40 bg-black/75 backdrop-blur-sm py-8 px-4">
          <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { label: 'Total Shielded Value', value: '$84.2M' },
              { label: 'Active Stealth Sets', value: '1,492' },
              { label: 'Avg Proof Time', value: '1.24s' },
              { label: 'Compliance Rate', value: '100%' },
            ].map((s, i) => (
              <FadeUp key={i} delay={i * 0.1}>
                <CountUp
                  value={s.value}
                  className="block text-2xl sm:text-3xl font-display font-extrabold text-text-primary tracking-tight tabular-nums"
                />
                <div className="text-[10px] text-accent-primary uppercase tracking-widest mt-1">{s.label}</div>
              </FadeUp>
            ))}
          </div>
        </section>

        {/* ── 3 FEATURE CARDS ── */}
        <section className="relative z-10 max-w-5xl mx-auto px-4 sm:px-8 py-20">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: Shield,
                title: 'Stealth Addresses',
                desc: 'Every transaction gets a unique, unlinkable destination address. No on-chain connection between sender and recipient.',
              },
              {
                icon: Cpu,
                title: 'ZK-SNARK Proofs',
                desc: 'Noir circuits prove your right to withdraw without revealing the deposit. Generated locally in-browser in under 2 seconds.',
              },
              {
                icon: ShieldCheck,
                title: 'Compliance Ready',
                desc: 'Export viewing keys to satisfy auditors without breaking privacy for anyone else on the network.',
              },
            ].map((f, i) => (
              <FadeUp key={i} delay={i * 0.1}>
                <GlassCard className="p-6 h-full flex flex-col bg-surface/65" hoverGlow>
                  <div className="p-2.5 rounded-lg bg-accent-primary/10 border border-accent-primary/20 w-fit mb-4">
                    <f.icon size={18} className="text-accent-primary" />
                  </div>
                  <h3 className="font-display text-sm font-bold uppercase tracking-wider text-text-primary mb-2">{f.title}</h3>
                  <p className="text-[11px] text-text-secondary leading-relaxed font-light">{f.desc}</p>
                </GlassCard>
              </FadeUp>
            ))}
          </div>
        </section>

        {/* ── HOW IT WORKS ── */}
        <section className="relative z-10 border-y border-border-custom/30 bg-black/40 backdrop-blur-sm py-20 px-4">
          <div className="max-w-5xl mx-auto">
            <FadeUp className="text-center mb-12">
              <span className="text-[10px] text-accent-primary uppercase tracking-widest font-sans mb-3 block">How It Works</span>
              <h2 className="font-display text-2xl sm:text-3xl font-extrabold uppercase tracking-tight text-text-primary">
                Three steps to total privacy
              </h2>
            </FadeUp>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                {
                  step: '01',
                  icon: Shield,
                  title: 'Shield Your Assets',
                  desc: 'Deposit tokens into a shielded pool. A zero-knowledge proof is generated locally — your keys never leave your device.',
                },
                {
                  step: '02',
                  icon: Send,
                  title: 'Trade in the Dark Pool',
                  desc: 'Orders match off-chain against a shared order book. A zero-knowledge proof verifies the match was computed correctly before it settles atomically on Flare.',
                },
                {
                  step: '03',
                  icon: EyeOff,
                  title: 'Withdraw Privately',
                  desc: 'Funds are released to a stealth address with no on-chain link to the original deposit. Gasless relayer pays the fee.',
                },
              ].map((item, i) => (
                <FadeUp key={i} delay={i * 0.12}>
                  <motion.div
                    whileHover={{ y: -4 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                    className="group flex flex-col p-6 rounded-xl border border-border-custom/50 bg-surface/65 hover:bg-surface/80 hover:border-accent-primary/50 hover:shadow-[0_12px_32px_rgba(0,0,0,0.55)] transition-colors duration-300 h-full cursor-pointer"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="p-2.5 rounded-lg bg-accent-primary/10 border border-accent-primary/20 group-hover:bg-accent-primary/20 group-hover:border-accent-primary/40 transition-colors">
                        <item.icon size={16} className="text-accent-primary" />
                      </div>
                      <span className="font-display text-3xl font-extrabold text-text-primary tracking-tight">{item.step}</span>
                    </div>
                    <h3 className="font-display text-xs font-bold uppercase tracking-wider text-text-primary mb-2">{item.title}</h3>
                    <p className="text-[10px] text-text-secondary leading-relaxed font-light">{item.desc}</p>
                  </motion.div>
                </FadeUp>
              ))}
            </div>
          </div>
        </section>

        {/* ── TECH STACK ── */}
        <section className="relative z-10 max-w-5xl mx-auto px-4 sm:px-8 py-16">
          <FadeUp className="text-center mb-10">
            <span className="text-[10px] text-accent-primary uppercase tracking-widest font-sans mb-3 block">Built on Proven Primitives</span>
            <h2 className="font-display text-2xl sm:text-3xl font-extrabold uppercase tracking-tight text-text-primary">
              The full stack
            </h2>
          </FadeUp>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { name: 'Next.js 16', role: 'App Router' },
              { name: 'React 19', role: 'UI Runtime' },
              { name: 'TypeScript', role: 'Type Safety' },
              { name: 'Tailwind v4', role: 'Styling' },
              { name: 'wagmi + viem', role: 'EVM Client' },
              { name: 'Flare', role: 'Settlement' },
              { name: 'Express', role: 'Protocol API' },
              { name: 'Noir + WASM', role: 'ZK Proving' },
              { name: 'AWS Lambda', role: 'Match Proving' },
              { name: 'FTSO', role: 'Price Oracle' },
              { name: 'FDC', role: 'Compliance' },
              { name: 'WebAuthn', role: 'Passkey Auth' },
            ].map((t, i) => (
              <FadeUp key={i} delay={(i % 4) * 0.07}>
                <div className="p-4 rounded-xl border border-border-custom/60 bg-surface/65 hover:border-accent-primary/40 hover:bg-surface/80 transition-all text-center">
                  <div className="font-display text-sm font-extrabold uppercase tracking-tight text-accent-primary mb-1">{t.name}</div>
                  <div className="text-[9px] text-text-secondary uppercase tracking-widest">{t.role}</div>
                </div>
              </FadeUp>
            ))}
          </div>
        </section>

        {/* ── CTA BANNER ── */}
        <section className="relative z-10 bg-black/75 backdrop-blur-sm border-y border-border-custom/30 py-20 px-4">
          <FadeUp className="max-w-2xl mx-auto text-center">
            <div className="mb-5 inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-accent-primary/30 bg-accent-primary/5 text-[10px] text-accent-primary uppercase tracking-widest">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-primary animate-pulse" />
              Testnet Live — No Real Funds at Risk
            </div>
            <h2 className="font-display text-3xl sm:text-4xl font-extrabold uppercase tracking-tighter text-text-primary mb-4">
              Ready to trade in the dark?
            </h2>
            <p className="text-sm text-text-secondary mb-8 font-light max-w-sm mx-auto leading-relaxed">
              Connect a wallet, shield your first assets, and experience private DeFi on Flare.
            </p>
            <AnimatedButton
              variant="primary"
              size="lg"
              onClick={isWalletConnected ? handleEnterVault : connectWallet}
              disabled={transitioning}
              className="px-10 py-4 font-bold"
            >
              {transitioning ? (
                <span className="flex items-center gap-2"><RefreshCw className="animate-spin" size={16} />Loading...</span>
              ) : isWalletConnected ? (
                <span className="flex items-center gap-2">Launch Protocol <ArrowRight size={16} /></span>
              ) : (
                <span className="flex items-center gap-2"><Wallet size={16} />Connect Wallet</span>
              )}
            </AnimatedButton>
          </FadeUp>
        </section>

        {/* ── FOOTER ── */}
        <footer className="relative z-10 max-w-5xl mx-auto px-4 sm:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-border-custom/30">
          <div className="flex items-center gap-2">
            <UmbraLogo size={22} textClassName="text-sm" />
            <span className="text-[10px] text-text-secondary ml-3 hidden sm:block">© 2026 Umbra Protocol.</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="https://docs.umbraprotocol.io" target="_blank" rel="noopener noreferrer" className="text-[10px] text-text-secondary hover:text-text-primary uppercase tracking-widest inline-flex items-center gap-1 transition-colors">
              <BookOpen size={10} />Docs
            </a>
            <a href="https://github.com/davre001/UMBRA" target="_blank" rel="noopener noreferrer" className="text-[10px] text-text-secondary hover:text-text-primary uppercase tracking-widest inline-flex items-center gap-1 transition-colors">
              <GitBranch size={10} />GitHub
            </a>
          </div>
        </footer>

      </motion.div>
    </main>
  );
}
