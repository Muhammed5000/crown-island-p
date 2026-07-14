'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2Icon, AlertTriangleIcon, InfoIcon, XIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Lightweight toast system for server-action feedback.
 *
 * Accessibility: toasts render inside a polite live region so screen readers
 * announce new messages; error toasts use `role="alert"` (assertive) while
 * success/info use `role="status"`. Auto-dismiss after a few seconds; each is
 * also manually dismissible. This is the missing "feedback for server actions"
 * channel — replaces scattered `alert()` calls.
 */

type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const TONE_STYLES: Record<ToastTone, string> = {
  success: 'border-green-500/30 bg-green-50 text-green-800',
  error: 'border-red-500/30 bg-red-50 text-red-800',
  info: 'border-teal-500/30 bg-teal-50 text-teal-800',
};

const TONE_ICONS = { success: CheckCircle2Icon, error: AlertTriangleIcon, info: InfoIcon } as const;

const DISMISS_MS = 4500;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = (idRef.current += 1);
      setItems((prev) => [...prev, { id, message, tone }]);
      setTimeout(() => remove(id), DISMISS_MS);
    },
    [remove],
  );

  const value = useMemo<ToastContextValue>(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end"
        aria-live="polite"
        aria-relevant="additions"
      >
        <AnimatePresence initial={false}>
          {items.map((t) => {
            const Icon = TONE_ICONS[t.tone];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 12, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                role={t.tone === 'error' ? 'alert' : 'status'}
                className={cn(
                  'pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur-md',
                  TONE_STYLES[t.tone],
                )}
              >
                <Icon className="mt-0.5 size-4 shrink-0" />
                <span className="flex-1">{t.message}</span>
                <button
                  type="button"
                  onClick={() => remove(t.id)}
                  aria-label="Dismiss"
                  className="opacity-70 transition-opacity hover:opacity-100"
                >
                  <XIcon className="size-4" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx.toast;
}
