"use client";

import React from 'react';
import { cn } from '@/lib/utils';

interface GlowBorderProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  active?: boolean;
  glowColor?: 'cyan' | 'purple' | 'success';
}

export const GlowBorder: React.FC<GlowBorderProps> = ({
  children,
  className,
  active = true,
  glowColor = 'cyan',
  ...props
}) => {
  const glowClasses = {
    cyan: "shadow-[0_0_15px_rgba(161,161,170,0.15)] border-accent-primary/20",
    purple: "shadow-[0_0_15px_rgba(255,0,122,0.15)] border-accent-secondary/20",
    success: "shadow-[0_0_15px_rgba(0,229,163,0.15)] border-success-state/20"
  };

  return (
    <div
      className={cn(
        "relative rounded-xl border transition-all duration-500",
        active ? glowClasses[glowColor] : "border-border-custom",
        className
      )}
      {...props}
    >
      {/* Absolute pulsing background border glow */}
      {active && (
        <div className={cn(
          "absolute -inset-px rounded-xl opacity-20 blur-sm pointer-events-none animate-border-pulse transition-opacity duration-500",
          glowColor === 'cyan' && "bg-accent-primary",
          glowColor === 'purple' && "bg-accent-secondary",
          glowColor === 'success' && "bg-success-state"
        )} />
      )}
      <div className="relative z-10 w-full h-full">
        {children}
      </div>
    </div>
  );
};
