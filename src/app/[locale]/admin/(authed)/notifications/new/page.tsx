import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { isLocale } from '@/i18n/config';
import { createNotificationAction } from '@/features/admin/notification-actions';
import { NotificationForm } from '../NotificationForm';

export default async function NewNotificationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);
  await requireAdmin();

  const [tags, t] = await Promise.all([
    prisma.customerTag.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    getTranslations('admin'),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="font-display text-2xl font-semibold text-foreground">{t('newNotification')}</h1>
      <NotificationForm mode="create" action={createNotificationAction} tags={tags} />
    </div>
  );
}
