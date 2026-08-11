"use client";

import React, { useMemo, useState } from 'react';
import { erc20Abi, formatUnits, isAddress, parseEventLogs, parseUnits } from 'viem';
import { useChainId, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/providers/app-provider';
import { useNoteWallet } from '@/lib/noteWallet/useNoteWallet';
import { getDeployment } from '@/lib/noteWallet/deployments';
import { SHIELDED_VAULT_ABI } from '@/lib/noteWallet/vaultAbi';
import { BATCH_WITHDRAWER_ABI } from '@/lib/noteWallet/batchWithdrawerAbi';
import { COMPLIANCE_REGISTRY_ABI } from '@/lib/noteWallet/complianceRegistryAbi';
import { nullifierHash as computeNullifierHash } from '@/lib/noteWallet/poseidon2';
import { proveWithdraw } from '@/lib/proving/prove';
import { screenAddress } from '@/lib/api';
import { assertTxSuccess, getErrorMessage } from '@/lib/utils';
import { ADD_CHAIN_PARAMS } from '@/lib/networkParams';
import type { StoredNote } from '@/lib/noteWallet/store';
import { Navbar } from '@/components/shared/navbar';
import { GlassCard } from '@/components/ui/glass-card';
import { AnimatedButton } from '@/components/ui/animated-button';
import { GlowBorder } from '@/components/ui/glow-border';
import {
  Shield,
  ArrowDown,
  ArrowUp,
  Clock,
  ChevronRight,
  ShieldCheck,
  CheckCircle2,
  Lock,
  RefreshCw,
} from 'lucide-react';
import Link from 'next/link';

type Tab = 'deposit' | 'withdraw';
type AssetSymbol = 'C2FLR' | 'FXRP' | 'USDT0' | 'BTC';
type FlowStep = 'idle' | 'approving' | 'screening' | 'submitting' | 'proving' | 'confirming' | 'finalized';

const COSTON2_CHAIN_ID = 114;
const ASSET_OPTIONS: { sym: AssetSymbol; name: string }[] = [
  { sym: 'C2FLR', name: 'Coston2 Flare (native)' },
  { sym: 'FXRP', name: 'FAssets XRP' },
  { sym: 'USDT0', name: 'Tether USD' },
  { sym: 'BTC', name: 'Bitcoin (signet)' },
];

const DEPOSIT_TIMELINE_ERC20 = [
  { key: 'approving', label: 'Approve Token' },
  { key: 'submitting', label: 'Submit Deposit' },
  { key: 'confirming', label: 'Confirm On-Chain' },
  { key: 'finalized', label: 'Settlement' },
] as const;

// No approve step for the native asset — shield() takes it directly as the
// call's own value, nothing to allow beforehand.
const DEPOSIT_TIMELINE_NATIVE = [
  { key: 'submitting', label: 'Submit Deposit' },
  { key: 'confirming', label: 'Confirm On-Chain' },
  { key: 'finalized', label: 'Settlement' },
] as const;

const WITHDRAW_TIMELINE = [
  { key: 'screening', label: 'Compliance Screening' },
  { key: 'proving', label: 'Generate ZK Proof' },
  { key: 'submitting', label: 'Submit Withdrawal' },
  { key: 'confirming', label: 'Confirm On-Chain' },
  { key: 'finalized', label: 'Settlement' },
] as const;

export default function ShieldPage() {
  const { isEntered, isWalletConnected, walletAddress, connectWallet, addNotification } = useApp();
  const queryClient = useQueryClient();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const deployment = useMemo(() => getDeployment(chainId), [chainId]);
  const vaultAddress = deployment?.vault;
  const noteWallet = useNoteWallet(vaultAddress, deployment?.deployBlock !== undefined ? BigInt(deployment.deployBlock) : undefined);

  const [activeTab, setActiveTab] = useState<Tab>('deposit');
  const [asset, setAsset] = useState<AssetSymbol>('C2FLR');
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [step, setStep] = useState<FlowStep>('idle');
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [bulkWithdrawing, setBulkWithdrawing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const assetConfig = deployment?.assets[asset];
  const onCoston2 = chainId === COSTON2_CHAIN_ID;
  // BTC is now ordinary allowlisted collateral (real WrappedBTC — see
  // ShieldedVault.sol's depositExternal), so every asset here defaults its
  // withdrawal destination to the connected wallet's own address the same
  // way, with no BTC-specific branching.
  const effectiveDestination = (destination || walletAddress || '') as `0x${string}` | '';

  const publicBalanceQuery = useQuery({
    queryKey: ['publicBalance', chainId, asset, walletAddress],
    queryFn: () =>
      assetConfig!.native
        ? publicClient!.getBalance({ address: walletAddress as `0x${string}` })
        : publicClient!.readContract({
            address: assetConfig!.token as `0x${string}`,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [walletAddress as `0x${string}`],
          }),
    enabled: !!publicClient && !!assetConfig && !!walletAddress,
  });

  const notesQuery = useQuery({
    queryKey: ['unspentNotes', walletAddress],
    queryFn: () => noteWallet.listUnspentNotes(),
    enabled: !!walletAddress,
  });

  const destinationScreenedQuery = useQuery({
    queryKey: ['isScreened', chainId, effectiveDestination],
    queryFn: () =>
      publicClient!.readContract({
        address: deployment!.compliance,
        abi: COMPLIANCE_REGISTRY_ABI,
        functionName: 'isScreened',
        args: [effectiveDestination as `0x${string}`],
      }),
    enabled: !!publicClient && !!deployment && activeTab === 'withdraw' && isAddress(effectiveDestination),
  });

  const assetNotes: StoredNote[] = useMemo(() => {
    if (!notesQuery.data || !assetConfig) return [];
    return notesQuery.data.filter((n) => n.kind === 'note' && n.assetId === String(assetConfig.assetId));
  }, [notesQuery.data, assetConfig]);

  const shieldedBalance = useMemo(
    () => assetNotes.reduce((sum, n) => sum + BigInt(n.amount), BigInt(0)),
    [assetNotes]
  );

  const formattedPublicBalance =
    publicBalanceQuery.data !== undefined && assetConfig
      ? Number(formatUnits(publicBalanceQuery.data, assetConfig.decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 })
      : '—';
  const formattedShieldedBalance = assetConfig
    ? Number(formatUnits(shieldedBalance, assetConfig.decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 })
    : '—';

  const handleDeposit = async () => {
    if (!walletAddress || !publicClient || !deployment || !assetConfig || !vaultAddress) return;
    try {
      const amountBaseUnits = parseUnits(amount || '0', assetConfig.decimals);
      if (amountBaseUnits <= BigInt(0)) {
        addNotification('Invalid Amount', 'Enter an amount greater than zero.', 'error');
        return;
      }

      if (assetConfig.native) {
        setStep('submitting');
      } else {
        setStep('approving');
        const allowance = await publicClient.readContract({
          address: assetConfig.token as `0x${string}`,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [walletAddress as `0x${string}`, vaultAddress],
        });
        if (allowance < amountBaseUnits) {
          const approveHash = await writeContractAsync({
            address: assetConfig.token as `0x${string}`,
            abi: erc20Abi,
            functionName: 'approve',
            args: [vaultAddress, amountBaseUnits],
          });
          const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
          assertTxSuccess(approveReceipt);
        }
        setStep('submitting');
      }

      const note = await noteWallet.prepareDepositNote(amountBaseUnits, BigInt(assetConfig.assetId));
      const shieldHash = await writeContractAsync({
        address: vaultAddress,
        abi: SHIELDED_VAULT_ABI,
        functionName: 'shield',
        args: [BigInt(assetConfig.assetId), amountBaseUnits, note.commitment],
        value: assetConfig.native ? amountBaseUnits : undefined,
      });

      setStep('confirming');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: shieldHash });
      const [shieldedLog] = parseEventLogs({ abi: SHIELDED_VAULT_ABI, eventName: 'Shielded', logs: receipt.logs });
      if (!shieldedLog) throw new Error('Shielded event not found in transaction receipt.');
      await noteWallet.confirmNote(note, shieldedLog.args.leafIndex);

      setLastTxHash(shieldHash);
      setStep('finalized');
      queryClient.invalidateQueries({ queryKey: ['unspentNotes', walletAddress] });
      queryClient.invalidateQueries({ queryKey: ['publicBalance', chainId, asset, walletAddress] });
      addNotification('Deposit Shielded', `Successfully shielded ${amount} ${asset} privately.`, 'success', shieldHash);
    } catch (err) {
      const message = getErrorMessage(err, 'Shield deposit failed.');
      addNotification('Shield Request Failed', message, 'error');
      setStep('idle');
    }
  };

  /**
   * ShieldedVault.withdraw() gates on ComplianceRegistry.isScreened(recipient)
   * — a destination that's never been screened (or was previously blocked)
   * makes the withdraw tx revert on-chain. Checks the real on-chain status
   * first and only calls the backend attester if it isn't already clear, so
   * repeat withdrawals to the same address don't re-screen every time.
   * Throws if the address comes back blocked, before any proof/gas is spent.
   */
  const ensureDestinationScreened = async (
    destination: `0x${string}`,
    onStep?: (step: 'screening') => void
  ): Promise<void> => {
    if (!publicClient || !deployment) throw new Error('No public client / deployment');
    onStep?.('screening');
    const alreadyClear = await publicClient.readContract({
      address: deployment.compliance,
      abi: COMPLIANCE_REGISTRY_ABI,
      functionName: 'isScreened',
      args: [destination],
    });
    if (alreadyClear) return;

    const result = await screenAddress(destination);
    if (!result.clear) {
      throw new Error('Destination address failed compliance screening and cannot receive a withdrawal.');
    }
    queryClient.invalidateQueries({ queryKey: ['isScreened', chainId, destination] });
  };

  /** Proves + submits one withdrawal, waits for confirmation, returns the tx hash. Shared by the single-note flow and Unshield All — `onStep` lets a caller drive its own progress UI, or omit it for a silent/batched call. */
  const withdrawOneNote = async (
    note: StoredNote,
    destination: `0x${string}`,
    onStep?: (step: 'proving' | 'submitting' | 'confirming') => void
  ): Promise<`0x${string}`> => {
    if (!publicClient || !vaultAddress) throw new Error('No public client / vault address');
    if (note.kind !== 'note') throw new Error('Selected item is not a spendable note.');

    onStep?.('proving');
    const merklePath = await noteWallet.getMerkleProof(note);
    const spendingKey = await noteWallet.getSpendingKey();
    const amountValue = BigInt(note.amount);
    const assetIdValue = BigInt(note.assetId);
    const nullifierHashValue = computeNullifierHash(BigInt(note.commitment), spendingKey);

    const proofHex = await proveWithdraw({
      root: merklePath.root,
      nullifierHash: nullifierHashValue,
      amount: amountValue,
      assetId: assetIdValue,
      recipient: BigInt(destination),
      note: {
        spendingKey,
        blinding: BigInt(note.blinding),
        merklePath: { pathElements: merklePath.pathElements, pathIndices: merklePath.pathIndices },
      },
    });

    onStep?.('submitting');
    const withdrawHash = await writeContractAsync({
      address: vaultAddress,
      abi: SHIELDED_VAULT_ABI,
      functionName: 'withdraw',
      args: [proofHex, merklePath.root, nullifierHashValue, amountValue, assetIdValue, destination],
    });

    onStep?.('confirming');
    const receipt = await publicClient.waitForTransactionReceipt({ hash: withdrawHash });
    assertTxSuccess(receipt);
    return withdrawHash;
  };

  const handleWithdraw = async () => {
    if (!walletAddress || !publicClient || !deployment || !assetConfig || !vaultAddress) return;
    const note = assetNotes.find((n) => n.id === selectedNoteId);
    if (!note) {
      addNotification('No Note Selected', 'Choose a shielded note to withdraw.', 'error');
      return;
    }
    if (!isAddress(effectiveDestination)) {
      addNotification('Missing Destination', 'Enter a destination address.', 'error');
      return;
    }

    try {
      const amountValue = BigInt(note.amount);
      await ensureDestinationScreened(effectiveDestination as `0x${string}`, setStep);
      const withdrawHash = await withdrawOneNote(note, effectiveDestination as `0x${string}`, setStep);
      await noteWallet.refreshSpentStatus();

      setLastTxHash(withdrawHash);
      setStep('finalized');
      setSelectedNoteId(null);
      queryClient.invalidateQueries({ queryKey: ['unspentNotes', walletAddress] });
      queryClient.invalidateQueries({ queryKey: ['publicBalance', chainId, asset, walletAddress] });
      addNotification(
        'Funds Withdrawn',
        `Successfully withdrew ${formatUnits(amountValue, assetConfig.decimals)} ${asset} privately.`,
        'success',
        withdrawHash
      );
    } catch (err) {
      const message = getErrorMessage(err, 'Withdrawal failed.');
      addNotification('Withdraw Request Failed', message, 'error');
      setStep('idle');
    }
  };

  /** Shared tail for both Unshield All paths below — reports the outcome and refreshes local/query state the same way regardless of how the withdrawals were actually submitted. */
  const finishUnshieldAll = async (succeeded: number, failed: number, totalAmount: bigint, txHash?: `0x${string}`) => {
    await noteWallet.refreshSpentStatus();
    queryClient.invalidateQueries({ queryKey: ['unspentNotes', walletAddress] });
    queryClient.invalidateQueries({ queryKey: ['publicBalance', chainId, asset, walletAddress] });

    if (succeeded > 0) {
      addNotification(
        'Unshield All Complete',
        `Withdrew ${succeeded} note${succeeded === 1 ? '' : 's'} (${formatUnits(totalAmount, assetConfig!.decimals)} ${asset})${failed ? `, ${failed} failed` : ''}.`,
        failed ? 'warning' : 'success',
        txHash
      );
    } else {
      addNotification('Unshield All Failed', 'None of the selected notes could be withdrawn.', 'error');
    }
  };

  const handleUnshieldAll = async () => {
    if (!walletAddress || !publicClient || !vaultAddress || !assetConfig || !isAddress(effectiveDestination)) {
      addNotification('Missing Destination', 'Enter a destination address.', 'error');
      return;
    }
    const notes = assetNotes.filter((n) => n.kind === 'note');
    if (notes.length === 0) return;

    try {
      await ensureDestinationScreened(effectiveDestination as `0x${string}`);
    } catch (err) {
      const message = getErrorMessage(err, 'Compliance screening failed.');
      addNotification('Compliance Screening Failed', message, 'error');
      return;
    }

    setBulkWithdrawing(true);
    setBulkProgress({ done: 0, total: notes.length });
    const batchWithdrawerAddress = deployment?.batchWithdrawer;

    try {
      if (batchWithdrawerAddress) {
        // Proving is still done one note at a time (pure local computation,
        // no signature) — only submission is batched into a single
        // transaction, so N notes costs one signature instead of N.
        const calls: { proof: `0x${string}`; root: bigint; nullifierHash: bigint; amount: bigint; assetId: bigint; recipient: `0x${string}` }[] = [];
        for (let i = 0; i < notes.length; i++) {
          const note = notes[i];
          const merklePath = await noteWallet.getMerkleProof(note);
          const spendingKey = await noteWallet.getSpendingKey();
          const amountValue = BigInt(note.amount);
          const assetIdValue = BigInt(note.assetId);
          const nullifierHashValue = computeNullifierHash(BigInt(note.commitment), spendingKey);
          const proofHex = await proveWithdraw({
            root: merklePath.root,
            nullifierHash: nullifierHashValue,
            amount: amountValue,
            assetId: assetIdValue,
            recipient: BigInt(effectiveDestination),
            note: {
              spendingKey,
              blinding: BigInt(note.blinding),
              merklePath: { pathElements: merklePath.pathElements, pathIndices: merklePath.pathIndices },
            },
          });
          calls.push({
            proof: proofHex,
            root: merklePath.root,
            nullifierHash: nullifierHashValue,
            amount: amountValue,
            assetId: assetIdValue,
            recipient: effectiveDestination as `0x${string}`,
          });
          setBulkProgress({ done: i + 1, total: notes.length });
        }

        const hash = await writeContractAsync({
          address: batchWithdrawerAddress,
          abi: BATCH_WITHDRAWER_ABI,
          functionName: 'batchWithdraw',
          args: [vaultAddress, calls],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        assertTxSuccess(receipt);
        const attempts = parseEventLogs({ abi: BATCH_WITHDRAWER_ABI, eventName: 'WithdrawAttempted', logs: receipt.logs });

        let succeeded = 0;
        let totalAmount = BigInt(0);
        for (const attempt of attempts) {
          if (attempt.args.success) {
            succeeded += 1;
            totalAmount += BigInt(notes[Number(attempt.args.index)].amount);
          }
        }
        await finishUnshieldAll(succeeded, notes.length - succeeded, totalAmount, hash);
      } else {
        // No BatchWithdrawer configured for this chain — fall back to one
        // signature per note.
        let succeeded = 0;
        let totalAmount = BigInt(0);
        for (let i = 0; i < notes.length; i++) {
          try {
            await withdrawOneNote(notes[i], effectiveDestination as `0x${string}`);
            succeeded += 1;
            totalAmount += BigInt(notes[i].amount);
          } catch {
            // counted via notes.length - succeeded below
          }
          setBulkProgress({ done: i + 1, total: notes.length });
        }
        await finishUnshieldAll(succeeded, notes.length - succeeded, totalAmount);
      }
    } catch (err) {
      const message = getErrorMessage(err, 'Unshield All failed.');
      addNotification('Unshield All Failed', message, 'error');
    } finally {
      setBulkWithdrawing(false);
      setBulkProgress(null);
      setSelectedNoteId(null);
    }
  };

  const handleRecoverDeposits = async () => {
    if (!walletAddress) return;
    setRecovering(true);
    try {
      const count = await noteWallet.recoverDepositNotes();
      queryClient.invalidateQueries({ queryKey: ['unspentNotes', walletAddress] });
      addNotification(
        count > 0 ? 'Deposits Recovered' : 'Nothing to Recover',
        count > 0
          ? `Found ${count} shielded deposit${count === 1 ? '' : 's'} from this wallet's on-chain history.`
          : "No deposit notes for this wallet were found beyond what's already in this browser.",
        count > 0 ? 'success' : 'info'
      );
    } catch (err) {
      const message = getErrorMessage(err, 'Recovery failed.');
      addNotification('Recovery Failed', message, 'error');
    } finally {
      setRecovering(false);
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
    if (activeTab === 'deposit') handleDeposit();
    else handleWithdraw();
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

  const timelineSteps =
    activeTab === 'deposit'
      ? assetConfig?.native
        ? DEPOSIT_TIMELINE_NATIVE
        : DEPOSIT_TIMELINE_ERC20
      : WITHDRAW_TIMELINE;
  const currentStepIdx = timelineSteps.findIndex((t) => t.key === step);

  const stepLabel: Record<Exclude<FlowStep, 'idle' | 'finalized'>, string> = {
    approving: 'Approving token...',
    screening: 'Verifying compliance status...',
    submitting: activeTab === 'deposit' ? 'Submitting deposit...' : 'Submitting withdrawal...',
    proving: 'Generating ZK proof in browser...',
    confirming: 'Confirming on-chain...',
  };

  const buttonLabel = (() => {
    if (!isWalletConnected) return 'Connect Wallet to Shield';
    if (!onCoston2) return 'Switch to Coston2 Testnet';
    if (step !== 'idle' && step !== 'finalized') {
      return (
        <span className="flex items-center gap-2">
          <RefreshCw className="animate-spin" size={14} />
          {stepLabel[step]}
        </span>
      );
    }
    if (activeTab === 'withdraw') {
      if (assetNotes.length === 0) return 'No Shielded Notes Available';
      if (!selectedNoteId) return 'Select a Note to Withdraw';
      return 'Initiate Private Withdrawal';
    }
    return 'Initiate Shield Deposit';
  })();

  const submitDisabled =
    (step !== 'idle' && step !== 'finalized') ||
    bulkWithdrawing ||
    (isWalletConnected && onCoston2 && activeTab === 'withdraw' && (assetNotes.length === 0 || !selectedNoteId));

  return (
    <div className="flex min-h-screen flex-col pt-16 z-10 relative">
      <Navbar />

      <div className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {/* Header */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-text-primary font-display uppercase">
              Shield Gateway
            </h1>
            <p className="text-text-secondary text-xs font-light mt-1 tracking-wider uppercase">
              Deposit and withdraw real Coston2 assets through the shielded vault
            </p>
          </div>
          {isWalletConnected && onCoston2 && (
            <button
              type="button"
              onClick={handleRecoverDeposits}
              disabled={recovering}
              className="flex items-center gap-1.5 self-start sm:self-auto px-3 py-1.5 rounded-lg border border-border-custom bg-surface/30 text-[10px] text-text-secondary hover:text-text-primary hover:border-border-custom/80 transition-all cursor-pointer uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
              title="Find shielded deposits made from a different browser or device"
            >
              <RefreshCw size={11} className={recovering ? 'animate-spin' : ''} />
              {recovering ? 'Recovering...' : 'Recover Deposits'}
            </button>
          )}
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
              <form onSubmit={handleSubmit} className="p-6 space-y-6">

                {/* Asset Selection */}
                <div>
                  <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light block mb-2">Select Asset Pool</label>
                  <div className="grid grid-cols-4 gap-3">
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

                {activeTab === 'deposit' ? (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light">Amount</label>
                      <span className="text-[9px] text-text-secondary font-mono">
                        Available: {formattedPublicBalance} {asset}
                      </span>
                    </div>
                    <div className="relative">
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        className="no-spinner w-full bg-surface/30 border border-border-custom rounded-lg pl-4 pr-20 py-3 text-sm text-text-primary focus:outline-none focus:border-accent-primary/60 font-mono"
                        required
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-xs text-text-secondary font-bold font-mono">{asset}</span>
                    </div>
                    {asset === 'BTC' && (
                      <p className="text-[9px] text-text-secondary/70 mt-2 leading-relaxed">
                        Need WrappedBTC first? Deposit real signet BTC on the <Link href="/faucet" className="text-accent-primary hover:underline">Faucet</Link> page —
                        it lands in your public balance automatically, then shields here like any other asset.
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light">Select Shielded Note</label>
                        <span className="text-[9px] text-text-secondary font-mono">
                          Shielded: {formattedShieldedBalance} {asset}
                        </span>
                      </div>
                      {assetNotes.length === 0 ? (
                        <div className="rounded-lg border border-border-custom bg-surface/20 p-4 text-center">
                          <p className="text-[10px] text-text-secondary leading-relaxed">
                            No shielded {asset} notes found in this browser. Shield a deposit first.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {assetNotes.map((n) => (
                            <button
                              key={n.id}
                              type="button"
                              onClick={() => setSelectedNoteId(n.id)}
                              className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-all cursor-pointer ${
                                selectedNoteId === n.id
                                  ? 'border-accent-secondary bg-accent-secondary/5'
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
                      {assetNotes.length > 1 && (
                        <button
                          type="button"
                          onClick={handleUnshieldAll}
                          disabled={bulkWithdrawing || !isAddress(effectiveDestination)}
                          className="mt-2 flex items-center gap-1.5 text-[10px] text-accent-secondary hover:text-accent-secondary/80 underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {bulkWithdrawing ? (
                            <>
                              <RefreshCw size={10} className="animate-spin" />
                              Unshielding {bulkProgress?.done ?? 0} / {bulkProgress?.total ?? assetNotes.length}...
                            </>
                          ) : (
                            `Unshield All (${assetNotes.length} notes)`
                          )}
                        </button>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light">
                          Destination Address
                        </label>
                        {isAddress(effectiveDestination) && (
                          <span className={`text-[9px] uppercase tracking-wider font-mono ${
                            destinationScreenedQuery.isLoading
                              ? 'text-text-secondary'
                              : destinationScreenedQuery.data
                                ? 'text-success-state'
                                : 'text-accent-secondary'
                          }`}>
                            {destinationScreenedQuery.isLoading
                              ? 'Checking compliance...'
                              : destinationScreenedQuery.data
                                ? 'Screened Clear'
                                : 'Not Yet Screened'}
                          </span>
                        )}
                      </div>
                      <input
                        type="text"
                        // Falls back to displaying the connected wallet's
                        // own address as a default when nothing's been typed.
                        value={effectiveDestination}
                        onChange={(e) => setDestination(e.target.value)}
                        placeholder="0x..."
                        className="w-full bg-surface/30 border border-border-custom rounded-lg px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-accent-primary/60 font-mono"
                        required
                      />
                      {isAddress(effectiveDestination) && destinationScreenedQuery.data === false && (
                        <p className="text-[9px] text-accent-secondary/80 mt-1.5 leading-relaxed">
                          Not screened yet — withdrawing will screen this address automatically before submitting.
                        </p>
                      )}
                    </div>
                  </>
                )}

                {/* Wrong network notice */}
                {isWalletConnected && !onCoston2 && (
                  <div className="rounded-lg border border-accent-secondary/30 bg-accent-secondary/5 p-3 text-[10px] text-accent-secondary">
                    Umbra&apos;s vault is deployed on the Coston2 testnet. Switch networks to continue.
                  </div>
                )}

                {/* Transaction details overview */}
                <div className="space-y-1.5 text-[10px] uppercase font-mono tracking-wider text-text-secondary border-b border-border-custom/40 pb-4">
                  <div className="flex justify-between">
                    <span>Network:</span>
                    <span className="text-text-primary">Flare Coston2 Testnet</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Vault Contract:</span>
                    <span className="text-text-primary">{vaultAddress ? `${vaultAddress.slice(0, 6)}...${vaultAddress.slice(-4)}` : '—'}</span>
                  </div>
                  {activeTab === 'withdraw' && (
                    <div className="flex justify-between">
                      <span>Proof System:</span>
                      <span className="text-text-primary">Noir / UltraHonk (in-browser)</span>
                    </div>
                  )}
                </div>

                {/* Submit Action */}
                <AnimatedButton
                  variant={activeTab === 'deposit' ? 'primary' : 'secondary'}
                  type="submit"
                  disabled={submitDisabled}
                  fullWidth
                  className="rounded-xl py-3"
                >
                  {buttonLabel}
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
                        Submit the form to {activeTab === 'deposit' ? 'shield a deposit' : 'withdraw a note'} on Coston2.
                      </p>
                    </div>
                  ) : (
                    /* Timeline Progress Display */
                    <div className="relative pl-6 space-y-6">

                      {/* Vertical line indicator */}
                      <div className="absolute left-2.5 top-2 bottom-2 w-0.5 bg-border-custom z-0" />

                      {timelineSteps.map((t, idx) => {
                        // currentStepIdx never exceeds the last step's own index, so
                        // without the `step === 'finalized'` check the final step would
                        // never flip to "done" even after the whole flow succeeded.
                        const isDone = currentStepIdx > idx || step === 'finalized';
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
                        <span className="text-[10px] font-bold text-success-state uppercase tracking-wider">Shield session verified</span>
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
