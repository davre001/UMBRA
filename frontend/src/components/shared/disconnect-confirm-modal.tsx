"use client";

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { useApp } from '@/providers/app-provider';
import { formatAddress } from '@/lib/utils';

export function DisconnectConfirmModal() {
  const { disconnectModalOpen, setDisconnectModalOpen, disconnectWallet, walletAddress } = useApp();

  const close = () => setDisconnectModalOpen(false);

  React.useEffect(() => {
    if (!disconnectModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDisconnectModalOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [disconnectModalOpen, setDisconnectModalOpen]);

  return (
    <AnimatePresence>
      {disconnectModalOpen && (
        <>
          {/* Backdrop — above the wallet modal (z-100/101) so it can confirm from inside it */}
          <motion.div
            key="disconnect-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
            className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-sm"
          />

          <motion.div
            key="disconnect-modal"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="fixed z-[111] inset-0 flex items-center justify-center px-4 pointer-events-none"
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="disconnect-title"
              className="w-full max-w-sm bg-bg-base border border-border-custom rounded-2xl shadow-[0_0_80px_rgba(0,0,0,0.8)] pointer-events-auto overflow-hidden"
            >
              <div className="p-6 flex flex-col items-center text-center gap-4">
                <div className="p-4 rounded-full border border-red-500/30 bg-red-500/5">
                  <AlertTriangle size={28} className="text-red-400" />
                </div>

                <div>
                  <h2 id="disconnect-title" className="font-display text-sm font-bold uppercase tracking-wider text-text-primary mb-2">
                    Disconnect Wallet?
                  </h2>
                  <p className="text-[11px] text-text-secondary font-light leading-relaxed">
                    This ends your secure session
                    {walletAddress && (
                      <> for <span className="font-mono text-text-primary">{formatAddress(walletAddress)}</span></>
                    )}
                    . You will need to reconnect to access shielded balances.
                  </p>
                </div>

                <div className="flex gap-3 w-full mt-1">
                  <button
                    onClick={close}
                    className="flex-1 py-2.5 rounded-xl border border-border-custom text-xs text-text-secondary hover:text-text-primary hover:border-accent-primary/40 transition-all uppercase tracking-wider font-sans cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={disconnectWallet}
                    className="flex-1 py-2.5 rounded-xl border border-red-500/40 bg-red-500/10 text-xs text-red-400 hover:bg-red-500/20 hover:border-red-500/60 transition-all uppercase tracking-wider font-sans cursor-pointer"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
