"use client";

import React, { useRef, useState } from 'react';
import { motion, useMotionTemplate, useMotionValue } from 'framer-motion';
import { cn } from '@/lib/utils';

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  hoverGlow?: boolean;
  glowColor?: 'cyan' | 'purple' | 'success';
}

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  className,
  hoverGlow = true,
  glowColor = 'cyan',
  ...props
}) => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const { left, top } = cardRef.current.getBoundingClientRect();
    mouseX.set(e.clientX - left);
    mouseY.set(e.clientY - top);
  };

  const handleMouseEnter = () => setIsHovered(true);
  const handleMouseLeave = () => setIsHovered(false);

  // Spotlight gradient styling
  const glowRGB = {
    cyan: '255, 165, 0',
    purple: '255, 255, 255',
    success: '0, 229, 163',
  }[glowColor];

  const background = useMotionTemplate`
    radial-gradient(
      350px circle at ${mouseX}px ${mouseY}px,
      rgba(${glowRGB}, 0.09) 0%,
      transparent 80%
    )
  `;

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "relative rounded-xl border border-border-custom bg-surface/40 backdrop-blur-md overflow-hidden transition-all duration-300",
        hoverGlow && "hover:border-border-custom/80 hover:shadow-[0_0_25px_rgba(0,0,0,0.4)]",
        className
      )}
      {...props}
    >
      {/* Background Spotlight Radial Glow */}
      {hoverGlow && isHovered && (
        <motion.div
          className="pointer-events-none absolute inset-0 z-0 transition-opacity duration-300"
          style={{ background }}
        />
      )}

      {/* Content wrapper to float above glow */}
      <div className="relative z-10 w-full h-full">
        {children}
      </div>

      {/* Dynamic Proximity Border Highlight */}
      {hoverGlow && isHovered && (
        <div
          className="pointer-events-none absolute inset-0 z-20 rounded-xl"
          style={{
            border: `1px solid rgba(${glowRGB}, 0.25)`,
            transition: 'border-color 0.3s ease'
          }}
        />
      )}
    </div>
  );
};
