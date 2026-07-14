'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2Icon, ShieldCheckIcon, XIcon } from 'lucide-react';
import { CROWN } from './tokens';
import { formatMoney } from '@/lib/money';
import { authorizeDiscountAction } from '@/features/reception/actions';

/**
 * Reception discount control — one discount per booking: a customer promo code
 * OR a supervisor-authorized manual discount (PIN → role-capped %). The booking
 * gets recorded under the authorizing supervisor; a "Return to normal" button
 * clears the override.
 */

type Mode = 'none' | 'promo' | 'manual';
interface Authorizer { name: string; role: string; maxPercent: number }

export interface DiscountValue {
  promoCode: string | null;
  manualDiscount: { pin: string; percent: number } | null;
}

const ERR_CODES = ['pin_not_found', 'not_authorized', 'invalid_pin', 'forbidden', 'rate_limited'] as const;

const { line, cream, dim, faint, gold, ok, bad, sans, serif } = CROWN;

const fieldBox: React.CSSProperties = {
  width: '100%', height: 48, borderRadius: 12, background: '#ffffff',
  border: `1px solid ${line}`, color: cream, padding: '0 14px', fontSize: 15,
  fontFamily: sans, outline: 'none',
};

const ROLE_KEYS = ['STAFF', 'SUPERVISOR', 'MANAGER', 'DIRECTOR', 'ADMIN', 'SUPER_ADMIN', 'DEVELOPER'] as const;

