import { setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/server/auth/guards';
import { isLocale } from '@/i18n/config';
import { listForUser } from '@/server/services/customer-notifications';
import { NotificationsView } from './NotificationsView';

export const dynamic = 'force-dynamic';

/**
 * Customer notification inbox — the bell's "see all" page. Auth-required.
 * A date-grouped column on mobile; a master-detail (list + reading pane) on ≥ lg.
 */
export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const user = await requireUser({ next: `/${locale}/notifications` });
  const { rows } = await listForUser(user.id);
  // Server component (force-dynamic) — runs once per request, so Date.now() is
  // a stable grouping reference, not an impure render.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  return <NotificationsView initialRows={rows} now={now} />;
}
