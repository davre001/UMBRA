"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { erc20Abi, formatUnits } from 'viem';
import { useChainId, usePublicClient } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '@/providers/app-provider';
import { useNoteWallet } from '@/lib/noteWallet/useNoteWallet';
import { getDeployment } from '@/lib/noteWallet/deployments';
import { COMPLIANCE_REGISTRY_ABI } from '@/lib/noteWallet/complianceRegistryAbi';
import type { StoredOrderNote } from '@/lib/noteWallet/store';
import { Navbar } from '@/components/shared/navbar';
import { tokenIcon } from '@/lib/icons';
import { GlassCard } from '@/components/ui/glass-card';
import { AnimatedButton } from '@/components/ui/animated-button';
import {
  ShieldCheck,
  ShieldAlert,
  ListOrdered,
  Lock,
  Wallet,
  ArrowRight,
  Eye,
  EyeOff,
} from 'lucide-react';
import Link from 'next/link';

type AssetSymbol = 'C2FLR' | 'FXRP' | 'USDT0' | 'BTC';
const ASSET_OPTIONS: AssetSymbol[] = ['C2FLR', 'FXRP', 'USDT0', 'BTC'];

const ASSET_ICONS: Record<AssetSymbol, string> = { C2FLR: 'FLR', FXRP: 'XRP', USDT0: 'USDT', BTC: 'BTC' };
const BALANCE_VISIBILITY_STORAGE_KEY = 'umbra:portfolio-balances-visible';

