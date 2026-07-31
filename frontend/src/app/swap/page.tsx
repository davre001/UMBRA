"use client";

import React, { useMemo, useState } from 'react';
import { formatUnits, parseEventLogs, parseUnits } from 'viem';
import { useChainId, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/providers/app-provider';
import { useNoteWallet } from '@/lib/noteWallet/useNoteWallet';
import { getDeployment } from '@/lib/noteWallet/deployments';
import { SHIELDED_VAULT_ABI } from '@/lib/noteWallet/vaultAbi';
import { nullifierHash as computeNullifierHash, ownerKey as computeOwnerKey } from '@/lib/noteWallet/poseidon2';
import { provePlaceOrder, proveCancelOrder } from '@/lib/proving/prove';
import { submitOrderToMatcher } from '@/lib/api';
import type { StoredNote, StoredOrderNote } from '@/lib/noteWallet/store';
import { Navbar } from '@/components/shared/navbar';
import { GlassCard } from '@/components/ui/glass-card';
import { AnimatedButton } from '@/components/ui/animated-button';
import { GlowBorder } from '@/components/ui/glow-border';
import {
  Lock,
  RefreshCw,
  ListOrdered,
  PlusCircle,
  Clock,
  ChevronRight,
  CheckCircle2,
  ShieldCheck,
  Info,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';

type Tab = 'place' | 'orders';
type AssetSymbol = 'C2FLR' | 'FXRP' | 'USDT0';
type PlaceStep = 'idle' | 'proving' | 'submitting' | 'confirming' | 'finalized';

const COSTON2_CHAIN_ID = 114;
const ASSET_OPTIONS: { sym: AssetSymbol; name: string }[] = [
  { sym: 'C2FLR', name: 'Coston2 Flare (native)' },
  { sym: 'FXRP', name: 'FAssets XRP' },
  { sym: 'USDT0', name: 'Tether USD' },
];

const PLACE_TIMELINE = [
  { key: 'proving', label: 'Generate ZK Proof' },
  { key: 'submitting', label: 'Submit Order' },
  { key: 'confirming', label: 'Confirm On-Chain' },
  { key: 'finalized', label: 'Order Placed' },
] as const;

export default function DarkPoolPage() {
  const { isEntered, isWalletConnected, walletAddress, connectWallet, addNotification } = useApp();
  const queryClient = useQueryClient();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const deployment = useMemo(() => getDeployment(chainId), [chainId]);
  const vaultAddress = deployment?.vault;
  const noteWallet = useNoteWallet(vaultAddress, deployment?.deployBlock !== undefined ? BigInt(deployment.deployBlock) : undefined);
  const onCoston2 = chainId === COSTON2_CHAIN_ID;

  const [activeTab, setActiveTab] = useState<Tab>('place');
  const [assetIn, setAssetIn] = useState<AssetSymbol>('C2FLR');
  const [assetOut, setAssetOut] = useState<AssetSymbol>('FXRP');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [minAmountOut, setMinAmountOut] = useState('');
  const [step, setStep] = useState<PlaceStep>('idle');
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  const assetInConfig = deployment?.assets[assetIn];
  const assetOutConfig = deployment?.assets[assetOut];

  const notesQuery = useQuery({
    queryKey: ['unspentNotes', walletAddress],
    queryFn: () => noteWallet.listUnspentNotes(),
    enabled: !!walletAddress,
  });

  const spendableNotes: StoredNote[] = useMemo(() => {
    if (!notesQuery.data || !assetInConfig) return [];
    return notesQuery.data.filter((n) => n.kind === 'note' && n.assetId === String(assetInConfig.assetId));
  }, [notesQuery.data, assetInConfig]);

  const openOrders = useMemo(
    () => (notesQuery.data ?? []).filter((n): n is StoredOrderNote => n.kind === 'order'),
    [notesQuery.data]
  );

  const handlePlaceOrder = async () => {
    if (!walletAddress || !publicClient || !deployment || !assetInConfig || !assetOutConfig || !vaultAddress) return;
    const note = spendableNotes.find((n) => n.id === selectedNoteId);
    if (!note || note.kind !== 'note') {
      addNotification('No Note Selected', 'Choose a shielded note to place an order with.', 'error');
      return;
    }
    const minOutBaseUnits = parseUnits(minAmountOut || '0', assetOutConfig.decimals);
    if (minOutBaseUnits <= BigInt(0)) {
      addNotification('Invalid Amount', 'Enter a minimum acceptable amount greater than zero.', 'error');
      return;
    }

    try {
      setStep('proving');
      const merklePath = await noteWallet.getMerkleProof(note);
      const spendingKey = await noteWallet.getSpendingKey();
      const amountIn = BigInt(note.amount);
      const assetInId = BigInt(note.assetId);
      const assetOutId = BigInt(assetOutConfig.assetId);
      const nullifierHashValue = computeNullifierHash(BigInt(note.commitment), spendingKey);
      const orderPrepared = await noteWallet.prepareOrderNote(amountIn, assetInId, assetOutId, minOutBaseUnits);

      const proofHex = await provePlaceOrder({
        root: merklePath.root,
        nullifierHash: nullifierHashValue,
        orderCommitment: orderPrepared.commitment,
        amountIn,
        assetIn: assetInId,
        note: {
          spendingKey,
          blinding: BigInt(note.blinding),
          merklePath: { pathElements: merklePath.pathElements, pathIndices: merklePath.pathIndices },
        },
        orderBlinding: orderPrepared.blinding,
        assetOut: assetOutId,
        minAmountOut: minOutBaseUnits,
      });

      setStep('submitting');
      const hash = await writeContractAsync({
        address: vaultAddress,
        abi: SHIELDED_VAULT_ABI,
        functionName: 'placeOrder',
        args: [proofHex, merklePath.root, nullifierHashValue, orderPrepared.commitment],
      });

      setStep('confirming');
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const [placedLog] = parseEventLogs({ abi: SHIELDED_VAULT_ABI, eventName: 'OrderPlaced', logs: receipt.logs });
      if (!placedLog) throw new Error('OrderPlaced event not found in transaction receipt.');
      await noteWallet.confirmNote(orderPrepared, placedLog.args.leafIndex);
      await noteWallet.refreshSpentStatus();

      setLastTxHash(hash);
      setStep('finalized');
      setSelectedNoteId(null);
      setMinAmountOut('');
      queryClient.invalidateQueries({ queryKey: ['unspentNotes', walletAddress] });

      // Hand the order's private details to the matcher — the on-chain
      // placeOrder above already fully authorized and placed it; this just
      // makes it findable for matching. A failure here doesn't undo the
      // placement, so it's surfaced separately, not as an "Order Failed" error.
      try {
        await submitOrderToMatcher({
          commitment: `0x${orderPrepared.commitment.toString(16)}`,
          leafIndex: placedLog.args.leafIndex,
          spendingKey: spendingKey.toString(),
          orderBlinding: orderPrepared.blinding.toString(),
          amountIn: amountIn.toString(),
          assetIn: Number(assetInId),
          assetOut: Number(assetOutId),
          minAmountOut: minOutBaseUnits.toString(),
          ownerKey: computeOwnerKey(spendingKey).toString(),
          walletAddress,
        });
        addNotification('Order Placed', 'Your dark-pool order is live and waiting to be matched.', 'success');
      } catch {
        addNotification(
          'Order Placed',
          'Order is on-chain, but the matcher could not be reached — it will need to be resubmitted for matching.',
          'error'
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Placing the order failed.';
      addNotification('Order Failed', message, 'error');
      setStep('idle');
    }
  };

  const handleCancelOrder = async (order: StoredOrderNote) => {
    if (!walletAddress || !publicClient || !vaultAddress) return;
    setCancelingId(order.id);
    try {
      const merklePath = await noteWallet.getMerkleProof(order);
      const spendingKey = await noteWallet.getSpendingKey();
      const amountIn = BigInt(order.amount);
      const assetInId = BigInt(order.assetId);
      const nullifierHashValue = computeNullifierHash(BigInt(order.commitment), spendingKey);
      const refundPrepared = await noteWallet.prepareNote(amountIn, assetInId);

      const proofHex = await proveCancelOrder({
        root: merklePath.root,
        nullifierHash: nullifierHashValue,
        refundCommitment: refundPrepared.commitment,
        spendingKey,
        orderBlinding: BigInt(order.blinding),
        amountIn,
        assetIn: assetInId,
        assetOut: BigInt(order.assetOut),
        minAmountOut: BigInt(order.minAmountOut),
        merklePath: { pathElements: merklePath.pathElements, pathIndices: merklePath.pathIndices },
        refundBlinding: refundPrepared.blinding,
      });

      const hash = await writeContractAsync({
        address: vaultAddress,
        abi: SHIELDED_VAULT_ABI,
        functionName: 'cancelOrder',
        args: [proofHex, merklePath.root, nullifierHashValue, refundPrepared.commitment],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const [cancelledLog] = parseEventLogs({ abi: SHIELDED_VAULT_ABI, eventName: 'OrderCancelled', logs: receipt.logs });
      if (!cancelledLog) throw new Error('OrderCancelled event not found in transaction receipt.');
      await noteWallet.confirmNote(refundPrepared, cancelledLog.args.leafIndex);
      await noteWallet.refreshSpentStatus();

      queryClient.invalidateQueries({ queryKey: ['unspentNotes', walletAddress] });
      addNotification('Order Cancelled', 'Your funds were refunded as a fresh shielded note.', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Cancelling the order failed.';
      addNotification('Cancel Failed', message, 'error');
    } finally {
      setCancelingId(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isWalletConnected) {
      connectWallet();
      return;
    }
    if (!onCoston2) {
      switchChainAsync({ chainId: COSTON2_CHAIN_ID }).catch(() => {
        addNotification('Network Switch Failed', 'Please switch your wallet to the Coston2 testnet manually.', 'error');
      });
      return;
    }
    setLastTxHash(null);
    handlePlaceOrder();
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

  const currentStepIdx = PLACE_TIMELINE.findIndex((t) => t.key === step);

  const stepLabel: Record<Exclude<PlaceStep, 'idle' | 'finalized'>, string> = {
    proving: 'Generating ZK proof in browser...',
    submitting: 'Submitting order...',
    confirming: 'Confirming on-chain...',
  };

  const buttonLabel = (() => {
    if (!isWalletConnected) return 'Connect Wallet to Trade';
    if (!onCoston2) return 'Switch to Coston2 Testnet';
    if (step !== 'idle' && step !== 'finalized') {
      return (
        <span className="flex items-center gap-2">
          <RefreshCw className="animate-spin" size={14} />
          {stepLabel[step]}
        </span>
      );
    }
    if (assetIn === assetOut) return 'Choose Two Different Assets';
    if (spendableNotes.length === 0) return 'No Shielded Notes Available';
    if (!selectedNoteId) return 'Select a Note to Trade';
    return 'Place Dark-Pool Order';
  })();

  const submitDisabled =
    (step !== 'idle' && step !== 'finalized') ||
    (isWalletConnected &&
      onCoston2 &&
      (assetIn === assetOut || spendableNotes.length === 0 || !selectedNoteId || !minAmountOut));

  return (
    <div className="flex min-h-screen flex-col pt-16 z-10 relative">
      <Navbar />

      <div className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold tracking-tight text-text-primary font-display uppercase">
            Dark Pool
          </h1>
          <p className="text-text-secondary text-xs font-light mt-1 tracking-wider uppercase">
            Place hidden orders — size and assets stay private until matched
          </p>
        </div>

        {/* Matcher disclosure */}
        <GlassCard className="p-4 mb-6 flex items-start gap-3" hoverGlow={false}>
          <Info size={16} className="text-accent-secondary flex-shrink-0 mt-0.5" />
          <p className="text-[10px] text-text-secondary leading-relaxed">
            Placing, cancelling, and matching orders are all real — each settles on-chain against a real Noir/UltraHonk
            proof. Matches can be partial: a large order may only be filled in part, with the remainder staying live on
            the book at the same terms. The matcher only ever sees what it needs to pair two compatible orders — it
            can&apos;t redirect funds or spend on your behalf. Cancel any open order any time to get your funds back as
            a fresh note.
          </p>
        </GlassCard>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Main Panel (Span 7) */}
          <div className="lg:col-span-7">
            <GlassCard className="overflow-hidden" hoverGlow={false}>
              {/* Tab Selector */}
              <div className="flex border-b border-border-custom bg-surface/10">
                <button
                  onClick={() => setActiveTab('place')}
                  className={`flex-1 flex items-center justify-center gap-2 py-4 text-xs font-display font-semibold uppercase tracking-wider transition-all cursor-pointer ${
                    activeTab === 'place'
                      ? 'border-b-2 border-accent-primary text-accent-primary bg-surface/20'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <PlusCircle size={14} />
                  Place Order
                </button>
                <button
                  onClick={() => setActiveTab('orders')}
                  className={`flex-1 flex items-center justify-center gap-2 py-4 text-xs font-display font-semibold uppercase tracking-wider transition-all cursor-pointer ${
                    activeTab === 'orders'
                      ? 'border-b-2 border-accent-secondary text-accent-secondary bg-surface/20'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <ListOrdered size={14} />
                  My Orders {openOrders.length > 0 && `(${openOrders.length})`}
                </button>
              </div>

              {activeTab === 'place' ? (
                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                  {/* Asset In */}
                  <div>
                    <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light block mb-2">You&apos;re Selling</label>
                    <div className="grid grid-cols-3 gap-3">
                      {ASSET_OPTIONS.map((item) => (
                        <button
                          key={item.sym}
                          type="button"
                          onClick={() => { setAssetIn(item.sym); setSelectedNoteId(null); }}
                          className={`flex flex-col items-start p-3 rounded-lg border text-left transition-all cursor-pointer ${
                            assetIn === item.sym
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
                    {spendableNotes.length === 0 ? (
                      <div className="rounded-lg border border-border-custom bg-surface/20 p-4 text-center">
                        <p className="text-[10px] text-text-secondary leading-relaxed">
                          No shielded {assetIn} notes found in this browser. Shield a deposit first.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-40 overflow-y-auto">
                        {spendableNotes.map((n) => (
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
                              {formatUnits(BigInt(n.amount), assetInConfig?.decimals ?? 18)} {assetIn}
                            </span>
                            <span className="text-[9px] text-text-secondary">note #{n.derivationIndex}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Asset Out */}
                  <div>
                    <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light block mb-2">You Want</label>
                    <div className="grid grid-cols-3 gap-3">
                      {ASSET_OPTIONS.map((item) => (
                        <button
                          key={item.sym}
                          type="button"
                          disabled={item.sym === assetIn}
                          onClick={() => setAssetOut(item.sym)}
                          className={`flex flex-col items-start p-3 rounded-lg border text-left transition-all ${
                            item.sym === assetIn
                              ? 'opacity-30 cursor-not-allowed border-border-custom bg-surface/10'
                              : assetOut === item.sym
                                ? 'cursor-pointer border-accent-secondary bg-accent-secondary/5'
                                : 'cursor-pointer border-border-custom bg-surface/20 hover:border-border-custom/80'
                          }`}
                        >
                          <span className="text-xs font-bold text-text-primary font-display">{item.sym}</span>
                          <span className="text-[9px] text-text-secondary mt-0.5">{item.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Min amount out */}
                  <div>
                    <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light block mb-2">Minimum Acceptable Amount</label>
                    <div className="relative">
                      <input
                        type="number"
                        value={minAmountOut}
                        onChange={(e) => setMinAmountOut(e.target.value)}
                        placeholder="0.00"
                        className="w-full bg-surface/30 border border-border-custom rounded-lg px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-accent-primary/60 font-mono"
                        required
                      />
                      <span className="absolute right-4 top-3.5 text-xs text-text-secondary font-bold font-mono">{assetOut}</span>
                    </div>
                  </div>

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
                      <span>Order Type:</span>
                      <span className="text-text-primary">Dark pool, partial fills supported</span>
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
                <div className="p-6 space-y-3">
                  {openOrders.length === 0 ? (
                    <div className="rounded-lg border border-border-custom bg-surface/20 p-6 text-center">
                      <p className="text-[10px] text-text-secondary leading-relaxed">
                        No open orders. Place one from the &quot;Place Order&quot; tab.
                      </p>
                    </div>
                  ) : (
                    openOrders.map((order) => {
                      const assetInSym = ASSET_OPTIONS.find((a) => deployment?.assets[a.sym]?.assetId === Number(order.assetId))?.sym ?? `asset ${order.assetId}`;
                      const assetOutSym = ASSET_OPTIONS.find((a) => deployment?.assets[a.sym]?.assetId === Number(order.assetOut))?.sym ?? `asset ${order.assetOut}`;
                      const inDecimals = deployment?.assets[assetInSym as AssetSymbol]?.decimals ?? 18;
                      const outDecimals = deployment?.assets[assetOutSym as AssetSymbol]?.decimals ?? 18;
                      const original = BigInt(order.originalAmountIn);
                      const remaining = BigInt(order.amount);
                      const filled = original - remaining;
                      const isPartiallyFilled = filled > BigInt(0);
                      return (
                        <div key={order.id} className="flex items-center justify-between p-4 rounded-lg border border-border-custom bg-surface/20">
                          <div>
                            <span className="text-xs font-mono font-bold text-text-primary block">
                              {formatUnits(remaining, inDecimals)} {assetInSym} → min {formatUnits(BigInt(order.minAmountOut), outDecimals)} {assetOutSym}
                            </span>
                            {isPartiallyFilled ? (
                              <span className="text-[9px] text-accent-primary">
                                {formatUnits(filled, inDecimals)} / {formatUnits(original, inDecimals)} {assetInSym} filled — rest still open
                              </span>
                            ) : (
                              <span className="text-[9px] text-text-secondary">Pending match — order #{order.derivationIndex}</span>
                            )}
                          </div>
                          <AnimatedButton
                            variant="secondary"
                            size="sm"
                            onClick={() => handleCancelOrder(order)}
                            disabled={cancelingId === order.id}
                          >
                            {cancelingId === order.id ? (
                              <span className="flex items-center gap-1.5">
                                <RefreshCw size={12} className="animate-spin" /> Cancelling...
                              </span>
                            ) : (
                              <span className="flex items-center gap-1.5">
                                <XCircle size={12} /> Cancel
                              </span>
                            )}
                          </AnimatedButton>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </GlassCard>
          </div>

          {/* Timeline Panel (Span 5) */}
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
                      <ShieldCheck size={36} className="text-border-custom mb-3" />
                      <span className="text-xs uppercase tracking-widest">Awaiting execution</span>
                      <p className="text-[10px] text-text-secondary/60 mt-1 max-w-[200px] leading-relaxed">
                        Submit the form to place a hidden order on Coston2.
                      </p>
                    </div>
                  ) : (
                    <div className="relative pl-6 space-y-6">
                      <div className="absolute left-2.5 top-2 bottom-2 w-0.5 bg-border-custom z-0" />
                      {PLACE_TIMELINE.map((t, idx) => {
                        const isDone = currentStepIdx > idx;
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
                        <ShieldCheck className="text-success-state animate-pulse" size={16} />
                        <span className="text-[10px] font-bold text-success-state uppercase tracking-wider">Order live in the dark pool</span>
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
