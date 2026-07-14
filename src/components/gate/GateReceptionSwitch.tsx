'use client';

import { usePathname, useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { canAccessReception, canAccessOps, isOpsStaffRole } from '@/server/auth/roles';

/**
 * Staff-area switch — routes between the gate surfaces the signed-in role may
 * use (Scanner / Reception / Ops desk).
 *
 * Rendered INLINE inside each surface's own header toolbar (centered, in normal
 * flow) — never as a floating overlay, so it can no longer cover the header's
 * brand / operator / sign-out content. The reception desk has its own
 * equivalent "Gate" button in its top bar, so this returns null there.
 *
 * Role gating mirrors the gate layout: SECURITY gets only the Scanner pill
 * (scan-only confinement); housekeeping/maintenance staff get no Scanner pill
 * (their home IS the ops desk). `@/server/auth/roles` is edge-safe (type-only
 * imports + plain string sets) so it is fine to pull into this client component.
 */
export function GateReceptionSwitch({ role }: { role: string | null | undefined }) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('gate');

  // The reception desk renders its own switch in its top bar.
  if (pathname.startsWith('/gate/reception')) return null;
  const onOps = pathname.startsWith('/gate/ops');

  const reception = canAccessReception(role);
  const ops = canAccessOps(role);
  const scanner = !isOpsStaffRole(role);

  const targets: { href: string; label: string }[] = [];
  if (onOps) {
    if (scanner) targets.push({ href: '/gate/scan', label: t('scanner') });
    if (reception) targets.push({ href: '/gate/reception', label: t('reception') });
  } else {
    if (reception) targets.push({ href: '/gate/reception', label: t('reception') });
    if (ops) targets.push({ href: '/gate/ops', label: t('opsDesk') });
  }
  if (targets.length === 0) return null;

  return (
    <div className="no-print" style={{ display: 'inline-flex', gap: 8 }}>
      {targets.map((target) => (
        <button
          key={target.href}
          type="button"
          onClick={() => router.push(target.href)}
          aria-label={`Switch to ${target.label}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            height: 38,
            padding: '0 16px',
            borderRadius: 999,
            cursor: 'pointer',
            background: 'rgba(194,161,78,0.14)',
            border: '1px solid #c2a14e',
            color: '#9c7d34',
            fontFamily: 'var(--font-aurelia-sans), system-ui, sans-serif',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.02em',
            whiteSpace: 'nowrap',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M8 7l-4 4 4 4M4 11h10M16 17l4-4-4-4M20 13H10"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {target.label}
        </button>
      ))}
    </div>
  );
}
