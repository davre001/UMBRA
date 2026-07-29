"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '@/providers/app-provider';
import { Navbar } from '@/components/shared/navbar';
import { GlassCard } from '@/components/ui/glass-card';
import { AnimatedButton } from '@/components/ui/animated-button';
import { GlowBorder } from '@/components/ui/glow-border';
import { 
  Send, 
  User, 
  Fingerprint, 
  ShieldCheck, 
  AlertTriangle, 
  Check, 
  HelpCircle,
  Lock,
  RefreshCw,
  Search,
  Sparkles
} from 'lucide-react';
import Link from 'next/link';

type RecipientType = 'ens' | 'wallet' | 'stealth';
type PayState = 'idle' | 'aml_scan' | 'aml_verified' | 'passkey_prompt' | 'sending' | 'success';

export default function PrivatePayPage() {
  const { isEntered, isWalletConnected, connectWallet, addNotification } = useApp();
  const [recipientType, setRecipientType] = useState<RecipientType>('ens');
  const [recipient, setRecipient] = useState('vitalik.eth');
  const [amount, setAmount] = useState('250');
  const [asset, setAsset] = useState('USDC');
  const [memo, setMemo] = useState('Secure reimbursement');
  const [payState, setPayState] = useState<PayState>('idle');
  const [amlProgress, setAmlProgress] = useState(0);

  // Recipient input details helper
  const placeholder = {
    ens: 'e.g. user.eth or name.sgb',
    wallet: 'e.g. 0x742d...f44e',
    stealth: 'e.g. st_flare_9f83...a2cd'
  }[recipientType];

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (payState === 'aml_scan') {
      let progress = 0;
      const interval = setInterval(() => {
        progress += 8;
        setAmlProgress(Math.min(progress, 100));
        if (progress >= 100) {
          clearInterval(interval);
          setPayState('aml_verified');
        }
      }, 100);
      return () => clearInterval(interval);
    } else if (payState === 'aml_verified') {
      timer = setTimeout(() => {
        setPayState('passkey_prompt');
      }, 1200);
    } else if (payState === 'sending') {
      timer = setTimeout(() => {
        setPayState('success');
        addNotification("Private Payment Sent", `Paid ${amount} ${asset} securely.`, "success");
      }, 2500);
    }
    return () => clearTimeout(timer);
  }, [payState]);

  const handleStartPay = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isWalletConnected) {
      connectWallet();
      return;
    }
    setPayState('aml_scan');
    setAmlProgress(0);
  };

  const handleSimulatePasskey = () => {
    setPayState('sending');
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
            Private Payments
          </h1>
          <p className="text-text-secondary text-xs font-light mt-1 tracking-wider uppercase">
            Send shielded capital to ENS domains, standard wallets, or stealth seeds
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Pay Setup Panel (Span 7) */}
          <div className="lg:col-span-7">
            <GlassCard className="p-6" hoverGlow={false}>
              <form onSubmit={handleStartPay} className="space-y-6">
                
                {/* Recipient Type Choice */}
                <div>
                  <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light block mb-2">Recipient Destination Type</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { key: 'ens', label: 'ENS Name' },
                      { key: 'wallet', label: 'Standard Address' },
                      { key: 'stealth', label: 'Stealth Key' }
                    ].map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => { setRecipientType(t.key as RecipientType); setRecipient(''); }}
                        className={`py-2 px-3 text-xs rounded-lg border text-center transition-all cursor-pointer ${
                          recipientType === t.key 
                            ? 'border-accent-primary bg-accent-primary/5 text-accent-primary font-semibold' 
                            : 'border-border-custom bg-surface/20 text-text-secondary hover:text-text-primary hover:border-border-custom/80'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Recipient Input */}
                <div>
                  <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light block mb-2">Recipient ID</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      placeholder={placeholder}
                      className="w-full bg-surface/30 border border-border-custom rounded-lg pl-10 pr-4 py-3 text-sm text-text-primary focus:outline-none focus:border-accent-primary/60 font-mono"
                      required
                    />
                    <User size={14} className="absolute left-3.5 top-4.5 text-text-secondary/60" />
                  </div>
                </div>

                {/* Amount / Asset */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2">
                    <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light block mb-2">Amount</label>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-surface/30 border border-border-custom rounded-lg px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-accent-primary/60 font-mono"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light block mb-2">Asset</label>
                    <select
                      value={asset}
                      onChange={(e) => setAsset(e.target.value)}
                      className="w-full bg-surface/30 border border-border-custom rounded-lg px-3 py-3.5 text-sm text-text-primary focus:outline-none focus:border-accent-primary/60 cursor-pointer"
                    >
                      <option value="USDC">USDC</option>
                      <option value="USDT">USDT</option>
                      <option value="WFLR">WFLR</option>
                    </select>
                  </div>
                </div>

                {/* Private Memo */}
                <div>
                  <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light block mb-2">Private Memo (Encrypted)</label>
                  <input
                    type="text"
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    placeholder="Enter private metadata..."
                    className="w-full bg-surface/30 border border-border-custom rounded-lg px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-accent-primary/60"
                  />
                  <span className="text-[9px] text-text-secondary/50 mt-1 block">Memo is visible only to sender and receiver under Diffie-Hellman keys.</span>
                </div>

                {/* Submit Action */}
                <AnimatedButton
                  variant="primary"
                  type="submit"
                  disabled={payState !== 'idle'}
                  fullWidth
                  className="rounded-xl py-3.5"
                >
                  {!isWalletConnected ? (
                    'Connect Wallet'
                  ) : payState !== 'idle' ? (
                    <span className="flex items-center gap-2">
                      <RefreshCw className="animate-spin" size={14} />
                      Locking Payment parameters...
                    </span>
                  ) : (
                    'Initiate Private Payment'
                  )}
                </AnimatedButton>

              </form>
            </GlassCard>
          </div>

          {/* Compliance & Verification panel (Span 5) */}
          <div className="lg:col-span-5">
            <GlowBorder active={payState !== 'idle'} glowColor={payState === 'success' ? 'success' : 'purple'}>
              <GlassCard className="p-6 min-h-[360px] flex flex-col justify-between" hoverGlow={false}>
                <div>
                  <div className="flex items-center gap-2 border-b border-border-custom pb-4 mb-6">
                    <ShieldCheck size={18} className="text-accent-secondary" />
                    <h2 className="text-sm uppercase tracking-wider font-display font-bold">Secure Compliance Check</h2>
                  </div>

                  {payState === 'idle' && (
                    <div className="flex flex-col items-center justify-center py-12 text-center text-text-secondary">
                      <Sparkles size={36} className="text-border-custom mb-3" />
                      <span className="text-xs uppercase tracking-widest">Compliance verification ready</span>
                      <p className="text-[10px] text-text-secondary/60 mt-1 leading-relaxed max-w-[220px]">
                        Payments are automatically screened against local sanction registries via trustless ZK proofs before execution.
                      </p>
                    </div>
                  )}

                  {payState === 'aml_scan' && (
                    <div className="space-y-4">
                      <span className="text-[11px] font-mono text-accent-primary uppercase tracking-widest block animate-pulse">
                        Scanning database registries...
                      </span>
                      <div className="w-full bg-border-custom/50 rounded-full h-1.5">
                        <div className="bg-accent-primary h-1.5 rounded-full" style={{ width: `${amlProgress}%` }} />
                      </div>
                      <p className="text-[10px] text-text-secondary leading-normal font-mono">
                        Checking target receiver {recipient} against: <br />
                        - OFAC Sanctioned Pools<br />
                        - EU Restricted Addresses<br />
                        - Flare Compliance Oracles
                      </p>
                    </div>
                  )}

                  {payState === 'aml_verified' && (
                    <div className="bg-success-state/5 border border-success-state/20 p-4 rounded-lg space-y-2 animate-fade-in">
                      <div className="flex items-center gap-2 text-success-state">
                        <Check size={16} />
                        <span className="text-xs font-semibold uppercase tracking-wider">Sanction Screen Clear</span>
                      </div>
                      <p className="text-[10px] text-text-secondary leading-normal font-light">
                        Verification check generated successfully. Recipient is clear. Cryptographic proof hash attached to payment envelope.
                      </p>
                    </div>
                  )}

                  {(payState === 'passkey_prompt' || payState === 'sending') && (
                    <div className="text-center py-6">
                      <Fingerprint size={36} className="text-accent-secondary animate-bounce mx-auto mb-2" />
                      <span className="text-xs font-bold text-text-primary uppercase tracking-wider block">Passkey Authentication Required</span>
                      <p className="text-[10px] text-text-secondary mt-1 max-w-[200px] mx-auto leading-normal">
                        Confirm biometric details via WebAuthn client to unlock private signing keys.
                      </p>
                      {payState === 'passkey_prompt' && (
                        <AnimatedButton
                          variant="secondary"
                          size="sm"
                          onClick={handleSimulatePasskey}
                          className="mt-4"
                        >
                          Authenticate with TouchID
                        </AnimatedButton>
                      )}
                    </div>
                  )}

                  {payState === 'success' && (
                    <div className="bg-success-state/5 border border-success-state/20 p-4 rounded-lg space-y-3">
                      <div className="flex items-center gap-2 text-success-state">
                        <Check size={16} />
                        <span className="text-xs font-semibold uppercase tracking-wider">Payment Settled Privately</span>
                      </div>
                      <p className="text-[10px] text-text-secondary leading-normal font-light font-mono">
                        Asset: {amount} {asset}<br />
                        Memo: u_enc({memo.slice(0, 15)}...)<br />
                        Relayer Hash: 0x9f83...a2cd
                      </p>
                      <div className="text-[9px] text-success-state/70">
                        Funds credited anonymously to stealth key derived for recipient. Transaction unlinkable.
                      </div>
                    </div>
                  )}

                </div>

                {payState === 'success' && (
                  <button
                    onClick={() => setPayState('idle')}
                    className="text-[9px] text-text-secondary hover:text-text-primary underline cursor-pointer text-left"
                  >
                    Send another payment
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
