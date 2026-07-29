"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '@/providers/app-provider';
import { Navbar } from '@/components/shared/navbar';
import { GlassCard } from '@/components/ui/glass-card';
import { AnimatedButton } from '@/components/ui/animated-button';
import { GlowBorder } from '@/components/ui/glow-border';
import { 
  RefreshCw, 
  Settings2, 
  HelpCircle, 
  TrendingUp, 
  Cpu, 
  Lock, 
  Check, 
  ZapOff, 
  ChevronDown,
  Activity
} from 'lucide-react';
import Link from 'next/link';

type SwapState = 'idle' | 'routing' | 'matching' | 'settled';

export default function DarkSwapPage() {
  const { isEntered, isWalletConnected, connectWallet, addNotification } = useApp();
  const [fromAsset, setFromAsset] = useState('USDC');
  const [toAsset, setToAsset] = useState('uWFLR');
  const [fromAmount, setFromAmount] = useState('5000');
  const [toAmount, setToAmount] = useState('25000');
  const [slippage, setSlippage] = useState('0.1');
  const [mevProtection, setMevProtection] = useState('maximum');
  const [swapState, setSwapState] = useState<SwapState>('idle');
  const [matchingProgress, setMatchingProgress] = useState(0);

  // Matcher animation steps
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (swapState === 'routing') {
      timer = setTimeout(() => {
        setSwapState('matching');
      }, 1500);
    } else if (swapState === 'matching') {
      let progress = 0;
      const interval = setInterval(() => {
        progress += 5;
        setMatchingProgress(progress);
        if (progress >= 100) {
          clearInterval(interval);
          setSwapState('settled');
        }
      }, 100);
      return () => clearInterval(interval);
    } else if (swapState === 'settled') {
      addNotification("Dark Swap Executed", `Exchanged ${fromAmount} ${fromAsset} for ${toAmount} ${toAsset} privately.`, "success");
    }
    return () => clearTimeout(timer);
  }, [swapState]);

  const handleSwap = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isWalletConnected) {
      connectWallet();
      return;
    }
    setSwapState('routing');
    setMatchingProgress(0);
  };

  const switchAssets = () => {
    const temp = fromAsset;
    setFromAsset(toAsset);
    setToAsset(temp);
    const tempAmt = fromAmount;
    setFromAmount(toAmount);
    setToAmount(tempAmt);
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

  // SVG Chart points
  const points = [40, 45, 42, 48, 52, 50, 58, 62, 59, 64, 68, 70, 74];
  const chartWidth = 600;
  const chartHeight = 150;
  const maxVal = 80;
  const minVal = 30;

  const chartCoordinates = points.map((p, i) => {
    const x = (i / (points.length - 1)) * chartWidth;
    const y = chartHeight - ((p - minVal) / (maxVal - minVal)) * chartHeight;
    return `${x},${y}`;
  }).join(' ');

  const areaPath = `M 0,${chartHeight} L ${chartCoordinates} L ${chartWidth},${chartHeight} Z`;
  const linePath = `M ${chartCoordinates}`;

  return (
    <div className="flex min-h-screen flex-col pt-16 z-10 relative">
      <Navbar />

      <div className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold tracking-tight text-text-primary font-display uppercase">
            Dark Swap Intentions
          </h1>
          <p className="text-text-secondary text-xs font-light mt-1 tracking-wider uppercase">
            MEV-resistant TEE batch matching order book
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Trading Charts & Configuration (Span 7) */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Midpoint Price Chart */}
            <GlassCard className="p-6" hoverGlow={false}>
              <div className="flex items-center justify-between border-b border-border-custom pb-4 mb-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="text-accent-primary" size={16} />
                  <span className="text-xs font-semibold uppercase tracking-wider font-display">Midpoint Index: {fromAsset}/{toAsset}</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-success-state font-mono">
                  <Activity size={12} className="animate-pulse" />
                  LIVE ORACLE FEED
                </div>
              </div>

              {/* Price Line chart */}
              <div className="h-[150px] w-full relative overflow-hidden">
                <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
                  <defs>
                    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgba(255, 165, 0, 0.15)" />
                      <stop offset="100%" stopColor="rgba(255, 255, 255, 0.0)" />
                    </linearGradient>
                  </defs>
                  
                  {/* Fill Area */}
                  <motion.path
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 1 }}
                    d={areaPath}
                    fill="url(#areaGrad)"
                  />

                  {/* Stroke Line */}
                  <motion.path
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 1.5 }}
                    d={linePath}
                    fill="none"
                    stroke="#FFA500"
                    strokeWidth="2"
                  />
                </svg>
              </div>

              {/* Chart Stats */}
              <div className="flex justify-between border-t border-border-custom/30 pt-4 mt-2 text-[10px] font-mono text-text-secondary uppercase">
                <span>Oracle Rate: 1 {fromAsset} = {(Number(toAmount)/Number(fromAmount)).toFixed(4)} {toAsset}</span>
                <span>Oracle Spread: 0.00% (Pure Midpoint)</span>
              </div>
            </GlassCard>

            {/* MEV & Slippage Settings */}
            <GlassCard className="p-6" hoverGlow={false}>
              <div className="flex items-center justify-between border-b border-border-custom pb-4 mb-6">
                <div className="flex items-center gap-2">
                  <Settings2 size={16} className="text-accent-secondary" />
                  <h2 className="text-xs uppercase tracking-wider font-display font-semibold">Private Protection controls</h2>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Slippage tolerance */}
                <div>
                  <span className="text-[10px] text-text-secondary uppercase tracking-widest font-light block mb-2">Max Slippage Limits</span>
                  <div className="flex gap-2">
                    {['0.05', '0.1', '0.5'].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setSlippage(v)}
                        className={`flex-1 py-2 text-xs font-mono rounded-lg border cursor-pointer ${
                          slippage === v 
                            ? 'border-accent-primary bg-accent-primary/5 text-accent-primary' 
                            : 'border-border-custom bg-surface/20 text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        {v}%
                      </button>
                    ))}
                  </div>
                </div>

                {/* MEV Protection Level */}
                <div>
                  <span className="text-[10px] text-text-secondary uppercase tracking-widest font-light block mb-2">MEV Shield Configuration</span>
                  <div className="flex gap-2">
                    {['maximum', 'auto'].map((l) => (
                      <button
                        key={l}
                        type="button"
                        onClick={() => setMevProtection(l)}
                        className={`flex-1 py-2 text-xs uppercase tracking-wider rounded-lg border cursor-pointer ${
                          mevProtection === l 
                            ? 'border-accent-secondary bg-accent-secondary/5 text-accent-secondary font-semibold' 
                            : 'border-border-custom bg-surface/20 text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </GlassCard>

          </div>

          {/* Swap action & matching simulator (Span 5) */}
          <div className="lg:col-span-5 space-y-6">
            <GlassCard className="p-6" hoverGlow={true} glowColor="purple">
              <form onSubmit={handleSwap} className="space-y-4">
                
                {/* FROM input */}
                <div>
                  <span className="text-[10px] text-text-secondary uppercase tracking-widest font-light block mb-1">Pay (Intent Source)</span>
                  <div className="relative">
                    <input
                      type="number"
                      value={fromAmount}
                      onChange={(e) => {
                        setFromAmount(e.target.value);
                        setToAmount((Number(e.target.value) * 5).toString());
                      }}
                      className="w-full bg-surface/30 border border-border-custom rounded-lg px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-accent-primary/60 font-mono"
                      required
                    />
                    <span className="absolute right-4 top-3 text-xs text-text-secondary font-bold font-mono">{fromAsset}</span>
                  </div>
                </div>

                {/* Switch button */}
                <div className="flex justify-center -my-2 relative z-20">
                  <button
                    type="button"
                    onClick={switchAssets}
                    className="p-2 rounded-full border border-border-custom bg-bg-base text-accent-primary hover:border-accent-primary transition-all cursor-pointer"
                  >
                    <RefreshCw size={14} className="hover:rotate-180 transition-transform duration-500" />
                  </button>
                </div>

                {/* TO input */}
                <div>
                  <span className="text-[10px] text-text-secondary uppercase tracking-widest font-light block mb-1">Receive (Private Pool Target)</span>
                  <div className="relative">
                    <input
                      type="number"
                      value={toAmount}
                      onChange={(e) => {
                        setToAmount(e.target.value);
                        setFromAmount((Number(e.target.value) / 5).toString());
                      }}
                      className="w-full bg-surface/30 border border-border-custom rounded-lg px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-accent-primary/60 font-mono"
                      required
                    />
                    <span className="absolute right-4 top-3 text-xs text-text-secondary font-bold font-mono">{toAsset}</span>
                  </div>
                </div>

                {/* Swap Execute */}
                <AnimatedButton
                  variant="primary"
                  type="submit"
                  disabled={swapState !== 'idle'}
                  fullWidth
                  className="py-3 rounded-xl"
                >
                  {swapState !== 'idle' ? 'Processing Intent...' : 'Submit Swap Intent'}
                </AnimatedButton>

              </form>
            </GlassCard>

            {/* TEE Matching visualizer */}
            <GlowBorder active={swapState !== 'idle'} glowColor={swapState === 'settled' ? 'success' : 'purple'}>
              <GlassCard className="p-6 h-56 flex flex-col justify-between" hoverGlow={false}>
                <div>
                  <div className="flex items-center gap-2 border-b border-border-custom pb-3 mb-4">
                    <Cpu size={16} className="text-accent-secondary" />
                    <h2 className="text-xs uppercase tracking-wider font-display font-semibold">Secure Matching Enclave (TEE)</h2>
                  </div>

                  {swapState === 'idle' && (
                    <div className="flex flex-col items-center justify-center text-center text-text-secondary py-6">
                      <Lock size={24} className="text-border-custom mb-1" />
                      <span className="text-[10px] uppercase tracking-widest">TEE Matching Node Ready</span>
                      <span className="text-[9px] text-text-secondary/50 mt-0.5">Matching occurs inside Intel SGX hardware.</span>
                    </div>
                  )}

                  {swapState === 'routing' && (
                    <div className="text-center py-4">
                      <RefreshCw size={20} className="text-accent-secondary animate-spin mx-auto mb-2" />
                      <span className="text-[10px] font-bold text-text-primary uppercase tracking-wider block">Routing Encrypted swap parameters</span>
                      <span className="text-[8px] font-mono text-text-secondary mt-0.5 block">Generating private ephemeral key seed...</span>
                    </div>
                  )}

                  {swapState === 'matching' && (
                    <div className="space-y-3">
                      <div className="flex justify-between items-center text-[10px] font-mono text-accent-primary uppercase tracking-wider">
                        <span>TEE Batch matching intents:</span>
                        <span>{matchingProgress}%</span>
                      </div>
                      <div className="w-full bg-border-custom/50 rounded-full h-1">
                        <div className="bg-accent-primary h-1 rounded-full" style={{ width: `${matchingProgress}%` }} />
                      </div>
                      <p className="text-[9px] text-text-secondary font-mono leading-normal">
                        Matching incoming counterpart liquidity packets securely. <br />
                        - Oracle Feed Sync: OK<br />
                        - Settlement Node: Secured Enclave
                      </p>
                    </div>
                  )}

                  {swapState === 'settled' && (
                    <div className="bg-success-state/5 border border-success-state/20 p-3 rounded-lg space-y-2">
                      <div className="flex items-center gap-2 text-success-state">
                        <Check size={14} />
                        <span className="text-[10px] font-bold uppercase tracking-wider">Matched & Settled successfully</span>
                      </div>
                      <p className="text-[9px] text-text-secondary leading-normal font-mono">
                        Exchange settled at exact midpoint. Zero MEV leakage occurred. Output credited privately to shielded vault.
                      </p>
                    </div>
                  )}

                </div>

                {swapState === 'settled' && (
                  <button
                    onClick={() => setSwapState('idle')}
                    className="text-[9px] text-text-secondary hover:text-text-primary underline cursor-pointer text-left"
                  >
                    Configure next order
                  </button>
                )}
              </GlassCard>
            </GlowBorder>
          </div>
        </div>

      </div>
    </div>
  );
}
