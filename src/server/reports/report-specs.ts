import 'server-only';
import type { Prisma, BookingStatus, PaymentStatus, PaymentProvider } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { summarizeAuditChange } from '@/lib/audit-diff';
import { resolveAuditContext } from '@/server/audit/audit-context';
import { splitPaidInvoice } from '@/server/services/report-math';
import { getStaffDirectory, staffInvoiceWhere } from '@/server/services/staff-performance';
import {
  getReportOverview,
  getRevenueReport,
  getPlacePerformanceReport,
  getCustomersReport,
  getOperationsReport,
} from '@/server/services/admin-reports';
import { getReviewsReport } from '@/server/services/review';
import type { ReportRange } from '@/server/services/report-math';
import type { ReportWorkbookSpec, ReportSheet } from './workbook';
import { resortDayKey } from '@/lib/date';

/**
 * Report → workbook-spec mapping for every admin export. One module owns the
 * "what columns, what data, what formatting" for each report so the route stays
 * thin and the on-screen page and the export can never disagree about numbers.
 *
 * All money is stored as integer cents in the DB; every money column here is
 * converted to EGP major units with `egp()` and formatted as currency in Excel.
 * PII (national id / passport) is masked. Detail exports are capped so a runaway
 * range can never stream unbounded rows into memory.
 */

/** Hard cap on detail rows per export sheet (protects memory + response time). */
export const EXPORT_ROW_CAP = 5000;

export interface ExportContext {
  range: ReportRange;
  serviceId?: string;
  categoryId?: string;
  placeId?: string;
  status?: BookingStatus;
  paymentStatus?: PaymentStatus;
  provider?: PaymentProvider;
  /** 'online' = website booking, 'reception' = walk-in desk booking. */
  channel?: 'online' | 'reception';
  /** 'yes' = at least one guest admitted, 'no' = nobody admitted. */
  checkedIn?: 'yes' | 'no';
  /** Human labels for the filter dropdowns, resolved by the caller. */
  serviceLabel?: string;
  categoryLabel?: string;
  placeLabel?: string;
}

const egp = (cents: number | null | undefined): number => Math.round(cents ?? 0) / 100;

/** Mask a government-ID number, revealing only the last 4 (PII minimisation). */
function maskId(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = value.trim();
  if (t.length <= 4) return '*'.repeat(t.length);
  return '*'.repeat(t.length - 4) + t.slice(-4);
}

