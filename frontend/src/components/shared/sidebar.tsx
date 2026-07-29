"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { useApp } from '@/providers/app-provider';
import { LayoutDashboard, Shield, Send, RefreshCw, QrCode, Settings, ChevronLeft, ChevronRight, Activity, Zap, Droplets } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Sidebar: React.FC = () => {
  const pathname = usePathname();
  const { isEntered } = useApp();
  const [collapsed, setCollapsed] = useState(true);

  // Hidden before entering the protocol vault
  if (!isEntered) return null;

  const links = [
    { name: 'Portfolio', icon: LayoutDashboard, href: '/portfolio' },
    { name: 'Shield Assets', icon: Shield, href: '/shield' },
    { name: 'Private Pay', icon: Send, href: '/pay' },
    { name: 'Dark Swap', icon: RefreshCw, href: '/swap' },
    { name: 'Receive Funds', icon: QrCode, href: '/receive' },
    { name: 'Faucet', icon: Droplets, href: '/faucet' },
  ];

  return (
    <motion.div
      animate={{ width: collapsed ? 64 : 220 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className="hidden md:flex flex-col fixed top-16 left-0 bottom-0 z-40 border-r border-border-custom bg-bg-base/40 backdrop-blur-md transition-colors duration-300"
    >
      {/* Link Items */}
      <div className="flex-1 py-6 flex flex-col gap-1 px-3">
        {links.map((link) => {
          const isActive = pathname === link.href;
          const Icon = link.icon;

          return (
            <Link
              key={link.name}
              href={link.href}
              className={cn(
                "group relative flex items-center h-10 rounded-lg transition-all duration-300",
                isActive 
                  ? "bg-accent-primary/5 text-accent-primary" 
                  : "text-text-secondary hover:text-text-primary hover:bg-surface/30"
              )}
            >
              {/* Active status indicator bar */}
              {isActive && (
                <motion.div
                  layoutId="sidebarActiveBar"
                  className="absolute left-0 w-1 h-5 rounded-r bg-accent-primary"
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                />
              )}

              <div className="w-10 h-10 flex items-center justify-center flex-shrink-0">
                <Icon size={18} className={cn("transition-transform group-hover:scale-110", isActive ? "text-accent-primary" : "text-text-secondary group-hover:text-text-primary")} />
              </div>

              <motion.span
                animate={{ opacity: collapsed ? 0 : 1, x: collapsed ? -10 : 0 }}
                transition={{ duration: 0.2 }}
                className={cn(
                  "font-sans text-xs tracking-wider uppercase font-light ml-2 absolute left-10 whitespace-nowrap",
                  collapsed && "pointer-events-none"
                )}
              >
                {link.name}
              </motion.span>

              {/* Tooltip on collapsed state */}
              {collapsed && (
                <div className="absolute left-14 px-2 py-1 rounded bg-surface border border-border-custom text-[10px] uppercase tracking-wider text-text-primary opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap z-50 shadow-lg">
                  {link.name}
                </div>
              )}
            </Link>
          );
        })}
      </div>

      {/* Sidebar Footer Stats / Collapse Toggle */}
      <div className="p-3 border-t border-border-custom/50 flex flex-col gap-2">
        {/* Simulated Gas/Telemetry Tracker */}
        <div className="flex items-center gap-2 rounded-lg bg-surface/20 p-2 border border-border-custom/40">
          <Zap size={14} className="text-accent-primary animate-pulse flex-shrink-0" />
          {!collapsed && (
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              className="flex flex-col text-[10px] leading-none"
            >
              <span className="text-text-secondary">GAS PRICE</span>
              <span className="text-accent-primary font-mono font-semibold mt-0.5">14.2 GWEI</span>
            </motion.div>
          )}
        </div>

        {/* Collapsible toggle button */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex h-8 items-center justify-center rounded-lg border border-border-custom bg-surface/30 text-text-secondary hover:text-text-primary transition-all cursor-pointer"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>
    </motion.div>
  );
};
