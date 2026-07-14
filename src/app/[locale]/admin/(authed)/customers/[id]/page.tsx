import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { BookingStatusBadge } from '@/components/booking/BookingStatusBadge';
import { adminGetCustomer } from '@/server/services/admin-customers';
import { adminGetUserSanctions } from '@/server/services/sanctions';
import { adminListTags } from '@/server/services/admin-tags';
import { getSessionUser } from '@/server/auth/guards';
import { auditStandalone } from '@/server/audit/audit';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/date';
import { isLocale } from '@/i18n/config';
import { CustomerNotesForm } from './CustomerNotesForm';
import { TagEditor } from './TagEditor';
import { BlockUnblockButton } from './BlockUnblockButton';
import { SanctionsCard } from './SanctionsCard';

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

const KIND_LABEL: Record<string, string> = { DAY_USE: 'Beach', CABANA: 'Cabana', EVENT: 'Event', OTHER: 'Other' };

export default async function AdminCustomerProfilePage({ params }: Props) {
  const { locale, id } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const [viewer, data, tagLibrary, sanctionData] = await Promise.all([
    getSessionUser(),
    adminGetCustomer(id),
    adminListTags(),
    adminGetUserSanctions(id),
  ]);
  if (!data) notFound();

  // Audit the profile view (fire-and-forget — a logging hiccup never blocks the page).
  if (viewer) {
    void auditStandalone({ actorUserId: viewer.id, action: 'VIEW', entityType: 'CustomerProfile', entityId: id }).catch(() => {});
  }

  const t = await getTranslations('admin');
  const { user, profile, rows, financial, stats, analytics, timeline, tags } = data;
  const money = (c: number) => formatMoney(c, { locale, currency: 'EGP' });
  const name = user.name ?? profile?.fullName ?? user.email ?? 'Customer';
  const initials = name.trim().slice(0, 2).toUpperCase();
  const ar = locale === 'ar';

  return (
    <div className="space-y-5">
      <Link href="/admin/customers" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-accent">
        ← {t('customers')}
      </Link>

      {/* ── Hero ── */}
      <Card>
        <CardBody className="flex flex-wrap items-center gap-5">
          <div className="grid size-16 place-items-center rounded-full bg-gradient-to-br from-gold-300 to-gold-600 font-display text-xl font-bold text-navy-950 shadow-gold">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-semibold text-gold-700">{name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span dir="ltr">{user.email ?? '—'}</span>
              <span dir="ltr">{user.phone ?? profile?.phone ?? '—'}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={user.emailVerified || user.phoneVerified ? 'success' : 'muted'}>
              {user.emailVerified || user.phoneVerified ? 'Verified' : 'Unverified'}
            </Badge>
            <Badge tone="navy">{user.role}</Badge>
            {sanctionData.activeCount > 0 ? (
              <Badge tone="danger">
                {sanctionData.activeCount} unpaid sanction{sanctionData.activeCount > 1 ? 's' : ''}
              </Badge>
            ) : null}
            {profile?.isHandicapped ? <Badge tone="info">Accessibility</Badge> : null}
            {profile?.marketingOpt ? <Badge tone="gold">Marketing opt-in</Badge> : null}
          </div>
        </CardBody>
      </Card>

      {/* ── Financial summary ── */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total spent" value={money(financial.totalSpentCents)} accent />
        <Stat label="Total paid" value={money(financial.totalPaidCents)} />
        <Stat label="Outstanding" value={money(financial.outstandingCents)} warn={financial.outstandingCents > 0} />
        <Stat label="Refunds" value={money(financial.totalRefundCents)} />
        <Stat label="Lifetime value" value={money(financial.lifetimeValueCents)} accent />
        <Stat label="Avg booking" value={money(financial.avgBookingCents)} />
        <Stat label="Highest" value={money(financial.highestBookingCents)} />
        <Stat label="Lowest" value={money(financial.lowestBookingCents)} />
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* ── Left column ── */}
        <div className="space-y-5 lg:col-span-2">
          {/* Booking statistics */}
          <Card>
            <CardHeader><h2 className="font-display text-base text-gold-700">Booking statistics</h2></CardHeader>
            <CardBody>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Tile n={stats.total} label="Total" />
                <Tile n={stats.confirmed} label="Confirmed" tone="success" />
                <Tile n={stats.upcoming} label="Upcoming" tone="info" />
                <Tile n={stats.checkedIn} label="Checked in" tone="gold" />
                <Tile n={stats.pending} label="Pending" tone="warning" />
                <Tile n={stats.cancelled} label="Cancelled" tone="danger" />
                <Tile n={stats.refunded} label="Refunded" />
                <Tile n={stats.totalGuests} label="Total guests" />
              </div>
              {/* status distribution bar */}
              {stats.total > 0 ? (
                <div className="mt-4">
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-muted/40">
                    <Bar n={stats.confirmed} total={stats.total} className="bg-success" />
                    <Bar n={stats.pending} total={stats.total} className="bg-warning" />
                    <Bar n={stats.cancelled + stats.expired + stats.failed} total={stats.total} className="bg-danger" />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    <Legend className="bg-success" label={`Confirmed ${stats.confirmed}`} />
                    <Legend className="bg-warning" label={`Pending ${stats.pending}`} />
                    <Legend className="bg-danger" label={`Closed ${stats.cancelled + stats.expired + stats.failed}`} />
                  </div>
                </div>
              ) : null}
            </CardBody>
          </Card>

          {/* Bookings */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <h2 className="font-display text-base text-gold-700">Bookings ({rows.length})</h2>
            </CardHeader>
            <CardBody className="overflow-x-auto p-0">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-start">Reference</th>
                    <th className="px-4 py-3 text-start">Date</th>
                    <th className="px-4 py-3 text-start">Service</th>
                    <th className="px-4 py-3 text-end">Guests</th>
                    <th className="px-4 py-3 text-end">Total</th>
                    <th className="px-4 py-3 text-end">Paid</th>
                    <th className="px-4 py-3 text-end">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {rows.map(({ b, total, paid }) => (
                    <tr key={b.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <Link href={`/admin/bookings/${b.id}`} dir="ltr" className="font-display text-accent underline-offset-4 hover:underline">
                          {b.reference}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(b.bookingDate, locale)}
                        {b.endDate && b.endDate.getTime() !== b.bookingDate.getTime() ? ` → ${formatDate(b.endDate, locale)}` : ''}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {ar ? b.service.category.nameAr : b.service.category.nameEn} · {KIND_LABEL[b.service.kind] ?? b.service.kind}
                      </td>
                      <td className="px-4 py-3 text-end tabular-nums text-muted-foreground">{b.people}</td>
                      <td className="px-4 py-3 text-end tabular-nums">{total > 0 ? money(total) : '—'}</td>
                      <td className="px-4 py-3 text-end tabular-nums text-muted-foreground">{paid > 0 ? money(paid) : '—'}</td>
                      <td className="px-4 py-3 text-end"><BookingStatusBadge status={b.status} /></td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No bookings yet.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </CardBody>
          </Card>

          {/* Activity timeline */}
          <Card>
            <CardHeader><h2 className="font-display text-base text-gold-700">Activity timeline</h2></CardHeader>
            <CardBody>
              <ol className="relative space-y-4 ps-5">
                <span className="absolute inset-y-1 start-[5px] w-px bg-border/60" aria-hidden />
                {timeline.slice(0, 40).map((ev, i) => (
                  <li key={i} className="relative">
                    <span className={`absolute -start-[18px] top-1 size-2.5 rounded-full ring-4 ring-background ${TL_COLOR[ev.type]}`} aria-hidden />
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-sm text-foreground">
                        {ev.label}
                        {ev.reference ? (
                          <Link href={`/admin/bookings/${ev.bookingId}`} dir="ltr" className="ms-2 text-accent underline-offset-2 hover:underline">
                            {ev.reference}
                          </Link>
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground">{formatDate(ev.at, locale, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    </div>
                  </li>
                ))}
                {timeline.length === 0 ? <li className="text-sm text-muted-foreground">No activity.</li> : null}
              </ol>
            </CardBody>
          </Card>
        </div>

        {/* ── Right column ── */}
        <div className="space-y-5">
          {/* Profile fields */}
          <Card>
            <CardHeader><h2 className="font-display text-base text-gold-700">Profile</h2></CardHeader>
            <CardBody className="space-y-3">
              <Field label="Full name" value={profile?.fullName ?? user.name} />
              <Field label="Email" value={user.email} mono />
              <Field label="Phone" value={user.phone ?? profile?.phone} mono />
              <Field label="Country code" value={profile?.countryCode} />
              <Field label="Region" value={profile?.region} />
              <Field label="Age" value={profile?.age != null ? String(profile.age) : null} />
              <Field label="National ID" value={profile?.nationalId} mono />
              <Field label="Passport" value={profile?.passportId} mono />
              <Field label="Accessibility" value={profile?.isHandicapped ? 'Yes' : 'No'} />
              <Field label="Registered" value={formatDate(user.createdAt, locale, { dateStyle: 'medium', timeStyle: 'short' })} />
              <Field label="Last activity" value={formatDate(analytics.lastActivityAt, locale, { dateStyle: 'medium' })} />
            </CardBody>
          </Card>

          {/* Analytics */}
          <Card>
            <CardHeader><h2 className="font-display text-base text-gold-700">Analytics</h2></CardHeader>
            <CardBody className="space-y-3">
              <Field label="Lifetime value" value={money(analytics.revenueCents)} />
              <Field label="Avg spend / booking" value={money(analytics.avgSpendCents)} />
              <Field label="Booking frequency" value={`${analytics.bookingsPerMonth} / month`} />
              <Field label="Most common type" value={analytics.mostCommonKind ? (KIND_LABEL[analytics.mostCommonKind] ?? analytics.mostCommonKind) : null} />
              <Field label="First booking" value={analytics.firstBookingAt ? formatDate(analytics.firstBookingAt, locale, { dateStyle: 'medium' }) : null} />
            </CardBody>
          </Card>

          {/* Tags */}
          <Card>
            <CardHeader><h2 className="font-display text-base text-gold-700">Tags</h2></CardHeader>
            <CardBody>
              <TagEditor userId={user.id} tags={tags} library={tagLibrary.map((t) => ({ id: t.id, name: t.name, color: t.color }))} />
            </CardBody>
          </Card>

          {/* Notes (editable) */}
          <Card>
            <CardHeader><h2 className="font-display text-base text-gold-700">Notes</h2></CardHeader>
            <CardBody>
              <CustomerNotesForm
                userId={user.id}
                locale={locale}
                initialNotes={profile?.notes ?? ''}
                initialAdminNotes={profile?.adminNotes ?? ''}
              />
            </CardBody>
          </Card>

          {/* Sanctions (financial penalties) */}
          <Card variant="outline">
            <CardHeader>
              <h2 className="font-display text-base text-danger">Sanctions</h2>
            </CardHeader>
            <CardBody>
              <SanctionsCard
                userId={user.id}
                activeTotalCents={sanctionData.activeTotalCents}
                sanctions={sanctionData.sanctions.map((s) => ({
                  id: s.id,
                  amountCents: s.amountCents,
                  reason: s.reason,
                  notes: s.notes,
                  status: s.status,
                  createdAt: formatDate(s.createdAt, locale),
                  createdByName: s.createdByName,
                  settledAt: s.settledAt ? formatDate(s.settledAt, locale) : null,
                  settledByName: s.settledByName,
                  settlementNote: s.settlementNote,
                  paidByBookingId: s.paidByBookingId,
                  paidByBookingReference: s.paidByBookingReference,
                  lockedByPendingBooking: s.lockedByPendingBooking,
                }))}
              />
            </CardBody>
          </Card>

          {/* Block / ban control */}
          <Card variant="outline">
            <CardHeader>
              <h2 className="font-display text-base text-danger">
                {user.blockedAt ? 'Blocked' : 'Block access'}
              </h2>
            </CardHeader>
            <CardBody>
              <BlockUnblockButton
                userId={user.id}
                isBlocked={!!user.blockedAt}
                blockedReason={user.blockedReason}
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

const TL_COLOR: Record<string, string> = {
  registered: 'bg-gold-400',
  created: 'bg-info',
  confirmed: 'bg-success',
  checkin: 'bg-gold-300',
  cancelled: 'bg-danger',
  expired: 'bg-muted-foreground',
  payment: 'bg-success',
  refund: 'bg-warning',
};

function Stat({ label, value, accent, warn }: { label: string; value: string; accent?: boolean; warn?: boolean }) {
  return (
    <Card variant={accent ? 'solid' : 'flat'}>
      <CardBody className="py-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={`mt-1 font-display text-xl font-bold tabular-nums ${warn ? 'text-warning' : accent ? 'text-gold-700' : 'text-foreground'}`}>
          {value}
        </p>
      </CardBody>
    </Card>
  );
}

function Tile({ n, label, tone }: { n: number; label: string; tone?: 'success' | 'warning' | 'danger' | 'info' | 'gold' }) {
  const color =
    tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-danger'
    : tone === 'info' ? 'text-info' : tone === 'gold' ? 'text-gold-700' : 'text-foreground';
  return (
    <div className="rounded-2xl border border-border/40 bg-muted/20 px-4 py-3 text-center">
      <p className={`font-display text-2xl font-bold tabular-nums ${color}`}>{n}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}

function Bar({ n, total, className }: { n: number; total: number; className: string }) {
  if (n <= 0) return null;
  return <span className={className} style={{ width: `${(n / total) * 100}%` }} />;
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block size-2.5 rounded-full ${className}`} />
      {label}
    </span>
  );
}

function Field({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`text-sm text-foreground ${mono ? 'tabular-nums' : ''}`} dir={mono ? 'ltr' : undefined}>
        {value || '—'}
      </span>
    </div>
  );
}
