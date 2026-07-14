import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/Card';
import { BookingStatusBadge } from '@/components/booking/BookingStatusBadge';
import { Badge } from '@/components/ui/Badge';
import { GuestIdGallery } from './GuestIdGallery';
import { RefundButton } from './RefundButton';
import { CancelPaymentButton } from './CancelPaymentButton';
import { adminGetBooking } from '@/server/services/admin-bookings';
import { getBookingInsuranceForAdmin } from '@/server/services/insurance-admin';
import { ReopenInsuranceButton } from './ReopenInsuranceButton';
import { assignedPlaceLabels } from '@/server/services/reception';
import { ensureVisitForBooking } from '@/server/services/visit-code';
import { getRefundTiers } from '@/server/settings/settings';
import { computeTieredRefund } from '@/lib/refund-policy';
import { prisma } from '@/server/db/prisma';
import { formatMoney } from '@/lib/money';
import { formatDate, formatDateRange } from '@/lib/date';
import { isLocale } from '@/i18n/config';
import { PremiumBookingExport } from './PremiumBookingExport';

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

export default async function AdminBookingDetail({ params }: Props) {
  const { locale, id } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const booking = await adminGetBooking(id);
  if (!booking) notFound();

  const t = await getTranslations('admin');
  const tBooking = await getTranslations('booking');
  const tIns = await getTranslations('adminInsurance');

  // Insurance deposit — absence of a row = the booking has none (zero backfill).
  const insurance = await getBookingInsuranceForAdmin(booking.id);
  const insuranceRefundedCents = (booking.invoice?.refunds ?? [])
    .filter((r) => r.kind === 'INSURANCE')
    .reduce((s, r) => s + r.amountCents, 0);

  // Daily visit group (root code): lazily ensured so legacy bookings link on
  // first view. Admin sees the code + every sibling booking of the same day.
  const visit = await ensureVisitForBooking(prisma, booking.id);
  const visitSiblings = await prisma.booking.findMany({
    where: { visitCodeId: visit.id, id: { not: booking.id } },
    select: {
      id: true,
      reference: true,
      status: true,
      service: { select: { nameEn: true, nameAr: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const canRefund =
    (booking.status === 'CONFIRMED' || booking.status === 'CANCELLED') &&
    booking.payments.some((p) => p.status === 'SUCCEEDED');

  // Tiered-refund preview for the refund control: the % that applies to how far
  // ahead of the visit we are now, capped at the still-refundable balance.
  const refundTiers = await getRefundTiers();
  const invoiceTotalCents = booking.invoice?.totalCents ?? 0;
  const alreadyRefundedCents = (booking.invoice?.refunds ?? []).reduce((s, r) => s + r.amountCents, 0);
  const remainingRefundableCents = Math.max(0, invoiceTotalCents - alreadyRefundedCents);
  const refundPreview = computeTieredRefund({
    bookingDate: booking.bookingDate,
    totalCents: invoiceTotalCents,
    tiers: refundTiers,
  });
  const eligibleRefundCents = Math.min(refundPreview.refundCents, remainingRefundableCents);
  // Cancel-payment applies only while the booking is still unpaid: a
  // PENDING payment with the booking in PENDING_PAYMENT. Anything past
  // that is either already-cancelled or in refund territory.
  const canCancelPayment = booking.status === 'PENDING_PAYMENT';

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-gold-700">
            <span dir="ltr">{booking.reference}</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {locale === 'ar' ? booking.service.category.nameAr : booking.service.category.nameEn} ·{' '}
            {locale === 'ar' ? booking.service.nameAr : booking.service.nameEn}
          </p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <BookingStatusBadge status={booking.status} />
          <PremiumBookingExport
            locale={locale}
            booking={{
              reference: booking.reference,
              bookingDate: booking.bookingDate,
              people: booking.people,
              cars: booking.cars,
              userName: booking.createdByStaffId
                ? (booking.guestName ?? 'Reception Guest')
                : (booking.user.name ?? 'Valued Guest'),
              userPhone: booking.createdByStaffId ? booking.guestPhone : booking.user.phone,
              serviceName: locale === 'ar' ? booking.service.nameAr : booking.service.nameEn,
              categoryName:
                locale === 'ar'
                  ? booking.service.category.nameAr
                  : booking.service.category.nameEn,
              totalCents: booking.invoice?.totalCents ?? 0,
              status: booking.status,
              invoiceLines: booking.invoice?.lines ?? [],
            }}
          />
        </div>
      </header>

      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-700">{t('bookings')}</h2>
        </CardHeader>
        <CardBody className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Row
            label={tBooking('stepDate')}
            dirLtr={!!(booking.endDate && booking.endDate > booking.bookingDate)}
            value={
              booking.endDate && booking.endDate > booking.bookingDate
                ? formatDateRange(booking.bookingDate, booking.endDate, locale)
                : formatDate(booking.bookingDate, locale)
            }
          />
          <Row
            label={booking.children > 0 ? tBooking('stepAdults') : tBooking('stepPeople')}
            value={String(booking.children > 0 ? booking.adults : booking.people)}
          />
          {booking.children > 0 && <Row label={tBooking('stepChildren')} value={String(booking.children)} />}
          <Row label={tBooking('stepCars')} value={String(booking.cars)} />
          {booking.service.placeAssignmentRequired && (
            <Row
              label={tBooking('yourPlaces')}
              value={assignedPlaceLabels(booking.units).join(', ') || '—'}
            />
          )}
          {booking.user.profile?.nationalId ? (
            <Row label={tBooking('nationalId')} value={booking.user.profile.nationalId} dirLtr />
          ) : null}
          {booking.user.profile?.passportId ? (
            <Row label={tBooking('passportId')} value={booking.user.profile.passportId} dirLtr />
          ) : null}
          {booking.user.profile?.region ? (
            <Row label={tBooking('region')} value={booking.user.profile.region} />
          ) : null}
          <Row
            label="Created At"
            value={new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', {
              dateStyle: 'short',
              timeStyle: 'short',
            }).format(booking.createdAt)}
          />
        </CardBody>
      </Card>

      {/* Daily visit group — the root code whose QR opens every booking of the
          customer's day. Siblings link to their own admin pages. */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-base text-gold-700">
            {locale === 'ar' ? 'مجموعة الزيارة اليومية' : 'Daily visit group'}
          </h2>
          <span dir="ltr" className="rounded-lg bg-input px-2.5 py-1 font-mono text-xs text-gold-700">
            {visit.code}
          </span>
        </CardHeader>
        <CardBody className="space-y-2 text-sm">
          <p className="text-xs text-muted-foreground">
            {locale === 'ar'
              ? 'رمز QR واحد (موقَّع من هذا الكود) يفتح كل حجوزات هذا العميل في نفس اليوم عند البوابة.'
              : 'One QR (signed over this code) opens every booking this customer holds for the same day at the gate.'}
          </p>
          {visitSiblings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {locale === 'ar' ? 'لا توجد حجوزات أخرى في هذه الزيارة.' : 'No other bookings on this visit.'}
            </p>
          ) : (
            <ul className="divide-y divide-border/40">
              {visitSiblings.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                  <Link
                    href={`/admin/bookings/${s.id}`}
                    dir="ltr"
                    className="font-display text-accent underline-offset-4 hover:underline"
                  >
                    {s.reference}
                  </Link>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {locale === 'ar' ? s.service.nameAr : s.service.nameEn}
                  </span>
                  <BookingStatusBadge status={s.status} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-700">
            {booking.createdByStaffId ? 'Guest Information' : t('users')}
          </h2>
        </CardHeader>
        <CardBody className="space-y-1 text-sm">
          {booking.createdByStaffId ? (
            <>
              <p className="text-foreground font-medium">{booking.guestName ?? '—'}</p>
              {booking.guestPhone ? (
                <p dir="ltr" className="text-muted-foreground">
                  {booking.guestPhone}
                </p>
              ) : null}
              <div className="mt-4 space-y-3 border-t border-border/40 pt-4">
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Reception staff</p>
                  <p className="text-foreground">
                    {booking.receptionStaff?.name ??
                      booking.receptionStaff?.email ??
                      booking.user.name ??
                      booking.user.email ??
                      '—'}
                  </p>
                </div>
                {booking.discountAuthorizer ? (
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
                      Discount authorized by
                    </p>
                    <p className="flex flex-wrap items-center gap-2 text-foreground">
                      {booking.discountAuthorizer.name ?? booking.discountAuthorizer.email ?? '—'}
                      <span className="rounded-full bg-gold-400/15 px-2 py-0.5 text-[11px] font-semibold text-gold-700">
                        {booking.discountAuthorizer.role}
                      </span>
                      {booking.manualDiscountPercent != null ? (
                        <span className="text-xs text-muted-foreground">· {booking.manualDiscountPercent}% off</span>
                      ) : null}
                    </p>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-foreground font-medium">
                    {booking.user.profile?.fullName ?? booking.user.name ?? '—'}
                  </p>
                  {booking.user.email ? <p dir="ltr" className="text-muted-foreground">{booking.user.email}</p> : null}
                  {booking.user.phone ? <p dir="ltr" className="text-muted-foreground">{booking.user.phone}</p> : null}
                </div>
                {booking.user.role === 'CUSTOMER' ? (
                  <Link
                    href={`/admin/customers/${booking.userId}`}
                    className="shrink-0 rounded-xl border border-gold-400/30 px-3 py-1.5 text-xs font-medium text-gold-700 hover:bg-gold-400/10"
                  >
                    View full profile →
                  </Link>
                ) : null}
              </div>
              {/* Full customer profile — every stored field. */}
              {booking.user.profile ? (
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border/40 pt-4 text-xs">
                  <CustField label="Region" value={booking.user.profile.region} />
                  <CustField label="Country code" value={booking.user.profile.countryCode} />
                  <CustField label="Age" value={booking.user.profile.age != null ? String(booking.user.profile.age) : null} />
                  <CustField label="National ID" value={booking.user.profile.nationalId} />
                  <CustField label="Passport" value={booking.user.profile.passportId} />
                  <CustField label="Accessibility" value={booking.user.profile.isHandicapped ? 'Yes' : 'No'} />
                  <CustField label="Marketing" value={booking.user.profile.marketingOpt ? 'Opted in' : 'No'} />
                  {booking.user.profile.notes ? <CustField label="Customer notes" value={booking.user.profile.notes} wide /> : null}
                  {booking.user.profile.adminNotes ? <CustField label="Admin notes" value={booking.user.profile.adminNotes} wide /> : null}
                </dl>
              ) : null}
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-700">{t('invoices')}</h2>
        </CardHeader>
        {booking.invoice ? (
          <>
            <CardBody className="divide-y divide-border/40 p-0">
              {booking.invoice.lines.map((line) => (
                <div key={line.id} className="flex items-center justify-between p-4 text-sm">
                  <span className="text-muted-foreground">
                    {line.label} × {line.quantity}
                  </span>
                  <span className="tabular-nums text-foreground">
                    {formatMoney(line.totalCents, { locale, currency: 'EGP' })}
                  </span>
                </div>
              ))}
              {booking.invoice.refunds.map((r) => (
                <div key={r.id} className="flex items-center justify-between p-4 text-sm text-danger">
                  <span>refund · {r.reason ?? '—'}</span>
                  <span className="tabular-nums">
                    -{formatMoney(r.amountCents, { locale, currency: 'EGP' })}
                  </span>
                </div>
              ))}
            </CardBody>
            <CardFooter>
              <span className="text-sm text-muted-foreground">{tBooking('total')}</span>
              <span className="font-display text-xl font-semibold text-gold-700 tabular-nums">
                {formatMoney(booking.invoice.totalCents, { locale, currency: 'EGP' })}
              </span>
            </CardFooter>
          </>
        ) : (
          <CardBody>
            <p className="text-sm text-muted-foreground">—</p>
          </CardBody>
        )}
      </Card>

      {/* Insurance deposit — separate money pool, never discounted (docs/INSURANCE.md). */}
      {insurance ? (
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base text-gold-700">{tIns('panelTitle')}</h2>
            <Badge
              tone={
                insurance.collectionStatus === 'COLLECTED'
                  ? 'success'
                  : insurance.collectionStatus === 'VOIDED'
                    ? 'muted'
                    : 'warning'
              }
            >
              {tIns(`collection${insurance.collectionStatus}`)}
            </Badge>
          </CardHeader>
          <CardBody className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Row
                label={tIns('depositConfig')}
                value={
                  insurance.type === 'PERCENT'
                    ? tIns('percentOfBase', {
                        percent: insurance.percent ?? 0,
                        base: formatMoney(insurance.baseCents, { locale, currency: 'EGP' }),
                      })
                    : tIns('fixedAmount', {
                        amount: formatMoney(insurance.fixedCents ?? 0, { locale, currency: 'EGP' }),
                      })
                }
              />
              <Row
                label={tIns('depositAmount')}
                value={formatMoney(insurance.amountCents, { locale, currency: 'EGP' })}
              />
              <Row
                label={tIns('colPaidVia')}
                value={insurance.paidVia ? tIns(`paidVia${insurance.paidVia}`) : '—'}
              />
              <Row
                label={tIns('refundedSoFar')}
                value={formatMoney(insuranceRefundedCents, { locale, currency: 'EGP' })}
              />
            </div>
            <div className="space-y-1 border-t border-border/40 pt-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{tIns('decision')}</p>
              <p className="text-foreground">
                {tIns(`decision${insurance.decision}`)}
                {insurance.decidedAt ? ` · ${formatDate(insurance.decidedAt, locale)}` : ''}
                {insurance.decidedByName ? ` · ${insurance.decidedByName}` : ''}
              </p>
              {insurance.noRefundReason ? (
                <p className="text-muted-foreground">
                  {tIns('noRefundReason')}: {insurance.noRefundReason}
                </p>
              ) : null}
              {insurance.canReopenDecision ? (
                <div className="pt-2">
                  <ReopenInsuranceButton bookingId={booking.id} />
                </div>
              ) : null}
            </div>
            {insurance.attempts.length > 0 ? (
              <div className="space-y-2 border-t border-border/40 pt-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  {tIns('attemptsTitle')}
                </p>
                <ul className="space-y-1.5">
                  {insurance.attempts.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/admin/insurance-refunds/${a.id}`}
                        className="text-accent underline-offset-4 hover:underline"
                      >
                        {formatDate(a.createdAt, locale)}
                      </Link>
                      <Badge tone={a.method === 'PROVIDER' ? 'navy' : 'gold'}>
                        {tIns(`method${a.method}`)}
                      </Badge>
                      <span className="tabular-nums text-foreground">
                        {formatMoney(a.amountCents, { locale, currency: 'EGP' })}
                      </span>
                      <Badge
                        tone={
                          a.status === 'COMPLETED'
                            ? 'success'
                            : a.status === 'REJECTED'
                              ? 'muted'
                              : a.status === 'FAILED' || a.status === 'MANUAL_ATTENTION'
                                ? 'danger'
                                : 'warning'
                        }
                      >
                        {tIns(`status${a.status}`)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-700">{t('payments')}</h2>
        </CardHeader>
        <CardBody className="divide-y divide-border/40 p-0">
          {booking.payments.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">—</p>
          ) : (
            booking.payments.map((p) => (
              <div key={p.id} className="flex flex-col p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <p dir="ltr" className="text-foreground">
                      {p.paymobOrderId ?? '—'}
                    </p>
                    <p className="text-xs text-muted-foreground">{p.provider}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums text-muted-foreground">
                      {formatMoney(p.amountCents, { locale, currency: 'EGP' })}
                    </span>
                    <Badge
                      tone={
                        p.status === 'SUCCEEDED'
                          ? 'success'
                          : p.status === 'FAILED'
                            ? 'danger'
                            : p.status === 'REFUNDED'
                              ? 'muted'
                              : 'warning'
                      }
                    >
                      {p.status}
                    </Badge>
                    {p.status === 'SUCCEEDED' && canRefund ? (
                      <RefundButton
                        bookingId={booking.id}
                        locale={locale}
                        eligiblePercent={refundPreview.percent}
                        eligibleRefundCents={eligibleRefundCents}
                        maxRefundCents={remainingRefundableCents}
                        hoursUntil={refundPreview.hoursUntilStart}
                        isOffline={p.provider !== 'CREDIT_AGRICOLE'}
                      />
                    ) : null}
                    {p.status === 'PENDING' && canCancelPayment ? (
                      <CancelPaymentButton bookingId={booking.id} />
                    ) : null}
                  </div>
                </div>
                {p.proofUrl && (
                  <div className="mt-3">
                    <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wider">Payment Proof</p>
                    <a href={p.proofUrl} target="_blank" rel="noreferrer" className="inline-block group relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.proofUrl}
                        alt="Payment proof"
                        className="h-32 rounded-lg border border-border/40 object-cover transition group-hover:opacity-75"
                      />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                        <span className="bg-black/60 text-white px-2 py-1 rounded text-xs">View Full</span>
                      </div>
                    </a>
                  </div>
                )}
              </div>
            ))
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="font-display text-base text-gold-700">Guest IDs</h2>
          {/* ID images are required for ADULTS only — children carry none. */}
          <Badge tone={booking.guestIds.length >= booking.adults ? 'success' : 'warning'}>
            {booking.guestIds.length}/{booking.adults}
          </Badge>
        </CardHeader>
        <CardBody>
          {booking.guestIds.length === 0 ? (
            <p className="text-sm text-muted-foreground">No identity documents uploaded yet.</p>
          ) : (
            <GuestIdGallery
              docs={booking.guestIds.map((doc) => ({
                id: doc.id,
                guestSeq: doc.guestSeq,
                guestName: doc.guestName,
                imageUrl: doc.imageUrl,
                verificationStatus: doc.verificationStatus,
              }))}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Row({ label, value, dirLtr }: { label: string; value: string; dirLtr?: boolean }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-foreground" {...(dirLtr ? { dir: 'ltr' as const } : {})}>
        {value}
      </p>
    </div>
  );
}

/** Compact customer-profile field for the booking detail. */
function CustField({ label, value, wide }: { label: string; value: string | null | undefined; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value || '—'}</dd>
    </div>
  );
}
