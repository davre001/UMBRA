"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useDisconnect } from 'wagmi';

type Notification = {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: Date;
};

type AppContextType = {
  isEntered: boolean;
  setIsEntered: (val: boolean) => void;
  // Wallet state — driven by wagmi
  isWalletConnected: boolean;
  walletAddress: string | null;
  connectWallet: () => void;   // now opens the modal — set externally
  requestDisconnect: () => void;
  disconnectWallet: () => void;
  // Modal control
  walletModalOpen: boolean;
  setWalletModalOpen: (open: boolean) => void;
  disconnectModalOpen: boolean;
  setDisconnectModalOpen: (open: boolean) => void;
  // Notifications
  notifications: Notification[];
  addNotification: (title: string, message: string, type?: Notification['type']) => void;
  clearNotifications: () => void;
  // Anonymity
  anonymityScore: number;
  setAnonymityScore: (score: number) => void;
};

const AppContext = createContext<AppContextType | undefined>(undefined);

// A page reload otherwise resets isEntered to false and drops the user back
// at the landing gate mid-session — persisting it means a refresh keeps them
// in the app.
const ENTERED_STORAGE_KEY = 'umbra:isEntered';

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isEntered, setIsEntered] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [anonymityScore, setAnonymityScore] = useState<number>(85);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [disconnectModalOpen, setDisconnectModalOpen] = useState(false);

  // Real wallet state from wagmi
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const router = useRouter();

  // Notify on connect/disconnect
  useEffect(() => {
    if (isConnected && address) {
      addNotification(
        'Wallet Connected',
        `Linked ${address.slice(0, 6)}...${address.slice(-4)}`,
        'success'
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address]);

  // Restores an entered session after a reload. Client-only and after mount
  // (not a lazy useState initializer) so the very first render still matches
  // the server's — no hydration mismatch, just one extra render on load.
  useEffect(() => {
    if (localStorage.getItem(ENTERED_STORAGE_KEY) === 'true') setIsEntered(true);
  }, []);

  const handleSetEntered = (val: boolean) => {
    setIsEntered(val);
    if (val) {
      localStorage.setItem(ENTERED_STORAGE_KEY, 'true');
      addNotification('Secure Vault Session', 'Vault interface unlocked.', 'success');
    } else {
      localStorage.removeItem(ENTERED_STORAGE_KEY);
    }
  };

  const connectWallet = () => setWalletModalOpen(true);

  const requestDisconnect = () => setDisconnectModalOpen(true);

  const disconnectWallet = () => {
    setDisconnectModalOpen(false);
    setWalletModalOpen(false);
    disconnect();
    addNotification('Wallet Disconnected', 'Secure connection terminated.', 'warning');
    // End the vault session and return to the gateway so the next connect starts clean
    handleSetEntered(false);
    router.push('/');
  };

  const addNotification = (title: string, message: string, type: Notification['type'] = 'info') => {
    const newNotif: Notification = {
      id: Math.random().toString(36).substring(2, 9),
      title,
      message,
      type,
      timestamp: new Date(),
    };
    setNotifications(prev => [newNotif, ...prev].slice(0, 15));
  };

  const clearNotifications = () => setNotifications([]);

  return (
    <AppContext.Provider value={{
      isEntered,
      setIsEntered: handleSetEntered,
      isWalletConnected: isConnected,
      walletAddress: address ?? null,
      connectWallet,
      requestDisconnect,
      disconnectWallet,
      walletModalOpen,
      setWalletModalOpen,
      disconnectModalOpen,
      setDisconnectModalOpen,
      notifications,
      addNotification,
      clearNotifications,
      anonymityScore,
      setAnonymityScore,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
