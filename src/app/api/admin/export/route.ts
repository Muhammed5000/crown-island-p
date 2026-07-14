import { NextResponse, type NextRequest } from 'next/server';
import { Prisma, BookingStatus, PaymentStatus, PaymentProvider } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { getSessionUser } from '@/server/auth/guards';
import { canAccessAdmin } from '@/server/auth/roles';
import { parseReportRange } from '@/lib/date';
import { buildReportWorkbook, buildReportCsv, type ReportSheet, type ReportWorkbookSpec } from '@/server/reports/workbook';
import { buildReportSpec, REPORT_TYPES, type ExportContext, type ReportType } from '@/server/reports/report-specs';
import { maskId } from '@/lib/mask';
import { log, errFields } from '@/lib/log';

// exceljs needs the Node runtime (never edge).
export const runtime = 'nodejs';

/**
 * Admin data export.
 *
 *  - `type=report-<name>` (from the Reports page) → the full styled workbook for
 *    that report + the current filters (date range, service, status, …).
 *  - `type=bookings|invoices|customers` (legacy list-page ExportButton) → a
 *    single styled sheet of the latest `limit` rows.
 *  - `format=csv` flattens the primary sheet.
 *
 * Every path is admin-gated, masks government-ID PII, and neutralises formula
 * injection (handled centrally in the workbook builder).
 */

const oneEnum =<T extends Record<string, string>>(e: T, v: string | null): T[keyof T] | undefined =>
  v && (Object.values(e) as string[]).includes(v) ? (v as T[keyof T]) : undefined;

async function respond(spec: ReportWorkbookSpec, fileStem: string, format: 'csv' | 'xlsx'): Promise<NextResponse> {
  if (format === 'csv') {
    // BOM so Excel decodes UTF-8 (Arabic names) correctly.
    const csv = '﻿' + buildReportCsv(spec);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Disposition': `attachment; filename="${fileStem}.csv"`,
        'Content-Type': 'text/csv; charset=utf-8',
      },
    });
  }
  const buf = await buildReportWorkbook(spec);
  // The bytes are a valid response body at runtime; the cast sidesteps a TS
  // friction where `Uint8Array<ArrayBufferLike>` isn't matched to `BodyInit`.
  return new NextResponse(buf as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Disposition': `attachment; filename="${fileStem}.xlsx"`,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
  });
}

