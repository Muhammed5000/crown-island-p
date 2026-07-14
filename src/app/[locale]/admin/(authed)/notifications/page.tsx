import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Pagination } from '@/components/ui/Pagination';
import { prisma } from '@/server/db/prisma';
import { isLocale } from '@/i18n/config';
import { NotificationDeleteButton } from './NotificationDeleteButton';

const STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: 'muted',
  SCHEDULED: 'info',
  SENDING: 'warning',
  SENT: 'success',
  FAILED: 'danger',
};

function fmtDate(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export default async function AdminNotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const sp = await searchParams;
  const t = await getTranslations('admin');

  const page = sp.page ? parseInt(sp.page, 10) : 1;
  const pageSize = 20;

  const [total, campaigns] = await Promise.all([
    prisma.notificationCampaign.count(),
    prisma.notificationCampaign.findMany({
      include: {
        tag: { select: { name: true } },
        _count: { select: { recipients: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const audienceLabel = (c: (typeof campaigns)[number]): string => {
    if (c.audience === 'ALL') return 'All customers';
    if (c.audience === 'TAG') return c.tag ? `Tag · ${c.tag.name}` : 'Tag';
    return `Specific · ${c._count.recipients}`;
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-foreground">{t('notifications')}</h1>
        <Link
          href="/admin/notifications/new"
          className="inline-flex h-10 items-center justify-center rounded-2xl bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          {t('newNotification')}
        </Link>
      </header>

      <Card>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start">title</th>
                <th className="px-4 py-3 text-start">audience</th>
                <th className="px-4 py-3 text-start">status</th>
                <th className="px-4 py-3 text-end">recipients</th>
                <th className="px-4 py-3 text-end">push</th>
                <th className="px-4 py-3 text-start">when</th>
                <th className="px-4 py-3 text-end" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {campaigns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    No notifications yet.
                  </td>
                </tr>
              ) : (
                campaigns.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {locale === 'ar' ? c.titleAr : c.titleEn}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{audienceLabel(c)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONE[c.status] ?? 'muted'}>{c.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums text-muted-foreground">
                      {c.status === 'SENT' ? c.recipientCount : '—'}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums text-muted-foreground">
                      {c.status === 'SENT' ? `${c.pushSentCount}/${c.pushSentCount + c.pushFailCount}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {c.status === 'SCHEDULED' && c.scheduledAt
                        ? `⏰ ${fmtDate(c.scheduledAt, locale)}`
                        : c.sentAt
                          ? fmtDate(c.sentAt, locale)
                          : fmtDate(c.createdAt, locale)}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          href={`/admin/notifications/${c.id}/edit`}
                          className="text-xs text-gold-600 underline-offset-4 hover:underline"
                          aria-label="Edit"
                        >
                          ✎
                        </Link>
                        <NotificationDeleteButton
                          id={c.id}
                          title={locale === 'ar' ? c.titleAr : c.titleEn}
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Pagination
        currentPage={page}
        totalPages={Math.ceil(total / pageSize)}
        baseUrl="/admin/notifications"
        searchParams={sp}
      />
    </div>
  );
}
