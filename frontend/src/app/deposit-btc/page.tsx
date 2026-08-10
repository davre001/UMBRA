"use client";

import React, { useMemo, useState } from 'react';
import { useChainId, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { parseEventLogs } from 'viem';
import { useApp } from '@/providers/app-provider';
import { useNoteWallet } from '@/lib/noteWallet/useNoteWallet';
import { getDeployment } from '@/lib/noteWallet/deployments';
import { SHIELDED_VAULT_ABI } from '@/lib/noteWallet/vaultAbi';
import { submitBtcDeposit, fetchBtcDepositStatus } from '@/lib/api';
import { assertTxSuccess, getErrorMessage } from '@/lib/utils';
import { ADD_CHAIN_PARAMS } from '@/lib/networkParams';
import { Navbar } from '@/components/shared/navbar';
import { GlassCard } from '@/components/ui/glass-card';
import { AnimatedButton } from '@/components/ui/animated-button';
import { Bitcoin, Copy, CheckCircle2, Lock, RefreshCw, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

const COSTON2_CHAIN_ID = 114;

// Must match contract/circuits/noir/btc_deposit/src/bitcoin.nr's BTC_ASSET_ID
// exactly — a placeholder until a real assetId slot is allocated at
// deployment. See that file's own CRITICAL DEPLOYMENT CONSTRAINT comment:
// this assetId must never be allowlisted for withdraw().
const BTC_ASSET_ID = BigInt(999);

// keccak256("BTC_SIGNET") — same sourceChainId convention documented in
// contract/circuits/BTC_DEPOSIT_DESIGN.md and used by
// backend/test/btc-deposit test fixtures / ShieldedVault.test.ts.
const BTC_SIGNET_SOURCE_CHAIN_ID = '0x5b2b79af9a2064a41a53f83acc6c8cfad3b61646800a01767d6c78d07fd323d9' as `0x${string}`;

// Placeholder — matches backend/src/btc-deposit/mempool.ts's default
// VAULT_PUBKEY_HASH. Must be replaced with the real deployed signet vault
// address before this page can accept real deposits.
const VAULT_PUBKEY_HASH_PLACEHOLDER = '00'.repeat(20);

type FlowStep = 'idle' | 'preparing' | 'submitting' | 'proven' | 'claiming' | 'confirming' | 'finalized';

function ownerKeyToHex(ownerKey: bigint): `0x${string}` {
  return ('0x' + ownerKey.toString(16).padStart(64, '0')) as `0x${string}`;
}

export default function DepositBtcPage() {
  const { isEntered, isWalletConnected, walletAddress, connectWallet, addNotification } = useApp();
  const queryClient = useQueryClient();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const deployment = useMemo(() => getDeployment(chainId), [chainId]);
  const vaultAddress = deployment?.vault;
  const btcDepositVerifier = deployment?.btcDepositVerifier;
  const noteWallet = useNoteWallet(vaultAddress, deployment?.deployBlock !== undefined ? BigInt(deployment.deployBlock) : undefined);

  const onCoston2 = chainId === COSTON2_CHAIN_ID;

  const [amountSats, setAmountSats] = useState('');
  const [ownerKeyHex, setOwnerKeyHex] = useState<`0x${string}` | null>(null);
  const [preparedNote, setPreparedNote] = useState<Awaited<ReturnType<typeof noteWallet.prepareDepositNote>> | null>(null);
  const [txid, setTxid] = useState('');
  const [depositId, setDepositId] = useState<string | null>(null);
  const [step, setStep] = useState<FlowStep>('idle');
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [copied, setCopied] = useState<'owner' | 'vault' | null>(null);

  // Polls until the local flow moves past claiming — no separate effect
  // mirroring server status into `step` (React 19 flags synchronous
  // setState-in-effect as a footgun; see https://react.dev/learn/you-might-not-need-an-effect).
  // Instead, `displayStatus` below reads remote status directly whenever
  // local action state (claiming/confirming/finalized) hasn't taken over.
  const depositStatusQuery = useQuery({
    queryKey: ['btcDepositStatus', depositId],
    queryFn: () => fetchBtcDepositStatus(depositId!),
    enabled: !!depositId && step !== 'finalized',
    refetchInterval: 4000,
  });

  const remoteStatus = depositStatusQuery.data?.status;
  const displayStatus: 'awaiting_proof' | 'proven' | 'failed' | 'claiming' | 'confirming' | 'finalized' | null = !depositId
    ? null
    : step === 'claiming' || step === 'confirming' || step === 'finalized'
      ? step
      : (remoteStatus ?? 'awaiting_proof');

  const handlePrepare = async () => {
    if (!walletAddress) {
      connectWallet();
      return;
    }
    const sats = BigInt(amountSats || '0');
    if (sats <= BigInt(0)) {
      addNotification('Invalid Amount', 'Enter a satoshi amount greater than zero.', 'error');
      return;
    }
    try {
      setStep('preparing');
      const ownerKey = await noteWallet.getOwnerKey();
      const prepared = await noteWallet.prepareDepositNote(sats, BTC_ASSET_ID);
      setOwnerKeyHex(ownerKeyToHex(ownerKey));
      setPreparedNote(prepared);
      setStep('idle');
    } catch (err) {
      addNotification('Preparation Failed', getErrorMessage(err, 'Could not derive a deposit note.'), 'error');
      setStep('idle');
    }
  };

  const handleSubmitTxid = async () => {
    if (!preparedNote) return;
    if (!/^[0-9a-f]{64}$/i.test(txid.trim())) {
      addNotification('Invalid Txid', 'Enter the 64-character hex txid of your confirmed signet transaction.', 'error');
      return;
    }
    try {
      setStep('submitting');
      const result = await submitBtcDeposit(txid.trim(), preparedNote.blinding.toString());
      setDepositId(result.id);
      setStep('idle');
      addNotification('Deposit Submitted', 'Your BTC payment was fetched and queued for proving.', 'success');
    } catch (err) {
      addNotification('Submission Failed', getErrorMessage(err, 'Could not submit this deposit.'), 'error');
      setStep('idle');
    }
  };

  const handleClaim = async () => {
    if (!publicClient || !vaultAddress || !btcDepositVerifier || !preparedNote || !depositStatusQuery.data?.proof) return;
    const { proof, publicInputs } = depositStatusQuery.data;
    if (!publicInputs) return;
    try {
      setStep('claiming');
      const claimHash = await writeContractAsync({
        address: vaultAddress,
        abi: SHIELDED_VAULT_ABI,
        functionName: 'depositExternal',
        args: [
          btcDepositVerifier,
          proof,
          {
            sourceChainId: BTC_SIGNET_SOURCE_CHAIN_ID,
            checkpointRoot: publicInputs[0] as `0x${string}`,
            noteCommitment: publicInputs[1] as `0x${string}`,
            nullifier: publicInputs[2] as `0x${string}`,
          },
        ],
      });

      setStep('confirming');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: claimHash });
      assertTxSuccess(receipt);
      const [depositedLog] = parseEventLogs({ abi: SHIELDED_VAULT_ABI, eventName: 'ExternalDeposited', logs: receipt.logs });
      if (!depositedLog) throw new Error('ExternalDeposited event not found in transaction receipt.');
      await noteWallet.confirmNote(preparedNote, depositedLog.args.leafIndex);

      setLastTxHash(claimHash);
      setStep('finalized');
      queryClient.invalidateQueries({ queryKey: ['unspentNotes', walletAddress] });
      addNotification('BTC Deposit Claimed', 'A private UMBRA note was minted from your BTC payment.', 'success', claimHash);
    } catch (err) {
      addNotification('Claim Failed', getErrorMessage(err, 'Could not claim this deposit on-chain.'), 'error');
      setStep('proven');
    }
  };

  const handleCopy = (value: string, which: 'owner' | 'vault') => {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  };

  const handleConnectOrSwitch = () => {
    if (!isWalletConnected) {
      connectWallet();
      return;
    }
    if (!onCoston2) {
      switchChainAsync({ chainId: COSTON2_CHAIN_ID, addEthereumChainParameter: ADD_CHAIN_PARAMS[COSTON2_CHAIN_ID] }).catch(() => {
        addNotification('Network Switch Failed', 'Please switch your wallet to the Coston2 testnet manually.', 'error');
      });
    }
  };

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

  const configured = !!btcDepositVerifier;

  return (
    <div className="flex min-h-screen flex-col pt-16 z-10 relative">
      <Navbar />

      <div className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold tracking-tight text-text-primary font-display uppercase flex items-center gap-2">
            <Bitcoin className="text-accent-primary" size={22} />
            BTC Deposit Gateway
          </h1>
          <p className="text-text-secondary text-xs font-light mt-1 tracking-wider uppercase">
            Mint a private UMBRA note from a real Bitcoin signet payment
          </p>
        </div>

        {!configured && (
          <div className="mb-6 rounded-lg border border-accent-secondary/30 bg-accent-secondary/5 p-4 flex items-start gap-3">
            <AlertTriangle className="text-accent-secondary flex-shrink-0 mt-0.5" size={16} />
            <p className="text-[10px] text-accent-secondary leading-relaxed">
              BTC deposits aren&apos;t configured on this network yet — no `btcDepositVerifier` address is set for chain {chainId}.
              See contract/circuits/BTC_DEPOSIT_DESIGN.md.
            </p>
          </div>
        )}

        <GlassCard className="overflow-hidden p-6 space-y-6" hoverGlow={false}>
          {/* Step 1: amount + derive owner_key */}
          <div>
            <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light block mb-2">
              1. Intended deposit amount (satoshis)
            </label>
            <div className="flex gap-3">
              <input
                type="number"
                value={amountSats}
                onChange={(e) => setAmountSats(e.target.value)}
                placeholder="150000"
                disabled={!!preparedNote}
                className="no-spinner flex-1 bg-surface/30 border border-border-custom rounded-lg px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-accent-primary/60 font-mono disabled:opacity-50"
              />
              <AnimatedButton
                variant="primary"
                onClick={preparedNote ? undefined : handlePrepare}
                disabled={!!preparedNote || step === 'preparing'}
                className="rounded-xl px-6 whitespace-nowrap"
              >
                {step === 'preparing' ? <RefreshCw className="animate-spin" size={14} /> : preparedNote ? 'Prepared' : 'Prepare'}
              </AnimatedButton>
            </div>
          </div>

          {/* Step 2: construct + broadcast the real BTC tx */}
          {preparedNote && ownerKeyHex && (
            <div className="space-y-4 border-t border-border-custom/40 pt-6">
              <div>
                <p className="text-[10px] text-text-secondary uppercase tracking-widest font-light mb-2">
                  2. Construct and broadcast a signet transaction (1 input, empty scriptSig, exactly 2 outputs)
                </p>
                <div className="rounded-lg border border-border-custom bg-surface/20 p-4 space-y-3 text-[10px] font-mono">
                  <div>
                    <div className="text-text-secondary mb-1">Output 0 — OP_RETURN, 0 value, push32(your owner_key):</div>
                    <div className="flex items-center gap-2">
                      <span className="text-text-primary break-all">{ownerKeyHex}</span>
                      <button type="button" onClick={() => handleCopy(ownerKeyHex, 'owner')} className="text-accent-primary hover:text-accent-primary/70 flex-shrink-0">
                        {copied === 'owner' ? <CheckCircle2 size={12} /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <div className="text-text-secondary mb-1">Output 1 — P2WPKH payment to the vault address ({amountSats} sats):</div>
                    <div className="flex items-center gap-2">
                      <span className="text-text-primary break-all">{VAULT_PUBKEY_HASH_PLACEHOLDER}</span>
                      <button type="button" onClick={() => handleCopy(VAULT_PUBKEY_HASH_PLACEHOLDER, 'vault')} className="text-accent-primary hover:text-accent-primary/70 flex-shrink-0">
                        {copied === 'vault' ? <CheckCircle2 size={12} /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>
                </div>
                <p className="text-[9px] text-text-secondary/70 mt-2 leading-relaxed">
                  No wallet integration builds this transaction for you — construct and broadcast it with your own signet
                  wallet/tooling, no change output (see BTC_DEPOSIT_DESIGN.md&apos;s disclosed template constraint), then
                  paste its confirmed txid below.
                </p>
              </div>

              <div>
                <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light block mb-2">
                  3. Confirmed transaction id
                </label>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={txid}
                    onChange={(e) => setTxid(e.target.value)}
                    placeholder="64-character hex txid"
                    disabled={!!depositId}
                    className="flex-1 bg-surface/30 border border-border-custom rounded-lg px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-accent-primary/60 font-mono disabled:opacity-50"
                  />
                  <AnimatedButton
                    variant="secondary"
                    onClick={depositId ? undefined : handleSubmitTxid}
                    disabled={!!depositId || step === 'submitting'}
                    className="rounded-xl px-6 whitespace-nowrap"
                  >
                    {step === 'submitting' ? <RefreshCw className="animate-spin" size={14} /> : depositId ? 'Submitted' : 'Submit'}
                  </AnimatedButton>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: status + claim */}
          {depositId && (
            <div className="border-t border-border-custom/40 pt-6">
              <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light block mb-2">
                4. Proving status
              </label>
              <div className="rounded-lg border border-border-custom bg-surface/20 p-4 flex items-center justify-between">
                <span className="text-xs font-mono text-text-primary uppercase tracking-wide">
                  {displayStatus === 'awaiting_proof' && (
                    <span className="flex items-center gap-2">
                      <RefreshCw className="animate-spin text-accent-primary" size={14} />
                      Awaiting proof from the btc-deposit-worker...
                    </span>
                  )}
                  {displayStatus === 'proven' && 'Proof ready — claim your note on-chain'}
                  {displayStatus === 'failed' && (
                    <span className="flex items-center gap-2 text-accent-secondary">
                      <AlertTriangle size={14} />
                      {depositStatusQuery.data?.failureReason ?? 'Proving failed.'}
                    </span>
                  )}
                  {(displayStatus === 'claiming' || displayStatus === 'confirming') && (
                    <span className="flex items-center gap-2">
                      <RefreshCw className="animate-spin text-accent-primary" size={14} />
                      {displayStatus === 'claiming' ? 'Submitting claim...' : 'Confirming on-chain...'}
                    </span>
                  )}
                  {displayStatus === 'finalized' && (
                    <span className="flex items-center gap-2 text-success-state">
                      <CheckCircle2 size={14} />
                      Note minted
                    </span>
                  )}
                </span>
                {displayStatus === 'proven' && (
                  <AnimatedButton
                    variant="primary"
                    onClick={!isWalletConnected || !onCoston2 ? handleConnectOrSwitch : handleClaim}
                    disabled={!configured}
                    className="rounded-xl px-6 whitespace-nowrap"
                  >
                    {!isWalletConnected ? 'Connect Wallet' : !onCoston2 ? 'Switch Network' : 'Claim On-Chain'}
                  </AnimatedButton>
                )}
              </div>

              {displayStatus === 'finalized' && lastTxHash && (
                <a
                  href={`https://coston2-explorer.flare.network/tx/${lastTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[9px] text-text-secondary/70 font-mono break-all hover:text-accent-primary flex items-center gap-1 mt-3"
                >
                  Tx: {lastTxHash.slice(0, 18)}…
                </a>
              )}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
