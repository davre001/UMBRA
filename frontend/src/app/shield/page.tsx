"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '@/providers/app-provider';
import { Navbar } from '@/components/shared/navbar';
import { GlassCard } from '@/components/ui/glass-card';
import { AnimatedButton } from '@/components/ui/animated-button';
import { GlowBorder } from '@/components/ui/glow-border';
import { 
  Shield, 
  ArrowDown, 
  ArrowUp, 
  ToggleLeft, 
  ToggleRight, 
  HelpCircle,
  Clock,
  Coins,
  ChevronRight,
  ShieldCheck,
  CheckCircle2,
  Lock,
  RefreshCw
} from 'lucide-react';
import Link from 'next/link';

type Tab = 'deposit' | 'withdraw';
type ShieldStep = 'idle' | 'broadcast' | 'proving' | 'relaying' | 'finalized';

export default function ShieldPage() {
  const { isEntered, isWalletConnected, connectWallet, addNotification } = useApp();
  const [activeTab, setActiveTab] = useState<Tab>('deposit');
  const [asset, setAsset] = useState('WFLR');
  const [amount, setAmount] = useState('1000');
  const [gaslessRelayer, setGaslessRelayer] = useState(true);
  const [step, setStep] = useState<ShieldStep>('idle');
  const [provingProgress, setProvingProgress] = useState(0);

  // Timeline processing simulation
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (step === 'broadcast') {
      timer = setTimeout(() => {
        setStep('proving');
      }, 1500);
    } else if (step === 'proving') {
      let progress = 0;
      const interval = setInterval(() => {
        progress += 4;
        setProvingProgress(progress);
        if (progress >= 100) {
          clearInterval(interval);
          setStep(gaslessRelayer ? 'relaying' : 'finalized');
        }
      }, 80);
      return () => clearInterval(interval);
    } else if (step === 'relaying') {
      timer = setTimeout(() => {
        setStep('finalized');
      }, 2000);
    } else if (step === 'finalized') {
      addNotification(
        activeTab === 'deposit' ? "Deposit Shielded" : "Funds Withdrawn",
        `Successfully settled ${amount} ${asset} privately.`,
        "success"
      );
    }
    return () => clearTimeout(timer);
  }, [step]);

  const handleStartShield = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isWalletConnected) {
      connectWallet();
      return;
    }
    setStep('broadcast');
    setProvingProgress(0);
  };

  // If user hasn't entered the vault, redirect to Landing index
  if (!isEntered) {
    return (
      <div className="min-h-screen bg-bg-base flex flex-col items-center justify-center p-6 text-center">
        <Lock className="text-accent-secondary mb-4 animate-bounce" size={48} />
        <h1 className="text-xl font-bold font-display uppercase tracking-widest text-text-primary mb-2">Vault Portal Locked</h1>
        <p className="text-xs text-text-secondary max-w-sm mb-6 font-light">Session authorization required. Please access the root gateway to unlock the protocol vault.</p>
        <Link href="/">
          <AnimatedButton variant="primary">Return to Gateway</AnimatedButton>
        </Link>
      </div>
    );
  }

  const timelineSteps = [
    { key: 'broadcast', label: 'Broadcast Intent' },
    { key: 'proving', label: 'Noir zkProver' },
    { key: 'relaying', label: 'Gasless Relayer', cond: gaslessRelayer },
    { key: 'finalized', label: 'Settlement' }
  ].filter(t => t.cond !== false);

  const getStepIndex = (currentStep: ShieldStep) => {
    if (currentStep === 'idle') return -1;
    if (currentStep === 'broadcast') return 0;
    if (currentStep === 'proving') return 1;
    if (currentStep === 'relaying') return 2;
    return gaslessRelayer ? 3 : 2;
  };

  const currentStepIdx = getStepIndex(step);

  return (
    <div className="flex min-h-screen flex-col pt-16 z-10 relative">
      <Navbar />

      <div className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold tracking-tight text-text-primary font-display uppercase">
            Shield Gateway
          </h1>
          <p className="text-text-secondary text-xs font-light mt-1 tracking-wider uppercase">
            Deposit assets into shielding pools or withdraw gasless to stealth destinations
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Main Shield Control Panel (Span 7) */}
          <div className="lg:col-span-7">
            <GlassCard className="overflow-hidden" hoverGlow={false}>
              {/* Tab Selector */}
              <div className="flex border-b border-border-custom bg-surface/10">
                <button
                  onClick={() => { setActiveTab('deposit'); setStep('idle'); }}
                  className={`flex-1 flex items-center justify-center gap-2 py-4 text-xs font-display font-semibold uppercase tracking-wider transition-all cursor-pointer ${
                    activeTab === 'deposit' 
                      ? 'border-b-2 border-accent-primary text-accent-primary bg-surface/20' 
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <ArrowDown size={14} />
                  Shield Deposit
                </button>
                <button
                  onClick={() => { setActiveTab('withdraw'); setStep('idle'); }}
                  className={`flex-1 flex items-center justify-center gap-2 py-4 text-xs font-display font-semibold uppercase tracking-wider transition-all cursor-pointer ${
                    activeTab === 'withdraw' 
                      ? 'border-b-2 border-accent-secondary text-accent-secondary bg-surface/20' 
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <ArrowUp size={14} />
                  Private Withdraw
                </button>
              </div>

              {/* Form Content */}
              <form onSubmit={handleStartShield} className="p-6 space-y-6">
                
                {/* Asset Selection */}
                <div>
                  <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light block mb-2">Select Asset Pool</label>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { sym: 'WFLR', name: 'Wrapped Flare' },
                      { sym: 'USDC', name: 'USD Coin' },
                      { sym: 'USDT', name: 'Tether USD' },
                    ].map((item) => (
                      <button
                        key={item.sym}
                        type="button"
                        onClick={() => setAsset(item.sym)}
                        className={`flex flex-col items-start p-3 rounded-lg border text-left transition-all cursor-pointer ${
                          asset === item.sym 
                            ? 'border-accent-primary bg-accent-primary/5 shadow-[0_0_10px_rgba(0,240,255,0.05)]' 
                            : 'border-border-custom bg-surface/20 hover:border-border-custom/80'
                        }`}
                      >
                        <span className="text-xs font-bold text-text-primary font-display">{item.sym}</span>
                        <span className="text-[9px] text-text-secondary mt-0.5">{item.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Amount Input */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light">Amount</label>
                    <span className="text-[9px] text-text-secondary font-mono">Available: 4,200 {asset}</span>
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-surface/30 border border-border-custom rounded-lg px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-accent-primary/60 font-mono"
                      required
                    />
                    <span className="absolute right-4 top-3.5 text-xs text-text-secondary font-bold font-mono">{asset}</span>
                  </div>
                </div>

                {/* Gasless Relayer Toggle */}
                <div className="flex items-center justify-between border-t border-b border-border-custom/50 py-4">
                  <div>
                    <span className="text-xs font-semibold text-text-primary uppercase tracking-wide flex items-center gap-1.5">
                      Gasless Relayer Settle
                      <HelpCircle size={12} className="text-text-secondary cursor-help" />
                    </span>
                    <p className="text-[10px] text-text-secondary mt-0.5 leading-normal max-w-sm">
                      Deduct network gas directly from shielded balance. No gas tokens required in matching wallet.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setGaslessRelayer(!gaslessRelayer)}
                    className="text-text-secondary hover:text-text-primary transition-all cursor-pointer"
                  >
                    {gaslessRelayer ? (
                      <ToggleRight size={38} className="text-accent-primary" />
                    ) : (
                      <ToggleLeft size={38} />
                    )}
                  </button>
                </div>

                {/* Transaction details overview */}
                <div className="space-y-1.5 text-[10px] uppercase font-mono tracking-wider text-text-secondary border-b border-border-custom/40 pb-4">
                  <div className="flex justify-between">
                    <span>Estimated Proving Speed:</span>
                    <span className="text-text-primary">~1.15 Seconds</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Protocol Fee (0.05%):</span>
                    <span className="text-text-primary">{(Number(amount) * 0.0005).toFixed(4)} {asset}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Relayer Fee:</span>
                    <span className="text-text-primary">{gaslessRelayer ? '0.12 WFLR' : '0.00 (Gas Paid)'}</span>
                  </div>
                </div>

                {/* Submit Action */}
                <AnimatedButton
                  variant={activeTab === 'deposit' ? 'primary' : 'secondary'}
                  type="submit"
                  disabled={step !== 'idle'}
                  fullWidth
                  className="rounded-xl py-3"
                >
                  {!isWalletConnected ? (
                    'Connect Wallet to Shield'
                  ) : step !== 'idle' ? (
                    <span className="flex items-center gap-2">
                      <RefreshCw className="animate-spin" size={14} />
                      Shield Cryptography in progress...
                    </span>
                  ) : activeTab === 'deposit' ? (
                    'Initiate Shield Deposit'
                  ) : (
                    'Initiate Private Withdrawal'
                  )}
                </AnimatedButton>

              </form>
            </GlassCard>
          </div>

          {/* Timeline Animation Panel (Span 5) */}
          <div className="lg:col-span-5">
            <GlowBorder active={step !== 'idle'} glowColor={step === 'finalized' ? 'success' : 'cyan'}>
              <GlassCard className="p-6 min-h-[380px] flex flex-col justify-between" hoverGlow={false}>
                <div>
                  <div className="flex items-center gap-2 border-b border-border-custom pb-4 mb-6">
                    <Clock size={16} className="text-accent-primary" />
                    <h2 className="text-sm uppercase tracking-wider font-display font-bold">Execution Timeline</h2>
                  </div>

                  {step === 'idle' ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center text-text-secondary">
                      <Shield size={36} className="text-border-custom mb-3" />
                      <span className="text-xs uppercase tracking-widest">Awaiting execution</span>
                      <p className="text-[10px] text-text-secondary/60 mt-1 max-w-[200px] leading-relaxed">
                        Submit the form to watch the zk-SNARK timeline progress live.
                      </p>
                    </div>
                  ) : (
                    /* Timeline Progress Display */
                    <div className="relative pl-6 space-y-6">
                      
                      {/* Vertical line indicator */}
                      <div className="absolute left-2.5 top-2 bottom-2 w-0.5 bg-border-custom z-0" />

                      {timelineSteps.map((t, idx) => {
                        const isDone = currentStepIdx > idx;
                        const isCurrent = currentStepIdx === idx;
                        
                        return (
                          <div key={t.key} className="relative z-10 flex items-start gap-4">
                            {/* Checkpoint marker */}
                            <div className={`h-6.5 w-6.5 rounded-full border-2 flex items-center justify-center bg-bg-base transition-colors duration-300 flex-shrink-0 ${
                              isDone 
                                ? 'border-success-state text-success-state' 
                                : isCurrent 
                                  ? 'border-accent-primary text-accent-primary animate-pulse' 
                                  : 'border-border-custom text-text-secondary'
                            }`}>
                              {isDone ? (
                                <CheckCircle2 size={12} className="fill-success-state/15" />
                              ) : (
                                <span className="text-[9px] font-bold font-mono">{idx + 1}</span>
                              )}
                            </div>

                            {/* Timeline labels */}
                            <div>
                              <span className={`text-xs font-semibold block uppercase tracking-wide ${
                                isDone ? 'text-text-primary' : isCurrent ? 'text-accent-primary' : 'text-text-secondary'
                              }`}>
                                {t.label}
                              </span>

                              {/* Action details under step */}
                              {isCurrent && t.key === 'broadcast' && (
                                <span className="text-[9px] text-text-secondary mt-0.5 block leading-normal">
                                  Signing security inputs. Structuring private transaction parameters.
                                </span>
                              )}
                              {isCurrent && t.key === 'proving' && (
                                <div className="mt-1.5 w-40">
                                  <span className="text-[8px] text-accent-primary font-mono block">Noir WASM constraint proving: {provingProgress}%</span>
                                  <div className="w-full bg-border-custom/50 rounded-full h-1 mt-1">
                                    <div className="bg-accent-primary h-1 rounded-full" style={{ width: `${provingProgress}%` }} />
                                  </div>
                                </div>
                              )}
                              {isCurrent && t.key === 'relaying' && (
                                <span className="text-[9px] text-accent-secondary mt-0.5 block leading-normal animate-pulse">
                                  Relayer node matching transaction hash. Settle fee deducted privately.
                                </span>
                              )}
                              {isCurrent && t.key === 'finalized' && (
                                <span className="text-[9px] text-success-state mt-0.5 block leading-normal">
                                  Vault transaction successfully processed. Ledger updated.
                                </span>
                              )}
                              {isDone && (
                                <span className="text-[9px] text-success-state/60 mt-0.5 block leading-none">Completed</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {step === 'finalized' && (
                  <div className="mt-6 border-t border-border-custom/40 pt-4 flex justify-between items-center bg-success-state/5 p-3 rounded-lg border border-success-state/10 animate-fade-in">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="text-success-state animate-pulse" size={16} />
                      <span className="text-[10px] font-bold text-success-state uppercase tracking-wider">Shield session verified</span>
                    </div>
                    <button
                      onClick={() => setStep('idle')}
                      className="text-[9px] text-text-secondary hover:text-text-primary underline cursor-pointer"
                    >
                      Clear State
                    </button>
                  </div>
                )}
              </GlassCard>
            </GlowBorder>
          </div>
        </div>

      </div>
    </div>
  );
}
