"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '@/providers/app-provider';
import { Navbar } from '@/components/shared/navbar';
import { GlassCard } from '@/components/ui/glass-card';
import { AnimatedButton } from '@/components/ui/animated-button';
import { GlowBorder } from '@/components/ui/glow-border';
import { CountUp } from '@/components/ui/count-up';
import {
  Shield,
  Cpu,
  ChevronRight,
  Lock,
  CheckCircle2,
  Server,
  ArrowRight,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  GitBranch,
  BookOpen,
  Droplets,
  Send,
  EyeOff,
  ArrowDown,
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
  const { isEntered, setIsEntered, connectWallet, isWalletConnected } = useApp();
  const [transitioning, setTransitioning] = useState(false);

  // ZK Proof Simulator States (used in dashboard)
  const [zkStep, setZkStep] = useState<'idle' | 'witness' | 'proving' | 'verifying' | 'success'>('idle');
  const [proveProgress, setProveProgress] = useState(0);
  const [witnessData, setWitnessData] = useState<string>('');
  const [proofBytes, setProofBytes] = useState<string>('');

  const handleEnterVault = () => {
    setTransitioning(true);
    setTimeout(() => {
      setIsEntered(true);
      setTransitioning(false);
    }, 1200);
  };

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (zkStep === 'witness') {
      setWitnessData('Calculating Merkle membership path...\nWitness inputs derived successfully:\n- secret_key: 0x9f...a2\n- nullifier_hash: 0x3d...b8\n- value: 1500 WFLR');
      timer = setTimeout(() => setZkStep('proving'), 1800);
    } else if (zkStep === 'proving') {
      let currentProgress = 0;
      const interval = setInterval(() => {
        currentProgress += 5;
        setProveProgress(currentProgress);
        const randomHex = Array.from({ length: 12 }, () =>
          Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
        ).join('');
        setProofBytes(prev => (prev + randomHex).slice(-360));
        if (currentProgress >= 100) {
          clearInterval(interval);
          setZkStep('verifying');
        }
      }, 100);
      return () => clearInterval(interval);
    } else if (zkStep === 'verifying') {
      timer = setTimeout(() => setZkStep('success'), 2000);
    }
    return () => clearTimeout(timer);
  }, [zkStep]);

  const startZkSimulation = () => {
    setZkStep('witness');
    setProveProgress(0);
    setWitnessData('');
    setProofBytes('');
  };

  return (
    <main className="relative min-h-screen w-full overflow-x-hidden">

      <AnimatePresence mode="wait">
        {!isEntered ? (

          /* ── LANDING PAGE ── */
          <motion.div
            key="vault-portal"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.05, filter: 'blur(10px)' }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
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
                  Trade without leaving a trace. Umbra pairs zero-knowledge proofs with stealth addresses and TEE-matched dark pool liquidity, so your positions, counterparties, and balances stay private — while settling openly on Flare.
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
                      desc: 'Swap inside Trusted Execution Environments. Orders match off-chain in SGX enclaves and settle atomically on Flare.',
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
                  { name: 'Intel SGX', role: 'TEE Matching' },
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
                  onClick={handleEnterVault}
                  disabled={transitioning}
                  className="px-10 py-4 font-bold"
                >
                  {transitioning ? (
                    <span className="flex items-center gap-2"><RefreshCw className="animate-spin" size={16} />Loading...</span>
                  ) : (
                    <span className="flex items-center gap-2">Launch Protocol <ArrowRight size={16} /></span>
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

        ) : (

          /* ── CORE APPLICATION DASHBOARD ── */
          <motion.div
            key="app-dashboard"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex min-h-screen flex-col pt-16 z-10 relative"
          >
            <Navbar />

            <div className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
              {/* Dashboard Hero Header */}
              <div className="mb-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-extrabold tracking-tight text-text-primary font-display uppercase">
                    Umbra Core
                  </h1>
                  <p className="text-text-secondary text-xs font-light mt-1 tracking-wider uppercase">
                    Zero-Knowledge Dark Pool Liquidity on Flare
                  </p>
                </div>
                {isWalletConnected && (
                  <div className="text-xs text-text-secondary flex items-center gap-2">
                    <span className="h-2 w-2 bg-success-state rounded-full animate-ping" />
                    Secure Sandbox Active
                  </div>
                )}
              </div>

              {/* Protocol Quick Statistics Grid */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                {[
                  { name: 'Net Shielded Value', value: '$84,204,910', change: '+12.4% (24h)', color: 'cyan' },
                  { name: 'Active Stealth Sets', value: '1,492', change: '+3.1% (24h)', color: 'purple' },
                  { name: 'Proving Velocity', value: '1.24s / Proof', change: 'WebGPU WASM', color: 'cyan' },
                  { name: 'Compliance Rate', value: '100%', change: 'Sanction Screened', color: 'success' },
                ].map((stat, idx) => (
                  <GlassCard key={idx} hoverGlow={true} glowColor={stat.color as any} className="p-4 flex flex-col justify-between">
                    <span className="text-[10px] text-text-secondary uppercase tracking-widest font-sans font-light">
                      {stat.name}
                    </span>
                    <div className="mt-2">
                      <CountUp
                        value={stat.value}
                        className="text-xl sm:text-2xl font-bold tracking-tight text-text-primary font-display tabular-nums"
                      />
                      <span className={`block text-[10px] mt-1 font-light ${stat.color === 'success' ? 'text-success-state' : 'text-accent-primary'}`}>
                        {stat.change}
                      </span>
                    </div>
                  </GlassCard>
                ))}
              </div>

              {/* TWO PANEL: ZK Sim and Architecture */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* ZK Proving Simulator (Span 2) */}
                <div className="lg:col-span-2">
                  <GlowBorder active={zkStep !== 'idle'} glowColor={zkStep === 'success' ? 'success' : 'cyan'}>
                    <GlassCard className="p-6 h-full flex flex-col justify-between" hoverGlow={false}>
                      <div>
                        <div className="flex items-center justify-between border-b border-border-custom pb-4 mb-6">
                          <div className="flex items-center gap-2">
                            <Cpu className="text-accent-primary" size={20} />
                            <h2 className="text-base uppercase tracking-wider font-display font-bold">
                              Interactive ZK-SNARK Proving Engine
                            </h2>
                          </div>
                          <span className="text-[10px] font-mono border border-border-custom px-2 py-0.5 rounded bg-surface/30 text-text-secondary uppercase">
                            Noir Compiler v0.32
                          </span>
                        </div>

                        <p className="text-xs text-text-secondary mb-6 font-light leading-relaxed">
                          Shielding assets requires proving membership in Flare state Merkle trees. Generate a zero-knowledge membership proof locally to hide your inputs.
                        </p>

                        <div className="bg-surface/50 border border-border-custom rounded-lg p-4 font-mono text-[11px] min-h-[180px] flex flex-col justify-between relative overflow-hidden mb-6">
                          {zkStep === 'proving' && (
                            <div className="absolute inset-0 bg-accent-primary/5 animate-pulse flex items-center justify-center">
                              <span className="h-40 w-40 rounded-full border border-dashed border-accent-primary/20 animate-spin" />
                            </div>
                          )}
                          {zkStep === 'idle' && (
                            <div className="flex flex-col items-center justify-center flex-1 text-center py-6">
                              <Shield size={32} className="text-border-custom mb-2" />
                              <span className="text-text-secondary uppercase tracking-widest text-[10px]">Proving simulator ready.</span>
                              <span className="text-[9px] text-text-secondary/50 mt-1">Select Shielding parameters to generate zk-SNARK proof.</span>
                            </div>
                          )}
                          {zkStep === 'witness' && (
                            <div className="text-accent-primary leading-normal whitespace-pre-wrap">{witnessData}</div>
                          )}
                          {zkStep === 'proving' && (
                            <div className="flex flex-col justify-between h-full flex-1">
                              <div className="text-accent-secondary leading-none mb-2 uppercase tracking-widest text-[10px]">WASM WebGPU Proving...</div>
                              <div className="text-text-secondary overflow-y-hidden text-[9px] leading-tight break-all max-h-[80px]">{proofBytes}</div>
                              <div className="w-full bg-border-custom/50 rounded-full h-1.5 mt-2">
                                <div className="bg-accent-primary h-1.5 rounded-full transition-all duration-100" style={{ width: `${proveProgress}%` }} />
                              </div>
                            </div>
                          )}
                          {zkStep === 'verifying' && (
                            <div className="flex flex-col items-center justify-center flex-1 py-4 text-center">
                              <RefreshCw size={24} className="text-accent-primary animate-spin mb-2" />
                              <span className="text-text-primary uppercase tracking-wider text-[10px] font-semibold">Broadcasting to Flare Verifier contract...</span>
                              <span className="text-[9px] text-text-secondary mt-1">Executing verify_proof() recursive check on-chain.</span>
                            </div>
                          )}
                          {zkStep === 'success' && (
                            <div className="flex flex-col justify-between flex-1">
                              <div className="flex items-center gap-2 text-success-state mb-2">
                                <CheckCircle2 size={16} />
                                <span className="font-semibold text-xs uppercase tracking-wider">Proof Accepted & Verified</span>
                              </div>
                              <div className="text-[10px] text-text-secondary leading-relaxed font-mono">
                                Proof Size: 192 bytes<br />
                                TX Hash: <span className="text-accent-primary">0xf381...ae3d</span><br />
                                State root updated. Assets shielded under stealth set.
                              </div>
                              <div className="text-[9px] text-success-state/60 border border-success-state/20 bg-success-state/5 p-2 rounded mt-2">
                                Anonymity set increased (+1). Connection to TEE dark pool matching node certified.
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-3">
                        {zkStep !== 'idle' && (
                          <button onClick={() => setZkStep('idle')} className="text-xs text-text-secondary hover:text-text-primary hover:underline cursor-pointer">
                            Reset Engine
                          </button>
                        )}
                        <AnimatedButton
                          variant={zkStep === 'success' ? 'glass' : 'primary'}
                          disabled={zkStep !== 'idle'}
                          onClick={startZkSimulation}
                        >
                          {zkStep === 'idle' && 'Generate Noir zk-SNARK Proof'}
                          {zkStep === 'witness' && 'Deriving Witness...'}
                          {zkStep === 'proving' && `Proving [${proveProgress}%]`}
                          {zkStep === 'verifying' && 'Contract Verifying...'}
                          {zkStep === 'success' && 'Simulation Completed'}
                        </AnimatedButton>
                      </div>
                    </GlassCard>
                  </GlowBorder>
                </div>

                {/* Architecture Visualizer (Span 1) */}
                <div>
                  <GlassCard className="p-6 h-full flex flex-col justify-between" hoverGlow={true}>
                    <div>
                      <div className="flex items-center gap-2 border-b border-border-custom pb-4 mb-6">
                        <Server size={18} className="text-accent-secondary" />
                        <h2 className="text-base uppercase tracking-wider font-display font-bold">
                          Protocol Architecture
                        </h2>
                      </div>
                      <div className="space-y-4">
                        {[
                          { title: 'Stealth Addresses', desc: 'Diffie-Hellman key derivation generates clean, unique payment seeds on Flare Network, isolating recipient identities.' },
                          { title: 'TEE Matching Nodes', desc: 'Dark Swap intents are matched in secure Enclaves (Intel SGX), executing batch orders at midpoint oracle rates.' },
                          { title: 'Compliance Verification', desc: 'Privacy is backed by opt-in cryptographic audits. Export viewing keys to prove clean transaction chains without breaking secrecy.' }
                        ].map((item, idx) => (
                          <div key={idx} className="border-l border-accent-secondary/30 pl-3">
                            <span className="text-xs font-semibold text-text-primary uppercase tracking-wider font-display block">{item.title}</span>
                            <p className="text-[10px] text-text-secondary mt-1 font-light leading-normal">{item.desc}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="pt-6 border-t border-border-custom/50 mt-6">
                      <Link
                        href="/portfolio"
                        className="text-xs text-accent-primary hover:text-accent-primary/80 font-semibold tracking-wider uppercase inline-flex items-center gap-1 hover:gap-1.5 transition-all"
                      >
                        Enter App Modules
                        <ChevronRight size={14} />
                      </Link>
                    </div>
                  </GlassCard>
                </div>

              </div>

              {/* FOOTER */}
              <footer className="mt-20 border-t border-border-custom/40 pt-8 pb-12 flex flex-col sm:flex-row items-center justify-between gap-4">
                <span className="text-[10px] text-text-secondary uppercase tracking-widest">
                  © 2026 Umbra Protocol. Built on Flare Network.
                </span>
                <div className="flex items-center gap-6">
                  <a href="https://docs.umbraprotocol.io" target="_blank" rel="noopener noreferrer" className="text-[10px] text-text-secondary hover:text-text-primary uppercase tracking-widest inline-flex items-center gap-1">
                    Documentation <ExternalLink size={10} />
                  </a>
                  <a href="https://github.com/davre001/UMBRA" target="_blank" rel="noopener noreferrer" className="text-[10px] text-text-secondary hover:text-text-primary uppercase tracking-widest">
                    GitHub
                  </a>
                </div>
              </footer>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
