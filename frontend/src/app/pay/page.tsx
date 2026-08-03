"use client";

import React, { useMemo, useState } from 'react';
import { formatUnits, isAddress, parseEventLogs } from 'viem';
import { useChainId, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/providers/app-provider';
import { useNoteWallet } from '@/lib/noteWallet/useNoteWallet';
import { getDeployment } from '@/lib/noteWallet/deployments';
import { SHIELDED_VAULT_ABI } from '@/lib/noteWallet/vaultAbi';
import { OWNER_KEY_REGISTRY_ABI } from '@/lib/noteWallet/ownerKeyRegistryAbi';
import { STEALTH_ANNOUNCER_ABI } from '@/lib/noteWallet/stealthAnnouncerAbi';
import { encodeNoteMetadata, OWNER_KEY_NOTE_SCHEME_ID } from '@/lib/noteWallet/announcer';
import { nullifierHash as computeNullifierHash } from '@/lib/noteWallet/poseidon2';
import { provePay } from '@/lib/proving/prove';
import { assertTxSuccess } from '@/lib/utils';
import { ADD_CHAIN_PARAMS } from '@/lib/networkParams';
import type { StoredNote } from '@/lib/noteWallet/store';
import { Navbar } from '@/components/shared/navbar';
import { GlassCard } from '@/components/ui/glass-card';
import { AnimatedButton } from '@/components/ui/animated-button';
import { GlowBorder } from '@/components/ui/glow-border';
import {
  Send,
  ShieldCheck,
  Check,
  Clock,
  Lock,
  RefreshCw,
  KeyRound,
  Inbox,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react';
import Link from 'next/link';

type Tab = 'send' | 'incoming';
type AssetSymbol = 'C2FLR' | 'FXRP' | 'USDT0';
type SendStep = 'idle' | 'proving' | 'submitting' | 'confirming' | 'announcing' | 'finalized';

const COSTON2_CHAIN_ID = 114;
const ASSET_OPTIONS: { sym: AssetSymbol; name: string }[] = [
  { sym: 'C2FLR', name: 'Coston2 Flare (native)' },
  { sym: 'FXRP', name: 'FAssets XRP' },
  { sym: 'USDT0', name: 'Tether USD' },
];

const SEND_TIMELINE = [
  { key: 'proving', label: 'Generate ZK Proof' },
  { key: 'submitting', label: 'Submit Payment' },
  { key: 'confirming', label: 'Confirm On-Chain' },
  { key: 'announcing', label: 'Notify Recipient' },
  { key: 'finalized', label: 'Settlement' },
] as const;

export default function PrivatePayPage() {
  const { isEntered, isWalletConnected, walletAddress, connectWallet, addNotification } = useApp();
  const queryClient = useQueryClient();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const deployment = useMemo(() => getDeployment(chainId), [chainId]);
  const vaultAddress = deployment?.vault;
  const registryAddress = deployment?.ownerKeyRegistry;
  const announcerAddress = deployment?.stealthAnnouncer;
  const noteWallet = useNoteWallet(vaultAddress, deployment?.deployBlock !== undefined ? BigInt(deployment.deployBlock) : undefined);
  const onCoston2 = chainId === COSTON2_CHAIN_ID;

  const [activeTab, setActiveTab] = useState<Tab>('send');
  const [asset, setAsset] = useState<AssetSymbol>('C2FLR');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [recipient, setRecipient] = useState('');
  const [step, setStep] = useState<SendStep>('idle');
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  const assetConfig = deployment?.assets[asset];

  const notesQuery = useQuery({
    queryKey: ['unspentNotes', walletAddress],
    queryFn: () => noteWallet.listUnspentNotes(),
    enabled: !!walletAddress,
  });

  const assetNotes: StoredNote[] = useMemo(() => {
    if (!notesQuery.data || !assetConfig) return [];
    return notesQuery.data.filter((n) => n.kind === 'note' && n.assetId === String(assetConfig.assetId));
  }, [notesQuery.data, assetConfig]);

  const recipientIsAddress = isAddress(recipient);

  const recipientOwnerKeyQuery = useQuery({
    queryKey: ['ownerKeyOf', chainId, recipient],
    queryFn: () =>
      publicClient!.readContract({
        address: registryAddress!,
        abi: OWNER_KEY_REGISTRY_ABI,
        functionName: 'ownerKeyOf',
        args: [recipient as `0x${string}`],
      }),
    enabled: !!publicClient && !!registryAddress && recipientIsAddress,
  });
  const recipientRegistered = (recipientOwnerKeyQuery.data ?? BigInt(0)) !== BigInt(0);

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
    enabled: !!announcerAddress && !!walletAddress && activeTab === 'incoming',
  });

  const [claimingCommitment, setClaimingCommitment] = useState<bigint | null>(null);

  const handleRegister = async () => {
    if (!registryAddress) return;
    try {
      const ownOwnerKey = await noteWallet.getOwnerKey();
      const hash = await writeContractAsync({
        address: registryAddress,
        abi: OWNER_KEY_REGISTRY_ABI,
        functionName: 'register',
        args: [ownOwnerKey],
      });
      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      assertTxSuccess(receipt);
      queryClient.invalidateQueries({ queryKey: ['ownerKeyOf', chainId, walletAddress] });
      addNotification('Payment Key Registered', 'Others can now pay you privately.', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed.';
      addNotification('Registration Failed', message, 'error');
    }
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

  const handleSend = async () => {
    if (!walletAddress || !publicClient || !deployment || !assetConfig || !vaultAddress || !registryAddress || !announcerAddress) return;
    const note = assetNotes.find((n) => n.id === selectedNoteId);
    if (!note || note.kind !== 'note') {
      addNotification('No Note Selected', 'Choose a shielded note to pay with.', 'error');
      return;
    }
    if (!recipientIsAddress) {
      addNotification('Invalid Recipient', 'Enter a valid recipient address.', 'error');
      return;
    }
    if (!recipientRegistered || recipientOwnerKeyQuery.data === undefined) {
      addNotification('Recipient Not Registered', "This address hasn't published a payment key yet.", 'error');
      return;
    }

    try {
      setStep('proving');
      const merklePath = await noteWallet.getMerkleProof(note);
      const spendingKey = await noteWallet.getSpendingKey();
      const amountValue = BigInt(note.amount);
      const assetIdValue = BigInt(note.assetId);
      const nullifierHashValue = computeNullifierHash(BigInt(note.commitment), spendingKey);
      const outNote = noteWallet.buildRecipientNote(amountValue, assetIdValue, recipientOwnerKeyQuery.data);

      const proofHex = await provePay({
        root: merklePath.root,
        nullifierHash: nullifierHashValue,
        amount: amountValue,
        assetId: assetIdValue,
        outCommitment: outNote.commitment,
        outOwnerKey: outNote.ownerKey,
        outBlinding: outNote.blinding,
        note: {
          spendingKey,
          blinding: BigInt(note.blinding),
          merklePath: { pathElements: merklePath.pathElements, pathIndices: merklePath.pathIndices },
        },
      });

      setStep('submitting');
      const payHash = await writeContractAsync({
        address: vaultAddress,
        abi: SHIELDED_VAULT_ABI,
        functionName: 'pay',
        args: [proofHex, merklePath.root, nullifierHashValue, assetIdValue, outNote.commitment],
      });

      setStep('confirming');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: payHash });
      assertTxSuccess(receipt);
      const [paidLog] = parseEventLogs({ abi: SHIELDED_VAULT_ABI, eventName: 'Paid', logs: receipt.logs });
      if (!paidLog) throw new Error('Paid event not found in transaction receipt.');

      setStep('announcing');
      const metadata = encodeNoteMetadata({
        assetId: assetIdValue,
        amount: amountValue,
        blinding: outNote.blinding,
        commitment: outNote.commitment,
      });
      const announceHash = await writeContractAsync({
        address: announcerAddress,
        abi: STEALTH_ANNOUNCER_ABI,
        functionName: 'announce',
        args: [OWNER_KEY_NOTE_SCHEME_ID, recipient as `0x${string}`, '0x', metadata],
      });
      const announceReceipt = await publicClient.waitForTransactionReceipt({ hash: announceHash });
      assertTxSuccess(announceReceipt);

      await noteWallet.refreshSpentStatus();

      setLastTxHash(payHash);
      setStep('finalized');
      setSelectedNoteId(null);
      queryClient.invalidateQueries({ queryKey: ['unspentNotes', walletAddress] });
      addNotification(
        'Payment Sent',
        `Privately paid ${formatUnits(amountValue, assetConfig.decimals)} ${asset} to ${recipient.slice(0, 6)}...${recipient.slice(-4)}.`,
        'success'
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Payment failed.';
      addNotification('Payment Failed', message, 'error');
      setStep('idle');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isWalletConnected) {
      connectWallet();
      return;
    }
    if (!onCoston2) {
      switchChainAsync({ chainId: COSTON2_CHAIN_ID, addEthereumChainParameter: ADD_CHAIN_PARAMS[COSTON2_CHAIN_ID] }).catch(() => {
        addNotification('Network Switch Failed', 'Please switch your wallet to the Coston2 testnet manually.', 'error');
      });
      return;
    }
    setLastTxHash(null);
    handleSend();
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

  const currentStepIdx = SEND_TIMELINE.findIndex((t) => t.key === step);

  const stepLabel: Record<Exclude<SendStep, 'idle' | 'finalized'>, string> = {
    proving: 'Generating ZK proof in browser...',
    submitting: 'Submitting payment...',
    confirming: 'Confirming on-chain...',
    announcing: 'Notifying recipient...',
  };

  const buttonLabel = (() => {
    if (!isWalletConnected) return 'Connect Wallet to Pay';
    if (!onCoston2) return 'Switch to Coston2 Testnet';
    if (step !== 'idle' && step !== 'finalized') {
      return (
        <span className="flex items-center gap-2">
          <RefreshCw className="animate-spin" size={14} />
          {stepLabel[step]}
        </span>
      );
    }
    if (assetNotes.length === 0) return 'No Shielded Notes Available';
    if (!selectedNoteId) return 'Select a Note to Pay With';
    if (!recipientIsAddress) return 'Enter Recipient Address';
    if (!recipientRegistered) return 'Recipient Has No Payment Key';
    return 'Send Private Payment';
  })();

  const submitDisabled =
    (step !== 'idle' && step !== 'finalized') ||
    (isWalletConnected &&
      onCoston2 &&
      (assetNotes.length === 0 || !selectedNoteId || !recipientIsAddress || !recipientRegistered));

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
            Pay a registered shielded address, or claim payments sent to you
          </p>
        </div>

        {/* Payment key status banner */}
        {isWalletConnected && onCoston2 && registryAddress && (
          <GlassCard className="p-4 mb-6 flex items-center justify-between gap-4" hoverGlow={false}>
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg border ${ownRegistered ? 'border-success-state/20 bg-success-state/5' : 'border-accent-secondary/30 bg-accent-secondary/5'}`}>
                <KeyRound size={16} className={ownRegistered ? 'text-success-state' : 'text-accent-secondary'} />
              </div>
              <div>
                <span className="text-xs font-semibold uppercase tracking-wide text-text-primary block">
                  {ownRegistered ? 'Payment key published' : 'Payment key not published'}
                </span>
                <span className="text-[10px] text-text-secondary">
                  {ownRegistered ? 'Others can pay you privately.' : 'Publish your key once so others can pay you.'}
                </span>
              </div>
            </div>
            {!ownRegistered && (
              <AnimatedButton variant="secondary" size="sm" onClick={handleRegister}>
                Publish Payment Key
              </AnimatedButton>
            )}
          </GlassCard>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Main Panel (Span 7) */}
          <div className="lg:col-span-7">
            <GlassCard className="overflow-hidden" hoverGlow={false}>
              {/* Tab Selector */}
              <div className="flex border-b border-border-custom bg-surface/10">
                <button
                  onClick={() => setActiveTab('send')}
                  className={`flex-1 flex items-center justify-center gap-2 py-4 text-xs font-display font-semibold uppercase tracking-wider transition-all cursor-pointer ${
                    activeTab === 'send'
                      ? 'border-b-2 border-accent-primary text-accent-primary bg-surface/20'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <Send size={14} />
                  Send
                </button>
                <button
                  onClick={() => setActiveTab('incoming')}
                  className={`flex-1 flex items-center justify-center gap-2 py-4 text-xs font-display font-semibold uppercase tracking-wider transition-all cursor-pointer ${
                    activeTab === 'incoming'
                      ? 'border-b-2 border-accent-secondary text-accent-secondary bg-surface/20'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <Inbox size={14} />
                  Incoming
                </button>
              </div>

              {activeTab === 'send' ? (
                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                  {/* Asset Selection */}
                  <div>
                    <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light block mb-2">Select Asset Pool</label>
                    <div className="grid grid-cols-3 gap-3">
                      {ASSET_OPTIONS.map((item) => (
                        <button
                          key={item.sym}
                          type="button"
                          onClick={() => { setAsset(item.sym); setSelectedNoteId(null); }}
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

                  {/* Note Picker */}
                  <div>
                    <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light block mb-2">Select Shielded Note</label>
                    {assetNotes.length === 0 ? (
                      <div className="rounded-lg border border-border-custom bg-surface/20 p-4 text-center">
                        <p className="text-[10px] text-text-secondary leading-relaxed">
                          No shielded {asset} notes found in this browser. Shield a deposit first.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-40 overflow-y-auto">
                        {assetNotes.map((n) => (
                          <button
                            key={n.id}
                            type="button"
                            onClick={() => setSelectedNoteId(n.id)}
                            className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-all cursor-pointer ${
                              selectedNoteId === n.id
                                ? 'border-accent-primary bg-accent-primary/5'
                                : 'border-border-custom bg-surface/20 hover:border-border-custom/80'
                            }`}
                          >
                            <span className="text-xs font-mono font-bold text-text-primary">
                              {formatUnits(BigInt(n.amount), assetConfig?.decimals ?? 18)} {asset}
                            </span>
                            <span className="text-[9px] text-text-secondary">note #{n.derivationIndex}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Recipient */}
                  <div>
                    <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light block mb-2">Recipient Address</label>
                    <input
                      type="text"
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      placeholder="0x..."
                      className="w-full bg-surface/30 border border-border-custom rounded-lg px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-accent-primary/60 font-mono"
                      required
                    />
                    {recipientIsAddress && recipientOwnerKeyQuery.data !== undefined && (
                      <span className={`text-[10px] mt-1.5 block ${recipientRegistered ? 'text-success-state' : 'text-accent-secondary'}`}>
                        {recipientRegistered ? 'Payment key found — ready to pay privately.' : "This address hasn't published a payment key yet."}
                      </span>
                    )}
                  </div>

                  {/* Wrong network notice */}
                  {isWalletConnected && !onCoston2 && (
                    <div className="rounded-lg border border-accent-secondary/30 bg-accent-secondary/5 p-3 text-[10px] text-accent-secondary">
                      Umbra&apos;s vault is deployed on the Coston2 testnet. Switch networks to continue.
                    </div>
                  )}

                  <div className="space-y-1.5 text-[10px] uppercase font-mono tracking-wider text-text-secondary border-b border-border-custom/40 pb-4">
                    <div className="flex justify-between">
                      <span>Network:</span>
                      <span className="text-text-primary">Flare Coston2 Testnet</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Proof System:</span>
                      <span className="text-text-primary">Noir / UltraHonk (in-browser)</span>
                    </div>
                  </div>

                  <AnimatedButton
                    variant="primary"
                    type="submit"
                    disabled={submitDisabled}
                    fullWidth
                    className="rounded-xl py-3.5"
                  >
                    {buttonLabel}
                  </AnimatedButton>
                </form>
              ) : (
                <div className="p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-text-secondary leading-relaxed max-w-sm">
                      Payments announced to your address, not yet saved to your shielded notes.
                    </p>
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
                    <div className="rounded-lg border border-border-custom bg-surface/20 p-4 text-center text-[10px] text-text-secondary">
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
                    <div className="rounded-lg border border-border-custom bg-surface/20 p-4 text-center text-[10px] text-text-secondary">
                      {incomingQuery.isFetching ? 'Scanning...' : 'Nothing to claim right now.'}
                    </div>
                  )}
                </div>
              )}
            </GlassCard>
          </div>

          {/* Timeline Panel (Span 5) */}
          <div className="lg:col-span-5">
            <GlowBorder active={step !== 'idle'} glowColor={step === 'finalized' ? 'success' : 'purple'}>
              <GlassCard className="p-6 min-h-[380px] flex flex-col justify-between" hoverGlow={false}>
                <div>
                  <div className="flex items-center gap-2 border-b border-border-custom pb-4 mb-6">
                    <Clock size={16} className="text-accent-secondary" />
                    <h2 className="text-sm uppercase tracking-wider font-display font-bold">Execution Timeline</h2>
                  </div>

                  {step === 'idle' ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center text-text-secondary">
                      <ShieldCheck size={36} className="text-border-custom mb-3" />
                      <span className="text-xs uppercase tracking-widest">Awaiting execution</span>
                      <p className="text-[10px] text-text-secondary/60 mt-1 max-w-[200px] leading-relaxed">
                        Submit the form to send a private payment on Coston2.
                      </p>
                    </div>
                  ) : (
                    <div className="relative pl-6 space-y-6">
                      <div className="absolute left-2.5 top-2 bottom-2 w-0.5 bg-border-custom z-0" />
                      {SEND_TIMELINE.map((t, idx) => {
                        // currentStepIdx never exceeds the last step's own index, so
                        // without the `step === 'finalized'` check the final step would
                        // never flip to "done" even after the whole flow succeeded.
                        const isDone = currentStepIdx > idx || step === 'finalized';
                        const isCurrent = currentStepIdx === idx;
                        return (
                          <div key={t.key} className="relative z-10 flex items-start gap-4">
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
                            <div>
                              <span className={`text-xs font-semibold block uppercase tracking-wide ${
                                isDone ? 'text-text-primary' : isCurrent ? 'text-accent-primary' : 'text-text-secondary'
                              }`}>
                                {t.label}
                              </span>
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
                  <div className="mt-6 border-t border-border-custom/40 pt-4 flex flex-col gap-2 bg-success-state/5 p-3 rounded-lg border border-success-state/10 animate-fade-in">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <Check className="text-success-state" size={16} />
                        <span className="text-[10px] font-bold text-success-state uppercase tracking-wider">Payment settled privately</span>
                      </div>
                      <button
                        onClick={() => setStep('idle')}
                        className="text-[9px] text-text-secondary hover:text-text-primary underline cursor-pointer"
                      >
                        Clear State
                      </button>
                    </div>
                    {lastTxHash && (
                      <a
                        href={`https://coston2-explorer.flare.network/tx/${lastTxHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[9px] text-text-secondary/70 font-mono break-all hover:text-accent-primary flex items-center gap-1"
                      >
                        Tx: {lastTxHash.slice(0, 18)}… <ChevronRight size={10} />
                      </a>
                    )}
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
