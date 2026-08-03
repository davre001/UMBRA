"use client";

import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';

export type ToastAsset = 'C2FLR' | 'USDT0' | 'FXRP';

export type ToastItem = {
  id: string;
  title: string;
  message: string;
  asset: ToastAsset;
};

/**
 * `beam` is the travelling highlight, `trail` its leading edge. FXRP's black
 * would be invisible against the dark card, so it carries a bright leading
 * edge — the sweep reads as black chrome rather than disappearing.
 */
const ACCENTS: Record<ToastAsset, { beam: string; trail: string; glow: string }> = {
  C2FLR: { beam: '#FF3B30', trail: 'rgba(255,110,100,0.95)', glow: 'rgba(255,59,48,0.22)' },
  USDT0: { beam: '#00E5A3', trail: 'rgba(120,255,215,0.95)', glow: 'rgba(0,229,163,0.22)' },
  FXRP: { beam: '#050507', trail: 'rgba(228,232,240,0.95)', glow: 'rgba(0,0,0,0.45)' },
};

const DEFAULT_DURATION = 4000;
const RING = 1.5;
const RADIUS = 22;

function ToastCard({
  toast,
  onDismiss,
  duration,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
  duration: number;
}) {
  const reduceMotion = useReducedMotion();
  const accent = ACCENTS[toast.asset];

  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const t = setTimeout(() => dismissRef.current(toast.id), duration);
    return () => clearTimeout(t);
  }, [toast.id, duration]);

  return (
    <motion.div
      layout
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.88, y: 8 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: -6 }}
      transition={
        reduceMotion
          ? { duration: 0.2 }
          : { type: 'spring', stiffness: 420, damping: 30, mass: 0.8 }
      }
      onClick={() => onDismiss(toast.id)}
      className="pointer-events-auto relative cursor-pointer select-none overflow-hidden"
      style={{
        borderRadius: RADIUS,
        padding: RING,
        background: 'rgba(255,255,255,0.10)',
        boxShadow: `0 18px 50px rgba(0,0,0,0.6), 0 0 34px ${accent.glow}`,
      }}
    >
      {/* Travelling highlight: a conic sweep confined to the ring by the inner card. */}
      {!reduceMotion && (
        <motion.div
          aria-hidden
          className="absolute"
          style={{
            inset: '-140%',
            background: `conic-gradient(from 0deg, transparent 0deg, transparent 260deg, ${accent.beam} 330deg, ${accent.trail} 356deg, transparent 360deg)`,
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 2.6, ease: 'linear', repeat: Infinity }}
        />
      )}

      {/* Inner card — neutral graphite glass, masks the sweep down to a hairline. */}
      <div
        className="relative px-4 py-3.5"
        style={{
          borderRadius: RADIUS - RING,
          background:
            'linear-gradient(180deg, rgba(120,128,145,0.20) 0%, rgba(30,33,40,0.55) 100%), rgba(12,13,16,0.86)',
          backdropFilter: 'blur(26px) saturate(180%)',
          WebkitBackdropFilter: 'blur(26px) saturate(180%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)',
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full"
            style={{
              background: 'rgba(0,229,163,0.20)',
              border: '1px solid rgba(0,229,163,0.45)',
            }}
          >
            <Check size={16} className="text-success-state" strokeWidth={3} />
          </div>

          <div className="min-w-0">
            <div className="text-[13px] font-semibold leading-tight text-white">{toast.title}</div>
            <div className="mt-0.5 text-[11px] leading-snug text-white/70">{toast.message}</div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function ToastStack({
  toasts,
  onDismiss,
  duration = DEFAULT_DURATION,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  duration?: number;
}) {
  return (
    <div className="pointer-events-none fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 px-4">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} duration={duration} />
        ))}
      </AnimatePresence>
    </div>
  );
}
