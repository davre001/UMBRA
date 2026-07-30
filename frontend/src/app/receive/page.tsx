"use client";

import React, { useMemo, useState } from 'react';
import { formatUnits } from 'viem';
import { useChainId, usePublicClient, useWriteContract } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/providers/app-provider';
import { useNoteWallet } from '@/lib/noteWallet/useNoteWallet';
import { getDeployment } from '@/lib/noteWallet/deployments';
import { OWNER_KEY_REGISTRY_ABI } from '@/lib/noteWallet/ownerKeyRegistryAbi';
import { Navbar } from '@/components/shared/navbar';
import { Sidebar } from '@/components/shared/sidebar';
import { GlassCard } from '@/components/ui/glass-card';
import { AnimatedButton } from '@/components/ui/animated-button';
import {
  KeyRound,
  Copy,
  Check,
  RefreshCw,
  Lock,
  Inbox,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';

export default function ReceivePage() {
  const { isEntered, isWalletConnected, walletAddress, connectWallet, addNotification } = useApp();
  const queryClient = useQueryClient();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const deployment = useMemo(() => getDeployment(chainId), [chainId]);
  const vaultAddress = deployment?.vault;
  const registryAddress = deployment?.ownerKeyRegistry;
  const announcerAddress = deployment?.stealthAnnouncer;
  const noteWallet = useNoteWallet(vaultAddress, deployment?.deployBlock !== undefined ? BigInt(deployment.deployBlock) : undefined);

  const [copiedAddress, setCopiedAddress] = useState(false);
  const [claimingCommitment, setClaimingCommitment] = useState<bigint | null>(null);
  const [registering, setRegistering] = useState(false);

  const ownRegistrationQuery = useQuery({
    queryKey: ['ownerKeyOf', chainId, walletAddress],
    queryFn: () =>
      publicClient!.readContract({
        address: registryAddress!,
        abi: OWNER_KEY_REGISTRY_ABI,
        functionName: 'ownerKeyOf',
        args: [walletAddress as `0x${string}`],
      }),
    enabled: !!publicClient && !!registryAddress && !!walletAddress,
  });
  const ownRegistered = (ownRegistrationQuery.data ?? BigInt(0)) !== BigInt(0);

  const incomingQuery = useQuery({
    queryKey: ['incomingAnnouncements', chainId, walletAddress],
    queryFn: () => noteWallet.scanIncomingNotes(announcerAddress!),
    enabled: !!announcerAddress && !!walletAddress,
  });

  const handleRegister = async () => {
    if (!registryAddress) return;
    setRegistering(true);
    try {
      const ownOwnerKey = await noteWallet.getOwnerKey();
      const hash = await writeContractAsync({
        address: registryAddress,
        abi: OWNER_KEY_REGISTRY_ABI,
        functionName: 'register',
        args: [ownOwnerKey],
      });
      await publicClient!.waitForTransactionReceipt({ hash });
      queryClient.invalidateQueries({ queryKey: ['ownerKeyOf', chainId, walletAddress] });
      addNotification('Payment Key Registered', 'Others can now pay you privately.', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed.';
      addNotification('Registration Failed', message, 'error');
    } finally {
      setRegistering(false);
    }
  };

  const handleCopyAddress = () => {
    if (!walletAddress) return;
    navigator.clipboard.writeText(walletAddress);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const handleClaim = async (candidate: { assetId: bigint; amount: bigint; blinding: bigint; commitment: bigint }) => {
    setClaimingCommitment(candidate.commitment);
    try {
      await noteWallet.claimIncomingNote(candidate);
      queryClient.invalidateQueries({ queryKey: ['unspentNotes', walletAddress] });
      queryClient.invalidateQueries({ queryKey: ['incomingAnnouncements', chainId, walletAddress] });
      addNotification('Payment Claimed', 'Saved to your shielded notes.', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Claim failed.';
      addNotification('Claim Failed', message, 'error');
    } finally {
      setClaimingCommitment(null);
    }
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
    <div className="flex min-h-screen flex-col pt-16 md:pl-16 z-10 relative">
      <Navbar />
      <Sidebar />

      <div className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold tracking-tight text-text-primary font-display uppercase">
            Receive
          </h1>
          <p className="text-text-secondary text-xs font-light mt-1 tracking-wider uppercase">
            Publish your payment key once, then claim payments sent to your address
          </p>
        </div>

        {!isWalletConnected ? (
          <GlassCard className="p-10 flex flex-col items-center text-center" hoverGlow={false}>
            <Lock size={36} className="text-border-custom mb-3" />
            <span className="text-xs uppercase tracking-widest text-text-secondary">Wallet not connected</span>
            <p className="text-[10px] text-text-secondary/60 mt-1 max-w-sm mb-6 leading-relaxed">
              Connect a wallet to publish your payment key and see incoming private payments.
            </p>
            <AnimatedButton variant="primary" onClick={connectWallet}>Connect Wallet</AnimatedButton>
          </GlassCard>
        ) : !registryAddress ? (
          <GlassCard className="p-10 flex flex-col items-center text-center" hoverGlow={false}>
            <p className="text-[10px] text-text-secondary">Not available on this network. Switch to Coston2.</p>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Payment key + address (Span 5) */}
            <div className="lg:col-span-5 space-y-6">
              <GlassCard className="p-6" hoverGlow={false}>
                <div className="flex items-center gap-2 border-b border-border-custom pb-4 mb-4">
                  <KeyRound size={16} className={ownRegistered ? 'text-success-state' : 'text-accent-secondary'} />
                  <h2 className="text-sm uppercase tracking-wider font-display font-bold">Payment Key</h2>
                </div>
                <p className="text-[10px] text-text-secondary leading-relaxed mb-4">
                  Publishing your payment key lets a sender build a private note only you can spend, without ever
                  learning your spending key. This is a one-time action per wallet.
                </p>
                {ownRegistrationQuery.isLoading ? (
                  <span className="text-[10px] text-text-secondary">Checking status...</span>
                ) : ownRegistered ? (
                  <div className="flex items-center gap-2 text-success-state">
                    <ShieldCheck size={16} />
                    <span className="text-xs font-semibold uppercase tracking-wide">Published — ready to receive</span>
                  </div>
                ) : (
                  <AnimatedButton variant="primary" fullWidth onClick={handleRegister} disabled={registering}>
                    {registering ? (
                      <span className="flex items-center gap-2">
                        <RefreshCw className="animate-spin" size={14} /> Publishing...
                      </span>
                    ) : (
                      'Publish Payment Key'
                    )}
                  </AnimatedButton>
                )}
              </GlassCard>

              <GlassCard className="p-6" hoverGlow={false}>
                <div className="flex items-center gap-2 border-b border-border-custom pb-4 mb-4">
                  <Copy size={16} className="text-accent-primary" />
                  <h2 className="text-sm uppercase tracking-wider font-display font-bold">Your Address</h2>
                </div>
                <p className="text-[10px] text-text-secondary leading-relaxed mb-3">
                  Share this with whoever wants to pay you. They&apos;ll enter it on the Pay page, which looks up your
                  published payment key automatically.
                </p>
                <div className="flex items-center gap-2 p-2.5 rounded-lg border border-border-custom bg-surface/20 font-mono text-[10px] break-all">
                  <span className="text-accent-primary select-all flex-1">{walletAddress}</span>
                  <button
                    type="button"
                    onClick={handleCopyAddress}
                    className="p-1.5 rounded bg-surface/40 hover:bg-surface border border-border-custom text-text-secondary hover:text-text-primary transition-all cursor-pointer flex-shrink-0"
                  >
                    {copiedAddress ? <Check size={12} className="text-success-state" /> : <Copy size={12} />}
                  </button>
                </div>
              </GlassCard>
            </div>

            {/* Incoming payments (Span 7) */}
            <div className="lg:col-span-7">
              <GlassCard className="p-6" hoverGlow={false}>
                <div className="flex items-center justify-between border-b border-border-custom pb-4 mb-4">
                  <div className="flex items-center gap-2">
                    <Inbox size={16} className="text-accent-secondary" />
                    <h2 className="text-sm uppercase tracking-wider font-display font-bold">Incoming Payments</h2>
                  </div>
                  <AnimatedButton
                    variant="secondary"
                    size="sm"
                    onClick={() => incomingQuery.refetch()}
                    disabled={incomingQuery.isFetching || !announcerAddress}
                  >
                    <span className="flex items-center gap-1.5">
                      <RefreshCw size={12} className={incomingQuery.isFetching ? 'animate-spin' : ''} />
                      Scan
                    </span>
                  </AnimatedButton>
                </div>

                {!announcerAddress ? (
                  <div className="rounded-lg border border-border-custom bg-surface/20 p-6 text-center text-[10px] text-text-secondary">
                    Not available on this network.
                  </div>
                ) : incomingQuery.data && incomingQuery.data.length > 0 ? (
                  <div className="space-y-2">
                    {incomingQuery.data.map((candidate) => (
                      <div
                        key={candidate.commitment.toString()}
                        className="flex items-center justify-between p-3 rounded-lg border border-border-custom bg-surface/20"
                      >
                        <span className="text-xs font-mono font-bold text-text-primary">
                          {formatUnits(candidate.amount, 18)} (asset {candidate.assetId.toString()})
                        </span>
                        <AnimatedButton
                          variant="primary"
                          size="sm"
                          onClick={() => handleClaim(candidate)}
                          disabled={claimingCommitment === candidate.commitment}
                        >
                          {claimingCommitment === candidate.commitment ? 'Claiming...' : 'Claim'}
                        </AnimatedButton>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-border-custom bg-surface/20 p-6 text-center text-[10px] text-text-secondary">
                    {incomingQuery.isFetching ? 'Scanning...' : 'Nothing to claim right now.'}
                  </div>
                )}
              </GlassCard>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
