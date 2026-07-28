"use client";

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useApp } from '@/providers/app-provider';
import { Navbar } from '@/components/shared/navbar';
import { Sidebar } from '@/components/shared/sidebar';
import { GlassCard } from '@/components/ui/glass-card';
import { AnimatedButton } from '@/components/ui/animated-button';
import { 
  Key, 
  TrendingUp, 
  ArrowUpRight, 
  ArrowDownLeft, 
  HelpCircle,
  Eye,
  EyeOff,
  Copy,
  Check,
  Shield,
  Layers,
  Lock
} from 'lucide-react';
import Link from 'next/link';

export default function Portfolio() {
  const { isEntered, isWalletConnected, connectWallet, anonymityScore } = useApp();
  const [revealKey, setRevealKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  const mockViewingKey = "umbra_vkey_flare_9f83a2cd739b84ac12e948ff1123d0a4b77f981240c5f2b3c10a4e76c12db";

  const handleCopyKey = () => {
    navigator.clipboard.writeText(mockViewingKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  // SVG Chart path parameters
  const chartPoints = [
    { day: 'Mon', value: 82000 },
    { day: 'Tue', value: 81500 },
    { day: 'Wed', value: 84000 },
    { day: 'Thu', value: 83100 },
    { day: 'Fri', value: 86500 },
    { day: 'Sat', value: 87800 },
    { day: 'Sun', value: 89400 }
  ];

  // Calculate coordinates for SVG path
  const width = 500;
  const height = 150;
  const minVal = 80000;
  const maxVal = 90000;
  
  const getCoordinates = () => {
    return chartPoints.map((p, i) => {
      const x = (i / (chartPoints.length - 1)) * width;
      const y = height - ((p.value - minVal) / (maxVal - minVal)) * height;
      return `${x},${y}`;
    }).join(' ');
  };

  const svgPath = `M ${getCoordinates()}`;

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

  return (
    <div className="flex min-h-screen flex-col pt-16 md:pl-16 z-10 relative">
      <Navbar />
      <Sidebar />

      <div className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold tracking-tight text-text-primary font-display uppercase">
            Shielded Portfolio
          </h1>
          <p className="text-text-secondary text-xs font-light mt-1 tracking-wider uppercase">
            Confidential assets & cryptographic audit views
          </p>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <GlassCard hoverGlow={false} className="p-5">
            <span className="text-[10px] text-text-secondary uppercase tracking-widest font-light block">Public Assets</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight font-display">$24,190</span>
              <span className="text-xs font-light text-text-secondary">WFLR, USDC</span>
            </div>
            <span className="text-[10px] text-text-secondary mt-1 block">Visible on explorer</span>
          </GlassCard>

          <GlassCard hoverGlow={true} glowColor="purple" className="p-5 border-accent-secondary/10">
            <span className="text-[10px] text-text-secondary uppercase tracking-widest font-light block">Shielded Assets</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-accent-secondary font-display">$65,210</span>
              <span className="text-xs font-light text-accent-secondary">uWFLR, uUSDC</span>
            </div>
            <span className="text-[10px] text-accent-secondary/80 mt-1 block">Private vault balances</span>
          </GlassCard>

          <GlassCard hoverGlow={false} className="p-5">
            <span className="text-[10px] text-text-secondary uppercase tracking-widest font-light block">Net Worth</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight font-display">$89,400</span>
              <span className="text-[10px] text-success-state font-mono font-medium">+8.2%</span>
            </div>
            <span className="text-[10px] text-text-secondary mt-1 block">Combined capital</span>
          </GlassCard>

          <GlassCard hoverGlow={true} glowColor="cyan" className="p-5 border-accent-primary/10">
            <span className="text-[10px] text-text-secondary uppercase tracking-widest font-light block">Anonymity score</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-accent-primary font-display">{anonymityScore}/100</span>
              <span className="text-[10px] text-accent-primary font-mono uppercase">Strong</span>
            </div>
            <span className="text-[10px] text-text-secondary mt-1 block">Shield sets integration</span>
          </GlassCard>
        </div>

        {/* Chart & Allocation Split */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* SVG line chart (Span 2) */}
          <div className="lg:col-span-2">
            <GlassCard className="p-6 h-full flex flex-col justify-between" hoverGlow={false}>
              <div>
                <div className="flex items-center justify-between border-b border-border-custom pb-4 mb-6">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="text-accent-primary" size={18} />
                    <h2 className="text-sm uppercase tracking-wider font-display font-bold">Historical Net Worth</h2>
                  </div>
                  <span className="text-[10px] text-text-secondary font-mono">7 DAY TREND</span>
                </div>

                {/* Simulated Chart visualization */}
                <div className="h-[150px] w-full relative mt-4">
                  <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`}>
                    {/* Glowing chart line */}
                    <motion.path
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 1.5, ease: "easeOut" }}
                      d={svgPath}
                      fill="none"
                      stroke="url(#chartGlow)"
                      strokeWidth="2.5"
                    />

                    {/* Gradient definition */}
                    <defs>
                      <linearGradient id="chartGlow" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#FFFFFF" />
                        <stop offset="50%" stopColor="#FFA500" />
                        <stop offset="100%" stopColor="#00E5A3" />
                      </linearGradient>
                    </defs>
                  </svg>

                  {/* Horizontal grid lines */}
                  <div className="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-10">
                    <div className="border-b border-text-primary w-full" />
                    <div className="border-b border-text-primary w-full" />
                    <div className="border-b border-text-primary w-full" />
                  </div>
                </div>

                {/* X Axis labels */}
                <div className="flex justify-between mt-2 px-1 text-[10px] text-text-secondary font-mono uppercase">
                  {chartPoints.map((pt, idx) => (
                    <span key={idx}>{pt.day}</span>
                  ))}
                </div>
              </div>
            </GlassCard>
          </div>

          {/* Anonymity Score Radial Gauge Gauge */}
          <div>
            <GlassCard className="p-6 h-full flex flex-col justify-between items-center text-center" hoverGlow={true} glowColor="cyan">
              <div className="w-full border-b border-border-custom pb-4 mb-4 text-left">
                <h2 className="text-sm uppercase tracking-wider font-display font-bold">Anonymity Gauge</h2>
              </div>

              {/* Radial Circle */}
              <div className="relative h-32 w-32 flex items-center justify-center my-2">
                <svg className="absolute w-full h-full transform -rotate-90">
                  <circle
                    cx="64"
                    cy="64"
                    r="54"
                    className="stroke-border-custom fill-none"
                    strokeWidth="4"
                  />
                  <motion.circle
                    cx="64"
                    cy="64"
                    r="54"
                    className="stroke-accent-primary fill-none"
                    strokeWidth="6"
                    strokeDasharray="339.3"
                    initial={{ strokeDashoffset: 339.3 }}
                    animate={{ strokeDashoffset: 339.3 - (339.3 * anonymityScore) / 100 }}
                    transition={{ duration: 1.5, ease: "easeOut" }}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="flex flex-col items-center">
                  <span className="text-3xl font-extrabold tracking-tighter text-text-primary font-display">{anonymityScore}%</span>
                  <span className="text-[9px] uppercase tracking-wider text-text-secondary mt-0.5">SCORE</span>
                </div>
              </div>

              <p className="text-[10px] text-text-secondary leading-normal font-light">
                Your score is optimized. Higher shielding counts and holding durations increase your privacy score dynamically.
              </p>
            </GlassCard>
          </div>
        </div>

        {/* Compliance Key Reveal & Assets */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Private Assets Table (Span 2) */}
          <div className="lg:col-span-2">
            <GlassCard className="p-6" hoverGlow={false}>
              <div className="flex items-center justify-between border-b border-border-custom pb-4 mb-4">
                <h2 className="text-sm uppercase tracking-wider font-display font-bold">Asset Allocation</h2>
                <span className="text-[10px] text-text-secondary font-mono">2 SHIELDED SETS</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border-custom/50 text-[10px] text-text-secondary uppercase tracking-wider">
                      <th className="py-2 font-normal">Asset</th>
                      <th className="py-2 font-normal">Type</th>
                      <th className="py-2 font-normal text-right">Balance</th>
                      <th className="py-2 font-normal text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-custom/30 text-xs">
                    <tr>
                      <td className="py-3 flex items-center gap-2">
                        <span className="h-5 w-5 rounded-full bg-accent-primary/20 flex items-center justify-center text-[10px] font-semibold text-accent-primary">FL</span>
                        <div>
                          <div className="font-semibold">Flare</div>
                          <div className="text-[10px] text-text-secondary font-mono">WFLR</div>
                        </div>
                      </td>
                      <td className="py-3 text-text-secondary">Public</td>
                      <td className="py-3 text-right font-mono font-medium">10,240 WFLR</td>
                      <td className="py-3 text-right font-mono">$2,048</td>
                    </tr>
                    <tr>
                      <td className="py-3 flex items-center gap-2">
                        <span className="h-5 w-5 rounded-full bg-accent-secondary/20 flex items-center justify-center text-[10px] font-semibold text-accent-secondary">uFL</span>
                        <div>
                          <div className="font-semibold text-accent-secondary">Shielded Flare</div>
                          <div className="text-[10px] text-accent-secondary/70 font-mono">uWFLR</div>
                        </div>
                      </td>
                      <td className="py-3 text-accent-secondary">Private</td>
                      <td className="py-3 text-right font-mono font-medium text-accent-secondary">225,000 uWFLR</td>
                      <td className="py-3 text-right font-mono text-accent-secondary">$45,000</td>
                    </tr>
                    <tr>
                      <td className="py-3 flex items-center gap-2">
                        <span className="h-5 w-5 rounded-full bg-accent-primary/20 flex items-center justify-center text-[10px] font-semibold text-accent-primary">UC</span>
                        <div>
                          <div className="font-semibold">USD Coin</div>
                          <div className="text-[10px] text-text-secondary font-mono">USDC</div>
                        </div>
                      </td>
                      <td className="py-3 text-text-secondary">Public</td>
                      <td className="py-3 text-right font-mono font-medium">22,142 USDC</td>
                      <td className="py-3 text-right font-mono">$22,142</td>
                    </tr>
                    <tr>
                      <td className="py-3 flex items-center gap-2">
                        <span className="h-5 w-5 rounded-full bg-accent-secondary/20 flex items-center justify-center text-[10px] font-semibold text-accent-secondary">uUC</span>
                        <div>
                          <div className="font-semibold text-accent-secondary">Shielded USDC</div>
                          <div className="text-[10px] text-accent-secondary/70 font-mono">uUSDC</div>
                        </div>
                      </td>
                      <td className="py-3 text-accent-secondary">Private</td>
                      <td className="py-3 text-right font-mono font-medium text-accent-secondary">20,210 uUSDC</td>
                      <td className="py-3 text-right font-mono text-accent-secondary">$20,210</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </GlassCard>
          </div>

          {/* Viewing Key Card */}
          <div>
            <GlassCard className="p-6 h-full flex flex-col justify-between" hoverGlow={true} glowColor="purple">
              <div>
                <div className="flex items-center gap-2 border-b border-border-custom pb-4 mb-4">
                  <Key size={16} className="text-accent-secondary" />
                  <h2 className="text-sm uppercase tracking-wider font-display font-bold">Compliance View Key</h2>
                </div>

                <p className="text-[10px] text-text-secondary leading-relaxed font-light mb-4">
                  Exporting your viewing key allows you to grant read-only access (for tax reporting or AML compliance audits) to verify inputs without compromising your account security.
                </p>

                <div className="bg-surface/50 border border-border-custom rounded-lg p-3 font-mono text-[10px] break-all relative min-h-[64px] flex items-center">
                  {revealKey ? (
                    <span className="text-accent-secondary select-all">{mockViewingKey}</span>
                  ) : (
                    <span className="text-text-secondary/40 select-none tracking-widest">••••••••••••••••••••••••••••••••••••</span>
                  )}
                </div>
              </div>

              <div className="flex gap-2 mt-6">
                <button
                  onClick={() => setRevealKey(!revealKey)}
                  className="flex items-center justify-center h-9 px-3 border border-border-custom rounded-lg bg-surface/30 text-text-secondary hover:text-text-primary text-xs gap-1.5 cursor-pointer"
                >
                  {revealKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  {revealKey ? "Hide" : "Reveal"}
                </button>
                {revealKey && (
                  <button
                    onClick={handleCopyKey}
                    className="flex-1 flex items-center justify-center h-9 px-3 border border-accent-secondary/20 bg-accent-secondary/5 text-accent-secondary hover:bg-accent-secondary/10 rounded-lg text-xs gap-1.5 cursor-pointer"
                  >
                    {copiedKey ? <Check size={14} /> : <Copy size={14} />}
                    {copiedKey ? "Copied" : "Copy Key"}
                  </button>
                )}
              </div>
            </GlassCard>
          </div>
        </div>

      </div>
    </div>
  );
}