export function DiscountSection({
  totalCents,
  locale,
  resetSignal,
  onChange,
}: {
  totalCents: number;
  locale: 'ar' | 'en';
  resetSignal?: number;
  onChange: (v: DiscountValue) => void;
}) {
  const t = useTranslations('reception.discount');
  const [mode, setMode] = useState<Mode>('none');
  const [promo, setPromo] = useState('');
  const [pin, setPin] = useState('');
  const [percent, setPercent] = useState(0);
  const [auth, setAuth] = useState<Authorizer | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Full reset when the parent bumps the signal (after a booking is created).
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setMode('none'); setPromo(''); setPin(''); setPercent(0); setAuth(null); setErr(null);
    });
    return () => { cancelled = true; };
  }, [resetSignal]);

  // Emit the discount payload upward whenever it changes.
  useEffect(() => {
    if (mode === 'promo') onChange({ promoCode: promo.trim() || null, manualDiscount: null });
    else if (mode === 'manual' && auth && percent >= 1) onChange({ promoCode: null, manualDiscount: { pin, percent } });
    else onChange({ promoCode: null, manualDiscount: null });
  }, [mode, promo, auth, percent, pin, onChange]);

  async function authorize() {
    setBusy(true);
    setErr(null);
    const res = await authorizeDiscountAction(pin);
    setBusy(false);
    if (res.ok) {
      setAuth({ name: res.name, role: res.role, maxPercent: res.maxPercent });
      setPercent(Math.min(10, res.maxPercent));
    } else {
      setAuth(null);
      setErr((ERR_CODES as readonly string[]).includes(res.code) ? t(`errors.${res.code}`) : t('errors.default'));
    }
  }

  function returnToNormal() {
    setAuth(null); setPin(''); setPercent(0); setErr(null); setMode('none');
  }

  const cap = auth?.maxPercent ?? 0;
  const cappedPercent = Math.max(0, Math.min(percent, cap));
  const discountCents = Math.round((totalCents * cappedPercent) / 100);

  const tabs: { id: Mode; label: string }[] = [
    { id: 'none', label: t('tabs.none') },
    { id: 'promo', label: t('tabs.promo') },
    { id: 'manual', label: t('tabs.manual') },
  ];

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontFamily: sans, fontSize: 11, letterSpacing: '1.6px', fontWeight: 600, color: faint, marginBottom: 10 }}>
        {t('heading')}
      </div>

      {/* Segmented mode toggle */}
      <div style={{ display: 'flex', gap: 6, padding: 4, background: 'rgba(28,43,64,0.05)', borderRadius: 13, border: `1px solid ${line}` }}>
        {tabs.map((tab) => {
          const on = mode === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => { setErr(null); setMode(tab.id); if (tab.id !== 'manual') { setAuth(null); setPin(''); setPercent(0); } if (tab.id !== 'promo') setPromo(''); }}
              aria-pressed={on}
              style={{
                flex: 1, height: 38, borderRadius: 10, border: 'none', cursor: 'pointer',
                background: on ? gold : 'transparent', color: on ? '#ffffff' : dim,
                fontFamily: sans, fontSize: 13, fontWeight: 700, letterSpacing: '0.2px', transition: 'all 0.16s',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Promo code */}
      {mode === 'promo' && (
        <div style={{ marginTop: 14 }}>
          <input
            value={promo}
            onChange={(e) => setPromo(e.target.value.toUpperCase())}
            placeholder={t('promo.placeholder')}
            style={fieldBox}
            aria-label={t('promo.ariaLabel')}
          />
          <p style={{ color: faint, fontSize: 11, marginTop: 6, fontFamily: sans }}>
            {t('promo.hint')}
          </p>
        </div>
      )}

      {/* Custom (supervisor) discount */}
      {mode === 'manual' && !auth && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, color: dim, fontFamily: sans, fontSize: 12.5 }}>
            <ShieldCheckIcon style={{ width: 15, height: 15, color: gold }} />
            {t('manual.prompt')}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              onKeyDown={(e) => { if (e.key === 'Enter' && pin.length >= 4) authorize(); }}
              placeholder="••••"
              inputMode="numeric"
              autoComplete="off"
              aria-label={t('manual.pinAriaLabel')}
              style={{ ...fieldBox, flex: 1, letterSpacing: '0.4em', fontSize: 18 }}
            />
            <button
              type="button"
              onClick={authorize}
              disabled={busy || pin.length < 4}
              style={{
                height: 48, padding: '0 22px', borderRadius: 12, border: 'none',
                cursor: busy || pin.length < 4 ? 'default' : 'pointer',
                background: pin.length >= 4 ? gold : 'rgba(28,43,64,0.06)',
                color: pin.length >= 4 ? '#ffffff' : faint,
                fontFamily: sans, fontSize: 14, fontWeight: 700, opacity: busy ? 0.7 : 1, whiteSpace: 'nowrap',
              }}
            >
              {busy ? t('manual.checking') : t('manual.authorize')}
            </button>
          </div>
          {err && <p style={{ color: bad, fontSize: 12.5, marginTop: 8, fontFamily: sans }}>{err}</p>}
        </div>
      )}

      {mode === 'manual' && auth && (
        <div style={{ marginTop: 14 }}>
          {/* Authorizer banner */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderRadius: 12, background: 'rgba(31,157,99,0.10)', border: `1px solid ${ok}44` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <CheckCircle2Icon style={{ width: 18, height: 18, color: ok, flexShrink: 0 }} />
              <div>
                <div style={{ fontFamily: sans, fontSize: 13.5, fontWeight: 700, color: cream }}>{auth.name}</div>
                <div style={{ fontFamily: sans, fontSize: 11.5, color: dim }}>
                  {t('roleCap', {
                    role: (ROLE_KEYS as readonly string[]).includes(auth.role) ? t(`roles.${auth.role}`) : auth.role,
                    percent: auth.maxPercent,
                  })}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={returnToNormal}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 12px', borderRadius: 9, cursor: 'pointer', background: 'transparent', border: `1px solid ${line}`, color: dim, fontFamily: sans, fontSize: 12, fontWeight: 600 }}
            >
              <XIcon style={{ width: 13, height: 13 }} />
              {t('manual.returnToNormal')}
            </button>
          </div>

          {/* Percent entry */}
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'flex-end', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontFamily: sans, fontSize: 11, letterSpacing: '1px', color: faint, marginBottom: 6 }}>{t('manual.percentLabel')}</label>
              <input
                type="number"
                min={1}
                max={cap}
                value={percent || ''}
                onChange={(e) => { const v = parseInt(e.target.value, 10); setPercent(Number.isNaN(v) ? 0 : Math.max(0, Math.min(cap, v))); }}
                aria-label={t('manual.percentAriaLabel')}
                style={{ ...fieldBox, fontVariantNumeric: 'tabular-nums' }}
              />
            </div>
            <div style={{ textAlign: 'end', minWidth: 120 }}>
              <div style={{ fontFamily: sans, fontSize: 11, color: faint }}>− {formatMoney(discountCents, { locale, currency: 'EGP' })}</div>
              <div style={{ fontFamily: serif, fontSize: 26, fontWeight: 600, color: gold, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
                {formatMoney(Math.max(0, totalCents - discountCents), { locale, currency: 'EGP' })}
              </div>
            </div>
          </div>
          {percent > cap && (
            <p style={{ color: bad, fontSize: 12, marginTop: 8, fontFamily: sans }}>{t('manual.cappedNote', { cap })}</p>
          )}
          <p style={{ color: faint, fontSize: 11, marginTop: 8, fontFamily: sans }}>
            {t('manual.recordedBy', { name: auth.name })}
          </p>
        </div>
      )}
    </div>
  );
}
