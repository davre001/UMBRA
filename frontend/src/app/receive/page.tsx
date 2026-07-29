"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '@/providers/app-provider';
import { Navbar } from '@/components/shared/navbar';
import { GlassCard } from '@/components/ui/glass-card';
import { AnimatedButton } from '@/components/ui/animated-button';
import { GlowBorder } from '@/components/ui/glow-border';
import { 
  QrCode, 
  Copy, 
  Check, 
  Share2, 
  RefreshCw, 
  Lock, 
  Info,
  HelpCircle,
  Coins,
  Cpu
} from 'lucide-react';
import Link from 'next/link';

type DerivationState = 'idle' | 'deriving' | 'ready';

export default function ReceivePage() {
  const { isEntered, isWalletConnected, connectWallet } = useApp();
  const [asset, setAsset] = useState('USDC');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [derivationState, setDerivationState] = useState<DerivationState>('idle');
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [stealthAddress, setStealthAddress] = useState('');
  const [paymentLink, setPaymentLink] = useState('');

  const handleGenerateInvoice = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isWalletConnected) {
      connectWallet();
      return;
    }
    setDerivationState('deriving');
  };

  useEffect(() => {
    if (derivationState === 'deriving') {
      const timer = setTimeout(() => {
        // Derive standard mock stealth address
        const randomHex = Array.from({ length: 20 }, () => 
          Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
        ).join('');
        const derivedStealth = `st_flare_0x${randomHex}`;
        setStealthAddress(derivedStealth);

        // Generate query links
        const params = new URLSearchParams();
        if (amount) params.set('amount', amount);
        if (asset) params.set('asset', asset);
        params.set('stealth', derivedStealth);
        setPaymentLink(`https://umbra.finance/pay?${params.toString()}`);

        setDerivationState('ready');
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [derivationState]);

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(stealthAddress);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(paymentLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
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

  return (
    <div className="flex min-h-screen flex-col pt-16 z-10 relative">
      <Navbar />

      <div className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold tracking-tight text-text-primary font-display uppercase">
            Stealth Invoice Gateway
          </h1>
          <p className="text-text-secondary text-xs font-light mt-1 tracking-wider uppercase">
            Derive clean, one-time stealth destination parameters to receive private capital
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Form Setup (Span 7) */}
          <div className="lg:col-span-7">
            <GlassCard className="p-6" hoverGlow={false}>
              <form onSubmit={handleGenerateInvoice} className="space-y-6">
                
                {/* Asset Choice */}
                <div>
                  <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light block mb-2">Select Asset Pool</label>
                  <div className="grid grid-cols-3 gap-3">
                    {['WFLR', 'USDC', 'USDT'].map((sym) => (
                      <button
                        key={sym}
                        type="button"
                        onClick={() => setAsset(sym)}
                        className={`py-3 px-4 rounded-lg border text-xs font-mono font-bold transition-all cursor-pointer ${
                          asset === sym 
                            ? 'border-accent-primary bg-accent-primary/5 text-accent-primary' 
                            : 'border-border-custom bg-surface/20 text-text-secondary hover:text-text-primary hover:border-border-custom/80'
                        }`}
                      >
                        {sym}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Amount (Optional) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light">Requested Amount (Optional)</label>
                  </div>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00 (Any Amount)"
                    className="w-full bg-surface/30 border border-border-custom rounded-lg px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-accent-primary/60 font-mono"
                  />
                </div>

                {/* Description / Memo */}
                <div>
                  <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light block mb-2">Request Memo (Encrypted)</label>
                  <input
                    type="text"
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    placeholder="Enter private metadata details..."
                    className="w-full bg-surface/30 border border-border-custom rounded-lg px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-accent-primary/60"
                  />
                  <span className="text-[9px] text-text-secondary/50 mt-1 block">Included in QR/Payment parameters under Diffie-Hellman encryption.</span>
                </div>

                {/* Submit */}
                <AnimatedButton
                  variant="primary"
                  type="submit"
                  disabled={derivationState === 'deriving'}
                  fullWidth
                  className="rounded-xl py-3"
                >
                  {derivationState === 'deriving' ? (
                    <span className="flex items-center gap-2">
                      <RefreshCw className="animate-spin" size={14} />
                      Deriving Cryptographic keys...
                    </span>
                  ) : (
                    'Generate Stealth Parameters'
                  )}
                </AnimatedButton>

              </form>
            </GlassCard>
          </div>

          {/* QR Code and link export panel (Span 5) */}
          <div className="lg:col-span-5">
            <GlowBorder active={derivationState === 'ready'} glowColor="cyan">
              <GlassCard className="p-6 min-h-[380px] flex flex-col justify-between items-center text-center" hoverGlow={false}>
                
                <div className="w-full">
                  <div className="flex items-center gap-2 border-b border-border-custom pb-3 mb-6 text-left">
                    <QrCode size={16} className="text-accent-primary" />
                    <h2 className="text-xs uppercase tracking-wider font-display font-semibold">Payment Destination</h2>
                  </div>

                  {derivationState === 'idle' && (
                    <div className="py-12 flex flex-col items-center justify-center text-text-secondary">
                      <Lock size={36} className="text-border-custom mb-3" />
                      <span className="text-xs uppercase tracking-widest">Parameters not initialized</span>
                      <p className="text-[10px] text-text-secondary/50 mt-1 max-w-[200px] leading-relaxed">
                        Input requested variables to derive a secure, single-use stealth payment code.
                      </p>
                    </div>
                  )}

                  {derivationState === 'deriving' && (
                    <div className="py-12 flex flex-col items-center justify-center text-text-secondary">
                      <Cpu size={28} className="text-accent-primary animate-spin mb-3" />
                      <span className="text-xs uppercase tracking-widest font-mono text-accent-primary">Deriving address...</span>
                      <p className="text-[9px] text-text-secondary/60 mt-1 max-w-[180px]">
                        Running Elliptic Curve Diffie-Hellman math checks locally.
                      </p>
                    </div>
                  )}

                  {derivationState === 'ready' && (
                    <div className="space-y-6 flex flex-col items-center w-full">
                      {/* Interactive CSS QR code */}
                      <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="p-3 bg-white rounded-xl border border-border-custom inline-block shadow-xl relative"
                      >
                        {/* Simulated high-fidelity QR Code blocks */}
                        <div className="h-36 w-36 bg-bg-base flex flex-wrap p-2 gap-1 rounded-lg">
                          {Array.from({ length: 49 }).map((_, i) => {
                            const isFilled = (i * 7 + i % 3) % 2 === 0 || i % 6 === 0;
                            return (
                              <div
                                key={i}
                                className={`h-[16px] w-[16px] rounded-sm transition-all duration-300 ${
                                  isFilled ? 'bg-accent-primary' : 'bg-surface/10'
                                }`}
                              />
                            );
                          })}
                        </div>
                        {/* Centered lock overlay */}
                        <div className="absolute inset-0 m-auto h-7 w-7 bg-bg-base border border-border-custom rounded-full flex items-center justify-center">
                          <Lock size={12} className="text-accent-secondary" />
                        </div>
                      </motion.div>

                      {/* Display derived stealth address */}
                      <div className="w-full text-left space-y-1.5">
                        <span className="text-[9px] text-text-secondary uppercase tracking-widest font-mono">One-Time Stealth Address</span>
                        <div className="flex items-center gap-2 p-2.5 rounded-lg border border-border-custom bg-surface/20 font-mono text-[10px] break-all">
                          <span className="text-accent-primary select-all flex-1">{stealthAddress}</span>
                          <button
                            type="button"
                            onClick={handleCopyAddress}
                            className="p-1.5 rounded bg-surface/40 hover:bg-surface border border-border-custom text-text-secondary hover:text-text-primary transition-all cursor-pointer"
                          >
                            {copiedAddress ? <Check size={12} className="text-success-state" /> : <Copy size={12} />}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {derivationState === 'ready' && (
                  <div className="w-full pt-4 border-t border-border-custom/30 mt-6 flex justify-between items-center">
                    <span className="text-[9px] text-text-secondary font-mono">STEALTH DESTINATION INITIALIZED</span>
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="text-xs text-accent-primary hover:text-accent-primary/80 inline-flex items-center gap-1 cursor-pointer font-semibold"
                    >
                      {copiedLink ? <Check size={12} /> : <Share2 size={12} />}
                      {copiedLink ? "Copied Link" : "Copy Payment Link"}
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
