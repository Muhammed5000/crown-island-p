'use client';

import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
}

/**
 * Subtle fade-up wrapper used on top-level page roots.
 * Kept on the client because Framer Motion needs `useReducedMotion` and DOM access.
 */
export function PageTransition({ children, className }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
