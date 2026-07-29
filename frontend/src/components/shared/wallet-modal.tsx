"use client";

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useConnect, useDisconnect, useAccount } from 'wagmi';
import { X, Wallet, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { walletIcon, networkIcon, CONNECTOR_ICONS, SUPPORTED_CHAINS } from '@/lib/icons';

const WALLET_META: Record<string, { label: string }> = {
  metaMask:      { label: 'MetaMask' },
  coinbaseWallet:{ label: 'Coinbase Wallet' },
  walletConnect: { label: 'WalletConnect' },
  rabby:         { label: 'Rabby' },
  trust:         { label: 'Trust Wallet' },
  phantom:       { label: 'Phantom' },
  injected:      { label: 'Browser Wallet' },
};

interface WalletModalProps {
  open: boolean;
  onClose: () => void;
  onConnected?: (address: string) => void;
}

export function WalletModal({ open, onClose, onConnected }: WalletModalProps) {
  const { connectors, connect, isPending, error } = useConnect({
    mutation: {
      onSuccess(data) {
        const account = data.accounts[0];
        onConnected?.(typeof account === 'string' ? account : account.address);
        onClose();
      },
    },
  });
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();

  const [pendingConnectorId, setPendingConnectorId] = React.useState<string | null>(null);

  const handleConnect = (connector: (typeof connectors)[number]) => {
    setPendingConnectorId(connector.id);
    connect({ connector });
  };

  const handleDisconnect = () => {
    disconnect();
    onClose();
  };

  // Targeted injected connectors carry their own id (rabby, trust, …); the bare
  // injected() fallback and EIP-6963 discovery can still surface the same wallet twice.
  const unique = React.useMemo(() => {
    const seen = new Set<string>();
    return connectors.filter(c => {
      const key = c.id === 'injected' ? 'browser' : c.id.toLowerCase();
      const nameKey = c.name.toLowerCase();
      if (seen.has(key) || seen.has(nameKey)) return false;
      seen.add(key);
      seen.add(nameKey);
      return true;
    });
  }, [connectors]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm"
          />

          {/* Modal */}
          <motion.div
            key="modal"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="fixed z-[101] inset-0 flex items-center justify-center px-4 pointer-events-none"
          >
            <div className="w-full max-w-sm bg-bg-base border border-border-custom rounded-2xl shadow-[0_0_80px_rgba(0,0,0,0.8)] pointer-events-auto overflow-hidden">

              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border-custom/50">
                <div className="flex items-center gap-2">
                  <Wallet size={16} className="text-accent-primary" />
                  <h2 className="font-display text-sm font-bold uppercase tracking-wider text-text-primary">
                    {isConnected ? 'Wallet Connected' : 'Connect Wallet'}
                  </h2>
                </div>
                <button
                  onClick={onClose}
                  className="text-text-secondary hover:text-text-primary transition-colors p-1 rounded-lg hover:bg-surface/40 cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Body */}
              <div className="p-5">
                {isConnected && address ? (
                  /* Already connected */
                  <div className="flex flex-col items-center text-center gap-4">
                    <div className="p-4 rounded-full border border-success-state/30 bg-success-state/5">
                      <CheckCircle2 size={32} className="text-success-state" />
                    </div>
                    <div>
                      <p className="text-xs text-text-secondary mb-1 uppercase tracking-widest">Connected Address</p>
                      <p className="font-mono text-sm text-text-primary font-semibold break-all">{address}</p>
                    </div>
                    <button
                      onClick={handleDisconnect}
                      className="w-full py-2.5 rounded-xl border border-border-custom text-xs text-text-secondary hover:border-red-500/40 hover:text-red-400 transition-all uppercase tracking-wider font-sans cursor-pointer"
                    >
                      Disconnect Wallet
                    </button>
                  </div>
                ) : (
                  /* Wallet list */
                  <div className="flex flex-col gap-2">
                    <p className="text-[10px] text-text-secondary uppercase tracking-widest mb-2">
                      Choose your EVM wallet
                    </p>

                    {unique.map((connector) => {
                      const meta = WALLET_META[connector.id] ?? { label: connector.name };
                      const iconSlug = CONNECTOR_ICONS[connector.id];
                      const isLoading = isPending && pendingConnectorId === connector.id;

                      return (
                        <button
                          key={connector.id}
                          onClick={() => handleConnect(connector)}
                          disabled={isPending}
                          className="flex items-center gap-4 w-full px-4 py-3.5 rounded-xl border border-border-custom/60 bg-surface/10 hover:bg-surface/30 hover:border-accent-primary/40 transition-all duration-200 text-left disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer group"
                        >
                          {iconSlug ? (
                            <img
                              src={walletIcon(iconSlug)}
                              alt={meta.label}
                              className="h-8 w-8 rounded-lg flex-shrink-0"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded-lg border border-border-custom bg-surface/40 flex items-center justify-center flex-shrink-0">
                              <Wallet size={15} className="text-text-secondary" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-text-primary font-display">{meta.label}</div>
                            <div className="text-[10px] text-text-secondary uppercase tracking-widest mt-0.5">{connector.name}</div>
                          </div>
                          {isLoading ? (
                            <Loader2 size={16} className="text-accent-primary animate-spin flex-shrink-0" />
                          ) : (
                            <div className="w-1.5 h-1.5 rounded-full bg-border-custom group-hover:bg-accent-primary transition-colors flex-shrink-0" />
                          )}
                        </button>
                      );
                    })}

                    {/* Error */}
                    {error && (
                      <div className="flex items-start gap-2 mt-2 p-3 rounded-lg border border-red-500/20 bg-red-500/5">
                        <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                        <p className="text-[10px] text-red-400 leading-relaxed">
                          {error.message.includes('User rejected')
                            ? 'Connection rejected by user.'
                            : error.message.slice(0, 120)}
                        </p>
                      </div>
                    )}

                    {/* Supported networks */}
                    <div className="mt-4 pt-4 border-t border-border-custom/40">
                      <p className="text-[9px] text-text-secondary uppercase tracking-widest mb-2.5 text-center">
                        Supported Networks
                      </p>
                      <div className="flex items-center justify-center flex-wrap gap-2">
                        {SUPPORTED_CHAINS.map((chain) => (
                          <div
                            key={chain.slug}
                            title={chain.name}
                            className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border-custom/50 bg-surface/20"
                          >
                            <img src={networkIcon(chain.slug)} alt={chain.name} className="h-4 w-4 rounded-full" />
                            <span className="text-[9px] text-text-secondary">{chain.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <p className="text-[9px] text-text-secondary/50 text-center mt-3 leading-relaxed">
                      By connecting a wallet you agree to Umbra Protocol&apos;s Terms of Service. This is a testnet application.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
