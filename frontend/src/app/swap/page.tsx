"use client";

import React, { useMemo, useState } from 'react';
import { formatUnits, hexToBytes, parseEventLogs, parseUnits } from 'viem';
import { useChainId, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '@/providers/app-provider';
import { useNoteWallet } from '@/lib/noteWallet/useNoteWallet';
import { getDeployment } from '@/lib/noteWallet/deployments';
import { SHIELDED_VAULT_ABI } from '@/lib/noteWallet/vaultAbi';
import { nullifierHash as computeNullifierHash, ownerKey as computeOwnerKey } from '@/lib/noteWallet/poseidon2';
import { provePlaceOrder, proveCancelOrder } from '@/lib/proving/prove';
import { submitOrderToMatcher, fetchMatcherOrders, fetchRate, fetchRecentMatches } from '@/lib/api';
import { ADD_CHAIN_PARAMS } from '@/lib/networkParams';
import { getErrorMessage } from '@/lib/utils';
import { encodeNoteMetadata, encodeOrderMetadata, OWNER_KEY_NOTE_SCHEME_ID, ORDER_SCHEME_ID, type AnnouncedOrder } from '@/lib/noteWallet/announcer';
import { encryptAnnouncement } from '@/lib/noteWallet/privacyKeys';
import { STEALTH_ANNOUNCER_ABI } from '@/lib/noteWallet/stealthAnnouncerAbi';
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
  UploadCloud,
  Inbox,
  History,
} from 'lucide-react';
import Link from 'next/link';

type Tab = 'place' | 'orders';
type AssetSymbol = 'C2FLR' | 'FXRP' | 'USDT0' | 'BTC';
type PlaceStep = 'idle' | 'proving' | 'submitting' | 'confirming' | 'finalized';

const COSTON2_CHAIN_ID = 114;
const ASSET_OPTIONS: { sym: AssetSymbol; name: string }[] = [
  { sym: 'C2FLR', name: 'Coston2 Flare (native)' },
  { sym: 'FXRP', name: 'FAssets XRP' },
  { sym: 'USDT0', name: 'Tether USD' },
  { sym: 'BTC', name: 'Bitcoin (signet)' },
];

const PLACE_TIMELINE = [
  { key: 'proving', label: 'Generate ZK Proof' },
  { key: 'submitting', label: 'Submit Order' },
  { key: 'confirming', label: 'Confirm On-Chain' },
  { key: 'finalized', label: 'Order Placed' },
] as const;

/** Coarse "Xm/Xh/Xd ago" — good enough for "how long has this been resting/how recently did this settle", not a precision clock. */
function timeAgo(ms: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  return `${Math.floor(diffHour / 24)}d ago`;
}

/** Symbol + decimals for an on-chain assetId, falling back to a raw label for anything outside the three known assets. */
function symbolFor(deployment: ReturnType<typeof getDeployment>, assetId: number | string): { sym: string; decimals: number } {
  const found = ASSET_OPTIONS.find((a) => deployment?.assets[a.sym]?.assetId === Number(assetId));
  return { sym: found?.sym ?? `asset ${assetId}`, decimals: found ? (deployment?.assets[found.sym]?.decimals ?? 18) : 18 };
}

/**
 * One row in "My Orders" — its own component (not inlined in a .map) because
 * it needs its own live-rate query: different open orders can each be a
 * different asset pair, so one page-level rate query can't cover all of
 * them. React Query dedupes by key, so orders sharing a pair only cost one
 * real request regardless of how many rows ask for it.
 */
