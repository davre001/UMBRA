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
import {
  buildDepositTx,
  broadcastSignetTx,
  fetchSignetFeeRate,
  fetchSignetUtxos,
  getSignetAddress,
  type SignetUtxo,
} from '@/lib/btcWallet';
import { Navbar } from '@/components/shared/navbar';
import { GlassCard } from '@/components/ui/glass-card';
import { AnimatedButton } from '@/components/ui/animated-button';
import {
  Bitcoin,
  Copy,
  CheckCircle2,
  Lock,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Zap,
} from 'lucide-react';
import Link from 'next/link';

const COSTON2_CHAIN_ID = 114;
const SIGNET_FAUCET_URL = 'https://signetfaucet.com/';

// Must match contract/circuits/noir/btc_deposit/src/bitcoin.nr's BTC_ASSET_ID
// exactly — a placeholder until a real assetId slot is allocated at
// deployment. See that file's own CRITICAL DEPLOYMENT CONSTRAINT comment:
// this assetId must never be allowlisted for withdraw().
const BTC_ASSET_ID = BigInt(999);

// keccak256("BTC_SIGNET") — same sourceChainId convention documented in
// contract/circuits/BTC_DEPOSIT_DESIGN.md and used by
// backend/test/btc-deposit test fixtures / ShieldedVault.test.ts.
const BTC_SIGNET_SOURCE_CHAIN_ID = '0x5b2b79af9a2064a41a53f83acc6c8cfad3b61646800a01767d6c78d07fd323d9' as `0x${string}`;

type FlowStep = 'idle' | 'preparing' | 'building' | 'broadcasting' | 'submitting' | 'proven' | 'claiming' | 'confirming' | 'finalized';

function ownerKeyToHex(ownerKey: bigint): `0x${string}` {
  return ('0x' + ownerKey.toString(16).padStart(64, '0')) as `0x${string}`;
}

