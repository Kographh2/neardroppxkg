'use client';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
export const motionTokens = { fast: 0.14, normal: 0.24, slow: 0.42 };
export function AnimatedText({ children, className = '' }: { children: string; className?: string }) {
  const reduced = useReducedMotion();
  return <span className={`animated-text ${className}`}><AnimatePresence mode="wait" initial={false}><motion.span key={children} initial={reduced ? false : { opacity: 0, y: 9, filter: 'blur(2px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={reduced ? undefined : { opacity: 0, y: -6 }} transition={{ duration: motionTokens.normal }}>{children}</motion.span></AnimatePresence></span>;
}