function OrderRow({
  order,
  deployment,
  matcherStatusKnown,
  isOnMatcherBook,
  resubmittingId,
  cancelingId,
  onResubmit,
  onCancel,
}: {
  order: StoredOrderNote;
  deployment: ReturnType<typeof getDeployment>;
  matcherStatusKnown: boolean;
  isOnMatcherBook: boolean;
  resubmittingId: string | null;
  cancelingId: string | null;
  onResubmit: (order: StoredOrderNote) => void;
  onCancel: (order: StoredOrderNote) => void;
}) {
  const { sym: assetInSym, decimals: inDecimals } = symbolFor(deployment, order.assetId);
  const { sym: assetOutSym, decimals: outDecimals } = symbolFor(deployment, order.assetOut);
  const original = BigInt(order.originalAmountIn);
  const remaining = BigInt(order.amount);
  const filled = original - remaining;
  const isPartiallyFilled = filled > BigInt(0);

  const rateQuery = useQuery({
    queryKey: ['rate', assetInSym, assetOutSym],
    queryFn: () => fetchRate(assetInSym, assetOutSym),
    enabled: assetInSym !== assetOutSym && !assetInSym.startsWith('asset '),
    refetchInterval: 30_000,
  });

  // Cheap arithmetic on values already fresh this render — not worth a
  // useMemo (and mixing locally-derived bigints/props in its deps is exactly
  // what trips react-hooks/preserve-manual-memoization for no real benefit).
  const impliedPctVsMarket = (() => {
    if (!rateQuery.data) return null;
    const remainingHuman = Number(formatUnits(remaining, inDecimals));
    const minOutHuman = Number(formatUnits(BigInt(order.minAmountOut), outDecimals));
    if (!remainingHuman || !minOutHuman) return null;
    const impliedRate = minOutHuman / remainingHuman;
    return ((impliedRate - rateQuery.data.rate) / rateQuery.data.rate) * 100;
  })();

  return (
    <div className="flex items-center justify-between p-4 rounded-lg border border-border-custom bg-surface/20">
      <div>
        <span className="text-xs font-mono font-bold text-text-primary block">
          {formatUnits(remaining, inDecimals)} {assetInSym} → min {formatUnits(BigInt(order.minAmountOut), outDecimals)} {assetOutSym}
        </span>
        {isPartiallyFilled ? (
          <span className="text-[9px] text-accent-primary block">
            {formatUnits(filled, inDecimals)} / {formatUnits(original, inDecimals)} {assetInSym} filled — rest still open
          </span>
        ) : (
          <span className="text-[9px] text-text-secondary block">Resting since {timeAgo(order.createdAt)} — order #{order.derivationIndex}</span>
        )}
        {matcherStatusKnown && isOnMatcherBook && (
          <span className="flex items-center gap-1 text-[9px] text-success-state mt-0.5">
            <CheckCircle2 size={9} /> Live on matcher&apos;s order book
          </span>
        )}
        {rateQuery.data && impliedPctVsMarket !== null && (
          <span
            className={`block text-[9px] mt-0.5 ${
              impliedPctVsMarket > 0.5 ? 'text-accent-secondary' : impliedPctVsMarket < -0.5 ? 'text-success-state' : 'text-text-secondary'
            }`}
          >
            {impliedPctVsMarket > 0.5
              ? `${impliedPctVsMarket.toFixed(1)}% above market — this is likely why it hasn't matched`
              : impliedPctVsMarket < -0.5
                ? `${Math.abs(impliedPctVsMarket).toFixed(1)}% below market — should match soon`
                : 'Priced at market'}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {matcherStatusKnown && !isOnMatcherBook && (
          <AnimatedButton
            variant="secondary"
            size="sm"
            onClick={() => onResubmit(order)}
            disabled={resubmittingId === order.id}
            title="Not currently found on the matcher's order book — hand it your order details again so it can be matched."
          >
            {resubmittingId === order.id ? (
              <span className="flex items-center gap-1.5">
                <RefreshCw size={12} className="animate-spin" /> Resubmitting...
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <UploadCloud size={12} /> Resubmit
              </span>
            )}
          </AnimatedButton>
        )}
        <AnimatedButton variant="secondary" size="sm" onClick={() => onCancel(order)} disabled={cancelingId === order.id}>
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
    </div>
  );
}

export default function DarkPoolPage() {
  const { isEntered, isWalletConnected, walletAddress, connectWallet, addNotification } = useApp();
  const queryClient = useQueryClient();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const deployment = useMemo(() => getDeployment(chainId), [chainId]);
  const vaultAddress = deployment?.vault;
  const announcerAddress = deployment?.stealthAnnouncer;
  const noteWallet = useNoteWallet(vaultAddress, deployment?.deployBlock !== undefined ? BigInt(deployment.deployBlock) : undefined);
  const onCoston2 = chainId === COSTON2_CHAIN_ID;

  const [activeTab, setActiveTab] = useState<Tab>('place');
  const [assetIn, setAssetIn] = useState<AssetSymbol>('C2FLR');
  const [assetOut, setAssetOut] = useState<AssetSymbol>('FXRP');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  // What the trader typed while in manual-price mode — ignored entirely
  // while `useBestPrice` is on.
  const [minAmountOutRaw, setMinAmountOutRaw] = useState('');
  // Default on: fills at (a shade under) the live rate with no pricing
  // decision required at all. Switching off reveals a manual minimum, for
  // anyone who actually wants a specific limit price.
  const [useBestPrice, setUseBestPrice] = useState(true);
  const [step, setStep] = useState<PlaceStep>('idle');
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [resubmittingId, setResubmittingId] = useState<string | null>(null);
  const [claimingCommitment, setClaimingCommitment] = useState<bigint | null>(null);

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

  const selectedNote = useMemo(
    () => spendableNotes.find((n) => n.id === selectedNoteId),
    [spendableNotes, selectedNoteId]
  );

  // Same live rate the backend's own fill sizing uses — without this, a
  // trader has no way to know a minimum like "2 XRP per USDT" is double the
  // real rate and will just sit unfilled forever. Kept fresh with a light
  // poll since the fair rate moves continuously.
  const rateQuery = useQuery({
    queryKey: ['rate', assetIn, assetOut],
    queryFn: () => fetchRate(assetIn, assetOut),
    enabled: assetIn !== assetOut,
    refetchInterval: 20_000,
  });

  // A fresh note/assetOut pairing defaults back to best-price mode, even if
  // the trader had switched to manual for a previous selection — a manual
  // price typed for a different note's amount wouldn't mean anything here.
  // Adjusted directly during render (React's documented pattern for "reset
  // state when a key changes") rather than in an effect, which would cost an
  // extra render and trip react-hooks/set-state-in-effect for no benefit.
  const selectionKey = `${selectedNoteId ?? ''}:${assetOut}`;
  const [lastSelectionKey, setLastSelectionKey] = useState(selectionKey);
  if (selectionKey !== lastSelectionKey) {
    setLastSelectionKey(selectionKey);
    if (!useBestPrice) setUseBestPrice(true);
  }

  // 1% under the live rate — an order priced slightly below fair value is one
  // that actually gets filled quickly, unlike one priced above market (or, as
  // happened before this existed, priced at double the real rate) which just
  // sits unmatched indefinitely. Purely derived, so best-price mode always
  // tracks the live rate as it refreshes with no effect needed.
  const suggestedMinAmountOut = useMemo(() => {
    if (!selectedNote || !assetInConfig || !assetOutConfig || !rateQuery.data) return '';
    const amountInHuman = Number(formatUnits(BigInt(selectedNote.amount), assetInConfig.decimals));
    const suggested = amountInHuman * rateQuery.data.rate * 0.99;
    return suggested.toFixed(Math.min(assetOutConfig.decimals, 6));
  }, [selectedNote, assetInConfig, assetOutConfig, rateQuery.data]);

  const minAmountOut = useBestPrice ? suggestedMinAmountOut : minAmountOutRaw;

  // How far the currently-entered minimum sits from the live rate, as a
  // percentage — positive means asking for more than fair (may not fill),
  // negative means offering a discount (fills easily).
  const impliedPctVsMarket = useMemo(() => {
    if (!rateQuery.data || !selectedNote || !assetInConfig) return null;
    const amountInHuman = Number(formatUnits(BigInt(selectedNote.amount), assetInConfig.decimals));
    const minOutHuman = Number(minAmountOut);
    if (!amountInHuman || !minOutHuman || Number.isNaN(minOutHuman)) return null;
    const impliedRate = minOutHuman / amountInHuman;
    return ((impliedRate - rateQuery.data.rate) / rateQuery.data.rate) * 100;
  }, [rateQuery.data, selectedNote, assetInConfig, minAmountOut]);

  const openOrders = useMemo(
    () => (notesQuery.data ?? []).filter((n): n is StoredOrderNote => n.kind === 'order'),
    [notesQuery.data]
  );

  // The matcher's book is in-memory on the backend with no persistence — an
  // order can silently fall out of it (backend restart/redeploy, or being
  // unreachable at submission time) while staying perfectly valid and
  // unspent on-chain. Polled while "My Orders" is open so a dropped order's
  // "Resubmit" action shows up without needing a manual refresh.
  const matcherOrdersQuery = useQuery({
    queryKey: ['matcherOrders'],
    queryFn: fetchMatcherOrders,
    enabled: activeTab === 'orders' && openOrders.length > 0,
    refetchInterval: 15_000,
  });

  // Commitments are stored locally zero-padded to 64 hex chars but rest on
  // the matcher's book as `"0x" + value.toString(16)` (no padding) — compare
  // by numeric value, not string, so a real match isn't missed over formatting.
  const matcherCommitments = useMemo(
    () => new Set((matcherOrdersQuery.data ?? []).map((o) => BigInt(o.commitment).toString())),
    [matcherOrdersQuery.data]
  );

  // A partial fill's leftover arrives as a residual order announced to this
  // wallet (same StealthAnnouncer delivery a payment uses, different scheme
  // id — see announcer.ts) — not yet a spendable local note until claimed.
  const incomingOrdersQuery = useQuery({
    queryKey: ['incomingOrderAnnouncements', chainId, walletAddress],
    queryFn: () => noteWallet.scanIncomingOrders(announcerAddress!),
    enabled: !!announcerAddress && !!walletAddress && activeTab === 'orders',
  });

  // Network-wide settled matches (commitments/amounts never exposed — same
  // privacy boundary as the rest of this matcher) shown while idle, as the
  // only positive proof anywhere in the UI that matching is actually real —
  // otherwise the only feedback a trader ever gets is their own balance
  // quietly changing on Portfolio.
  const recentMatchesQuery = useQuery({
    queryKey: ['recentMatches'],
    queryFn: fetchRecentMatches,
    enabled: step === 'idle',
    refetchInterval: 20_000,
  });

  const recentSettled = useMemo(
    () =>
      (recentMatchesQuery.data ?? [])
        .filter((m) => m.status === 'settled')
        .sort((a, b) => b.matchedAt - a.matchedAt)
        .slice(0, 5),
    [recentMatchesQuery.data]
  );

  const handlePlaceOrder = async () => {
    if (!walletAddress || !publicClient || !deployment || !assetInConfig || !assetOutConfig || !vaultAddress) return;
    const note = selectedNote;
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

      // Self-announce the order — otherwise it exists only in this
      // browser's local IndexedDB, with no way to find it again from a
      // different device (unlike everything else here, which is already
      // recoverable by scanning the chain: incoming payments, matched
      // proceeds, residual orders). Best-effort: the order is already
      // fully placed and valid on-chain regardless of whether this succeeds.
      // Encrypted to this wallet's own privacy key (always known locally, no
      // registry lookup needed since sender and recipient are the same
      // wallet) — see privacyKeys.ts. stealthAddress stays the real address:
      // this trader's identity is already public via the placeOrder tx
      // above, so there's no counterparty to hide.
      if (announcerAddress) {
        try {
          const selfOrderMetadata = encodeOrderMetadata({
            assetIn: assetInId,
            assetOut: assetOutId,
            amountIn,
            minAmountOut: minOutBaseUnits,
            blinding: orderPrepared.blinding,
            commitment: orderPrepared.commitment,
            originalAmountIn: amountIn,
          });
          const { publicKey: ownPrivacyPubKey } = await noteWallet.getPrivacyKeyPair();
          const encrypted = encryptAnnouncement(ownPrivacyPubKey, hexToBytes(selfOrderMetadata));
          const selfAnnounceHash = await writeContractAsync({
            address: announcerAddress,
            abi: STEALTH_ANNOUNCER_ABI,
            functionName: 'announce',
            args: [ORDER_SCHEME_ID, walletAddress as `0x${string}`, encrypted.ephemeralPubKey, encrypted.metadata],
          });
          await publicClient.waitForTransactionReceipt({ hash: selfAnnounceHash });
        } catch {
          // Not fatal — the order is already placed. It just won't be
          // recoverable from a different device until resubmitted from
          // this one.
        }
      }

      setLastTxHash(hash);
      setStep('finalized');
      setSelectedNoteId(null);
      setMinAmountOutRaw('');
      setUseBestPrice(true);
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
        addNotification(
          'Order Placed',
          `Selling ${formatUnits(amountIn, assetInConfig.decimals)} ${assetIn} for at least ${formatUnits(minOutBaseUnits, assetOutConfig.decimals)} ${assetOut} — live and waiting to be matched.`,
          'success',
          hash
        );
      } catch {
        addNotification(
          'Order Placed',
          `${formatUnits(amountIn, assetInConfig.decimals)} ${assetIn} order is on-chain, but the matcher could not be reached — it will need to be resubmitted for matching.`,
          'error',
          hash
        );
      }
    } catch (err) {
      const message = getErrorMessage(err, 'Placing the order failed.');
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

      // Self-announce the refund note — same reasoning and same encryption
      // (to this wallet's own key) as the order self-announce above.
      // Best-effort: the refund is already valid on-chain regardless of
      // whether this succeeds.
      if (announcerAddress) {
        try {
          const refundMetadata = encodeNoteMetadata({
            assetId: assetInId,
            amount: amountIn,
            blinding: refundPrepared.blinding,
            commitment: refundPrepared.commitment,
          });
          const { publicKey: ownPrivacyPubKey } = await noteWallet.getPrivacyKeyPair();
          const encrypted = encryptAnnouncement(ownPrivacyPubKey, hexToBytes(refundMetadata));
          const selfAnnounceHash = await writeContractAsync({
            address: announcerAddress,
            abi: STEALTH_ANNOUNCER_ABI,
            functionName: 'announce',
            args: [OWNER_KEY_NOTE_SCHEME_ID, walletAddress as `0x${string}`, encrypted.ephemeralPubKey, encrypted.metadata],
          });
          await publicClient.waitForTransactionReceipt({ hash: selfAnnounceHash });
        } catch {
          // Not fatal — the refund note is already valid on-chain. It just
          // won't be recoverable from a different device until this one
          // re-syncs its local store.
        }
      }

      queryClient.invalidateQueries({ queryKey: ['unspentNotes', walletAddress] });
      const { sym: refundSym, decimals: refundDecimals } = symbolFor(deployment, order.assetId);
      addNotification(
        'Order Cancelled',
        `${formatUnits(amountIn, refundDecimals)} ${refundSym} refunded as a fresh shielded note.`,
        'success',
        hash
      );
    } catch (err) {
      const message = getErrorMessage(err, 'Cancelling the order failed.');
      addNotification('Cancel Failed', message, 'error');
    } finally {
      setCancelingId(null);
    }
  };

  /**
   * Re-hands an already-on-chain order's private details to the matcher —
   * the same call handlePlaceOrder makes right after placeOrder(), for an
   * order that's since fallen out of the matcher's in-memory book (a
   * backend restart/redeploy, or the matcher being unreachable the first
   * time). The order itself never left the chain — this only affects
   * whether the matcher currently knows to try matching it.
   */
  const handleResubmitOrder = async (order: StoredOrderNote) => {
    if (!walletAddress) return;
    setResubmittingId(order.id);
    try {
      const spendingKey = await noteWallet.getSpendingKey();
      const result = await submitOrderToMatcher({
        commitment: order.commitment,
        leafIndex: order.leafIndex!,
        spendingKey: spendingKey.toString(),
        orderBlinding: order.blinding,
        amountIn: order.amount,
        assetIn: Number(order.assetId),
        assetOut: Number(order.assetOut),
        minAmountOut: order.minAmountOut,
        ownerKey: computeOwnerKey(spendingKey).toString(),
        walletAddress,
      });
      const { sym: resubmitSym, decimals: resubmitDecimals } = symbolFor(deployment, order.assetId);
      const resubmitAmount = `${formatUnits(BigInt(order.amount), resubmitDecimals)} ${resubmitSym}`;
      if (result.status === 'already_settled') {
        // This order's nullifier is already spent on-chain — it matched and
        // settled in a matcher process that no longer remembers it (e.g. a
        // backend restart), so there's nothing left to resubmit. Sync local
        // state instead of leaving a stale "open" order in the list.
        await noteWallet.refreshSpentStatus();
        queryClient.invalidateQueries({ queryKey: ['unspentNotes', walletAddress] });
        addNotification('Already Settled', `Your ${resubmitAmount} order already matched and settled — check your notes for the proceeds.`, 'success');
      } else {
        queryClient.invalidateQueries({ queryKey: ['matcherOrders'] });
        addNotification('Order Resubmitted', `Your ${resubmitAmount} order is back on the matcher's book.`, 'success');
      }
    } catch (err) {
      const message = getErrorMessage(err, 'Resubmitting the order failed.');
      addNotification('Resubmit Failed', message, 'error');
    } finally {
      setResubmittingId(null);
    }
  };

  /** Saves a partial fill's announced residual as a spendable local order — after this it behaves exactly like any other entry in "My Orders" (matchable, cancellable). */
  const handleClaimOrder = async (candidate: AnnouncedOrder) => {
    setClaimingCommitment(candidate.commitment);
    try {
      await noteWallet.claimIncomingOrder(candidate);
      queryClient.invalidateQueries({ queryKey: ['unspentNotes', walletAddress] });
      queryClient.invalidateQueries({ queryKey: ['incomingOrderAnnouncements', chainId, walletAddress] });
      const { sym: claimedSym, decimals: claimedDecimals } = symbolFor(deployment, Number(candidate.assetIn));
      addNotification(
        'Order Claimed',
        `${formatUnits(candidate.amountIn, claimedDecimals)} ${claimedSym} residual saved to your open orders.`,
        'success'
      );
    } catch (err) {
      const message = getErrorMessage(err, 'Claim failed.');
      addNotification('Claim Failed', message, 'error');
    } finally {
      setClaimingCommitment(null);
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
                    <div className="grid grid-cols-4 gap-3">
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
                    <div className="grid grid-cols-4 gap-3">
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
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[10px] text-text-secondary uppercase tracking-widest font-light">Minimum Acceptable Amount</label>
                      <label className="flex items-center gap-1.5 text-[9px] text-text-secondary uppercase tracking-wider cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={useBestPrice}
                          onChange={(e) => {
                            if (!e.target.checked) setMinAmountOutRaw(suggestedMinAmountOut);
                            setUseBestPrice(e.target.checked);
                          }}
                          className="accent-accent-primary cursor-pointer"
                        />
                        Best available price
                      </label>
                    </div>
                    {useBestPrice ? (
                      <div className="w-full bg-surface/20 border border-dashed border-border-custom rounded-lg px-4 py-3 text-sm text-text-primary font-mono flex items-center justify-between">
                        <span>{minAmountOut || '—'} {assetOut}</span>
                        <span className="text-[9px] text-text-secondary uppercase tracking-wider">Updates with the live rate</span>
                      </div>
                    ) : (
                      <div className="relative">
                        <input
                          type="number"
                          value={minAmountOut}
                          onChange={(e) => setMinAmountOutRaw(e.target.value)}
                          placeholder="0.00"
                          className="no-spinner w-full bg-surface/30 border border-border-custom rounded-lg pl-4 pr-20 py-3 text-sm text-text-primary focus:outline-none focus:border-accent-primary/60 font-mono"
                          required
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-xs text-text-secondary font-bold font-mono">{assetOut}</span>
                      </div>
                    )}
                    {rateQuery.data && (
                      <p className="text-[9px] text-text-secondary mt-1.5 leading-relaxed">
                        Live rate: 1 {assetIn} ≈ {rateQuery.data.rate.toFixed(6)} {assetOut}
                        {impliedPctVsMarket !== null && (
                          <span
                            className={
                              impliedPctVsMarket > 0.5
                                ? ' text-accent-secondary'
                                : impliedPctVsMarket < -0.5
                                  ? ' text-success-state'
                                  : ' text-text-secondary'
                            }
                          >
                            {' — your minimum is '}
                            {impliedPctVsMarket > 0.5
                              ? `${impliedPctVsMarket.toFixed(1)}% above market (may sit unfilled a while)`
                              : impliedPctVsMarket < -0.5
                                ? `${Math.abs(impliedPctVsMarket).toFixed(1)}% below market (should fill quickly)`
                                : 'at market'}
                          </span>
                        )}
                      </p>
                    )}
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
                  {incomingOrdersQuery.data && incomingOrdersQuery.data.length > 0 && (
                    <div className="space-y-2 pb-3 mb-3 border-b border-border-custom/40">
                      <div className="flex items-center gap-1.5 text-[10px] text-accent-secondary uppercase tracking-widest">
                        <Inbox size={11} /> Unclaimed residual orders
                      </div>
                      {incomingOrdersQuery.data.map((candidate) => {
                        const inSym = ASSET_OPTIONS.find((a) => deployment?.assets[a.sym]?.assetId === Number(candidate.assetIn))?.sym ?? `asset ${candidate.assetIn}`;
                        const outSym = ASSET_OPTIONS.find((a) => deployment?.assets[a.sym]?.assetId === Number(candidate.assetOut))?.sym ?? `asset ${candidate.assetOut}`;
                        const inDecimals = deployment?.assets[inSym as AssetSymbol]?.decimals ?? 18;
                        return (
                          <div
                            key={candidate.commitment.toString()}
                            className="flex items-center justify-between p-3 rounded-lg border border-accent-secondary/30 bg-accent-secondary/5"
                          >
                            <div>
                              <span className="text-[9px] text-text-secondary uppercase tracking-wide block">Leftover from a partial fill</span>
                              <span className="text-xs font-mono font-bold text-text-primary">
                                {formatUnits(candidate.amountIn, inDecimals)} {inSym} → {outSym}
                              </span>
                            </div>
                            <AnimatedButton
                              variant="primary"
                              size="sm"
                              onClick={() => handleClaimOrder(candidate)}
                              disabled={claimingCommitment === candidate.commitment}
                            >
                              {claimingCommitment === candidate.commitment ? 'Claiming...' : 'Claim'}
                            </AnimatedButton>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {openOrders.length === 0 ? (
                    <div className="rounded-lg border border-border-custom bg-surface/20 p-6 text-center">
                      <p className="text-[10px] text-text-secondary leading-relaxed">
                        No open orders. Place one from the &quot;Place Order&quot; tab.
                      </p>
                    </div>
                  ) : (
                    openOrders.map((order) => {
                      // Only trust a "not on the book" verdict once the query has
                      // actually resolved at least once — otherwise every order
                      // would flash a Resubmit button before we truly know.
                      const matcherStatusKnown = matcherOrdersQuery.data !== undefined;
                      const isOnMatcherBook = matcherCommitments.has(BigInt(order.commitment).toString());
                      return (
                        <OrderRow
                          key={order.id}
                          order={order}
                          deployment={deployment}
                          matcherStatusKnown={matcherStatusKnown}
                          isOnMatcherBook={isOnMatcherBook}
                          resubmittingId={resubmittingId}
                          cancelingId={cancelingId}
                          onResubmit={handleResubmitOrder}
                          onCancel={handleCancelOrder}
                        />
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
                    {step === 'idle' ? <History size={16} className="text-accent-primary" /> : <Clock size={16} className="text-accent-primary" />}
                    <h2 className="text-sm uppercase tracking-wider font-display font-bold">
                      {step === 'idle' ? 'Recent Matches' : 'Execution Timeline'}
                    </h2>
                  </div>

                  {step === 'idle' ? (
                    recentSettled.length > 0 ? (
                      <div className="space-y-3">
                        <p className="text-[9px] text-text-secondary/70 uppercase tracking-widest">
                          Network-wide — proof matching genuinely settles on-chain
                        </p>
                        {recentSettled.map((m) => (
                          <a
                            key={m.id}
                            href={m.txHash ? `https://coston2-explorer.flare.network/tx/${m.txHash}` : undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`flex items-center justify-between p-3 rounded-lg border border-border-custom bg-surface/20 ${m.txHash ? 'hover:border-accent-primary/40' : 'pointer-events-none'}`}
                          >
                            <span className="flex items-center gap-2 text-xs text-text-primary">
                              <CheckCircle2 size={13} className="text-success-state" /> Match settled
                            </span>
                            <span className="flex items-center gap-1 text-[9px] text-text-secondary font-mono">
                              {timeAgo(m.matchedAt)} <ChevronRight size={10} />
                            </span>
                          </a>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-10 text-center text-text-secondary">
                        <ShieldCheck size={36} className="text-border-custom mb-3" />
                        <span className="text-xs uppercase tracking-widest">Awaiting execution</span>
                        <p className="text-[10px] text-text-secondary/60 mt-1 max-w-[200px] leading-relaxed">
                          {recentMatchesQuery.isLoading
                            ? 'Checking recent network activity...'
                            : 'No matches settled recently. Submit the form to place a hidden order on Coston2.'}
                        </p>
                      </div>
                    )
                  ) : (
                    <div className="relative pl-6 space-y-6">
                      <div className="absolute left-2.5 top-2 bottom-2 w-0.5 bg-border-custom z-0" />
                      {PLACE_TIMELINE.map((t, idx) => {
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
