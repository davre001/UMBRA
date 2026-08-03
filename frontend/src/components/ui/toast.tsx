"use client";

import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';

export type ToastItem = {
  id: string;
  title: string;
  message: string;
};

const DEFAULT_DURATION = 4000;

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

  // Held in a ref so a re-created parent callback doesn't restart the timer.
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
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -28, scale: 0.9 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -18, scale: 0.96 }}
      transition={
        reduceMotion
          ? { duration: 0.2 }
          : { type: 'spring', stiffness: 420, damping: 30, mass: 0.8 }
      }
      onClick={() => onDismiss(toast.id)}
      className="pointer-events-auto cursor-pointer select-none overflow-hidden rounded-[22px] px-4 py-3.5"
      style={{
        background:
          'linear-gradient(180deg, rgba(0,229,163,0.18) 0%, rgba(0,229,163,0.10) 100%), rgba(8,20,17,0.72)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        border: '1px solid rgba(0,229,163,0.30)',
        boxShadow:
          '0 12px 40px rgba(0,0,0,0.55), 0 0 28px rgba(0,229,163,0.14), inset 0 1px 0 rgba(255,255,255,0.14)',
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full"
          style={{
            background: 'rgba(0,229,163,0.22)',
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
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} duration={duration} />
        ))}
      </AnimatePresence>
    </div>
  );
}
