"use client";

import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2, XCircle, AlertTriangle, Info, ExternalLink } from 'lucide-react';

export type ToastNotification = {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  txHash?: `0x${string}`;
};

// Errors/warnings stay up longer — there's more to read, and a failure is
// worth the extra second to actually notice.
const DURATIONS: Record<ToastNotification['type'], number> = {
  success: 4500,
  info: 4500,
  warning: 6500,
  error: 7500,
};

const STYLES: Record<ToastNotification['type'], { icon: typeof CheckCircle2; color: string; ring: string }> = {
  success: { icon: CheckCircle2, color: 'text-success-state', ring: 'rgba(0,229,163,0.35)' },
  error: { icon: XCircle, color: 'text-red-400', ring: 'rgba(248,113,113,0.35)' },
  warning: { icon: AlertTriangle, color: 'text-amber-400', ring: 'rgba(251,191,36,0.35)' },
  info: { icon: Info, color: 'text-sky-400', ring: 'rgba(56,189,248,0.35)' },
};

function ToastCard({ toast, onDismiss }: { toast: ToastNotification; onDismiss: (id: string) => void }) {
  const reduceMotion = useReducedMotion();
  const { icon: Icon, color, ring } = STYLES[toast.type];

  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const t = setTimeout(() => dismissRef.current(toast.id), DURATIONS[toast.type]);
    return () => clearTimeout(t);
  }, [toast.id, toast.type]);

  return (
    <motion.div
      layout
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 40, scale: 0.95 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 40, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.8 }}
      className="pointer-events-auto w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border-custom bg-surface/95 shadow-xl backdrop-blur-md"
      style={{ boxShadow: `0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px ${ring}` }}
    >
      <div className="flex items-start gap-3 p-3.5">
        <Icon size={18} className={`mt-0.5 flex-shrink-0 ${color}`} />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-text-primary">{toast.title}</div>
          <p className="mt-0.5 text-[11px] leading-snug text-text-secondary">{toast.message}</p>
          {toast.txHash && (
            <a
              href={`https://coston2-explorer.flare.network/tx/${toast.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-accent-primary hover:underline"
            >
              View on Explorer <ExternalLink size={10} />
            </a>
          )}
        </div>
        <button
          onClick={() => onDismiss(toast.id)}
          className="flex-shrink-0 text-text-secondary/60 hover:text-text-primary cursor-pointer"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </motion.div>
  );
}

/** Mounted once, globally — see providers.tsx. Shows every new notification as a transient popup, independent of the persistent bell history in navbar.tsx. */
export function NotificationToastStack({ toasts, onDismiss }: { toasts: ToastNotification[]; onDismiss: (id: string) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}
