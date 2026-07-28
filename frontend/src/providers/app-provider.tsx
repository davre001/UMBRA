"use client";

import React, { createContext, useContext, useState } from 'react';

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
  isWalletConnected: boolean;
  walletAddress: string | null;
  connectWallet: () => void;
  disconnectWallet: () => void;
  notifications: Notification[];
  addNotification: (title: string, message: string, type?: Notification['type']) => void;
  clearNotifications: () => void;
  anonymityScore: number;
  setAnonymityScore: (score: number) => void;
};

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isEntered, setIsEntered] = useState<boolean>(false);
  const [isWalletConnected, setIsWalletConnected] = useState<boolean>(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [anonymityScore, setAnonymityScore] = useState<number>(85); // default starting score
  const handleSetEntered = (val: boolean) => {
    setIsEntered(val);
    if (val) {
      addNotification("Secure Vault Session", "Sanitized TEE connection established.", "success");
    }
  };

  const connectWallet = () => {
    setIsWalletConnected(true);
    // Standard stealth preview address
    const mockAddress = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
    setWalletAddress(mockAddress);
    addNotification("Wallet Connected", `Linked ${mockAddress.slice(0, 6)}...${mockAddress.slice(-4)}`, "info");
  };

  const disconnectWallet = () => {
    setIsWalletConnected(false);
    setWalletAddress(null);
    addNotification("Wallet Disconnected", "Secure connection terminated.", "warning");
  };

  const addNotification = (title: string, message: string, type: Notification['type'] = 'info') => {
    const newNotif: Notification = {
      id: Math.random().toString(36).substring(2, 9),
      title,
      message,
      type,
      timestamp: new Date()
    };
    setNotifications(prev => [newNotif, ...prev].slice(0, 15)); // keep last 15
  };

  const clearNotifications = () => {
    setNotifications([]);
  };

  return (
    <AppContext.Provider value={{
      isEntered,
      setIsEntered: handleSetEntered,
      isWalletConnected,
      walletAddress,
      connectWallet,
      disconnectWallet,
      notifications,
      addNotification,
      clearNotifications,
      anonymityScore,
      setAnonymityScore
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