export async function GET(req: NextRequest) {
  // Auth FIRST and outside the try block — requireAdmin() throws a redirect that
  // a catch would swallow into a 500, so check the session explicitly.
  const user = await getSessionUser();
  if (!user || !canAccessAdmin(user.role)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') || 'bookings';
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100', 10) || 100, 1), 5000);
    const format = searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';
    const stamp = new Date().toISOString().slice(0, 10);
    const nowMeta = { label: 'Generated', value: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC' };

    // ── Reports-page exports: styled multi-sheet workbook per report + filters ──
    if (type.startsWith('report-')) {
      const key = type.slice('report-'.length) as ReportType;
      if (!(REPORT_TYPES as readonly string[]).includes(key)) {
        return new NextResponse('Unknown report type', { status: 400 });
      }
      const range = parseReportRange(searchParams.get('from'), searchParams.get('to'));
      const serviceId = searchParams.get('serviceId') || undefined;
      const categoryId = searchParams.get('categoryId') || undefined;
      const placeId = searchParams.get('placeId') || undefined;

      // Resolve human labels for the "filters applied" band (cheap, id-scoped).
      const [service, category, place] = await Promise.all([
        serviceId ? prisma.service.findUnique({ where: { id: serviceId }, select: { nameEn: true } }) : null,
        categoryId ? prisma.category.findUnique({ where: { id: categoryId }, select: { nameEn: true } }) : null,
        placeId ? prisma.servicePlace.findUnique({ where: { id: placeId }, select: { label: true } }) : null,
      ]);

      const channelParam = searchParams.get('channel');
      const checkedInParam = searchParams.get('checkedIn');
      const ctx: ExportContext = {
        range,
        serviceId,
        categoryId,
        placeId,
        status: oneEnum(BookingStatus, searchParams.get('status')),
        paymentStatus: oneEnum(PaymentStatus, searchParams.get('paymentStatus')),
        provider: oneEnum(PaymentProvider, searchParams.get('provider')),
        channel: channelParam === 'online' || channelParam === 'reception' ? channelParam : undefined,
        checkedIn: checkedInParam === 'yes' || checkedInParam === 'no' ? checkedInParam : undefined,
        serviceLabel: service?.nameEn,
        categoryLabel: category?.nameEn,
        placeLabel: place?.label,
      };

      const { spec, fileStem } = await buildReportSpec(key, ctx);
      return await respond(spec, fileStem, format);
    }

    // ── Legacy list-page exports (bookings / invoices / customers) ─────────────
    let sheet: ReportSheet | null = null;
    let fileStem = '';

    if (type === 'bookings') {
      const bookings = await prisma.booking.findMany({
        select: {
          reference: true,
          bookingDate: true,
          status: true,
          createdAt: true,
          user: { select: { name: true, email: true, phone: true } },
          service: { select: { nameEn: true, category: { select: { nameEn: true } } } },
          invoice: { select: { totalCents: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      sheet = {
        name: 'Bookings',
        columns: [
          { header: 'Reference', key: 'Reference', width: 20 },
          { header: 'Date', key: 'Date', format: 'date' },
          { header: 'Service', key: 'Service', width: 20 },
          { header: 'Category', key: 'Category', width: 16 },
          { header: 'Customer Name', key: 'Customer Name', width: 22 },
          { header: 'Customer Email', key: 'Customer Email', width: 24 },
          { header: 'Customer Phone', key: 'Customer Phone', width: 16 },
          { header: 'Total Amount', key: 'Total Amount', format: 'money', total: true },
          { header: 'Status', key: 'Status', width: 16 },
          { header: 'Created At', key: 'Created At', format: 'datetime' },
        ],
        rows: bookings.map((b) => ({
          Reference: b.reference,
          Date: b.bookingDate,
          Service: b.service.nameEn,
          Category: b.service.category.nameEn,
          'Customer Name': b.user.name ?? '—',
          'Customer Email': b.user.email ?? '—',
          'Customer Phone': b.user.phone ?? '—',
          'Total Amount': b.invoice ? b.invoice.totalCents / 100 : 0,
          Status: b.status,
          'Created At': b.createdAt,
        })),
      };
      fileStem = `bookings_export_${stamp}`;
    } else if (type === 'invoices') {
      const invoices = await prisma.invoice.findMany({
        select: {
          id: true, status: true, currency: true,
          subtotalCents: true, taxCents: true, feeCents: true, totalCents: true,
          paidAt: true, createdAt: true,
          booking: { select: { reference: true, user: { select: { name: true, email: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      sheet = {
        name: 'Invoices',
        columns: [
          { header: 'Invoice ID', key: 'Invoice ID', width: 26 },
          { header: 'Booking Reference', key: 'Booking Reference', width: 20 },
          { header: 'Customer Name', key: 'Customer Name', width: 22 },
          { header: 'Customer Email', key: 'Customer Email', width: 24 },
          { header: 'Status', key: 'Status', width: 12 },
          { header: 'Currency', key: 'Currency', width: 10 },
          { header: 'Subtotal', key: 'Subtotal', format: 'money', total: true },
          { header: 'Tax', key: 'Tax', format: 'money', total: true },
          { header: 'Fee', key: 'Fee', format: 'money', total: true },
          { header: 'Total', key: 'Total', format: 'money', total: true },
          { header: 'Paid At', key: 'Paid At', format: 'datetime' },
          { header: 'Created At', key: 'Created At', format: 'datetime' },
        ],
        rows: invoices.map((inv) => ({
          'Invoice ID': inv.id,
          'Booking Reference': inv.booking.reference,
          'Customer Name': inv.booking.user.name ?? '—',
          'Customer Email': inv.booking.user.email ?? '—',
          Status: inv.status,
          Currency: inv.currency,
          Subtotal: inv.subtotalCents / 100,
          Tax: inv.taxCents / 100,
          Fee: inv.feeCents / 100,
          Total: inv.totalCents / 100,
          'Paid At': inv.paidAt,
          'Created At': inv.createdAt,
        })),
      };
      fileStem = `invoices_export_${stamp}`;
    } else if (type === 'customers') {
      const users = await prisma.user.findMany({
        where: { role: 'CUSTOMER', deletedAt: null },
        select: {
          id: true, name: true, email: true, phone: true, createdAt: true,
          emailVerified: true, phoneVerified: true,
          profile: { select: { region: true, nationalId: true, passportId: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      const ids = users.map((u) => u.id);
      const agg = ids.length
        ? await prisma.$queryRaw<{ userId: string; bookings: number; spentCents: number; lastBookingAt: Date | null }[]>`
            SELECT b."userId" AS "userId", COUNT(*)::int AS "bookings",
                   COALESCE(SUM(CASE WHEN b.status='CONFIRMED' THEN i."totalCents" ELSE 0 END),0)::int AS "spentCents",
                   MAX(b."bookingDate") AS "lastBookingAt"
            FROM "Booking" b LEFT JOIN "Invoice" i ON i."bookingId" = b.id
            WHERE b."userId" IN (${Prisma.join(ids)}) GROUP BY b."userId"`
        : [];
      const aggMap = new Map(agg.map((r) => [r.userId, r]));
      sheet = {
        name: 'Customers',
        columns: [
          { header: 'Customer ID', key: 'Customer ID', width: 26 },
          { header: 'Name', key: 'Name', width: 22 },
          { header: 'Email', key: 'Email', width: 26 },
          { header: 'Phone', key: 'Phone', width: 16 },
          { header: 'Region', key: 'Region', width: 14 },
          { header: 'National ID', key: 'National ID', width: 16 },
          { header: 'Passport', key: 'Passport', width: 14 },
          { header: 'Verified', key: 'Verified', width: 10 },
          { header: 'Total Bookings', key: 'Total Bookings', format: 'int', total: true },
          { header: 'Total Spent', key: 'Total Spent', format: 'money', total: true },
          { header: 'Last Booking', key: 'Last Booking', format: 'date' },
          { header: 'Registered', key: 'Registered', format: 'date' },
        ],
        rows: users.map((u) => {
          const a = aggMap.get(u.id);
          return {
            'Customer ID': u.id,
            Name: u.name ?? '—',
            Email: u.email ?? '—',
            Phone: u.phone ?? '—',
            Region: u.profile?.region ?? '—',
            'National ID': maskId(u.profile?.nationalId),
            Passport: maskId(u.profile?.passportId),
            Verified: u.emailVerified || u.phoneVerified ? 'Yes' : 'No',
            'Total Bookings': a?.bookings ?? 0,
            'Total Spent': (a?.spentCents ?? 0) / 100,
            'Last Booking': a?.lastBookingAt ?? null,
            Registered: u.createdAt,
          };
        }),
      };
      fileStem = `customers_export_${stamp}`;
    } else {
      return new NextResponse('Unknown export type', { status: 400 });
    }

    const spec: ReportWorkbookSpec = {
      title: sheet.name + ' Export',
      meta: [{ label: 'Rows', value: `Latest ${sheet.rows.length}` }, nowMeta],
      sheets: [sheet],
    };
    return await respond(spec, fileStem, format);
  } catch (error) {
    log.error('export error', errFields(error));
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