export default function Portfolio() {
  const { isEntered, isWalletConnected, walletAddress, connectWallet } = useApp();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const deployment = useMemo(() => getDeployment(chainId), [chainId]);
  const vaultAddress = deployment?.vault;
  const noteWallet = useNoteWallet(vaultAddress, deployment?.deployBlock !== undefined ? BigInt(deployment.deployBlock) : undefined);
  const [areBalancesVisible, setAreBalancesVisible] = useState(true);

  useEffect(() => {
    try {
      const storedPreference = localStorage.getItem(BALANCE_VISIBILITY_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (storedPreference !== null) setAreBalancesVisible(storedPreference === 'true');
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
  }, []);

  const toggleBalanceVisibility = () => {
    const nextVisibility = !areBalancesVisible;
    setAreBalancesVisible(nextVisibility);
    try {
      localStorage.setItem(BALANCE_VISIBILITY_STORAGE_KEY, String(nextVisibility));
    } catch {
      // Keep the toggle functional for this session even if persistence fails.
    }
  };

  const publicBalancesQuery = useQuery({
    queryKey: ['portfolioPublicBalances', chainId, walletAddress],
    queryFn: async () => {
      const entries = await Promise.all(
        // BTC is now ordinary allowlisted collateral (real WrappedBTC,
        // minted directly to the depositor's public balance — see
        // ShieldedVault.sol's depositExternal) with a real `token` entry,
        // same as FXRP/USDT0 — the `external` flag stays in AssetConfig
        // for a hypothetical future chain with no real EVM-side
        // collateral, but nothing currently sets it.
        ASSET_OPTIONS.filter((sym) => !deployment!.assets[sym].external).map(async (sym) => {
          const cfg = deployment!.assets[sym];
          const balance = cfg.native
            ? await publicClient!.getBalance({ address: walletAddress as `0x${string}` })
            : await publicClient!.readContract({
                address: cfg.token as `0x${string}`,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [walletAddress as `0x${string}`],
              });
          return [sym, balance] as const;
        })
      );
      return Object.fromEntries(entries) as Record<AssetSymbol, bigint>;
    },
    enabled: !!publicClient && !!deployment && !!walletAddress,
  });

  const notesQuery = useQuery({
    queryKey: ['unspentNotes', walletAddress],
    queryFn: () => noteWallet.listUnspentNotes(),
    enabled: !!walletAddress,
  });

  const shieldedBalances = useMemo(() => {
    const totals: Record<AssetSymbol, bigint> = { C2FLR: BigInt(0), FXRP: BigInt(0), USDT0: BigInt(0), BTC: BigInt(0) };
    if (!notesQuery.data || !deployment) return totals;
    for (const note of notesQuery.data) {
      if (note.kind !== 'note') continue;
      const sym = ASSET_OPTIONS.find((s) => String(deployment.assets[s].assetId) === note.assetId);
      if (sym) totals[sym] += BigInt(note.amount);
    }
    return totals;
  }, [notesQuery.data, deployment]);

  const openOrders = useMemo(
    () => (notesQuery.data ?? []).filter((n): n is StoredOrderNote => n.kind === 'order'),
    [notesQuery.data]
  );

  const complianceQuery = useQuery({
    queryKey: ['isScreened', chainId, walletAddress],
    queryFn: () =>
      publicClient!.readContract({
        address: deployment!.compliance,
        abi: COMPLIANCE_REGISTRY_ABI,
        functionName: 'isScreened',
        args: [walletAddress as `0x${string}`],
      }),
    enabled: !!publicClient && !!deployment && !!walletAddress,
  });

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

  const unspentNoteCount = (notesQuery.data ?? []).filter((n) => n.kind === 'note').length;

  return (
    <div className="flex min-h-screen flex-col pt-16 z-10 relative">
      <Navbar />

      <div className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold tracking-tight text-text-primary font-display uppercase">
            Shielded Portfolio
          </h1>
          <p className="text-text-secondary text-xs font-light mt-1 tracking-wider uppercase">
            Public and shielded balances on Coston2 — from your own connected wallet and local notes
          </p>
        </div>

        {!isWalletConnected ? (
          <GlassCard className="p-10 flex flex-col items-center text-center" hoverGlow={false}>
            <Wallet size={36} className="text-border-custom mb-3" />
            <span className="text-xs uppercase tracking-widest text-text-secondary">Wallet not connected</span>
            <p className="text-[10px] text-text-secondary/60 mt-1 max-w-sm mb-6 leading-relaxed">
              Connect a wallet to load your public and shielded balances.
            </p>
            <AnimatedButton variant="primary" onClick={connectWallet}>Connect Wallet</AnimatedButton>
          </GlassCard>
        ) : (
          <>
            {/* Metrics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <GlassCard hoverGlow={false} className="p-5">
                <span className="text-[10px] text-text-secondary uppercase tracking-widest font-light block">Shielded Notes</span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold tracking-tight text-accent-secondary font-display">
                    {notesQuery.isLoading ? '—' : unspentNoteCount}
                  </span>
                </div>
                <span className="text-[10px] text-text-secondary mt-1 block">Unspent, in this browser</span>
              </GlassCard>

              <GlassCard hoverGlow={false} className="p-5">
                <span className="text-[10px] text-text-secondary uppercase tracking-widest font-light block">Open Dark-Pool Orders</span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold tracking-tight font-display">
                    {notesQuery.isLoading ? '—' : openOrders.length}
                  </span>
                </div>
                <span className="text-[10px] text-text-secondary mt-1 block">Waiting to be matched or cancelled</span>
              </GlassCard>

              <GlassCard hoverGlow={true} glowColor={complianceQuery.data ? 'cyan' : 'purple'} className="p-5">
                <span className="text-[10px] text-text-secondary uppercase tracking-widest font-light block">Compliance Status</span>
                <div className="mt-2 flex items-center gap-2">
                  {complianceQuery.data ? (
                    <ShieldCheck size={18} className="text-success-state" />
                  ) : (
                    <ShieldAlert size={18} className="text-accent-secondary" />
                  )}
                  <span className={`text-sm font-bold font-display ${complianceQuery.data ? 'text-success-state' : 'text-accent-secondary'}`}>
                    {complianceQuery.isLoading ? '—' : complianceQuery.data ? 'Screened Clear' : 'Not Screened'}
                  </span>
                </div>
                <span className="text-[10px] text-text-secondary mt-1 block">Required to receive a public withdrawal</span>
              </GlassCard>
            </div>

            {/* Balances table */}
            <GlassCard className="p-6 mb-6" hoverGlow={false}>
              <div className="flex items-center justify-between border-b border-border-custom pb-4 mb-4">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm uppercase tracking-wider font-display font-bold">Asset Balances</h2>
                  <button
                    type="button"
                    onClick={toggleBalanceVisibility}
                    aria-label={areBalancesVisible ? 'Hide asset balances' : 'Show asset balances'}
                    aria-pressed={!areBalancesVisible}
                    title={areBalancesVisible ? 'Hide asset balances' : 'Show asset balances'}
                    className="rounded-md p-1 text-text-secondary transition-colors hover:bg-surface/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary cursor-pointer"
                  >
                    {areBalancesVisible ? <Eye size={15} /> : <EyeOff size={15} />}
                  </button>
                </div>
                <span className="text-[10px] text-text-secondary font-mono">Flare Coston2 Testnet</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border-custom/50 text-[10px] text-text-secondary uppercase tracking-wider">
                      <th className="py-2 font-normal">Asset</th>
                      <th className="py-2 font-normal text-right">Public</th>
                      <th className="py-2 font-normal text-right">Shielded</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-custom/30 text-xs">
                    {ASSET_OPTIONS.map((sym) => {
                      const cfg = deployment?.assets[sym];
                      const publicBalance = publicBalancesQuery.data?.[sym];
                      const shieldedBalance = shieldedBalances[sym];
                      return (
                        <tr key={sym}>
                          <td className="py-3 flex items-center gap-2">
                            <img src={tokenIcon(ASSET_ICONS[sym])} alt="" className="h-5 w-5 flex-shrink-0" />
                            <span className="font-semibold">{sym}</span>
                          </td>
                          <td className="py-3 text-right font-mono font-medium">
                            <span className={`inline-block transition-[filter] duration-200 ${areBalancesVisible ? '' : 'select-none blur-sm'}`}>
                            {publicBalance !== undefined && cfg
                              ? Number(formatUnits(publicBalance, cfg.decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 })
                              : '—'}
                            </span>
                          </td>
                          <td className="py-3 text-right font-mono font-medium text-accent-secondary">
                            <span className={`inline-block transition-[filter] duration-200 ${areBalancesVisible ? '' : 'select-none blur-sm'}`}>
                            {cfg
                              ? Number(formatUnits(shieldedBalance, cfg.decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 })
                              : '—'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </GlassCard>

            {/* Open orders summary */}
            <GlassCard className="p-6" hoverGlow={false}>
              <div className="flex items-center justify-between border-b border-border-custom pb-4 mb-4">
                <div className="flex items-center gap-2">
                  <ListOrdered size={16} className="text-accent-secondary" />
                  <h2 className="text-sm uppercase tracking-wider font-display font-bold">Open Dark-Pool Orders</h2>
                </div>
                <Link href="/swap" className="text-[10px] text-accent-primary hover:underline flex items-center gap-1">
                  Manage <ArrowRight size={10} />
                </Link>
              </div>
              {openOrders.length === 0 ? (
                <p className="text-[10px] text-text-secondary text-center py-4">No open orders.</p>
              ) : (
                <div className="space-y-2">
                  {openOrders.map((order) => {
                    const inSym = ASSET_OPTIONS.find((s) => String(deployment?.assets[s]?.assetId) === order.assetId);
                    const outSym = ASSET_OPTIONS.find((s) => String(deployment?.assets[s]?.assetId) === order.assetOut);
                    const inDecimals = inSym ? deployment?.assets[inSym]?.decimals ?? 18 : 18;
                    const outDecimals = outSym ? deployment?.assets[outSym]?.decimals ?? 18 : 18;
                    return (
                      <div key={order.id} className="flex items-center justify-between p-3 rounded-lg border border-border-custom bg-surface/20 text-xs font-mono">
                        <span>
                          {formatUnits(BigInt(order.amount), inDecimals)} {inSym ?? `asset ${order.assetId}`} → min{' '}
                          {formatUnits(BigInt(order.minAmountOut), outDecimals)} {outSym ?? `asset ${order.assetOut}`}
                        </span>
                        <span className="text-[9px] text-text-secondary uppercase">Pending match</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </GlassCard>
          </>
        )}
      </div>
    </div>
  );
}
