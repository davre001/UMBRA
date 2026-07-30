'use client';

import React from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface LogoProps {
  size?: number;
  showText?: boolean;
  className?: string;
  textClassName?: string;
  iconOnly?: boolean;
  animated?: boolean;
}

export function UmbraLogo({
  size = 28,
  showText = true,
  className,
  textClassName,
  iconOnly = false,
  animated = true,
}: LogoProps) {
  return (
    <div className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <div className={cn("relative flex items-center justify-center flex-shrink-0 transition-transform duration-300 hover:scale-105", animated && "group")}>
        {/* Glow effect behind icon */}
        <div 
          className="absolute inset-0 rounded-full bg-accent-primary/20 blur-md opacity-70 transition-opacity duration-300 group-hover:opacity-100"
          style={{ width: size, height: size }}
        />
        
        {/* Official Umbra Shield Logo Image */}
        <Image
          src="/logo.png"
          alt="Umbra Protocol"
          width={size}
          height={size}
          priority
          className="relative z-10 object-contain drop-shadow-[0_0_8px_rgba(245,158,11,0.3)]"
          style={{ width: `${size}px`, height: `${size}px` }}
        />
      </div>

      {!iconOnly && showText && (
        <span className={cn("font-display font-extrabold tracking-widest text-text-primary uppercase flex items-center", textClassName || "text-lg")}>
          UMBRA
          <span className="text-accent-primary ml-0.5 animate-pulse">.</span>
        </span>
      )}
    </div>
  );
}

export default UmbraLogo;
