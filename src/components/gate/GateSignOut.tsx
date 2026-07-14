'use client';

import React, { useState, useTransition } from 'react';
import { LogOutIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CROWN } from './tokens';
import { signOutGateAction } from '@/features/auth/actions';

interface Props {
  locale: 'ar' | 'en';
  /** Compact icon-style trigger for the tight mobile header. */
  compact?: boolean;
}

export function GateSignOut({ locale, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const tGate = useTranslations('gate');
  const tAuth = useTranslations('auth');
  const tCommon = useTranslations('common');

  const confirm = () => {
    startTransition(async () => {
      await signOutGateAction(locale);
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={tAuth('signOut')}
        title={tAuth('signOut')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          height: compact ? 32 : 38,
          padding: compact ? '0 11px' : '0 14px',
          borderRadius: 999,
          cursor: 'pointer',
          background: 'transparent',
          border: `1px solid ${CROWN.line}`,
          color: CROWN.dim,
          fontFamily: CROWN.sans,
          fontSize: compact ? 11 : 12.5,
          fontWeight: 600,
          letterSpacing: 0.3,
          whiteSpace: 'nowrap',
        }}
      >
        <LogOutIcon size={compact ? 14 : 16} />
        {!compact && <span>{tAuth('signOut')}</span>}
      </button>

      {open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            background: 'rgba(28,43,64,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
          onClick={() => {
            if (!pending) setOpen(false);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={tAuth('signOut')}
            style={{
              width: '100%',
              maxWidth: 380,
              background: CROWN.panel,
              borderRadius: 22,
              border: `1px solid ${CROWN.line}`,
              padding: 26,
              animation: 'crown-fadeIn 0.22s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 14 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 999,
                  display: 'grid',
                  placeItems: 'center',
                  background: 'rgba(192,57,43,0.10)',
                  border: `1px solid ${CROWN.bad}55`,
                  color: CROWN.bad,
                  flexShrink: 0,
                }}
              >
                <LogOutIcon size={20} />
              </div>
              <h2 style={{ margin: 0, fontFamily: CROWN.serif, fontSize: 24, fontWeight: 500, color: CROWN.cream, lineHeight: 1.1 }}>
                {tGate('signOutTitle')}
              </h2>
            </div>
            <p style={{ margin: '0 0 22px', fontFamily: CROWN.sans, fontSize: 13, lineHeight: 1.55, color: CROWN.dim }}>
              {tGate('signOutDesc')}
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                style={{
                  flex: 1,
                  height: 50,
                  borderRadius: 14,
                  cursor: pending ? 'default' : 'pointer',
                  background: CROWN.panel2,
                  border: `1px solid ${CROWN.line}`,
                  color: CROWN.cream,
                  fontFamily: CROWN.sans,
                  fontSize: 13.5,
                  fontWeight: 600,
                  letterSpacing: 0.3,
                  opacity: pending ? 0.6 : 1,
                }}
              >
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={pending}
                style={{
                  flex: 1,
                  height: 50,
                  borderRadius: 14,
                  border: 'none',
                  cursor: pending ? 'default' : 'pointer',
                  background: CROWN.bad,
                  color: CROWN.panel,
                  fontFamily: CROWN.sans,
                  fontSize: 13.5,
                  fontWeight: 700,
                  letterSpacing: 0.3,
                  opacity: pending ? 0.7 : 1,
                }}
              >
                {pending ? tGate('signingOut') : tAuth('signOut')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
