import { setRequestLocale } from 'next-intl/server';
import { requireOpsOrNull } from '@/server/auth/guards';
import { canManageOps, isOpsOperator, isOpsStaffRole } from '@/server/auth/roles';
import {
  getOpsSummary,
  listMyStaffNotifications,
  listOpsStaff,
  listOpsTickets,
} from '@/server/services/ops-tickets';
import { isLocale } from '@/i18n/config';
import { OpsDesk } from '@/components/ops/OpsDesk';

interface Props {
  params: Promise<{ locale: string }>;
}

/**
 * Housekeeping & Maintenance staff desk (`/gate/ops`).
 *
 * Every gate-authorised role may enter: HOUSEKEEPING / MAINTENANCE staff work
 * tickets here (and are CONFINED here by the proxy), reception & gate staff
 * report issues, managers / admin tiers run the board (assign, prioritise,
 * cancel, return places to service). Customers get a 403 from the gate layout;
 * a non-gate signed-in account reaching this page directly gets the panel
 * below.
 */
export default async function OpsPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const staffUser = await requireOpsOrNull();
  if (!staffUser) {
    return (
      <main dir="ltr" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div
          style={{
            maxWidth: 380,
            textAlign: 'center',
            padding: '32px 28px',
            borderRadius: 20,
            background: '#ffffff',
            border: '1px solid rgba(28,43,64,0.12)',
            boxShadow: '0 10px 30px rgba(28,43,64,0.08)',
            color: '#1c2b40',
            fontFamily: 'var(--font-aurelia-sans), system-ui, sans-serif',
          }}
        >
          <p style={{ fontFamily: 'var(--font-aurelia-display), serif', fontSize: 28, fontWeight: 600, color: '#9c7d34', margin: 0 }}>
            403
          </p>
          <h1 style={{ fontSize: 16, fontWeight: 600, margin: '12px 0 8px' }}>Operations access restricted</h1>
          <p style={{ fontSize: 13, lineHeight: 1.5, color: 'rgba(28,43,64,0.62)', margin: 0 }}>
            This account is not authorised for the housekeeping &amp; maintenance desk.
          </p>
        </div>
      </main>
    );
  }

  const viewer = { id: staffUser.id, role: staffUser.role };
  const isManager = canManageOps(staffUser.role);
  const isOperator = isOpsOperator(staffUser.role);
  const [rows, summary, staff, notifications] = await Promise.all([
    listOpsTickets(viewer, { status: 'OPEN_ALL' }),
    getOpsSummary(viewer),
    // Every operator can route work, so they all need the assignable list;
    // SECURITY (reporter only) gets none → no assign UI renders for them.
    isOperator ? listOpsStaff() : Promise.resolve([]),
    listMyStaffNotifications(staffUser.id),
  ]);

  return (
    <OpsDesk
      viewer={{
        id: staffUser.id,
        name: staffUser.name ?? staffUser.email ?? 'Staff',
        role: staffUser.role,
        isManager,
        isOperator,
        isOpsStaff: isOpsStaffRole(staffUser.role),
        canReturnToService: isManager || staffUser.role === 'MAINTENANCE',
      }}
      staff={staff}
      initialRows={rows}
      initialSummary={summary}
      initialNotifications={notifications.rows}
      initialUnread={notifications.unread}
    />
  );
}
