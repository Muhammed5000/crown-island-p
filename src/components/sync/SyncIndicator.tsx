'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { RefreshCwIcon, UploadCloudIcon, WifiOffIcon, CheckCircle2Icon } from 'lucide-react';
import { useSyncStatus } from '@/components/providers/SyncStatusProvider';
import { cn } from '@/lib/cn';

/**
 * Bottom-left popup that shows reception/gate staff what the local venue node is
 * doing: pulling master data, pushing venue operations up, freshly synced, or
 * offline (new bookings paused). Consumes the existing `SyncStatusProvider`.
 * Renders nothing on any node that isn't the local venue node (mode !== 'local').
 * Bilingual: mirrors the page's `lang`.
 */

type Tone = 'offline' | 'busy' | 'ok';

const TONE_STYLES: Record<Tone, string> = {
  offline: 'border-amber-500/30 bg-amber-50 text-amber-800',
  busy: 'border-sky-500/30 bg-sky-50 text-sky-800',
  ok: 'border-green-500/30 bg-green-50 text-green-800',
};

function isArabic(): boolean {
  if (typeof document === 'undefined') return false;
  return (document.documentElement.lang || '').toLowerCase().startsWith('ar');
}

export function SyncIndicator() {
  const s = useSyncStatus();
  const [justSynced, setJustSynced] = useState(false);
  const prevActivity = useRef<string>('idle');

  useEffect(() => {
    if (!s.loaded) return;
    const prev = prevActivity.current;
    prevActivity.current = s.activity;
    // Flash "Synced" the moment a pull/push finishes and we're still online.
    if ((prev === 'pulling' || prev === 'pushing') && s.activity === 'idle' && s.online) {
      setJustSynced(true);
      const t = setTimeout(() => setJustSynced(false), 3000);
      return () => clearTimeout(t);
    }
  }, [s.activity, s.loaded, s.online]);

  if (!s.loaded || s.mode !== 'local') return null;

  const ar = isArabic();
  const queued = s.outboxDepth > 0 ? ` (${s.outboxDepth})` : '';
  let view: { tone: Tone; icon: React.ReactNode; label: string } | null = null;

  if (!s.online) {
    view = {
      tone: 'offline',
      icon: <WifiOffIcon className="size-4 shrink-0" />,
      label: (ar ? 'يعمل دون اتصال · الحجوزات الجديدة متوقفة' : 'Working offline · new bookings paused') + queued,
    };
  } else if (s.activity === 'pulling') {
    view = {
      tone: 'busy',
      icon: <RefreshCwIcon className="size-4 shrink-0 animate-spin" />,
      label: ar ? 'جارٍ سحب البيانات…' : 'Pulling data…',
    };
  } else if (s.activity === 'pushing') {
    view = {
      tone: 'busy',
      icon: <UploadCloudIcon className="size-4 shrink-0 animate-pulse" />,
      label: (ar ? 'جارٍ رفع البيانات…' : 'Pushing data…') + queued,
    };
  } else if (justSynced) {
    view = {
      tone: 'ok',
      icon: <CheckCircle2Icon className="size-4 shrink-0" />,
      label: ar ? 'تمت المزامنة' : 'Synced',
    };
  } else if (s.outboxDepth > 0) {
    view = {
      tone: 'busy',
      icon: <UploadCloudIcon className="size-4 shrink-0" />,
      label: (ar ? 'تغييرات في انتظار المزامنة' : 'changes queued') + queued,
    };
  }

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[90]" dir={ar ? 'rtl' : 'ltr'}>
      <AnimatePresence>
        {view && (
          <motion.div
            key={`${view.tone}:${view.label}`}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            role="status"
            aria-live="polite"
            className={cn(
              'pointer-events-auto flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-medium shadow-lg backdrop-blur-md',
              TONE_STYLES[view.tone],
            )}
          >
            {view.icon}
            <span>{view.label}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
