import Image from 'next/image';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { PhoneIcon, SearchIcon, StoreIcon, UtensilsIcon } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { TopNav } from '@/components/layout/TopNav';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { Card, CardBody } from '@/components/ui/Card';
import { PageTransition } from '@/components/layout/PageTransition';
import { requireUser } from '@/server/auth/guards';
import { isRestaurantOwner } from '@/server/auth/roles';
import { listPublicRestaurants } from '@/server/services/restaurants';
import { isLocale } from '@/i18n/config';

/**
 * Restaurants directory — every APPROVED partner restaurant, searchable by
 * name/description. Each card opens `/menu/[id]` where the guest can read the
 * full profile, call, follow social links and download the menu PDF.
 * RESTAURANT-role accounts also get a "manage my restaurant" shortcut.
 */
export default async function MenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);
  // User-only page — guests are sent to sign in (the booking catalog stays open).
  const user = await requireUser();

  const { q } = await searchParams;
  const query = typeof q === 'string' ? q.slice(0, 80) : undefined;
  const [restaurants, t] = await Promise.all([
    listPublicRestaurants(query),
    getTranslations('menu'),
  ]);

  return (
    <PageTransition>
      <TopNav
        title={t('title')}
        locale={locale}
        hideBack
        trailing={
          <div className="xl:hidden">
            <NotificationBell />
          </div>
        }
      />
      <div className="mx-auto max-w-md px-5 pb-10 pt-2 md:max-w-3xl xl:max-w-5xl">
        <p className="mb-4 text-sm text-muted-foreground">{t('directorySubtitle')}</p>

        {isRestaurantOwner(user.role) ? (
          <Link
            href="/menu/manage"
            className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-gold-400/30 bg-gold-400/10 px-4 py-3 text-sm font-semibold text-gold-700 transition hover:bg-gold-400/20"
          >
            <span className="inline-flex items-center gap-2">
              <StoreIcon className="size-4" />
              {t('manageCta')}
            </span>
            <span aria-hidden>→</span>
          </Link>
        ) : null}

        {/* Search (GET form — works without JS, keeps the URL shareable) */}
        <form action="" method="get" className="mb-6 flex gap-2" role="search">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              name="q"
              defaultValue={query ?? ''}
              maxLength={80}
              placeholder={t('searchPlaceholder')}
              className="h-12 w-full rounded-2xl border border-gold-400/30 bg-card ps-11 pe-4 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <button
            type="submit"
            className="h-12 rounded-2xl border border-gold-400/30 bg-gold-400/10 px-5 text-sm font-semibold text-gold-700 transition hover:bg-gold-400/20"
          >
            {t('searchAction')}
          </button>
        </form>

        {restaurants.length === 0 ? (
          <Card variant="glass">
            <CardBody className="flex flex-col items-center gap-4 px-5 py-12 text-center">
              <span className="grid size-14 place-items-center rounded-2xl bg-gold-400/15 text-gold-600">
                <UtensilsIcon className="size-7" />
              </span>
              <p className="max-w-xs text-sm text-muted-foreground">
                {query ? t('emptySearch') : t('empty')}
              </p>
            </CardBody>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {restaurants.map((r) => (
              <Link key={r.id} href={`/menu/${r.id}`} className="group block focus-visible:outline-none">
                <div className="flex h-full flex-col overflow-hidden rounded-[20px] border border-border bg-card transition-all duration-200 group-hover:-translate-y-1 group-hover:border-gold-400/30 group-hover:shadow-[0_22px_55px_rgba(28,43,64,0.15)]">
                  <div className="relative h-[170px] overflow-hidden bg-muted">
                    {r.coverUrl ? (
                      <Image
                        src={r.coverUrl}
                        alt=""
                        fill
                        sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                        className="object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="grid h-full place-items-center bg-[radial-gradient(circle_at_50%_30%,rgba(212,165,87,0.18),transparent_70%)]">
                        <UtensilsIcon className="size-10 text-gold-400/50" strokeWidth={1.25} />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col px-5 pt-4">
                    <h3 className="font-display text-lg font-bold text-foreground transition-colors group-hover:text-gold-700">
                      {r.name}
                    </h3>
                    {r.description ? (
                      <p className="mt-1.5 line-clamp-2 min-h-[36px] text-[13px] leading-[1.5] text-muted-foreground">
                        {r.description}
                      </p>
                    ) : (
                      <div className="min-h-[36px]" />
                    )}
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-border bg-muted px-5 py-3.5 transition-colors group-hover:bg-gold-400/5">
                    <span className="text-[12px] font-bold uppercase tracking-[0.12em] text-gold-700">
                      {t('viewProfile')}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground" dir="ltr">
                      <PhoneIcon className="size-3.5" />
                      {r.phone}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </PageTransition>
  );
}