function formatSats(sats: number | bigint): string {
  return `${sats.toLocaleString()} sats (${(Number(sats) / 1e8).toFixed(8)} BTC)`;
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
  const btcVaultPubkeyHash = deployment?.btcVaultPubkeyHash;
  const noteWallet = useNoteWallet(vaultAddress, deployment?.deployBlock !== undefined ? BigInt(deployment.deployBlock) : undefined);

  const onCoston2 = chainId === COSTON2_CHAIN_ID;

  const [ownerKeyHex, setOwnerKeyHex] = useState<`0x${string}` | null>(null);
  const [signetAddress, setSignetAddress] = useState<string | null>(null);
  const [selectedUtxo, setSelectedUtxo] = useState<SignetUtxo | null>(null);
  const [preparedNote, setPreparedNote] = useState<Awaited<ReturnType<typeof noteWallet.prepareDepositNote>> | null>(null);
  const [depositId, setDepositId] = useState<string | null>(null);
  const [step, setStep] = useState<FlowStep>('idle');
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [copied, setCopied] = useState<'owner' | 'vault' | 'address' | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [manualAmountSats, setManualAmountSats] = useState('');
  const [manualTxid, setManualTxid] = useState('');

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

  // Live signet balance for the derived deposit address — same
  // watch-and-poll pattern the /faucet page's EVM asset cards already use.
  const utxosQuery = useQuery({
    queryKey: ['signetUtxos', signetAddress],
    queryFn: () => fetchSignetUtxos(signetAddress!),
    enabled: !!signetAddress && !depositId,
    refetchInterval: 8000,
  });
  const confirmedUtxos = (utxosQuery.data ?? []).filter((u) => u.status.confirmed).sort((a, b) => b.value - a.value);

  const feeRateQuery = useQuery({
    queryKey: ['signetFeeRate'],
    queryFn: fetchSignetFeeRate,
    enabled: !!signetAddress && !depositId,
    staleTime: 60_000,
  });

  const handleDeriveAddress = async () => {
    if (!walletAddress) {
      connectWallet();
      return;
    }
    try {
      setStep('preparing');
      const [ownerKey, signetKeyPair] = await Promise.all([noteWallet.getOwnerKey(), noteWallet.getSignetKeyPair()]);
      setOwnerKeyHex(ownerKeyToHex(ownerKey));
      setSignetAddress(getSignetAddress(signetKeyPair));
      setStep('idle');
    } catch (err) {
      addNotification('Derivation Failed', getErrorMessage(err, 'Could not derive your signet deposit address.'), 'error');
      setStep('idle');
    }
  };

  /** The auto path: builds + signs + broadcasts the fixed-template tx spending `selectedUtxo` in full, then hands its txid straight into the existing proving pipeline (submitBtcDeposit) — no manual construction, no separate wallet, no copy-pasting a txid by hand. */
  const handleAutoDeposit = async () => {
    if (!selectedUtxo || !btcVaultPubkeyHash || feeRateQuery.data === undefined) return;
    try {
      setStep('building');
      const amountSats = BigInt(selectedUtxo.value) - BigInt(Math.ceil(153 * feeRateQuery.data));
      const [ownerKey, signetKeyPair] = await Promise.all([noteWallet.getOwnerKey(), noteWallet.getSignetKeyPair()]);
      const prepared = await noteWallet.prepareDepositNote(amountSats, BTC_ASSET_ID);
      setPreparedNote(prepared);

      const built = buildDepositTx(signetKeyPair, selectedUtxo, btcVaultPubkeyHash, ownerKey, feeRateQuery.data);

      setStep('broadcasting');
      const txid = await broadcastSignetTx(built.rawHex);
      addNotification('Signet Transaction Broadcast', `Sent ${formatSats(built.amountSats)} to the vault — waiting for it to be submitted for proving.`, 'success');

      setStep('submitting');
      const result = await submitBtcDeposit(txid, prepared.blinding.toString());
      setDepositId(result.id);
      setStep('idle');
      addNotification('Deposit Submitted', 'Your BTC payment was broadcast and queued for proving.', 'success');
    } catch (err) {
      addNotification('Deposit Failed', getErrorMessage(err, 'Could not build, sign, or broadcast the deposit transaction.'), 'error');
      setStep('idle');
    }
  };

  const handlePrepareManual = async () => {
    if (!walletAddress) {
      connectWallet();
      return;
    }
    const sats = BigInt(manualAmountSats || '0');
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

  const handleSubmitManualTxid = async () => {
    if (!preparedNote) return;
    if (!/^[0-9a-f]{64}$/i.test(manualTxid.trim())) {
      addNotification('Invalid Txid', 'Enter the 64-character hex txid of your confirmed signet transaction.', 'error');
      return;
    }
    try {
      setStep('submitting');
      const result = await submitBtcDeposit(manualTxid.trim(), preparedNote.blinding.toString());
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

  const handleCopy = (value: string, which: 'owner' | 'vault' | 'address') => {
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

  const configured = !!btcDepositVerifier && !!btcVaultPubkeyHash;
  const busy = step === 'preparing' || step === 'building' || step === 'broadcasting' || step === 'submitting';

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
              BTC deposits aren&apos;t configured on this network yet — no `btcDepositVerifier`/`btcVaultPubkeyHash` is set for chain {chainId}.
              See contract/circuits/BTC_DEPOSIT_DESIGN.md.
            </p>
          </div>
        )}

        {!depositId && (
          <GlassCard className="overflow-hidden p-6 space-y-6 mb-6" hoverGlow={false}>
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-accent-primary" />
              <span className="text-[10px] text-accent-primary uppercase tracking-widest font-semibold">Recommended — no separate wallet needed</span>
            </div>

            {!signetAddress ? (
              <div>
                <p className="text-[10px] text-text-secondary leading-relaxed mb-4">
                  Derives a real signet Bitcoin address from your connected wallet&apos;s own signature — the same one your
                  UMBRA spending key already comes from. No new wallet to install, no seed phrase to back up.
                </p>
                <AnimatedButton variant="primary" onClick={handleDeriveAddress} disabled={busy} className="rounded-xl px-6">
                  {step === 'preparing' ? <RefreshCw className="animate-spin" size={14} /> : 'Derive My Signet Address'}
                </AnimatedButton>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light block mb-2">
                    1. Your signet deposit address
                  </label>
                  <div className="rounded-lg border border-border-custom bg-surface/20 p-4 flex items-center justify-between gap-3">
                    <span className="text-xs font-mono text-text-primary break-all">{signetAddress}</span>
                    <button type="button" onClick={() => handleCopy(signetAddress, 'address')} className="text-accent-primary hover:text-accent-primary/70 flex-shrink-0">
                      {copied === 'address' ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                  <a href={SIGNET_FAUCET_URL} target="_blank" rel="noopener noreferrer" className="inline-flex mt-2">
                    <AnimatedButton variant="secondary" size="sm" className="rounded-lg">
                      <ExternalLink size={12} />
                      Open Signet Faucet
                    </AnimatedButton>
                  </a>
                </div>

                <div>
                  <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light flex items-center justify-between mb-2">
                    <span>2. Confirmed signet balance</span>
                    {utxosQuery.isFetching && <RefreshCw className="animate-spin text-text-secondary" size={11} />}
                  </label>
                  {confirmedUtxos.length === 0 ? (
                    <div className="rounded-lg border border-border-custom bg-surface/20 p-4 text-[10px] text-text-secondary">
                      No confirmed signet BTC yet — fund the address above from the faucet, then wait for a confirmation.
                      Checking every few seconds.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {confirmedUtxos.map((utxo) => (
                        <button
                          key={`${utxo.txid}:${utxo.vout}`}
                          type="button"
                          onClick={() => setSelectedUtxo(utxo)}
                          disabled={busy}
                          className={`w-full flex items-center justify-between rounded-lg border p-3 text-left transition-colors ${
                            selectedUtxo?.txid === utxo.txid && selectedUtxo?.vout === utxo.vout
                              ? 'border-accent-primary/60 bg-accent-primary/5'
                              : 'border-border-custom bg-surface/20 hover:border-border-custom/80'
                          }`}
                        >
                          <span className="text-xs font-mono text-text-primary">{formatSats(utxo.value)}</span>
                          <span className="text-[9px] text-text-secondary font-mono">{utxo.txid.slice(0, 10)}…:{utxo.vout}</span>
                        </button>
                      ))}
                      <p className="text-[9px] text-text-secondary/70 leading-relaxed">
                        This deposit template has no room for change — depositing spends the whole selected UTXO, minus a
                        small network fee.
                      </p>
                    </div>
                  )}
                </div>

                {selectedUtxo && (
                  <AnimatedButton
                    variant="primary"
                    onClick={handleAutoDeposit}
                    disabled={busy || feeRateQuery.data === undefined}
                    className="rounded-xl px-6"
                  >
                    {step === 'building' && <span className="flex items-center gap-1.5"><RefreshCw className="animate-spin" size={14} />Signing…</span>}
                    {step === 'broadcasting' && <span className="flex items-center gap-1.5"><RefreshCw className="animate-spin" size={14} />Broadcasting…</span>}
                    {step === 'submitting' && <span className="flex items-center gap-1.5"><RefreshCw className="animate-spin" size={14} />Submitting…</span>}
                    {!busy && 'Build, Sign & Broadcast Deposit'}
                  </AnimatedButton>
                )}
              </div>
            )}
          </GlassCard>
        )}

        {!depositId && (
          <div className="mb-6">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1.5 text-[10px] text-text-secondary hover:text-text-primary uppercase tracking-widest transition-colors"
            >
              {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              Advanced — use my own signet wallet instead
            </button>

            {showAdvanced && (
              <GlassCard className="overflow-hidden p-6 space-y-6 mt-3" hoverGlow={false}>
                <div>
                  <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light block mb-2">
                    Intended deposit amount (satoshis)
                  </label>
                  <div className="flex gap-3">
                    <input
                      type="number"
                      value={manualAmountSats}
                      onChange={(e) => setManualAmountSats(e.target.value)}
                      placeholder="150000"
                      disabled={!!preparedNote}
                      className="no-spinner flex-1 bg-surface/30 border border-border-custom rounded-lg px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-accent-primary/60 font-mono disabled:opacity-50"
                    />
                    <AnimatedButton
                      variant="primary"
                      onClick={preparedNote ? undefined : handlePrepareManual}
                      disabled={!!preparedNote || busy}
                      className="rounded-xl px-6 whitespace-nowrap"
                    >
                      {step === 'preparing' ? <RefreshCw className="animate-spin" size={14} /> : preparedNote ? 'Prepared' : 'Prepare'}
                    </AnimatedButton>
                  </div>
                </div>

                {preparedNote && ownerKeyHex && (
                  <div className="space-y-4 border-t border-border-custom/40 pt-6">
                    <div>
                      <p className="text-[10px] text-text-secondary uppercase tracking-widest font-light mb-2">
                        Construct and broadcast a signet transaction (1 input, empty scriptSig, exactly 2 outputs)
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
                          <div className="text-text-secondary mb-1">Output 1 — P2WPKH payment to the vault address ({manualAmountSats} sats):</div>
                          <div className="flex items-center gap-2">
                            <span className="text-text-primary break-all">{btcVaultPubkeyHash ?? 'not configured'}</span>
                            {btcVaultPubkeyHash && (
                              <button type="button" onClick={() => handleCopy(btcVaultPubkeyHash, 'vault')} className="text-accent-primary hover:text-accent-primary/70 flex-shrink-0">
                                {copied === 'vault' ? <CheckCircle2 size={12} /> : <Copy size={12} />}
                              </button>
                            )}
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
                        Confirmed transaction id
                      </label>
                      <div className="flex gap-3">
                        <input
                          type="text"
                          value={manualTxid}
                          onChange={(e) => setManualTxid(e.target.value)}
                          placeholder="64-character hex txid"
                          disabled={!!depositId}
                          className="flex-1 bg-surface/30 border border-border-custom rounded-lg px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-accent-primary/60 font-mono disabled:opacity-50"
                        />
                        <AnimatedButton
                          variant="secondary"
                          onClick={depositId ? undefined : handleSubmitManualTxid}
                          disabled={!!depositId || step === 'submitting'}
                          className="rounded-xl px-6 whitespace-nowrap"
                        >
                          {step === 'submitting' ? <RefreshCw className="animate-spin" size={14} /> : depositId ? 'Submitted' : 'Submit'}
                        </AnimatedButton>
                      </div>
                    </div>
                  </div>
                )}
              </GlassCard>
            )}
          </div>
        )}

        {/* Status + claim */}
        {depositId && (
          <GlassCard className="overflow-hidden p-6" hoverGlow={false}>
            <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light block mb-2">
              Proving status
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
          </GlassCard>
        )}
      </div>
    </div>
  );
}
