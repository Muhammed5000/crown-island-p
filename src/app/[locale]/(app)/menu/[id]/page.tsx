import Image from 'next/image';
import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  ClockIcon,
  DownloadIcon,
  EyeIcon,
  FacebookIcon,
  GlobeIcon,
  InstagramIcon,
  MapPinIcon,
  Music2Icon,
  PhoneIcon,
  UtensilsIcon,
} from 'lucide-react';
import { PageTransition } from '@/components/layout/PageTransition';
import { requireUser } from '@/server/auth/guards';
import { canAccessAdmin } from '@/server/auth/roles';
import { getRestaurantForViewer } from '@/server/services/restaurants';
import { isLocale } from '@/i18n/config';

/**
 * Restaurant profile - full description, contact details, social links and
 * the downloadable menu PDF. Only APPROVED restaurants are visible to guests;
 * the owner and admins can preview an unapproved profile.
 */
export default async function RestaurantDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);
  const user = await requireUser();

  const restaurant = await getRestaurantForViewer(id, {
    id: user.id,
    isAdmin: canAccessAdmin(user.role),
  });
  if (!restaurant) notFound();

  const t = await getTranslations('menu');

  const socials = [
    { href: restaurant.facebookUrl, label: 'Facebook', Icon: FacebookIcon, kind: 'social' },
    { href: restaurant.instagramUrl, label: 'Instagram', Icon: InstagramIcon, kind: 'social' },
    { href: restaurant.tiktokUrl, label: 'TikTok', Icon: Music2Icon, kind: 'social' },
    { href: restaurant.websiteUrl, label: t('website'), Icon: GlobeIcon, kind: 'website' },
  ].filter(
    (s): s is { href: string; label: string; Icon: typeof GlobeIcon; kind: 'social' | 'website' } =>
      !!s.href,
  );

  return (
    <PageTransition>
      <div className="relative mx-auto w-full max-w-[1280px] overflow-hidden px-4 pb-12 pt-2 sm:px-6 lg:px-10">
        <div
          className="pointer-events-none absolute inset-x-0 top-12 -z-10 h-[520px] bg-[linear-gradient(180deg,rgba(255,255,255,0.74),rgba(255,255,255,0.34)_42%,transparent)]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-x-[8%] bottom-0 -z-10 h-48 rounded-[50%] bg-[radial-gradient(80%_80%_at_50%_100%,rgba(42,157,168,0.08),transparent_68%)]"
          aria-hidden
        />

        {restaurant.status !== 'APPROVED' ? (
          <div className="mx-auto mb-5 flex max-w-[1120px] items-center gap-2 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-[13px] font-medium text-warning">
            <EyeIcon className="size-4 shrink-0" />
            {t('previewBanner')}
          </div>
        ) : null}

        <section className="mx-auto max-w-[1120px]">
          <div className="relative overflow-hidden rounded-[22px] border border-gold-400/20 bg-card shadow-[0_22px_70px_-34px_rgba(20,32,46,0.55)]">
            <div className="relative aspect-[4/3] sm:aspect-[16/7] lg:aspect-[16/5]">
              {restaurant.coverUrl ? (
                <Image
                  src={restaurant.coverUrl}
                  alt={restaurant.name}
                  fill
                  priority
                  sizes="(max-width: 768px) 100vw, 1120px"
                  className="object-cover"
                />
              ) : (
                <div className="grid h-full place-items-center bg-[linear-gradient(135deg,#f7f1e5,#ffffff_42%,#e7f5f6)]">
                  <UtensilsIcon className="size-16 text-gold-400/55" strokeWidth={1.2} />
                </div>
              )}
              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(16,11,4,0.34),transparent_38%,rgba(16,11,4,0.06))]" />
              <div className="absolute bottom-0 left-0 right-0 h-20 bg-[linear-gradient(180deg,transparent,rgba(16,11,4,0.28))]" />
            </div>
          </div>
        </section>

        <section className="mx-auto mt-6 max-w-3xl text-center">
          <h1 className="font-aurelia-display text-5xl font-semibold leading-none text-primary sm:text-6xl lg:text-7xl">
            {restaurant.name}
          </h1>
          {restaurant.description ? (
            <p className="mx-auto mt-4 max-w-2xl whitespace-pre-line font-aurelia-display text-xl leading-relaxed text-foreground sm:text-2xl">
              {restaurant.description}
            </p>
          ) : null}
        </section>

        <section className="mx-auto mt-6 max-w-[640px]">
          {restaurant.menuPdfUrl ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <a
                href={restaurant.menuPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="gleam inline-flex min-h-14 items-center justify-center gap-3 rounded-lg bg-[linear-gradient(135deg,#d99a24_0%,#c68112_52%,#a86108_100%)] px-5 py-3 text-center font-bold text-white shadow-[0_14px_32px_-16px_rgba(168,97,8,0.7)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_44px_-18px_rgba(168,97,8,0.78)]"
              >
                <EyeIcon className="size-5 shrink-0" />
                {t('viewMenu')}
              </a>
              <a
                href={restaurant.menuPdfUrl}
                download={restaurant.menuPdfName || `${restaurant.name}-menu.pdf`}
                className="bg-white/78 inline-flex min-h-14 items-center justify-center gap-3 rounded-lg border border-gold-500/45 px-5 py-3 text-center font-bold text-gold-700 shadow-[0_10px_30px_-24px_rgba(20,32,46,0.35)] backdrop-blur transition hover:-translate-y-0.5 hover:border-gold-600/60 hover:bg-white"
              >
                <DownloadIcon className="size-5 shrink-0" />
                {t('downloadMenu')}
              </a>
            </div>
          ) : (
            <div className="bg-white/78 rounded-lg border border-gold-400/35 px-5 py-4 text-center font-medium text-muted-foreground shadow-soft backdrop-blur">
              {t('noMenu')}
            </div>
          )}
        </section>

        <section className="mx-auto mt-7 grid max-w-[960px] gap-4 lg:grid-cols-3">
          <DetailCard
            label={t('phone')}
            value={restaurant.phone}
            href={`tel:${restaurant.phone}`}
            Icon={PhoneIcon}
            dir="ltr"
          />
          {restaurant.address ? (
            <DetailCard label={t('address')} value={restaurant.address} Icon={MapPinIcon} />
          ) : null}
          {restaurant.openingHours ? (
            <DetailCard label={t('hours')} value={restaurant.openingHours} Icon={ClockIcon} />
          ) : null}
        </section>

        {socials.length > 0 ? (
          <section className="bg-white/66 relative mx-auto mt-6 max-w-[1120px] overflow-hidden rounded-[22px] border border-gold-400/20 px-5 pb-6 pt-4 shadow-[0_24px_60px_-44px_rgba(20,32,46,0.6)] backdrop-blur">
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-[linear-gradient(170deg,transparent_0_40%,rgba(42,157,168,0.12)_41%_58%,rgba(42,157,168,0.04)_59%_68%,transparent_69%)]"
              aria-hidden
            />
            <div className="relative mb-5 text-center">
              <h2 className="font-aurelia-display text-lg font-bold uppercase tracking-[0.16em] text-foreground">
                {t('links')}
              </h2>
              <span
                className="mx-auto mt-2 block h-0.5 w-10 rounded-full bg-gold-400/60"
                aria-hidden
              />
            </div>
            <div className="relative mx-auto grid max-w-2xl gap-3 sm:grid-cols-2">
              {socials.map(({ href, label, Icon, kind }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-white/82 inline-flex min-h-16 items-center gap-4 rounded-2xl border border-border/70 px-4 py-3 text-start shadow-soft transition hover:-translate-y-0.5 hover:border-teal-400/45 hover:bg-white"
                >
                  <span className="grid size-12 shrink-0 place-items-center rounded-full bg-teal-500 text-white shadow-teal">
                    <Icon className="size-6" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-teal-700">{label}</span>
                    <span className="block truncate text-sm text-foreground" dir="ltr">
                      {socialLabel(href, kind)}
                    </span>
                  </span>
                </a>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </PageTransition>
  );
}

type DetailCardProps = {
  label: string;
  value: string;
  href?: string;
  Icon: typeof PhoneIcon;
  dir?: 'ltr' | 'rtl';
};

function DetailCard({ label, value, href, Icon, dir }: DetailCardProps) {
  const content = (
    <>
      <span
        className="absolute inset-x-8 bottom-0 h-10 bg-[linear-gradient(170deg,transparent_0_42%,rgba(42,157,168,0.13)_43%_64%,transparent_65%)]"
        aria-hidden
      />
      <span className="relative grid size-16 shrink-0 place-items-center rounded-full border border-gold-400/45 bg-white text-gold-700 shadow-[0_12px_34px_-18px_rgba(42,157,168,0.9)]">
        <Icon className="size-8" strokeWidth={1.8} aria-hidden />
      </span>
      <span className="relative h-14 w-px shrink-0 bg-border" aria-hidden />
      <span className="relative min-w-0">
        <span className="block font-aurelia-display text-sm font-bold uppercase text-foreground">
          {label}
        </span>
        <span
          className="mt-1 block break-words text-base font-semibold leading-snug text-primary"
          dir={dir}
        >
          {value}
        </span>
      </span>
    </>
  );

  const className =
    'group/card relative flex min-h-[116px] items-center gap-5 overflow-hidden rounded-[18px] border border-gold-400/35 bg-white/74 px-6 py-5 text-start shadow-[0_20px_58px_-40px_rgba(20,32,46,0.6)] backdrop-blur transition hover:-translate-y-0.5 hover:bg-white';

  return href ? (
    <a href={href} className={className}>
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  );
}

function socialLabel(href: string, kind: 'social' | 'website'): string {
  try {
    const url = new URL(href);
    const username = url.pathname.split('/').filter(Boolean)[0];
    if (username && kind === 'social') return `@${username.replace(/^@/, '')}`;
    return url.hostname.replace(/^www\./, '');
  } catch {
    return href;
  }
}