/** The metadata band shown atop the first sheet: range, filters, generated-at. */
function metaFor(ctx: ExportContext): { label: string; value: string }[] {
  // TIME-001: range.from/toExclusive are Cairo-civil-day UTC instants, so the
  // label must read them as Cairo days (a UTC slice would print the day before).
  const from = resortDayKey(ctx.range.from);
  const to = resortDayKey(new Date(ctx.range.toExclusive.getTime() - 1));
  const filters: string[] = [];
  if (ctx.categoryLabel) filters.push(`Category = ${ctx.categoryLabel}`);
  if (ctx.serviceLabel) filters.push(`Service = ${ctx.serviceLabel}`);
  if (ctx.placeLabel) filters.push(`Place = ${ctx.placeLabel}`);
  if (ctx.status) filters.push(`Booking status = ${ctx.status}`);
  if (ctx.paymentStatus) filters.push(`Payment status = ${ctx.paymentStatus}`);
  if (ctx.provider) filters.push(`Payment method = ${ctx.provider}`);
  if (ctx.channel) filters.push(`Channel = ${ctx.channel === 'online' ? 'Online' : 'Reception'}`);
  if (ctx.checkedIn) filters.push(`Checked in = ${ctx.checkedIn === 'yes' ? 'Yes' : 'No'}`);
  return [
    { label: 'Date range', value: `${from} → ${to}` },
    { label: 'Filters applied', value: filters.length ? filters.join('  ·  ') : 'None' },
    { label: 'Generated', value: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC' },
  ];
}

const summarySheet = (name: string, rows: { Metric: string; Value: string | number }[]): ReportSheet => ({
  name,
  columns: [
    { header: 'Metric', key: 'Metric', width: 34 },
    { header: 'Value', key: 'Value', width: 22 },
  ],
  rows,
});

// ── Booking channel / check-in where helpers ─────────────────────────────────

function bookingScopeWhere(ctx: ExportContext): Prisma.BookingWhereInput {
  const w: Prisma.BookingWhereInput = {};
  if (ctx.serviceId) w.serviceId = ctx.serviceId;
  else if (ctx.categoryId) w.service = { categoryId: ctx.categoryId };
  if (ctx.status) w.status = ctx.status;
  if (ctx.channel === 'online') w.createdByStaffId = null;
  else if (ctx.channel === 'reception') w.createdByStaffId = { not: null };
  if (ctx.checkedIn === 'yes') w.checkedInAt = { not: null };
  else if (ctx.checkedIn === 'no') w.checkedInAt = null;
  if (ctx.paymentStatus) w.payments = { some: { status: ctx.paymentStatus } };
  return w;
}

// ── Enriched Bookings ────────────────────────────────────────────────────────

async function bookingsSheet(ctx: ExportContext): Promise<ReportSheet> {
  const rows = await prisma.booking.findMany({
    where: {
      bookingDate: { gte: ctx.range.from, lt: ctx.range.toExclusive },
      ...bookingScopeWhere(ctx),
    },
    select: {
      reference: true,
      bookingDate: true,
      endDate: true,
      status: true,
      people: true,
      adults: true,
      children: true,
      extraPersons: true,
      cars: true,
      unitsPerDay: true,
      checkedInAt: true,
      checkedInCount: true,
      confirmedAt: true,
      cancelledAt: true,
      createdAt: true,
      guestName: true,
      guestPhone: true,
      createdByStaffId: true,
      user: { select: { name: true, email: true, phone: true, profile: { select: { nationalId: true, passportId: true } } } },
      service: { select: { nameEn: true, category: { select: { nameEn: true } } } },
      invoice: {
        select: {
          subtotalCents: true,
          taxCents: true,
          feeCents: true,
          totalCents: true,
          status: true,
          paidAt: true,
          lines: { select: { totalCents: true } },
          refunds: { select: { amountCents: true } },
        },
      },
      payments: { select: { provider: true, status: true, amountCents: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
    },
    orderBy: [{ bookingDate: 'desc' }, { createdAt: 'desc' }],
    take: EXPORT_ROW_CAP,
  });

  const data = rows.map((b) => {
    const inv = b.invoice;
    const total = inv?.totalCents ?? 0;
    // Discounts are stored as negative invoice lines (promo / manual).
    const discount = inv ? -inv.lines.filter((l) => l.totalCents < 0).reduce((a, l) => a + l.totalCents, 0) : 0;
    // TOTAL money returned (all RefundLine kinds, deposit payouts included) —
    // consistent with the Total/Paid columns, which include the deposit.
    const refunded = inv ? inv.refunds.reduce((a, r) => a + r.amountCents, 0) : 0;
    const paid = b.payments.filter((p) => p.status === 'SUCCEEDED').reduce((a, p) => a + p.amountCents, 0);
    const latest = b.payments[0];
    const isReception = !!b.createdByStaffId;
    return {
      Reference: b.reference,
      'Visit date': b.bookingDate,
      'End date': b.endDate,
      Service: b.service.nameEn,
      Category: b.service.category.nameEn,
      Customer: isReception ? (b.guestName ?? '—') : (b.user.name ?? '—'),
      Phone: isReception ? (b.guestPhone ?? '—') : (b.user.phone ?? '—'),
      Email: isReception ? '—' : (b.user.email ?? '—'),
      'National ID': maskId(b.user.profile?.nationalId) ?? '—',
      Passport: maskId(b.user.profile?.passportId) ?? '—',
      Adults: b.adults,
      Children: b.children,
      'Extra persons': b.extraPersons,
      Cars: b.cars,
      'Units/day': b.unitsPerDay,
      Channel: isReception ? 'Reception' : 'Online',
      'Subtotal (EGP)': egp(inv?.subtotalCents),
      'Discount (EGP)': egp(discount),
      'Tax (EGP)': egp(inv?.taxCents),
      'Fee (EGP)': egp(inv?.feeCents),
      'Total (EGP)': egp(total),
      'Paid (EGP)': egp(paid),
      'Refunded (EGP)': egp(refunded),
      'Remaining (EGP)': egp(Math.max(0, total - paid)),
      'Payment method': latest ? latest.provider : '—',
      'Payment status': latest ? latest.status : '—',
      'Invoice status': inv?.status ?? '—',
      'Booking status': b.status,
      'Checked in': b.checkedInAt ? 'Yes' : 'No',
      'Guests in': b.checkedInCount,
      'Booked at': b.createdAt,
      'Confirmed at': b.confirmedAt,
      'Paid at': inv?.paidAt,
      'Cancelled at': b.cancelledAt,
      'Checked-in at': b.checkedInAt,
    };
  });

  return {
    name: 'Bookings',
    note: data.length >= EXPORT_ROW_CAP ? `Showing the first ${EXPORT_ROW_CAP} rows (cap reached — narrow the date range for the rest).` : undefined,
    columns: [
      { header: 'Reference', key: 'Reference', width: 20 },
      { header: 'Visit date', key: 'Visit date', format: 'date' },
      { header: 'End date', key: 'End date', format: 'date' },
      { header: 'Service', key: 'Service', width: 20 },
      { header: 'Category', key: 'Category', width: 16 },
      { header: 'Customer', key: 'Customer', width: 22 },
      { header: 'Phone', key: 'Phone', width: 16 },
      { header: 'Email', key: 'Email', width: 24 },
      { header: 'National ID', key: 'National ID', width: 16 },
      { header: 'Passport', key: 'Passport', width: 14 },
      { header: 'Adults', key: 'Adults', format: 'int', total: true },
      { header: 'Children', key: 'Children', format: 'int', total: true },
      { header: 'Extra persons', key: 'Extra persons', format: 'int', total: true },
      { header: 'Cars', key: 'Cars', format: 'int', total: true },
      { header: 'Units/day', key: 'Units/day', format: 'int' },
      { header: 'Channel', key: 'Channel', width: 12 },
      { header: 'Subtotal (EGP)', key: 'Subtotal (EGP)', format: 'money', total: true },
      { header: 'Discount (EGP)', key: 'Discount (EGP)', format: 'money', total: true },
      { header: 'Tax (EGP)', key: 'Tax (EGP)', format: 'money', total: true },
      { header: 'Fee (EGP)', key: 'Fee (EGP)', format: 'money', total: true },
      { header: 'Total (EGP)', key: 'Total (EGP)', format: 'money', total: true },
      { header: 'Paid (EGP)', key: 'Paid (EGP)', format: 'money', total: true },
      { header: 'Refunded (EGP)', key: 'Refunded (EGP)', format: 'money', total: true },
      { header: 'Remaining (EGP)', key: 'Remaining (EGP)', format: 'money', total: true },
      { header: 'Payment method', key: 'Payment method', width: 16 },
      { header: 'Payment status', key: 'Payment status', width: 15 },
      { header: 'Invoice status', key: 'Invoice status', width: 14 },
      { header: 'Booking status', key: 'Booking status', width: 16 },
      { header: 'Checked in', key: 'Checked in', width: 11 },
      { header: 'Guests in', key: 'Guests in', format: 'int' },
      { header: 'Booked at', key: 'Booked at', format: 'datetime' },
      { header: 'Confirmed at', key: 'Confirmed at', format: 'datetime' },
      { header: 'Paid at', key: 'Paid at', format: 'datetime' },
      { header: 'Cancelled at', key: 'Cancelled at', format: 'datetime' },
      { header: 'Checked-in at', key: 'Checked-in at', format: 'datetime' },
    ],
    rows: data,
  };
}

// ── Payments detail ──────────────────────────────────────────────────────────

async function paymentsSheets(ctx: ExportContext): Promise<ReportSheet[]> {
  const { from, toExclusive } = ctx.range;
  const paymentWhere: Prisma.PaymentWhereInput = {
    createdAt: { gte: from, lt: toExclusive },
    ...(ctx.provider ? { provider: ctx.provider } : {}),
    ...(ctx.paymentStatus ? { status: ctx.paymentStatus } : {}),
    ...(ctx.serviceId || ctx.categoryId || ctx.channel
      ? { booking: bookingScopeWhere({ ...ctx, paymentStatus: undefined }) }
      : {}),
  };

  const [rows, byStatus, byProvider] = await Promise.all([
    prisma.payment.findMany({
      where: paymentWhere,
      select: {
        provider: true,
        status: true,
        amountCents: true,
        currency: true,
        paymobOrderId: true,
        paymobTransactionId: true,
        proofUrl: true,
        failureCode: true,
        failureMessage: true,
        paidAt: true,
        refundedAt: true,
        createdAt: true,
        booking: {
          select: {
            reference: true,
            guestName: true,
            guestPhone: true,
            status: true,
            createdByStaffId: true,
            user: { select: { name: true, phone: true, email: true } },
            service: { select: { nameEn: true, category: { select: { nameEn: true } } } },
            invoice: { select: { totalCents: true, status: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_CAP,
    }),
    prisma.payment.groupBy({ by: ['status'], where: paymentWhere, _count: { _all: true }, _sum: { amountCents: true } }),
    prisma.payment.groupBy({ by: ['provider'], where: paymentWhere, _count: { _all: true }, _sum: { amountCents: true } }),
  ]);

  const detail: ReportSheet = {
    name: 'Payments',
    note: rows.length >= EXPORT_ROW_CAP ? `Showing the first ${EXPORT_ROW_CAP} rows (cap reached — narrow the date range).` : undefined,
    columns: [
      { header: 'Created at', key: 'Created at', format: 'datetime' },
      { header: 'Booking', key: 'Booking', width: 20 },
      { header: 'Customer', key: 'Customer', width: 22 },
      { header: 'Phone', key: 'Phone', width: 16 },
      { header: 'Email', key: 'Email', width: 24 },
      { header: 'Category', key: 'Category', width: 16 },
      { header: 'Service', key: 'Service', width: 20 },
      { header: 'Channel', key: 'Channel', width: 12 },
      { header: 'Method', key: 'Method', width: 16 },
      { header: 'Payment status', key: 'Payment status', width: 14 },
      { header: 'Amount', key: 'Amount', format: 'money', total: true },
      { header: 'Currency', key: 'Currency', width: 9 },
      { header: 'Booking status', key: 'Booking status', width: 16 },
      { header: 'Invoice status', key: 'Invoice status', width: 13 },
      { header: 'Invoice total', key: 'Invoice total', format: 'money' },
      { header: 'Paid at', key: 'Paid at', format: 'datetime' },
      { header: 'Refunded at', key: 'Refunded at', format: 'datetime' },
      { header: 'Order id', key: 'Order id', width: 26 },
      { header: 'Transaction id', key: 'Transaction id', width: 30 },
      { header: 'Proof', key: 'Proof', width: 10 },
      { header: 'Failure code', key: 'Failure code', width: 16 },
      { header: 'Failure message', key: 'Failure message', width: 28 },
    ],
    rows: rows.map((p) => {
      const reception = !!p.booking?.createdByStaffId;
      return {
        'Created at': p.createdAt,
        Booking: p.booking?.reference ?? '—',
        Customer: reception ? (p.booking?.guestName ?? '—') : (p.booking?.user?.name ?? '—'),
        Phone: reception ? (p.booking?.guestPhone ?? '—') : (p.booking?.user?.phone ?? '—'),
        Email: reception ? '—' : (p.booking?.user?.email ?? '—'),
        Category: p.booking?.service?.category?.nameEn ?? '—',
        Service: p.booking?.service?.nameEn ?? '—',
        Channel: reception ? 'Reception' : 'Online',
        Method: p.provider,
        'Payment status': p.status,
        Amount: egp(p.amountCents),
        Currency: p.currency,
        'Booking status': p.booking?.status ?? '—',
        'Invoice status': p.booking?.invoice?.status ?? '—',
        'Invoice total': egp(p.booking?.invoice?.totalCents),
        'Paid at': p.paidAt,
        'Refunded at': p.refundedAt,
        'Order id': p.paymobOrderId ?? '—',
        'Transaction id': p.paymobTransactionId ?? '—',
        Proof: p.proofUrl ? 'Yes' : 'No',
        'Failure code': p.failureCode ?? '—',
        'Failure message': p.failureMessage ?? '—',
      };
    }),
  };

  const summary = summarySheet('By status', []);
  summary.columns = [
    { header: 'Status', key: 'Status', width: 18 },
    { header: 'Payments', key: 'Payments', format: 'int', total: true },
    { header: 'Amount (EGP)', key: 'Amount (EGP)', format: 'money', total: true },
  ];
  summary.rows = byStatus.map((s) => ({ Status: s.status, Payments: s._count._all, 'Amount (EGP)': egp(s._sum.amountCents ?? 0) }));

  const providers: ReportSheet = {
    name: 'By method',
    columns: [
      { header: 'Method', key: 'Method', width: 18 },
      { header: 'Payments', key: 'Payments', format: 'int', total: true },
      { header: 'Amount (EGP)', key: 'Amount (EGP)', format: 'money', total: true },
    ],
    rows: byProvider.map((p) => ({ Method: p.provider, Payments: p._count._all, 'Amount (EGP)': egp(p._sum.amountCents ?? 0) })),
  };

  return [detail, summary, providers];
}

// ── Cancellations & Refunds ──────────────────────────────────────────────────

async function cancellationsSheets(ctx: ExportContext): Promise<ReportSheet[]> {
  const { from, toExclusive } = ctx.range;

  const [cancelled, refunds] = await Promise.all([
    prisma.booking.findMany({
      where: {
        status: { in: ['CANCELLED', 'EXPIRED', 'FAILED'] },
        cancelledAt: { gte: from, lt: toExclusive },
        ...(ctx.serviceId ? { serviceId: ctx.serviceId } : ctx.categoryId ? { service: { categoryId: ctx.categoryId } } : {}),
      },
      select: {
        reference: true,
        status: true,
        bookingDate: true,
        cancelledAt: true,
        createdAt: true,
        people: true,
        guestName: true,
        createdByStaffId: true,
        user: { select: { name: true, phone: true } },
        service: { select: { nameEn: true, category: { select: { nameEn: true } } } },
        invoice: { select: { totalCents: true, refunds: { select: { amountCents: true, reason: true, createdAt: true } } } },
      },
      orderBy: { cancelledAt: 'desc' },
      take: EXPORT_ROW_CAP,
    }),
    prisma.refundLine.findMany({
      where: { createdAt: { gte: from, lt: toExclusive } },
      select: {
        amountCents: true,
        kind: true,
        reason: true,
        createdAt: true,
        invoice: { select: { booking: { select: { reference: true, guestName: true, createdByStaffId: true, user: { select: { name: true } }, service: { select: { nameEn: true } } } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_CAP,
    }),
  ]);

  const cancelledSheet: ReportSheet = {
    name: 'Cancelled bookings',
    columns: [
      { header: 'Reference', key: 'Reference', width: 20 },
      { header: 'Status', key: 'Status', width: 12 },
      { header: 'Visit date', key: 'Visit date', format: 'date' },
      { header: 'Customer', key: 'Customer', width: 22 },
      { header: 'Phone', key: 'Phone', width: 16 },
      { header: 'Service', key: 'Service', width: 20 },
      { header: 'Category', key: 'Category', width: 16 },
      { header: 'Guests', key: 'Guests', format: 'int', total: true },
      { header: 'Invoice total (EGP)', key: 'Invoice total (EGP)', format: 'money', total: true },
      { header: 'Refunded (EGP)', key: 'Refunded (EGP)', format: 'money', total: true },
      { header: 'Booked at', key: 'Booked at', format: 'datetime' },
      { header: 'Cancelled at', key: 'Cancelled at', format: 'datetime' },
    ],
    rows: cancelled.map((b) => ({
      Reference: b.reference,
      Status: b.status,
      'Visit date': b.bookingDate,
      Customer: b.createdByStaffId ? (b.guestName ?? '—') : (b.user.name ?? '—'),
      Phone: b.createdByStaffId ? '—' : (b.user.phone ?? '—'),
      Service: b.service.nameEn,
      Category: b.service.category.nameEn,
      Guests: b.people,
      'Invoice total (EGP)': egp(b.invoice?.totalCents),
      'Refunded (EGP)': egp(b.invoice?.refunds.reduce((a, r) => a + r.amountCents, 0) ?? 0),
      'Booked at': b.createdAt,
      'Cancelled at': b.cancelledAt,
    })),
  };

  // Every money-out line, deposit payouts included — 'Kind' separates the
  // booking-refund pool (Service) from insurance-deposit returns.
  const refundsSheet: ReportSheet = {
    name: 'Refunds',
    columns: [
      { header: 'Refunded at', key: 'Refunded at', format: 'datetime' },
      { header: 'Booking', key: 'Booking', width: 20 },
      { header: 'Customer', key: 'Customer', width: 22 },
      { header: 'Service', key: 'Service', width: 20 },
      { header: 'Kind', key: 'Kind', width: 16 },
      { header: 'Amount (EGP)', key: 'Amount (EGP)', format: 'money', total: true },
      { header: 'Reason', key: 'Reason', width: 30 },
    ],
    rows: refunds.map((r) => ({
      'Refunded at': r.createdAt,
      Booking: r.invoice.booking.reference,
      Customer: r.invoice.booking.createdByStaffId ? (r.invoice.booking.guestName ?? '—') : (r.invoice.booking.user.name ?? '—'),
      Service: r.invoice.booking.service.nameEn,
      Kind: r.kind === 'INSURANCE' ? 'Insurance deposit' : 'Service',
      'Amount (EGP)': egp(r.amountCents),
      Reason: r.reason ?? '—',
    })),
  };

  return [cancelledSheet, refundsSheet];
}

// ── Sanctions ────────────────────────────────────────────────────────────────

async function sanctionsSheets(ctx: ExportContext): Promise<ReportSheet[]> {
  const { from, toExclusive } = ctx.range;
  const [rows, byStatus] = await Promise.all([
    prisma.sanction.findMany({
      where: { createdAt: { gte: from, lt: toExclusive } },
      select: {
        amountCents: true,
        reason: true,
        status: true,
        createdAt: true,
        settledAt: true,
        settlementNote: true,
        user: { select: { name: true, email: true, phone: true } },
        paidByBooking: { select: { reference: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_CAP,
    }),
    prisma.sanction.groupBy({
      by: ['status'],
      where: { createdAt: { gte: from, lt: toExclusive } },
      _count: { _all: true },
      _sum: { amountCents: true },
    }),
  ]);

  const detail: ReportSheet = {
    name: 'Sanctions',
    columns: [
      { header: 'Issued at', key: 'Issued at', format: 'datetime' },
      { header: 'Customer', key: 'Customer', width: 22 },
      { header: 'Phone', key: 'Phone', width: 16 },
      { header: 'Amount (EGP)', key: 'Amount (EGP)', format: 'money', total: true },
      { header: 'Reason', key: 'Reason', width: 34 },
      { header: 'Status', key: 'Status', width: 12 },
      { header: 'Settled at', key: 'Settled at', format: 'datetime' },
      { header: 'Paid by booking', key: 'Paid by booking', width: 20 },
      { header: 'Settlement note', key: 'Settlement note', width: 28 },
    ],
    rows: rows.map((s) => ({
      'Issued at': s.createdAt,
      Customer: s.user.name ?? s.user.email ?? '—',
      Phone: s.user.phone ?? '—',
      'Amount (EGP)': egp(s.amountCents),
      Reason: s.reason,
      Status: s.status,
      'Settled at': s.settledAt,
      'Paid by booking': s.paidByBooking?.reference ?? '—',
      'Settlement note': s.settlementNote ?? '—',
    })),
  };

  const summary: ReportSheet = {
    name: 'By status',
    columns: [
      { header: 'Status', key: 'Status', width: 16 },
      { header: 'Count', key: 'Count', format: 'int', total: true },
      { header: 'Amount (EGP)', key: 'Amount (EGP)', format: 'money', total: true },
    ],
    rows: byStatus.map((s) => ({ Status: s.status, Count: s._count._all, 'Amount (EGP)': egp(s._sum.amountCents ?? 0) })),
  };

  return [summary, detail];
}

// ── Audit / admin activity ───────────────────────────────────────────────────

async function auditSheets(ctx: ExportContext): Promise<ReportSheet[]> {
  const { from, toExclusive } = ctx.range;
  const [rows, byAction] = await Promise.all([
    prisma.auditLog.findMany({
      where: { createdAt: { gte: from, lt: toExclusive } },
      select: {
        id: true,
        createdAt: true,
        action: true,
        entityType: true,
        entityId: true,
        ipAddress: true,
        before: true,
        after: true,
        actor: { select: { name: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_CAP,
    }),
    prisma.auditLog.groupBy({ by: ['action'], where: { createdAt: { gte: from, lt: toExclusive } }, _count: { _all: true } }),
  ]);

  const auditCtx = await resolveAuditContext(
    rows.map((a) => ({ id: a.id, entityType: a.entityType, entityId: a.entityId, before: a.before, after: a.after })),
    'en',
  );

  const rawJson = (v: unknown): string => {
    if (v === null || v === undefined) return '—';
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  };

  const detail: ReportSheet = {
    name: 'Activity',
    columns: [
      { header: 'When', key: 'When', format: 'datetime' },
      { header: 'Actor', key: 'Actor', width: 24 },
      { header: 'Role', key: 'Role', width: 14 },
      { header: 'Action', key: 'Action', width: 12 },
      { header: 'Entity', key: 'Entity', width: 16 },
      { header: 'Category', key: 'Category', width: 18 },
      { header: 'Service', key: 'Service', width: 22 },
      { header: 'Item', key: 'Item', width: 20 },
      { header: 'What changed', key: 'What changed', width: 60 },
      { header: 'Before (raw)', key: 'Before (raw)', width: 40 },
      { header: 'After (raw)', key: 'After (raw)', width: 40 },
      { header: 'IP', key: 'IP', width: 16 },
    ],
    rows: rows.map((a) => {
      const c = auditCtx.get(a.id);
      return {
        When: a.createdAt,
        Actor: a.actor?.name ?? a.actor?.email ?? 'System',
        Role: a.actor?.role ?? '—',
        Action: a.action,
        Entity: a.entityType,
        Category: c?.category ?? '—',
        Service: c?.service ?? '—',
        Item: c?.label ?? a.entityId ?? '—',
        'What changed': summarizeAuditChange(a.before, a.after, 20, 80),
        'Before (raw)': rawJson(a.before),
        'After (raw)': rawJson(a.after),
        IP: a.ipAddress ?? '—',
      };
    }),
  };

  const summary: ReportSheet = {
    name: 'By action',
    columns: [
      { header: 'Action', key: 'Action', width: 20 },
      { header: 'Count', key: 'Count', format: 'int', total: true },
    ],
    rows: byAction.map((a) => ({ Action: a.action, Count: a._count._all })),
  };

  return [summary, detail];
}

// ── Restyled existing reports (reuse the service functions) ──────────────────

async function overviewSheets(ctx: ExportContext): Promise<ReportSheet[]> {
  const [o, bookings] = await Promise.all([getReportOverview(ctx.range), bookingsSheet(ctx)]);
  return [
    summarySheet('Summary', [
      { Metric: 'Net revenue (EGP)', Value: egp(o.netRevenueCents) },
      { Metric: 'Paid invoices', Value: o.paidInvoices },
      { Metric: 'Average invoice (EGP)', Value: egp(o.avgInvoiceCents) },
      { Metric: 'Refunds (EGP)', Value: egp(o.refundCents) },
      { Metric: 'Refund count', Value: o.refundCount },
      { Metric: 'Outstanding (EGP)', Value: egp(o.outstandingCents) },
      { Metric: 'Deposits collected (EGP)', Value: egp(o.deposits.collectedCents) },
      { Metric: 'Deposits refunded (EGP)', Value: egp(o.deposits.refundedCents) },
      { Metric: 'Deposits retained (EGP)', Value: egp(o.deposits.retainedCents) },
      { Metric: 'Deposits held — all time (EGP)', Value: egp(o.deposits.heldCents) },
      { Metric: 'Bookings created', Value: o.totalBookings },
      { Metric: 'Online bookings', Value: o.onlineBookings },
      { Metric: 'Reception bookings', Value: o.receptionBookings },
      { Metric: 'Visits in range', Value: o.visitBookings },
      { Metric: 'Guests in range', Value: o.visitGuests },
      { Metric: 'Total customers', Value: o.totalCustomers },
      { Metric: 'New customers', Value: o.newCustomers },
      { Metric: 'Places out of service now', Value: o.placesOutNow },
      { Metric: 'Places offline', Value: o.placesOffline },
    ]),
    {
      name: 'Revenue by day',
      columns: [
        { header: 'Date', key: 'Date', format: 'date' },
        { header: 'Revenue (EGP)', key: 'Revenue (EGP)', format: 'money', total: true },
      ],
      rows: o.revenueTrend.map((d) => ({ Date: new Date(d.date), 'Revenue (EGP)': d.amount })),
    },
    bookings,
  ];
}

async function revenueSheets(ctx: ExportContext): Promise<ReportSheet[]> {
  const r = await getRevenueReport({ ...ctx.range, categoryId: ctx.categoryId });

  // Invoice-level detail: every PAID invoice whose payment settled in range —
  // the line items behind the "net revenue" number, so the report is auditable
  // down to each transaction, not just totals.
  const invoiceRows = await prisma.invoice.findMany({
    where: {
      status: 'PAID',
      paidAt: { gte: ctx.range.from, lt: ctx.range.toExclusive },
      ...(ctx.serviceId
        ? { booking: { serviceId: ctx.serviceId } }
        : ctx.categoryId
          ? { booking: { service: { categoryId: ctx.categoryId } } }
          : {}),
    },
    select: {
      subtotalCents: true,
      taxCents: true,
      feeCents: true,
      totalCents: true,
      currency: true,
      paidAt: true,
      lines: { select: { totalCents: true } },
      refunds: { select: { amountCents: true, kind: true } },
      booking: {
        select: {
          reference: true,
          bookingDate: true,
          guestName: true,
          guestPhone: true,
          createdByStaffId: true,
          insurance: { select: { amountCents: true, collectionStatus: true } },
          user: { select: { name: true, phone: true, email: true } },
          service: { select: { nameEn: true, category: { select: { nameEn: true } } } },
          payments: { select: { provider: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        },
      },
    },
    orderBy: { paidAt: 'desc' },
    take: EXPORT_ROW_CAP,
  });

  const invoiceDetail: ReportSheet = {
    name: 'Paid invoices',
    note: invoiceRows.length >= EXPORT_ROW_CAP ? `Showing the first ${EXPORT_ROW_CAP} rows (cap reached — narrow the date range).` : undefined,
    columns: [
      { header: 'Paid at', key: 'Paid at', format: 'datetime' },
      { header: 'Visit date', key: 'Visit date', format: 'date' },
      { header: 'Reference', key: 'Reference', width: 20 },
      { header: 'Customer', key: 'Customer', width: 22 },
      { header: 'Phone', key: 'Phone', width: 16 },
      { header: 'Email', key: 'Email', width: 24 },
      { header: 'Category', key: 'Category', width: 16 },
      { header: 'Service', key: 'Service', width: 20 },
      { header: 'Channel', key: 'Channel', width: 12 },
      { header: 'Method', key: 'Method', width: 16 },
      { header: 'Subtotal (EGP)', key: 'Subtotal (EGP)', format: 'money', total: true },
      { header: 'Discount (EGP)', key: 'Discount (EGP)', format: 'money', total: true },
      { header: 'Tax (EGP)', key: 'Tax (EGP)', format: 'money', total: true },
      { header: 'Fee (EGP)', key: 'Fee (EGP)', format: 'money', total: true },
      { header: 'Total (EGP)', key: 'Total (EGP)', format: 'money', total: true },
      { header: 'Deposit (EGP)', key: 'Deposit (EGP)', format: 'money', total: true },
      { header: 'Refunded (EGP)', key: 'Refunded (EGP)', format: 'money', total: true },
      { header: 'Net revenue (EGP)', key: 'Net revenue (EGP)', format: 'money', total: true },
      { header: 'Currency', key: 'Currency', width: 9 },
    ],
    rows: invoiceRows.map((inv) => {
      const b = inv.booking;
      const reception = !!b?.createdByStaffId;
      const discount = -inv.lines.filter((l) => l.totalCents < 0).reduce((a, l) => a + l.totalCents, 0);
      // Auditable identity per row: Net = max(0, Total − Deposit − Refunded).
      // 'Deposit' = the COLLECTED insurance amount inside Total (a liability);
      // 'Refunded' = SERVICE refunds only (deposit payouts live in the
      // Cancellations & Refunds export, kind = Insurance deposit).
      const split = splitPaidInvoice(inv.totalCents, inv.refunds, b?.insurance);
      const refunded = inv.refunds.filter((x) => x.kind === 'SERVICE').reduce((a, x) => a + x.amountCents, 0);
      return {
        'Paid at': inv.paidAt,
        'Visit date': b?.bookingDate ?? null,
        Reference: b?.reference ?? '—',
        Customer: reception ? (b?.guestName ?? '—') : (b?.user?.name ?? '—'),
        Phone: reception ? (b?.guestPhone ?? '—') : (b?.user?.phone ?? '—'),
        Email: reception ? '—' : (b?.user?.email ?? '—'),
        Category: b?.service?.category?.nameEn ?? '—',
        Service: b?.service?.nameEn ?? '—',
        Channel: reception ? 'Reception' : 'Online',
        Method: b?.payments[0]?.provider ?? '—',
        'Subtotal (EGP)': egp(inv.subtotalCents),
        'Discount (EGP)': egp(discount),
        'Tax (EGP)': egp(inv.taxCents),
        'Fee (EGP)': egp(inv.feeCents),
        'Total (EGP)': egp(inv.totalCents),
        'Deposit (EGP)': egp(inv.totalCents - split.serviceGrossCents),
        'Refunded (EGP)': egp(refunded),
        'Net revenue (EGP)': egp(split.serviceNetCents),
        Currency: inv.currency,
      };
    }),
  };

  return [
    invoiceDetail,
    summarySheet('Summary', [
      { Metric: 'Net revenue (EGP)', Value: egp(r.netRevenueCents) },
      { Metric: 'Gross revenue (EGP)', Value: egp(r.grossRevenueCents) },
      { Metric: 'Tax (EGP)', Value: egp(r.taxCents) },
      { Metric: 'Fees (EGP)', Value: egp(r.feeCents) },
      { Metric: 'Refunds (EGP)', Value: egp(r.refundCents) },
      { Metric: 'Deposits collected (EGP)', Value: egp(r.depositCollectedCents) },
      { Metric: 'Deposits refunded (EGP)', Value: egp(r.depositRefundedCents) },
      { Metric: 'Outstanding (EGP)', Value: egp(r.outstandingCents) },
      { Metric: 'Online net (EGP)', Value: egp(r.onlineNetCents) },
      { Metric: 'Reception net (EGP)', Value: egp(r.receptionNetCents) },
      { Metric: 'Paid invoices', Value: r.paidInvoices },
      { Metric: 'Average invoice (EGP)', Value: egp(r.avgInvoiceCents) },
    ]),
    {
      name: 'Revenue by day',
      columns: [
        { header: 'Date', key: 'Date', format: 'date' },
        { header: 'Revenue (EGP)', key: 'Revenue (EGP)', format: 'money', total: true },
      ],
      rows: r.trend.map((d) => ({ Date: new Date(d.date), 'Revenue (EGP)': d.amount })),
    },
    {
      name: 'By category',
      columns: [
        { header: 'Category', key: 'Category', width: 22 },
        { header: 'Invoices', key: 'Invoices', format: 'int', total: true },
        { header: 'Net revenue (EGP)', key: 'Net revenue (EGP)', format: 'money', total: true },
      ],
      rows: r.byCategory.map((c) => ({ Category: c.nameEn, Invoices: c.invoices, 'Net revenue (EGP)': egp(c.cents) })),
    },
    {
      name: 'By service',
      columns: [
        { header: 'Service', key: 'Service', width: 24 },
        { header: 'Invoices', key: 'Invoices', format: 'int', total: true },
        { header: 'Net revenue (EGP)', key: 'Net revenue (EGP)', format: 'money', total: true },
      ],
      rows: r.byService.map((s) => ({ Service: s.nameEn, Invoices: s.invoices, 'Net revenue (EGP)': egp(s.cents) })),
    },
    {
      name: 'By method',
      columns: [
        { header: 'Method', key: 'Method', width: 18 },
        { header: 'Payments', key: 'Payments', format: 'int', total: true },
        { header: 'Collected (EGP)', key: 'Collected (EGP)', format: 'money', total: true },
      ],
      rows: r.byMethod.map((m) => ({ Method: m.provider, Payments: m.payments, 'Collected (EGP)': egp(m.collectedCents) })),
    },
  ];
}

async function ratingsSheets(ctx: ExportContext): Promise<ReportSheet[]> {
  const r = await getReviewsReport({ ...ctx.range, categoryId: ctx.categoryId });
  // Raw reviews for the detail sheet — same range + category filter, capped.
  const reviews = await prisma.review.findMany({
    where: {
      createdAt: { gte: ctx.range.from, lt: ctx.range.toExclusive },
      ...(ctx.categoryId ? { service: { categoryId: ctx.categoryId } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: EXPORT_ROW_CAP,
    select: {
      createdAt: true,
      rating: true,
      status: true,
      comment: true,
      user: { select: { name: true, email: true } },
      service: { select: { nameEn: true, category: { select: { nameEn: true } } } },
      booking: { select: { reference: true } },
    },
  });
  return [
    summarySheet('Summary', [
      { Metric: 'Average rating', Value: r.average },
      { Metric: 'Total reviews', Value: r.total },
      { Metric: 'Approved', Value: r.approved },
      { Metric: 'Approval rate (%)', Value: r.approvalRate },
    ]),
    {
      name: 'By category',
      columns: [
        { header: 'Category', key: 'Category', width: 22 },
        { header: 'Avg rating', key: 'Avg rating', width: 12 },
        { header: 'Reviews', key: 'Reviews', format: 'int', total: true },
      ],
      rows: r.byCategory.map((c) => ({ Category: c.nameEn, 'Avg rating': c.avg, Reviews: c.count })),
    },
    {
      name: 'By service',
      columns: [
        { header: 'Category', key: 'Category', width: 22 },
        { header: 'Service', key: 'Service', width: 24 },
        { header: 'Avg rating', key: 'Avg rating', width: 12 },
        { header: 'Reviews', key: 'Reviews', format: 'int', total: true },
      ],
      rows: r.byService.map((s) => ({
        Category: s.categoryNameEn,
        Service: s.nameEn,
        'Avg rating': s.avg,
        Reviews: s.count,
      })),
    },
    {
      name: 'Reviews',
      columns: [
        { header: 'Date', key: 'Date', format: 'date' },
        { header: 'Guest', key: 'Guest', width: 20 },
        { header: 'Category', key: 'Category', width: 18 },
        { header: 'Service', key: 'Service', width: 20 },
        { header: 'Rating', key: 'Rating', format: 'int' },
        { header: 'Status', key: 'Status', width: 12 },
        { header: 'Comment', key: 'Comment', width: 50 },
      ],
      rows: reviews.map((v) => ({
        Date: v.createdAt,
        Guest: v.user.name || v.user.email || '—',
        Category: v.service.category.nameEn,
        Service: v.service.nameEn,
        Rating: v.rating,
        Status: v.status,
        Comment: v.comment,
      })),
    },
  ];
}

async function cabanasSheets(ctx: ExportContext): Promise<ReportSheet[]> {
  const r = await getPlacePerformanceReport({ ...ctx.range, serviceId: ctx.serviceId, categoryId: ctx.categoryId, placeId: ctx.placeId });
  return [
    {
      name: 'Place performance',
      columns: [
        { header: 'Place', key: 'Place', width: 12 },
        { header: 'Type', key: 'Type', width: 12 },
        { header: 'Zone', key: 'Zone', width: 12 },
        { header: 'Category', key: 'Category', width: 16 },
        { header: 'Service', key: 'Service', width: 20 },
        { header: 'Bookings', key: 'Bookings', format: 'int', total: true },
        { header: 'Booked days', key: 'Booked days', format: 'int', total: true },
        { header: 'Occupancy %', key: 'Occupancy %', format: 'percent' },
        { header: 'Revenue (EGP)', key: 'Revenue (EGP)', format: 'money', total: true },
        { header: 'Avg per booking (EGP)', key: 'Avg per booking (EGP)', format: 'money' },
        { header: 'Out-of-service count', key: 'Out-of-service count', format: 'int', total: true },
        { header: 'Downtime (hours)', key: 'Downtime (hours)', format: 'int', total: true },
        { header: 'Last booked', key: 'Last booked', format: 'date' },
        { header: 'Status', key: 'Status', width: 10 },
      ],
      rows: r.rows.map((p) => ({
        Place: p.label,
        Type: p.type,
        Zone: p.zone ?? '—',
        Category: p.categoryNameEn,
        Service: p.serviceNameEn,
        Bookings: p.bookings,
        'Booked days': p.bookedDays,
        'Occupancy %': p.occupancyPct,
        'Revenue (EGP)': egp(p.revenueCents),
        'Avg per booking (EGP)': egp(p.avgPerBookingCents),
        'Out-of-service count': p.outageCount,
        'Downtime (hours)': p.downtimeHours,
        'Last booked': p.lastBookedAt,
        Status: p.status,
      })),
    },
    summarySheet('Totals', [
      { Metric: 'Attributed revenue (EGP)', Value: egp(r.totals.revenueCents) },
      { Metric: 'Unassigned revenue (EGP)', Value: egp(r.unassignedRevenueCents) },
      { Metric: 'Booked place-days', Value: r.totals.bookedDays },
      { Metric: 'Bookings', Value: r.totals.bookings },
      { Metric: 'Out-of-service windows', Value: r.totals.outages },
      { Metric: 'Downtime (hours)', Value: r.totals.downtimeHours },
      { Metric: 'Range days', Value: r.rangeDays },
    ]),
  ];
}

async function customersSheets(ctx: ExportContext): Promise<ReportSheet[]> {
  const r = await getCustomersReport(ctx.range);

  // Full roster with lifetime metrics — the complete customer base, not just the
  // top spenders. Bookings count + last-visit come from a cheap groupBy; lifetime
  // net spend is folded from the customers' paid invoices.
  const customers = await prisma.user.findMany({
    where: { role: 'CUSTOMER', deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      createdAt: true,
      blockedAt: true,
      profile: { select: { nationalId: true, passportId: true, region: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: EXPORT_ROW_CAP,
  });
  const ids = customers.map((c) => c.id);
  const [bookingAgg, paidInvoices] = await Promise.all([
    prisma.booking.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _count: { _all: true }, _max: { bookingDate: true, createdAt: true } }),
    prisma.invoice.findMany({
      where: { status: 'PAID', booking: { userId: { in: ids } } },
      select: {
        totalCents: true,
        refunds: { select: { amountCents: true, kind: true } },
        booking: { select: { userId: true, insurance: { select: { amountCents: true, collectionStatus: true } } } },
      },
    }),
  ]);
  const bMap = new Map(bookingAgg.map((b) => [b.userId, b]));
  // Lifetime "spend" is SERVICE money: held/returned deposits are not spend.
  const spend = new Map<string, number>();
  for (const inv of paidInvoices) {
    const uid = inv.booking?.userId;
    if (!uid) continue;
    spend.set(uid, (spend.get(uid) ?? 0) + splitPaidInvoice(inv.totalCents, inv.refunds, inv.booking?.insurance).serviceNetCents);
  }

  const roster: ReportSheet = {
    name: 'All customers',
    note: customers.length >= EXPORT_ROW_CAP ? `Showing the first ${EXPORT_ROW_CAP} customers (cap reached).` : undefined,
    columns: [
      { header: 'Name', key: 'Name', width: 24 },
      { header: 'Email', key: 'Email', width: 26 },
      { header: 'Phone', key: 'Phone', width: 16 },
      { header: 'Region', key: 'Region', width: 16 },
      { header: 'National ID', key: 'National ID', width: 16 },
      { header: 'Passport', key: 'Passport', width: 14 },
      { header: 'Lifetime bookings', key: 'Lifetime bookings', format: 'int', total: true },
      { header: 'Lifetime net spend (EGP)', key: 'Lifetime net spend (EGP)', format: 'money', total: true },
      { header: 'Last visit', key: 'Last visit', format: 'date' },
      { header: 'Registered', key: 'Registered', format: 'datetime' },
      { header: 'Status', key: 'Status', width: 10 },
    ],
    rows: customers.map((c) => ({
      Name: c.name ?? '—',
      Email: c.email ?? '—',
      Phone: c.phone ?? '—',
      Region: c.profile?.region ?? '—',
      'National ID': maskId(c.profile?.nationalId) ?? '—',
      Passport: maskId(c.profile?.passportId) ?? '—',
      'Lifetime bookings': bMap.get(c.id)?._count._all ?? 0,
      'Lifetime net spend (EGP)': egp(spend.get(c.id) ?? 0),
      'Last visit': bMap.get(c.id)?._max.bookingDate ?? null,
      Registered: c.createdAt,
      Status: c.blockedAt ? 'Blocked' : 'Active',
    })),
  };

  return [
    roster,
    {
      name: 'Top customers',
      columns: [
        { header: 'Name', key: 'Name', width: 24 },
        { header: 'Email', key: 'Email', width: 26 },
        { header: 'Bookings', key: 'Bookings', format: 'int', total: true },
        { header: 'Net spend (EGP)', key: 'Net spend (EGP)', format: 'money', total: true },
      ],
      rows: r.topCustomers.map((c) => ({ Name: c.name ?? '—', Email: c.email ?? '—', Bookings: c.bookings, 'Net spend (EGP)': egp(c.netCents) })),
    },
    summarySheet('Summary', [
      { Metric: 'Total customers', Value: r.totalCustomers },
      { Metric: 'New customers', Value: r.newCustomers },
      { Metric: 'Blocked customers', Value: r.blockedCustomers },
      { Metric: 'Active bookers', Value: r.activeBookers },
      { Metric: 'New bookers', Value: r.newBookers },
      { Metric: 'Returning bookers', Value: r.returningBookers },
    ]),
  ];
}

async function operationsSheets(ctx: ExportContext): Promise<ReportSheet[]> {
  const r = await getOperationsReport(ctx.range);

  // Per-scan gate trail: every admit / deny / reception event in range — the raw
  // activity behind the by-hour and by-result summaries.
  const scans = await prisma.gateScanEvent.findMany({
    where: { createdAt: { gte: ctx.range.from, lt: ctx.range.toExclusive } },
    select: {
      createdAt: true,
      result: true,
      people: true,
      reference: true,
      reason: true,
      amountCents: true,
      operator: { select: { name: true, email: true } },
      booking: { select: { reference: true, service: { select: { nameEn: true } } } },
      scannedUser: { select: { name: true, phone: true } },
      category: { select: { nameEn: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: EXPORT_ROW_CAP,
  });

  const scanTrail: ReportSheet = {
    name: 'Gate scans',
    note: scans.length >= EXPORT_ROW_CAP ? `Showing the first ${EXPORT_ROW_CAP} scans (cap reached — narrow the date range).` : undefined,
    columns: [
      { header: 'Time', key: 'Time', format: 'datetime' },
      { header: 'Result', key: 'Result', width: 14 },
      { header: 'Operator', key: 'Operator', width: 22 },
      { header: 'Guest', key: 'Guest', width: 22 },
      { header: 'Phone', key: 'Phone', width: 16 },
      { header: 'Booking', key: 'Booking', width: 20 },
      { header: 'Category', key: 'Category', width: 16 },
      { header: 'Service', key: 'Service', width: 20 },
      { header: 'People', key: 'People', format: 'int', total: true },
      { header: 'Collected (EGP)', key: 'Collected (EGP)', format: 'money', total: true },
      { header: 'Detail', key: 'Detail', width: 30 },
    ],
    rows: scans.map((s) => ({
      Time: s.createdAt,
      Result: s.result,
      Operator: s.operator?.name ?? s.operator?.email ?? '—',
      Guest: s.scannedUser?.name ?? '—',
      Phone: s.scannedUser?.phone ?? '—',
      Booking: s.booking?.reference ?? s.reference ?? '—',
      Category: s.category?.nameEn ?? '—',
      Service: s.booking?.service?.nameEn ?? '—',
      People: s.people,
      'Collected (EGP)': egp(s.amountCents),
      Detail: s.reason ?? '—',
    })),
  };

  return [
    scanTrail,
    {
      name: 'Admissions by hour',
      columns: [
        { header: 'Hour', key: 'Hour', width: 10 },
        { header: 'Scans', key: 'Scans', format: 'int', total: true },
        { header: 'Guests', key: 'Guests', format: 'int', total: true },
      ],
      rows: r.admittedByHour.map((h) => ({ Hour: h.hour, Scans: h.scans, Guests: h.people })),
    },
    {
      name: 'Scans by result',
      columns: [
        { header: 'Result', key: 'Result', width: 16 },
        { header: 'Count', key: 'Count', format: 'int', total: true },
      ],
      rows: r.scansByResult.map((s) => ({ Result: s.result, Count: s.count })),
    },
    {
      name: 'Out of service now',
      columns: [
        { header: 'Place', key: 'Place', width: 12 },
        { header: 'Category', key: 'Category', width: 16 },
        { header: 'Service', key: 'Service', width: 20 },
        { header: 'Reason', key: 'Reason', width: 24 },
        { header: 'Back in service', key: 'Back in service', format: 'datetime' },
      ],
      rows: r.placesOutNow.map((p) => ({ Place: p.label, Category: p.categoryNameEn, Service: p.serviceNameEn, Reason: p.reason ?? '—', 'Back in service': p.until })),
    },
    {
      name: 'Offline places',
      columns: [
        { header: 'Place', key: 'Place', width: 12 },
        { header: 'Category', key: 'Category', width: 16 },
        { header: 'Service', key: 'Service', width: 20 },
      ],
      rows: r.placesOffline.map((p) => ({ Place: p.label, Category: p.categoryNameEn, Service: p.serviceNameEn })),
    },
  ];
}

// ── Staff performance ────────────────────────────────────────────────────────

async function staffSheets(ctx: ExportContext): Promise<ReportSheet[]> {
  const range = { from: ctx.range.from, toExclusive: ctx.range.toExclusive };
  const dir = await getStaffDirectory(range);
  const ids = dir.map((d) => d.id);
  const byId = new Map(dir.map((d) => [d.id, d]));
  const hrs = (ms: number) => Math.round((ms / 3_600_000) * 100) / 100;

  const summary: ReportSheet = {
    name: 'Staff summary',
    columns: [
      { header: 'Staff', key: 'Staff', width: 24 },
      { header: 'Role', key: 'Role', width: 14 },
      { header: 'Status', key: 'Status', width: 10 },
      { header: 'Reception bookings', key: 'Reception bookings', format: 'int', total: true },
      { header: 'Gate scans', key: 'Gate scans', format: 'int', total: true },
      { header: 'Admitted (people)', key: 'Admitted (people)', format: 'int', total: true },
      { header: 'Denied scans', key: 'Denied scans', format: 'int', total: true },
      { header: 'Net revenue (EGP)', key: 'Net revenue (EGP)', format: 'money', total: true },
      { header: 'Cash collected (EGP)', key: 'Cash collected (EGP)', format: 'money', total: true },
      { header: 'Deposit payouts (EGP)', key: 'Deposit payouts (EGP)', format: 'money', total: true },
      { header: 'Worked hours', key: 'Worked hours', total: true },
      { header: 'Active window (hrs)', key: 'Active window (hrs)' },
      { header: 'Last active', key: 'Last active', format: 'datetime' },
    ],
    rows: dir.map((d) => ({
      Staff: d.name,
      Role: d.role,
      Status: d.active ? 'Active' : 'Inactive',
      'Reception bookings': d.rollup.bookings,
      'Gate scans': d.rollup.gateScans,
      'Admitted (people)': d.rollup.admittedPeople,
      'Denied scans': d.rollup.deniedScans,
      'Net revenue (EGP)': egp(d.rollup.revenueCents),
      'Cash collected (EGP)': egp(d.rollup.cashCents),
      // Insurance deposits paid back over this desk (cash leaving the drawer) —
      // reported beside, never netted against, revenue or cash collected.
      'Deposit payouts (EGP)': egp(d.rollup.depositPayoutCents),
      'Worked hours': hrs(d.rollup.workedMs),
      'Active window (hrs)': hrs(d.rollup.scanWindowMs),
      'Last active': d.lastActiveAt,
    })),
  };

  if (ids.length === 0) return [summary];

  // Working-hours ledger: every shift (WorkSession) overlapping the range.
  const sessions = await prisma.workSession.findMany({
    where: { staffId: { in: ids }, startedAt: { lt: range.toExclusive }, OR: [{ endedAt: null }, { endedAt: { gte: range.from } }] },
    orderBy: { startedAt: 'desc' },
    take: EXPORT_ROW_CAP,
    select: { staffId: true, location: true, startedAt: true, lastActivityAt: true, endedAt: true, autoClosed: true },
  });
  const hoursSheet: ReportSheet = {
    name: 'Working hours',
    note: sessions.length >= EXPORT_ROW_CAP ? `Showing the first ${EXPORT_ROW_CAP} sessions (cap reached).` : undefined,
    columns: [
      { header: 'Staff', key: 'Staff', width: 24 },
      { header: 'Role', key: 'Role', width: 14 },
      { header: 'Location', key: 'Location', width: 12 },
      { header: 'Started', key: 'Started', format: 'datetime' },
      { header: 'Last activity', key: 'Last activity', format: 'datetime' },
      { header: 'Ended', key: 'Ended', format: 'datetime' },
      { header: 'Status', key: 'Status', width: 12 },
      { header: 'Worked hours', key: 'Worked hours', total: true },
    ],
    rows: sessions.map((s) => {
      const end = s.endedAt ?? s.lastActivityAt;
      return {
        Staff: byId.get(s.staffId)?.name ?? 'Staff',
        Role: byId.get(s.staffId)?.role ?? '—',
        Location: s.location,
        Started: s.startedAt,
        'Last activity': s.lastActivityAt,
        Ended: s.endedAt,
        Status: s.endedAt ? (s.autoClosed ? 'Auto-closed' : 'Closed') : 'Open',
        'Worked hours': hrs(Math.max(0, end.getTime() - s.startedAt.getTime())),
      };
    }),
  };

  // Revenue by staff per day (net invoice revenue via createdByStaffId + cash
  // collected via RECEPTION scans — kept in separate columns, never summed).
  const [invoices, recScans] = await Promise.all([
    prisma.invoice.findMany({
      where: staffInvoiceWhere(ids, range),
      select: {
        paidAt: true,
        totalCents: true,
        refunds: { select: { amountCents: true, kind: true } },
        booking: { select: { createdByStaffId: true, insurance: { select: { amountCents: true, collectionStatus: true } } } },
      },
    }),
    prisma.gateScanEvent.findMany({
      where: { operatorId: { in: ids }, result: 'RECEPTION', createdAt: { gte: range.from, lt: range.toExclusive } },
      select: { operatorId: true, createdAt: true, amountCents: true, people: true },
    }),
  ]);
  type Cell = { revenue: number; cash: number; bookings: number; people: number };
  const daily = new Map<string, Cell>();
  const cell = (staffId: string, day: string): Cell => {
    const k = `${staffId}|${day}`;
    let c = daily.get(k);
    if (!c) {
      c = { revenue: 0, cash: 0, bookings: 0, people: 0 };
      daily.set(k, c);
    }
    return c;
  };
  for (const inv of invoices) {
    const sid = inv.booking?.createdByStaffId;
    if (!sid || !inv.paidAt) continue;
    // Service-only net: deposits never inflate a staffer's revenue figures.
    cell(sid, resortDayKey(inv.paidAt)).revenue += splitPaidInvoice(inv.totalCents, inv.refunds, inv.booking?.insurance).serviceNetCents;
  }
  for (const s of recScans) {
    const c = cell(s.operatorId, resortDayKey(s.createdAt));
    c.cash += s.amountCents ?? 0;
    c.bookings += 1;
    c.people += s.people;
  }
  const dailyRows = Array.from(daily.entries())
    .map(([k, c]) => {
      const [sid, day] = k.split('|');
      return { sid: sid!, day: day!, ...c };
    })
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.sid < b.sid ? -1 : 1));
  const revenueSheet: ReportSheet = {
    name: 'Revenue by staff (daily)',
    columns: [
      { header: 'Day', key: 'Day', format: 'date' },
      { header: 'Staff', key: 'Staff', width: 24 },
      { header: 'Role', key: 'Role', width: 14 },
      { header: 'Reception bookings', key: 'Reception bookings', format: 'int', total: true },
      { header: 'People', key: 'People', format: 'int', total: true },
      { header: 'Net revenue (EGP)', key: 'Net revenue (EGP)', format: 'money', total: true },
      { header: 'Cash collected (EGP)', key: 'Cash collected (EGP)', format: 'money', total: true },
    ],
    rows: dailyRows.map((r) => ({
      Day: new Date(`${r.day}T00:00:00Z`),
      Staff: byId.get(r.sid)?.name ?? 'Staff',
      Role: byId.get(r.sid)?.role ?? '—',
      'Reception bookings': r.bookings,
      People: r.people,
      'Net revenue (EGP)': egp(r.revenue),
      'Cash collected (EGP)': egp(r.cash),
    })),
  };

  return [summary, hoursSheet, revenueSheet];
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

/** Report keys accepted after the `report-` prefix. */
export const REPORT_TYPES = [
  'overview',
  'bookings',
  'cabanas',
  'revenue',
  'ratings',
  'customers',
  'operations',
  'payments',
  'cancellations',
  'sanctions',
  'audit',
  'staff',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

const TITLES: Record<ReportType, string> = {
  overview: 'Operational Overview Report',
  bookings: 'Bookings Report',
  cabanas: 'Place Performance Report',
  revenue: 'Revenue Report',
  ratings: 'Guest Ratings Report',
  customers: 'Customers Report',
  operations: 'Operations Report',
  payments: 'Payments Report',
  cancellations: 'Cancellations & Refunds Report',
  sanctions: 'Sanctions Report',
  audit: 'Admin Activity (Audit) Report',
  staff: 'Staff Performance Report',
};

const FILE_STEMS: Record<ReportType, string> = {
  overview: 'overview-report',
  bookings: 'bookings-report',
  cabanas: 'place-performance-report',
  revenue: 'revenue-report',
  ratings: 'guest-ratings-report',
  customers: 'customers-report',
  operations: 'operations-report',
  payments: 'payments-report',
  cancellations: 'cancellations-refunds-report',
  sanctions: 'sanctions-report',
  audit: 'audit-report',
  staff: 'staff-performance-report',
};

/** Build the full styled workbook spec + filename stem for a report + filters. */
export async function buildReportSpec(
  type: ReportType,
  ctx: ExportContext,
): Promise<{ spec: ReportWorkbookSpec; fileStem: string }> {
  let sheets: ReportSheet[];
  switch (type) {
    case 'overview': sheets = await overviewSheets(ctx); break;
    case 'bookings': sheets = [await bookingsSheet(ctx)]; break;
    case 'cabanas': sheets = await cabanasSheets(ctx); break;
    case 'revenue': sheets = await revenueSheets(ctx); break;
    case 'ratings': sheets = await ratingsSheets(ctx); break;
    case 'customers': sheets = await customersSheets(ctx); break;
    case 'operations': sheets = await operationsSheets(ctx); break;
    case 'payments': sheets = await paymentsSheets(ctx); break;
    case 'cancellations': sheets = await cancellationsSheets(ctx); break;
    case 'sanctions': sheets = await sanctionsSheets(ctx); break;
    case 'audit': sheets = await auditSheets(ctx); break;
    case 'staff': sheets = await staffSheets(ctx); break;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    spec: { title: TITLES[type], meta: metaFor(ctx), sheets },
    fileStem: `${FILE_STEMS[type]}-${stamp}`,
  };
}
