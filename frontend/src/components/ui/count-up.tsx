"use client";

import React from 'react';
import { animate, useInView } from 'framer-motion';

interface CountUpProps {
  value: string;
  duration?: number;
  className?: string;
}

// Splits "$84.2M" into prefix "$", number 84.2, suffix "M" so only the
// numeric run animates and the formatting survives verbatim.
const PARTS = /^([^\d-]*)(-?[\d,]*\.?\d+)([\s\S]*)$/;

export function CountUp({ value, duration = 1.8, className }: CountUpProps) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });

  const match = value.match(PARTS);
  const prefix = match?.[1] ?? '';
  const raw = match?.[2] ?? '';
  const suffix = match?.[3] ?? '';

  const target = Number(raw.replace(/,/g, ''));
  const decimals = raw.includes('.') ? raw.split('.')[1].length : 0;
  const grouped = raw.includes(',');

  const format = React.useCallback(
    (n: number) => {
      const fixed = n.toFixed(decimals);
      if (!grouped) return fixed;
      const [int, frac] = fixed.split('.');
      const withCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return frac ? `${withCommas}.${frac}` : withCommas;
    },
    [decimals, grouped]
  );

  React.useEffect(() => {
    const node = ref.current;
    if (!node || !inView || !match || Number.isNaN(target)) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      node.textContent = value;
      return;
    }

    const controls = animate(0, target, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate(n) {
        node.textContent = `${prefix}${format(n)}${suffix}`;
      },
    });
    return () => controls.stop();
  }, [inView, target, duration, prefix, suffix, format, match, value]);

  // Unparseable values render as-is; the initial text also keeps SSR output
  // identical to the final state so there is no layout shift.
  if (!match || Number.isNaN(target)) {
    return <span className={className}>{value}</span>;
  }

  return (
    <span ref={ref} className={className}>
      {value}
    </span>
  );
}
