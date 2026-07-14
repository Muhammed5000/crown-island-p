import { setRequestLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ArrowLeftIcon } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/server/auth/guards';
import { isLocale } from '@/i18n/config';
import { getForUser } from '@/server/services/customer-notifications';
import { MarkNotificationRead } from './MarkNotificationRead';
import { NotificationReader } from '../NotificationReader';

export const dynamic = 'force-dynamic';

/**
 * Notification detail — opened when a customer taps a notification on mobile (or
 * via a push deep link). Reuses the shared NotificationReader so it matches the
 * desktop reading pane exactly. Framed as a notification, not a news article.
 */
export default async function NotificationDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const user = await requireUser({ next: `/${locale}/notifications/${id}` });
  const [n, t] = await Promise.all([
    getForUser(user.id, id),
    getTranslations('notifications'),
  ]);
  if (!n) notFound();

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 lg:py-8">
      <MarkNotificationRead id={n.id} />
      {/* The visible title is the reader's <h2>; this gives the route one h1. */}
      <h1 className="sr-only">{t('title')}</h1>

      <Link
        href="/notifications"
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-accent transition-colors hover:text-accent/80"
      >
        <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
        {t('detailBack')}
      </Link>

      <NotificationReader notification={n} />
    </div>
  );
}
