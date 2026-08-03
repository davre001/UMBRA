"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useChainId, useSwitchChain } from 'wagmi';
import { flare, flareTestnet } from 'wagmi/chains';
import { useApp } from '@/providers/app-provider';
import { ADD_CHAIN_PARAMS } from '@/lib/networkParams';
import { Bell, Wallet, ShieldAlert, ShieldCheck, ChevronDown, Menu, X, Check, ArrowRight } from 'lucide-react';
import { formatAddress } from '@/lib/utils';
import { AnimatedButton } from '@/components/ui/animated-button';
import { UmbraLogo } from '@/components/shared/logo';

// Only the two chains actually configured in wagmi.ts — Songbird was never
// one of them, so it was never a real option even before this dropdown did
// anything at all.
const NETWORKS = [
  { chainId: flareTestnet.id, name: 'Coston2 Testnet' },
  { chainId: flare.id, name: 'Flare Mainnet' },
] as const;

export const Navbar: React.FC = () => {
  const pathname = usePathname();
  const {
    isEntered,
    setIsEntered,
    isWalletConnected,
    walletAddress,
    connectWallet,
    requestDisconnect,
    notifications,
    clearNotifications,
    addNotification,
  } = useApp();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();

  const [lastScrollY, setLastScrollY] = useState(0);
  const [showNavbar, setShowNavbar] = useState(true);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showNetworkMenu, setShowNetworkMenu] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const currentNetwork = NETWORKS.find((n) => n.chainId === chainId);
  const selectedNetwork = currentNetwork?.name ?? 'Unsupported Network';
  // Umbra's vault is only deployed on Coston2 — Flare Mainnet is a real,
  // switchable chain (unlike the removed Songbird option) but has no
  // deployment, so every app page already falls back to its own "not
  // available on this network" state there.
  const onCoston2 = chainId === flareTestnet.id;

  const handleSwitchNetwork = async (targetChainId: (typeof NETWORKS)[number]['chainId']) => {
    setShowNetworkMenu(false);
    if (targetChainId === chainId) return;
    try {
      // addEthereumChainParameter lets the wallet add this network on the
      // fly if it doesn't already have it configured, instead of just
      // failing with "unrecognized chain ID".
      await switchChainAsync({ chainId: targetChainId, addEthereumChainParameter: ADD_CHAIN_PARAMS[targetChainId] });
    } catch {
      addNotification('Network Switch Failed', 'Please switch networks manually in your wallet.', 'error');
    }
  };

  // Manage show/hide on scroll
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY > lastScrollY && currentScrollY > 80) {
        setShowNavbar(false); // scrolling down
      } else {
        setShowNavbar(true); // scrolling up
      }
      setLastScrollY(currentScrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  const navLinks = [
    { name: 'Portfolio', href: '/portfolio' },
    { name: 'Shield', href: '/shield' },
    { name: 'Private Pay', href: '/pay' },
    { name: 'Dark Swap', href: '/swap' },
    { name: 'Receive', href: '/receive' },
    { name: 'Faucet', href: '/faucet' },
  ];

  const unreadCount = notifications.length;

  // Hidden before entering the protocol vault
  if (!isEntered) return null;

  return (
    <motion.nav
      initial={{ y: -100, opacity: 0 }}
      animate={{ y: showNavbar ? 0 : -100, opacity: showNavbar ? 1 : 0 }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
      className="fixed top-0 left-0 right-0 z-50 w-full border-b border-border-custom bg-bg-base/70 backdrop-blur-md"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-8">
            <motion.div
              whileHover={{ scale: 1.05, rotate: -2 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
            >
              <a
                href="/"
                className="flex items-center gap-2"
                onClick={(e) => {
                  e.preventDefault();
                  window.location.replace('/');
                }}
              >
                <UmbraLogo size={32} />
              </a>
            </motion.div>

            {/* Desktop Navigation Links */}
            <div className="hidden md:flex items-center gap-1">
              {navLinks.map((link) => {
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.name}
                    href={link.href}
                    className="relative px-4 py-2 text-xs tracking-wider font-light uppercase transition-colors"
                  >
                    <span className={isActive ? "text-accent-primary" : "text-text-secondary hover:text-text-primary"}>
                      {link.name}
                    </span>
                    {isActive && (
                      <motion.div
                        layoutId="activeNavIndicator"
                        className="absolute bottom-0 left-4 right-4 h-0.5 bg-accent-primary"
                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                      />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="hidden md:flex items-center gap-4">
            {/* Network Selector */}
            <div className="relative">
              <button
                onClick={() => setShowNetworkMenu(!showNetworkMenu)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-custom bg-surface/30 text-xs text-text-secondary hover:text-text-primary hover:border-border-custom/80 transition-all cursor-pointer"
              >
                <div className={`h-1.5 w-1.5 rounded-full ${onCoston2 ? 'bg-success-state' : 'bg-accent-secondary'}`} />
                {selectedNetwork}
                <ChevronDown size={12} className="opacity-60" />
              </button>

              <AnimatePresence>
                {showNetworkMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute right-0 mt-2 w-48 rounded-lg border border-border-custom bg-surface/90 backdrop-blur-md p-1 shadow-xl z-50"
                  >
                    {NETWORKS.map((net) => (
                      <button
                        key={net.chainId}
                        onClick={() => handleSwitchNetwork(net.chainId)}
                        className="flex w-full items-center justify-between px-3 py-2 rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-border-custom/40 transition-all text-left cursor-pointer"
                      >
                        {net.name}
                        {chainId === net.chainId && <Check size={12} className="text-accent-primary" />}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Notifications Trigger */}
            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="relative p-2 rounded-lg border border-border-custom bg-surface/30 text-text-secondary hover:text-text-primary hover:border-border-custom/80 transition-all cursor-pointer"
              >
                <Bell size={16} />
                {unreadCount > 0 && (
                  <span className="absolute top-0 right-0 h-2 w-2 rounded-full bg-accent-secondary" />
                )}
              </button>

              <AnimatePresence>
                {showNotifications && (
                  <motion.div
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 15 }}
                    className="absolute right-0 mt-2 w-80 rounded-lg border border-border-custom bg-surface/95 backdrop-blur-md shadow-xl overflow-hidden z-50"
                  >
                    <div className="p-3 border-b border-border-custom flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-text-primary">System Signals</span>
                      {unreadCount > 0 && (
                        <button onClick={clearNotifications} className="text-[10px] text-accent-primary hover:underline cursor-pointer">Clear</button>
                      )}
                    </div>

                    <div className="max-h-64 overflow-y-auto divide-y divide-border-custom/40">
                      {notifications.length === 0 ? (
                        <div className="p-6 text-center text-xs text-text-secondary">No active signals</div>
                      ) : (
                        notifications.map((notif) => (
                          <div key={notif.id} className="p-3 hover:bg-surface/50 transition-all">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-semibold text-text-primary">{notif.title}</span>
                              <span className="text-[9px] text-text-secondary">
                                {notif.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <p className="text-[10px] text-text-secondary mt-1 leading-normal">{notif.message}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Wallet Connect */}
            {isWalletConnected ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-accent-primary/20 bg-accent-primary/5 text-xs text-accent-primary font-mono">
                  <ShieldCheck size={14} className="text-accent-primary animate-pulse" />
                  {formatAddress(walletAddress || '')}
                </div>
                <button
                  onClick={requestDisconnect}
                  className="text-xs text-text-secondary hover:text-text-primary transition-all underline cursor-pointer"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <AnimatedButton
                variant="primary"
                size="sm"
                onClick={connectWallet}
              >
                <Wallet size={14} />
                Connect Vault
              </AnimatedButton>
            )}
          </div>

          {/* Mobile Menu Trigger */}
          <div className="flex md:hidden items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg border border-border-custom text-text-secondary hover:text-text-primary cursor-pointer"
            >
              {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Nav Menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="md:hidden border-t border-border-custom bg-bg-base/95 backdrop-blur-lg overflow-hidden"
          >
            <div className="px-4 py-4 space-y-3">
              {navLinks.map((link) => {
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.name}
                    href={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`block py-2 text-sm tracking-widest uppercase font-light ${
                      isActive ? 'text-accent-primary' : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {link.name}
                  </Link>
                );
              })}

              <div className="pt-4 border-t border-border-custom/50 flex flex-col gap-3">
                <div className="flex items-center justify-between text-xs text-text-secondary">
                  <span>Active Security:</span>
                  <span className="text-accent-primary font-mono">{selectedNetwork}</span>
                </div>

                {isWalletConnected ? (
                  <div className="flex items-center justify-between bg-accent-primary/5 p-3 rounded-lg border border-accent-primary/10">
                    <span className="text-xs font-mono text-accent-primary">{formatAddress(walletAddress || '')}</span>
                    <button onClick={requestDisconnect} className="text-xs text-text-secondary hover:underline cursor-pointer">Disconnect</button>
                  </div>
                ) : (
                  <AnimatedButton
                    variant="primary"
                    size="sm"
                    fullWidth
                    onClick={() => {
                      connectWallet();
                      setMobileMenuOpen(false);
                    }}
                  >
                    Connect Vault
                  </AnimatedButton>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
};
