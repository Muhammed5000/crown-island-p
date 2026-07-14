'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { CrownIcon } from '@/components/brand/CrownIcon';
import type { CustomerNotificationRow } from '@/server/services/customer-notifications';

/**
 * Elegant single-notification reading view — the image, a source + timestamp
 * byline, the title in the display serif, the full body, and an optional deep
 * link. Shared by the `/notifications/[id]` detail page AND the desktop
 * master-detail reading pane so both stay identical and DRY.
 */
export function NotificationReader({ notification: n }: { notification: CustomerNotificationRow }) {
  const t = useTranslations('notifications');
  const tCommon = useTranslations('common');
  const locale = useLocale();

  const title = locale === 'ar' ? n.titleAr : n.titleEn;
  const body = locale === 'ar' ? n.bodyAr : n.bodyEn;
  const dateLabel = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(n.createdAt));

  // Sanitize the optional deep link: external http(s) → new tab; internal must
  // start with "/" but not "//" (protocol-relative escapes the origin).
  const url = n.url ?? '';
  const isExternal = /^https?:\/\//i.test(url);
  const internalSafe = url.startsWith('/') && !url.startsWith('//');
  const ctaClass =
    'mt-1 inline-flex h-11 items-center justify-center rounded-full bg-primary px-7 text-sm font-semibold text-primary-foreground shadow-[0_12px_28px_-12px_rgba(22,48,79,0.45)] transition-all hover:-translate-y-px hover:bg-primary/95';

  return (
    <article className="space-y-5">
      {n.imageUrl ? (
        <div className="aspect-[16/9] w-full overflow-hidden rounded-2xl bg-muted ring-1 ring-border/60">
          {/* eslint-disable-next-line @next/next/no-img-element -- admin-uploaded / external media */}
          <img src={n.imageUrl} alt="" className="size-full object-cover" />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-gold-400/20 pb-4 text-xs text-muted-foreground">
        <span className="grid size-7 place-items-center rounded-full bg-primary/10 text-primary">
          <CrownIcon size={15} />
        </span>
        <span className="font-semibold text-foreground">{tCommon('appName')}</span>
        <span className="size-1 rounded-full bg-gold-400" aria-hidden />
        <time>{dateLabel}</time>
      </div>

      {/* h2 (not h1): on the desktop inbox this renders beside the page's own
          h1 inbox title; the standalone detail route supplies an sr-only h1. */}
      <h2 className="font-display text-[30px] font-semibold leading-[1.15] tracking-[-0.01em] text-foreground">
        {title}
      </h2>

      {body ? (
        <p className="whitespace-pre-line text-[15.5px] leading-[1.75] text-foreground/85">{body}</p>
      ) : null}

      {isExternal ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className={ctaClass}>
          {t('openLink')}
        </a>
      ) : internalSafe ? (
        <Link href={url} className={ctaClass}>
          {t('openLink')}
        </Link>
      ) : null}
    </article>
  );
}
