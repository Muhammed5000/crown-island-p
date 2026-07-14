import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { ArrowLeftIcon, FileTextIcon } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { requireAdmin } from '@/server/auth/guards';
import { adminGetRestaurant } from '@/server/services/restaurants';
import { isLocale } from '@/i18n/config';
import { RestaurantModerationPanel } from '../RestaurantModerationPanel';

const STATUS_TONE: Record<string, BadgeTone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  DISABLED: 'muted',
};

/** Admin: one restaurant profile — full details, owner, links, moderation. */
export default async function AdminRestaurantDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);
  await requireAdmin();

  const restaurant = await adminGetRestaurant(id);
  if (!restaurant) notFound();

  const links: Array<{ label: string; href: string | null }> = [
    { label: 'Facebook', href: restaurant.facebookUrl },
    { label: 'Instagram', href: restaurant.instagramUrl },
    { label: 'TikTok', href: restaurant.tiktokUrl },
    { label: 'Website', href: restaurant.websiteUrl },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/admin/restaurants"
            className="mb-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5 rtl:rotate-180" />
            All restaurants
          </Link>
          <h1 className="font-display text-2xl font-bold text-foreground">{restaurant.name}</h1>
          <p className="text-sm text-muted-foreground">
            Created {restaurant.createdAt.toISOString().slice(0, 10)} · Updated{' '}
            {restaurant.updatedAt.toISOString().slice(0, 10)}
          </p>
        </div>
        <Badge tone={STATUS_TONE[restaurant.status] ?? 'muted'}>{restaurant.status}</Badge>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-foreground">Profile</h2>
            </CardHeader>
            <CardBody className="space-y-4">
              {restaurant.coverUrl ? (
                // Plain <img> matches the admin-preview convention (see MediaUploadInput).
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={restaurant.coverUrl}
                  alt=""
                  className="max-h-[260px] w-full rounded-xl object-cover"
                />
              ) : (
                <p className="text-sm text-muted-foreground">No cover image uploaded.</p>
              )}
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wider text-muted-foreground">Phone</dt>
                  <dd className="text-foreground" dir="ltr">{restaurant.phone}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                    Opening hours
                  </dt>
                  <dd className="text-foreground">{restaurant.openingHours ?? '—'}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs uppercase tracking-wider text-muted-foreground">Address</dt>
                  <dd className="text-foreground">{restaurant.address ?? '—'}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                    Description
                  </dt>
                  <dd className="whitespace-pre-line text-muted-foreground">
                    {restaurant.description ?? '—'}
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="font-semibold text-foreground">Menu & links</h2>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              {restaurant.menuPdfUrl ? (
                <a
                  href={restaurant.menuPdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-gold-600 underline-offset-4 hover:underline"
                >
                  <FileTextIcon className="size-4" />
                  {restaurant.menuPdfName ?? 'Menu PDF'}
                  {restaurant.menuPdfSize
                    ? ` (${(restaurant.menuPdfSize / (1024 * 1024)).toFixed(1)} MB)`
                    : ''}
                </a>
              ) : (
                <p className="text-muted-foreground">No menu PDF uploaded.</p>
              )}
              <ul className="space-y-1.5">
                {links.map(({ label, href }) => (
                  <li key={label} className="flex items-center gap-2">
                    <span className="w-24 text-xs uppercase tracking-wider text-muted-foreground">
                      {label}
                    </span>
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        dir="ltr"
                        className="truncate text-gold-600 underline-offset-4 hover:underline"
                      >
                        {href}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-foreground">Owner</h2>
            </CardHeader>
            <CardBody className="space-y-1.5 text-sm">
              <p className="font-medium text-foreground">{restaurant.owner.name ?? '—'}</p>
              <p className="text-muted-foreground">{restaurant.owner.email ?? '—'}</p>
              <p className="text-muted-foreground" dir="ltr">
                {restaurant.owner.phone ?? '—'}
              </p>
              {restaurant.owner.blockedAt ? <Badge tone="danger">Blocked account</Badge> : null}
              {restaurant.owner.deletedAt ? <Badge tone="muted">Archived account</Badge> : null}
              <p className="pt-1">
                <Link
                  href={`/admin/customers/${restaurant.owner.id}`}
                  className="text-gold-600 underline-offset-4 hover:underline"
                >
                  Open customer profile
                </Link>
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="font-semibold text-foreground">Moderation</h2>
            </CardHeader>
            <CardBody>
              <RestaurantModerationPanel
                id={restaurant.id}
                status={restaurant.status}
                statusNote={restaurant.statusNote}
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
