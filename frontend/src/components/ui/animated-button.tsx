"use client";

import React from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';

interface AnimatedButtonProps extends HTMLMotionProps<"button"> {
  children?: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'glass' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

export const AnimatedButton: React.FC<AnimatedButtonProps> = ({
  children,
  className,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  ...props
}) => {
  const [isHovered, setIsHovered] = React.useState(false);

  const baseStyles = "relative inline-flex items-center justify-center font-display rounded-lg font-medium transition-all focus:outline-none focus:ring-1 focus:ring-accent-primary/50 overflow-hidden cursor-pointer active:scale-[0.98]";

  const variantStyles = {
    primary: "bg-accent-primary text-bg-base hover:bg-accent-primary/90 hover:shadow-[0_0_15px_rgba(255,165,0,0.4)]",
    secondary: "bg-accent-secondary text-text-primary hover:bg-accent-secondary/90 hover:shadow-[0_0_15px_rgba(255,255,255,0.2)]",
    glass: "glass-panel border-border-custom text-text-primary hover:bg-surface/60 hover:border-accent-primary/30",
    ghost: "bg-transparent border border-transparent text-text-secondary hover:text-text-primary hover:bg-surface/20"
  };

  const sizeStyles = {
    sm: "px-3 py-1.5 text-xs tracking-wider",
    md: "px-5 py-2.5 text-sm tracking-wide",
    lg: "px-8 py-3.5 text-base tracking-widest uppercase font-semibold"
  };

  return (
    <motion.button
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      whileHover={{
        scale: 1.05,
        rotate: -2,
      }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      className={cn(
        baseStyles,
        variantStyles[variant],
        sizeStyles[size],
        fullWidth && "w-full",
        className
      )}
      {...props}
    >
      {/* Glow highlight for premium buttons */}
      {(variant === 'primary' || variant === 'secondary') && (
        <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full hover:animate-[shimmer_1.5s_infinite]" />
      )}
      
      {/* Glowing ring effect */}
      {isHovered && (
        <motion.span
          layoutId="button-glow"
          className="absolute inset-0 rounded-lg border border-accent-primary/40 pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        />
      )}

      <span className="relative z-10 flex items-center justify-center gap-2">
        {children}
      </span>
    </motion.button>
  );
};
