"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '@/providers/app-provider';
import { Navbar } from '@/components/shared/navbar';
import { Sidebar } from '@/components/shared/sidebar';
import { GlassCard } from '@/components/ui/glass-card';
import { AnimatedButton } from '@/components/ui/animated-button';
import { GlowBorder } from '@/components/ui/glow-border';
import { 
  Shield, 
  Cpu, 
  ChevronRight, 
  Lock, 
  CheckCircle2, 
  Server, 
  ArrowRight, 
  ExternalLink,
  Code,
  ShieldCheck,
  RefreshCw
} from 'lucide-react';
import Link from 'next/link';

export default function Home() {
  const { isEntered, setIsEntered, connectWallet, isWalletConnected } = useApp();
  const [transitioning, setTransitioning] = useState(false);

  // ZK Proof Simulator States
  const [zkStep, setZkStep] = useState<'idle' | 'witness' | 'proving' | 'verifying' | 'success'>('idle');
  const [proveProgress, setProveProgress] = useState(0);
  const [witnessData, setWitnessData] = useState<string>('');
  const [proofBytes, setProofBytes] = useState<string>('');

  const handleEnterVault = () => {
    setTransitioning(true);
    // Cinematic delay
    setTimeout(() => {
      setIsEntered(true);
      setTransitioning(false);
    }, 1200);
  };

  // ZK proof simulation loop
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
        
        // Generate random fake proof hex bytes
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
          /* CINEMATIC LANDING PANEL */
          <motion.div
            key="vault-portal"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.05, filter: 'blur(10px)' }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
            className="relative flex flex-col items-center justify-center min-h-screen px-4 z-30"
          >
            {/* Grid background */}
            <div className="absolute inset-0 grid-overlay opacity-30 z-0 pointer-events-none" />

            <div className="relative text-center flex flex-col items-center max-w-3xl z-10">
              {/* Giant Luxury Ambient Ring */}
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 25, repeat: Infinity, ease: 'linear' }}
                className="absolute -top-36 w-96 h-96 rounded-full border border-dashed border-accent-primary/20 opacity-30 pointer-events-none blur-[2px]"
              />
              
              {/* Giant Vault Logo Lock */}
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 1, ease: 'easeOut' }}
                className="mb-8 p-6 rounded-full border border-border-custom bg-surface/30 backdrop-blur-xl relative group shadow-[0_0_50px_rgba(112,0,255,0.05)]"
              >
                <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-accent-secondary/20 to-accent-primary/20 opacity-0 group-hover:opacity-100 transition-opacity duration-700 blur" />
                <div className="h-20 w-20 rounded-full border border-accent-primary/30 flex items-center justify-center bg-bg-base relative">
                  <Lock size={32} className="text-accent-primary animate-pulse" />
                </div>
              </motion.div>

              <motion.h1
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2, duration: 0.8 }}
                whileHover={{
                  scale: 1.03,
                  rotate: -1,
                }}
                className="font-display text-5xl sm:text-7xl font-extrabold tracking-tighter text-text-primary mb-6 uppercase cursor-default origin-center select-none filter drop-shadow-[0_4px_12px_rgba(0,0,0,0.95)] drop-shadow-[0_12px_24px_rgba(0,0,0,0.95)]"
              >
                Private Trading.<br />
                <span className="text-accent-primary">
                  Without Compromise.
                </span>
              </motion.h1>

              <motion.p
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4, duration: 0.8 }}
                className="font-sans text-sm sm:text-base text-text-primary max-w-lg mb-10 tracking-normal font-semibold leading-relaxed text-center select-none filter drop-shadow-[0_2px_4px_rgba(0,0,0,1)] drop-shadow-[0_8px_16px_rgba(0,0,0,1)]"
              >
                Umbra Protocol brings trustless dark pool liquidity, stealth addresses, and compliance-certified zero-knowledge proving architecture to the Flare Network.
              </motion.p>

              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.6, duration: 0.8 }}
              >
                <AnimatedButton
                  variant="primary"
                  size="lg"
                  onClick={handleEnterVault}
                  disabled={transitioning}
                  className="px-10 py-4 font-bold border border-accent-primary/30 rounded-xl"
                >
                  {transitioning ? (
                    <span className="flex items-center gap-2">
                      <RefreshCw className="animate-spin" size={16} />
                      Opening Secure Vault...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      Initiate Protocol Session
                      <ArrowRight size={16} />
                    </span>
                  )}
                </AnimatedButton>
              </motion.div>
            </div>
          </motion.div>
        ) : (
          /* CORE APPLICATION DASHBOARD OVERVIEW */
          <motion.div
            key="app-dashboard"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex min-h-screen flex-col pt-16 md:pl-16 z-10 relative"
          >
            <Navbar />
            <Sidebar />

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
                {!isWalletConnected ? (
                  <AnimatedButton variant="primary" size="sm" onClick={connectWallet}>
                    Connect Wallet
                  </AnimatedButton>
                ) : (
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
                      <span className="text-xl sm:text-2xl font-bold tracking-tight text-text-primary font-display">
                        {stat.value}
                      </span>
                      <span className={`block text-[10px] mt-1 font-light ${stat.color === 'success' ? 'text-success-state' : 'text-accent-primary'}`}>
                        {stat.change}
                      </span>
                    </div>
                  </GlassCard>
                ))}
              </div>

              {/* TWO PANEL CONTENT: ZK Sim and Architecture */}
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

                        {/* Interactive proving simulator screen */}
                        <div className="bg-surface/50 border border-border-custom rounded-lg p-4 font-mono text-[11px] min-h-[180px] flex flex-col justify-between relative overflow-hidden mb-6">
                          
                          {/* Ambient Proving Ring background */}
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
                            <div className="text-accent-primary leading-normal whitespace-pre-wrap">
                              {witnessData}
                            </div>
                          )}

                          {zkStep === 'proving' && (
                            <div className="flex flex-col justify-between h-full flex-1">
                              <div className="text-accent-secondary leading-none mb-2 uppercase tracking-widest text-[10px]">
                                WASM WebGPU Proving...
                              </div>
                              <div className="text-text-secondary overflow-y-hidden text-[9px] leading-tight break-all max-h-[80px]">
                                {proofBytes}
                              </div>
                              <div className="w-full bg-border-custom/50 rounded-full h-1.5 mt-2">
                                <div 
                                  className="bg-accent-primary h-1.5 rounded-full transition-all duration-100" 
                                  style={{ width: `${proveProgress}%` }}
                                />
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
                          <button 
                            onClick={() => setZkStep('idle')} 
                            className="text-xs text-text-secondary hover:text-text-primary hover:underline cursor-pointer"
                          >
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
                          { title: 'Compliance verification', desc: 'Privacy is backed by opt-in cryptographic audits. Export viewing keys to prove clean transaction chains without breaking secrecy.' }
                        ].map((item, idx) => (
                          <div key={idx} className="border-l border-accent-secondary/30 pl-3">
                            <span className="text-xs font-semibold text-text-primary uppercase tracking-wider font-display block">
                              {item.title}
                            </span>
                            <p className="text-[10px] text-text-secondary mt-1 font-light leading-normal">
                              {item.desc}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="pt-6 border-t border-border-custom/50 mt-6 flex items-center justify-between">
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
                  <a href="#" className="text-[10px] text-text-secondary hover:text-text-primary uppercase tracking-widest inline-flex items-center gap-1">
                    Documentation <ExternalLink size={10} />
                  </a>
                  <a href="#" className="text-[10px] text-text-secondary hover:text-text-primary uppercase tracking-widest">
                    Audits
                  </a>
                  <a href="#" className="text-[10px] text-text-secondary hover:text-text-primary uppercase tracking-widest">
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
