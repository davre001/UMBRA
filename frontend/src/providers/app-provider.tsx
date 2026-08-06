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
  /** Coston2 explorer link shown on the toast/bell entry when this notification is about a specific transaction. */
  txHash?: `0x${string}`;
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
  /** `skipToast` — the bell history still logs it, but no popup fires. For call sites (e.g. the faucet) that already show their own dedicated toast for the same event, so the two don't stack. */
  addNotification: (title: string, message: string, type?: Notification['type'], txHash?: `0x${string}`, skipToast?: boolean) => void;
  clearNotifications: () => void;
  // Transient on-screen toasts — a subset of `notifications` currently
  // visible as a popup, independent of the persistent bell history above.
  activeToasts: Notification[];
  dismissToast: (id: string) => void;
  // Anonymity
  anonymityScore: number;
  setAnonymityScore: (score: number) => void;
};

const AppContext = createContext<AppContextType | undefined>(undefined);

// A page reload otherwise resets isEntered to false and drops the user back
// at the landing gate mid-session — persisting it means a refresh keeps them
// in the app.
const ENTERED_STORAGE_KEY = 'umbra:isEntered';

// Same reload problem for the notification bell — without this, refreshing
// the page silently wipes your whole recent-activity history. Deliberately
// NOT synced anywhere beyond this browser (see the cross-device discussion
// this followed): a server-side store for this would mean a backend
// learning your activity, including payment amounts that today never touch
// any backend at all.
const NOTIFICATIONS_STORAGE_KEY = 'umbra:notifications';
const MAX_STORED_NOTIFICATIONS = 15;

type StoredNotification = Omit<Notification, 'timestamp'> & { timestamp: string };

function loadStoredNotifications(): Notification[] {
  try {
    const raw = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredNotification[];
    return parsed.map((n) => ({ ...n, timestamp: new Date(n.timestamp) }));
  } catch {
    return []; // corrupted or pre-dates this format — start fresh rather than crash the app
  }
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isEntered, setIsEntered] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [activeToasts, setActiveToasts] = useState<Notification[]>([]);
  const [anonymityScore, setAnonymityScore] = useState<number>(85);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [disconnectModalOpen, setDisconnectModalOpen] = useState(false);

  // Real wallet state from wagmi
  const { address, isConnected, connector } = useAccount();
  const { disconnect } = useDisconnect();
  const router = useRouter();

  const addNotification = (
    title: string,
    message: string,
    type: Notification['type'] = 'info',
    txHash?: `0x${string}`,
    skipToast = false
  ) => {
    const newNotif: Notification = {
      id: Math.random().toString(36).substring(2, 9),
      title,
      message,
      type,
      timestamp: new Date(),
      txHash,
    };
    setNotifications(prev => [newNotif, ...prev].slice(0, 15));
    if (!skipToast) setActiveToasts(prev => [...prev, newNotif]);
  };

  // Notify on connect/disconnect — reacting to wagmi's own external
  // connection state, the canonical case react-hooks/set-state-in-effect's
  // own guidance calls out as fine to suppress ("subscribe for updates from
  // some external system").
  useEffect(() => {
    if (isConnected && address) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      addNotification(
        'Wallet Connected',
        `Linked ${address.slice(0, 6)}...${address.slice(-4)}`,
        'success'
      );
    }
  }, [isConnected, address]);

  // Restores an entered session after a reload. Client-only and after mount
  // (not a lazy useState initializer) so the very first render still matches
  // the server's — no hydration mismatch, just one extra render on load.
  // localStorage doesn't exist during SSR, so reading it during render
  // (including a lazy initializer) would produce a different result
  // server- vs client-side — exactly the mismatch this pattern avoids, at
  // the cost of one extra render on load that react-hooks/set-state-in-effect
  // flags by default.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localStorage.getItem(ENTERED_STORAGE_KEY) === 'true') setIsEntered(true);
  }, []);

  // Same client-only-after-mount reasoning as above — restores the bell
  // history a reload would otherwise silently wipe.
  useEffect(() => {
    const stored = loadStoredNotifications();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored.length > 0) setNotifications(stored);
  }, []);

  // Persists on every change, not just on add — so clearNotifications()
  // wiping the list is reflected too, not just growth.
  useEffect(() => {
    localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(notifications.slice(0, MAX_STORED_NOTIFICATIONS)));
  }, [notifications]);

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

  const disconnectWallet = async () => {
    setDisconnectModalOpen(false);
    setWalletModalOpen(false);

    // Injected wallets (MetaMask, Rabby, Trust, Phantom) have no real "log
    // out" — wagmi's own attempt at this (wallet_revokePermissions) uses a
    // 100ms timeout that's too tight to ever actually complete, so it
    // silently no-ops even on wallets that support it. That's why the app
    // correctly shows disconnected but the wallet still reconnects the same
    // account with one click and no prompt. Try the real revoke here first,
    // with room to actually finish, before wagmi tears down local state.
    if (connector?.type === 'injected') {
      try {
        const provider = (await connector.getProvider()) as
          | { request(args: { method: string; params?: unknown[] }): Promise<unknown> }
          | undefined;
        await provider?.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] });
      } catch {
        // Not supported by this wallet — nothing more we can do from the dApp side.
      }
    }

    disconnect();
    addNotification('Wallet Disconnected', 'Secure connection terminated.', 'warning');
    // End the vault session and return to the gateway so the next connect starts clean
    handleSetEntered(false);
    router.push('/');
  };

  const clearNotifications = () => setNotifications([]);

  const dismissToast = (id: string) => setActiveToasts(prev => prev.filter(t => t.id !== id));

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
      activeToasts,
      dismissToast,
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
