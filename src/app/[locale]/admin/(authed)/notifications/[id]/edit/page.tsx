import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { requireAdmin } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { isLocale } from '@/i18n/config';
import { updateNotificationAction } from '@/features/admin/notification-actions';
import { NotificationForm } from '../../NotificationForm';

const STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT: 'muted',
  SCHEDULED: 'info',
  SENDING: 'warning',
  SENT: 'success',
  FAILED: 'danger',
};

/** datetime-local needs "YYYY-MM-DDTHH:mm" in the server's local (resort) time. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default async function EditNotificationPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);
  await requireAdmin();

  const [campaign, tags] = await Promise.all([
    prisma.notificationCampaign.findUnique({
      where: { id },
      include: {
        recipients: {
          include: { user: { select: { id: true, name: true, email: true, phone: true } } },
        },
      },
    }),
    prisma.customerTag.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  if (!campaign) notFound();

  const title = locale === 'ar' ? campaign.titleAr : campaign.titleEn;
  const body = locale === 'ar' ? campaign.bodyAr : campaign.bodyEn;
  const readOnly = campaign.status === 'SENT' || campaign.status === 'SENDING';

  if (readOnly) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="flex items-center justify-between gap-3">
          <h1 className="font-display text-2xl font-semibold text-foreground">{title}</h1>
          <Badge tone={STATUS_TONE[campaign.status] ?? 'muted'}>{campaign.status}</Badge>
        </header>
        <Card>
          <CardBody className="space-y-3 text-sm">
            <p className="text-muted-foreground">{body}</p>
            <dl className="grid grid-cols-2 gap-3 border-t border-border/50 pt-3">
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Recipients</dt>
                <dd className="tabular-nums text-foreground">{campaign.recipientCount}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Push delivered</dt>
                <dd className="tabular-nums text-foreground">
                  {campaign.pushSentCount} / {campaign.pushSentCount + campaign.pushFailCount}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              Sent notifications are read-only. Create a new one to send again.
            </p>
          </CardBody>
        </Card>
        <Link href="/admin/notifications" className="text-sm text-accent hover:underline">
          ← Back to notifications
        </Link>
      </div>
    );
  }

  const defaults = {
    id: campaign.id,
    titleEn: campaign.titleEn,
    titleAr: campaign.titleAr,
    bodyEn: campaign.bodyEn,
    bodyAr: campaign.bodyAr,
    iconUrl: campaign.iconUrl ?? undefined,
    url: campaign.url ?? undefined,
    audience: campaign.audience,
    tagId: campaign.tagId,
    scheduledAtLocal: campaign.scheduledAt ? toLocalInput(campaign.scheduledAt) : undefined,
    recipients: campaign.recipients.map((r) => ({
      id: r.userId,
      label: r.user.name || r.user.email || r.user.phone || r.userId,
    })),
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="font-display text-2xl font-semibold text-foreground">Edit notification</h1>
      <NotificationForm
        mode="edit"
        action={updateNotificationAction}
        tags={tags}
        defaultValues={defaults}
      />
    </div>
  );
}
