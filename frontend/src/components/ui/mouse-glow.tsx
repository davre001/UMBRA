"use client";

import React, { useEffect } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';

export const MouseGlow: React.FC = () => {
  const x = useMotionValue(-1000);
  const y = useMotionValue(-1000);

  const springX = useSpring(x, { damping: 50, stiffness: 300 });
  const springY = useSpring(y, { damping: 50, stiffness: 300 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Position the glow center at cursor
      x.set(e.clientX);
      y.set(e.clientY);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [x, y]);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* Primary Cyan Glow */}
      <motion.div
        className="absolute w-[600px] h-[600px] rounded-full"
        style={{
          x: springX,
          y: springY,
          translateX: "-50%",
          translateY: "-50%",
          background: "radial-gradient(circle, rgba(255, 165, 0, 0.04) 0%, rgba(255, 255, 255, 0.01) 40%, transparent 70%)",
        }}
      />
      {/* Secondary Soft Ambient Purple Glow */}
      <motion.div
        className="absolute w-[800px] h-[800px] rounded-full"
        style={{
          x: springX,
          y: springY,
          translateX: "-50%",
          translateY: "-50%",
          background: "radial-gradient(circle, rgba(255, 255, 255, 0.01) 0%, transparent 60%)",
        }}
      />
    </div>
  );
};
