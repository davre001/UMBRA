"use client";

import React from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from '@/lib/wagmi';
import { AppProvider, useApp } from './app-provider';
import { WalletModal } from '@/components/shared/wallet-modal';

const queryClient = new QueryClient();

// Inner component so it can access AppContext
function WalletModalMount() {
  const { walletModalOpen, setWalletModalOpen, addNotification, walletAddress } = useApp();
  return (
    <WalletModal
      open={walletModalOpen}
      onClose={() => setWalletModalOpen(false)}
      onConnected={(addr) => {
        addNotification('Wallet Connected', `Linked ${addr.slice(0, 6)}...${addr.slice(-4)}`, 'success');
      }}
    />
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <AppProvider>
          {children}
          <WalletModalMount />
        </AppProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
