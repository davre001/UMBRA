"use client";

import React from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from '@/lib/wagmi';
import { AppProvider, useApp } from './app-provider';
import { WalletModal } from '@/components/shared/wallet-modal';
import { DisconnectConfirmModal } from '@/components/shared/disconnect-confirm-modal';
import { NotificationToastStack } from '@/components/ui/notification-toast';

const queryClient = new QueryClient();

// Inner component so it can access AppContext
function WalletModalMount() {
  const { walletModalOpen, setWalletModalOpen } = useApp();
  return <WalletModal open={walletModalOpen} onClose={() => setWalletModalOpen(false)} />;
}

function NotificationToastMount() {
  const { activeToasts, dismissToast } = useApp();
  return <NotificationToastStack toasts={activeToasts} onDismiss={dismissToast} />;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <AppProvider>
          {children}
          <WalletModalMount />
          <DisconnectConfirmModal />
          <NotificationToastMount />
        </AppProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
