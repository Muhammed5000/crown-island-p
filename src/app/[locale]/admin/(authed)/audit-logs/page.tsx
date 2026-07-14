import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { prisma } from '@/server/db/prisma';
import { formatDate } from '@/lib/date';
import { isLocale } from '@/i18n/config';
import { Pagination } from '@/components/ui/Pagination';
import { diffAudit } from '@/lib/audit-diff';
import { resolveAuditContext } from '@/server/audit/audit-context';
import { requireSuperAdminOrNull } from '@/server/auth/guards';
import { Link } from '@/i18n/navigation';
import { ErrorIllustration } from '@/components/ui/ErrorIllustration';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ entity?: string; page?: string }>;
}

/** Truncate a long value for the inline diff (the raw toggle keeps everything). */
function short(s: string, n = 70): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Renders exactly which fields changed (before → after) for one audit row. */
function ChangesCell({ before, after }: { before: unknown; after: unknown }) {
  const diffs = diffAudit(before, after);
  const hasRaw = (before !== null && before !== undefined) || (after !== null && after !== undefined);
  return (
    <div className="space-y-1.5">
      {diffs.length === 0 ? (
        <span className="text-xs text-muted-foreground">—</span>
      ) : (
        <ul className="space-y-0.5">
          {diffs.slice(0, 14).map((d, i) => (
            <li key={i} className="text-xs leading-snug" dir="ltr">
              <span className="font-mono font-semibold text-foreground/80">{d.field}</span>
              {d.from === null ? (
                <span className="text-emerald-600"> + {short(d.to ?? '')}</span>
              ) : d.to === null ? (
                <span className="text-red-600"> − {short(d.from)}</span>
              ) : (
                <>
                  <span className="text-red-600/80"> {short(d.from)}</span>
                  <span className="text-muted-foreground"> → </span>
                  <span className="text-emerald-700">{short(d.to ?? '')}</span>
                </>
              )}
            </li>
          ))}
          {diffs.length > 14 ? (
            <li className="text-[11px] text-muted-foreground">+{diffs.length - 14} more…</li>
          ) : null}
        </ul>
      )}
      {hasRaw ? (
        <details className="text-[11px]">
          <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">raw</summary>
          <pre
            className="mt-1 max-h-56 overflow-auto rounded-lg bg-muted/50 p-2 text-[10.5px] leading-tight text-foreground/80"
            dir="ltr"
          >
            {JSON.stringify({ before: before ?? null, after: after ?? null }, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

export default async function AdminAuditLogsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  // The audit trail carries actor IPs + full before/after snapshots (customer PII,
  // role changes, settings). Restrict reading it to SUPER_ADMIN / DEVELOPER — a
  // tighter gate than the panel-wide requireAdminOrNull in the layout.
  const auditor = await requireSuperAdminOrNull();
  if (!auditor) {
    const tf = await getTranslations('admin');
    return (
      <div className="grid h-full place-items-center p-6">
        <Card variant="glass" className="w-full max-w-md">
          <CardBody className="space-y-6 flex flex-col items-center py-10 text-center">
            <ErrorIllustration type="forbidden" />
            <div className="space-y-2">
              <h1 className="font-display text-2xl font-bold text-gradient-gold uppercase tracking-wider">
                {tf('auditLogs')}
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                This administrative sector is restricted to <strong>Super Admins</strong> only.
              </p>
            </div>
            <Link
              href="/admin"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-8 text-sm font-black text-primary-foreground shadow-sm transition-all hover:brightness-110 active:scale-95"
            >
              Return to Dashboard
            </Link>
          </CardBody>
        </Card>
      </div>
    );
  }

  const sp = await searchParams;
  const t = await getTranslations('admin');
  const tCommon = await getTranslations('common');

  const page = sp.page ? parseInt(sp.page, 10) : 1;
  const pageSize = 20;
  const where = sp.entity ? { entityType: sp.entity } : undefined;

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      // `before` / `after` (the change snapshots) are scalar Json columns and are
      // selected by default — they drive the Changes column below.
      include: { actor: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  // Resolve each row's category / service / entity label (batched, so it's a
  // handful of queries regardless of page size).
  const ctxMap = await resolveAuditContext(
    logs.map((l) => ({ id: l.id, entityType: l.entityType, entityId: l.entityId, before: l.before, after: l.after })),
    locale,
  );

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold text-gold-700">{t('auditLogs')}</h1>

      <form className="flex items-center gap-2">
        <select
          name="entity"
          defaultValue={sp.entity ?? ''}
          className="h-10 rounded-2xl border border-border/60 bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">{tCommon('viewAll')}</option>
          <option value="Category">Category</option>
          <option value="Service">Service</option>
          <option value="PriceRule">PriceRule</option>
          <option value="Booking">Booking</option>
          <option value="ServicePlace">ServicePlace</option>
          <option value="PlaceOutage">PlaceOutage</option>
          <option value="Sanction">Sanction</option>
          <option value="User">User</option>
          <option value="PromoCode">PromoCode</option>
        </select>
        <button
          type="submit"
          className="h-10 rounded-2xl bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          {tCommon('search')}
        </button>
      </form>

      <Card>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start">when</th>
                <th className="px-4 py-3 text-start">actor</th>
                <th className="px-4 py-3 text-start">action</th>
                <th className="px-4 py-3 text-start">entity</th>
                <th className="px-4 py-3 text-start">what changed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {logs.map((l) => (
                <tr key={l.id} className="align-top hover:bg-muted/30">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                    {formatDate(l.createdAt, locale, { dateStyle: 'short', timeStyle: 'short' })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-foreground">{l.actor?.name ?? l.actor?.email ?? 'System'}</div>
                    {l.ipAddress ? (
                      <div className="text-[11px] text-muted-foreground" dir="ltr">{l.ipAddress}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={l.action === 'DELETE' ? 'danger' : l.action === 'CREATE' ? 'success' : 'gold'}>
                      {l.action}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      const ctx = ctxMap.get(l.id);
                      return (
                        <>
                          <div className="text-foreground/80">{l.entityType}</div>
                          {ctx?.service || ctx?.category ? (
                            <div className="text-[11px] font-medium text-gold-700">
                              {ctx.service ?? ctx.label ?? ''}
                              {ctx.category ? <span className="text-muted-foreground"> · {ctx.category}</span> : null}
                            </div>
                          ) : ctx?.label ? (
                            <div className="text-[11px] text-muted-foreground">{ctx.label}</div>
                          ) : l.entityId ? (
                            <div className="text-[11px] text-muted-foreground" dir="ltr" title={l.entityId}>
                              {l.entityId.slice(0, 14)}…
                            </div>
                          ) : null}
                        </>
                      );
                    })()}
                  </td>
                  <td className="max-w-[520px] px-4 py-3">
                    <ChangesCell before={l.before} after={l.after} />
                  </td>
                </tr>
              ))}
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                    {tCommon('viewAll')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Pagination
        currentPage={page}
        totalPages={Math.max(1, Math.ceil(total / pageSize))}
        baseUrl="/admin/audit-logs"
        searchParams={sp}
      />
    </div>
  );
}
