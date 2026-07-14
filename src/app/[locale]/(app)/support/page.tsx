import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  HeadphonesIcon,
  MailIcon,
  MessageCircleIcon,
  PhoneIcon,
} from 'lucide-react';
import { PageTransition } from '@/components/layout/PageTransition';
import { requireUser } from '@/server/auth/guards';
import { getSettings } from '@/server/settings/settings';
import { isLocale } from '@/i18n/config';
import { cn } from '@/lib/cn';

/**
 * Support — concierge "help center" (recreation of the Support v2 design).
 *
 * Faithful to the design's structure (eyebrow · headset crest · serif title ·
 * intro with a gold "soon" highlight · notify toggle · contact rows · hours
 * footnote) but rebuilt on the app's own primitives:
 *  - colours use the theme tokens (`foreground`/`muted`/`gold`/`success`/…) so
 *    it tracks light ↔ dark automatically — nothing is hardcoded to the dark
 *    palette the standalone design used;
 *  - every string comes from the `support` i18n namespace (Arabic + English,
 *    RTL-aware), and the contact values come from the editable Settings, not
 *    inline constants.
 */

// Used only if the admin hasn't set contact details in Settings yet.
const FALLBACK_EMAIL = 'support@crown-island.local';
const FALLBACK_PHONE = '+20 100 123 4567';

// The resort runs on Cairo time (matches src/i18n/request.ts) — the "open now"
// check is evaluated against it regardless of the server's own timezone.
const RESORT_TZ = 'Africa/Cairo';
const tag = (ar: boolean) => (ar ? 'ar-EG' : 'en-US');

/** Localized weekday name for a JS getDay() index (0 = Sun). Arabic = full, English = short. */
function dayName(day: number, ar: boolean): string {
  // 2024-01-07 (UTC) is a Sunday, so +day lands on the requested weekday.
  const d = new Date(Date.UTC(2024, 0, 7 + day));
  return new Intl.DateTimeFormat(tag(ar), { weekday: ar ? 'long' : 'short', timeZone: 'UTC' }).format(d);
}

function dayRange(open: number, close: number, ar: boolean): string {
  const a = dayName(open, ar);
  return open === close ? a : `${a} – ${dayName(close, ar)}`;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** "HH:MM" → localized 12-hour time (minutes omitted when :00). ar → "٩ ص", en → "9 AM". */
function formatTime(hhmm: string, ar: boolean): string {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(Date.UTC(2024, 0, 1, h ?? 0, m ?? 0));
  return new Intl.DateTimeFormat(tag(ar), {
    hour: 'numeric',
    ...(m ? { minute: '2-digit' as const } : {}),
    hour12: true,
    timeZone: 'UTC',
  }).format(d);
}

function timeRange(open: string, close: string, ar: boolean): string {
  return `${formatTime(open, ar)} – ${formatTime(close, ar)}`;
}

/** Day range wraps the week (open > close), e.g. Sat(6)→Thu(4) = every day but Friday. */
function dayInRange(day: number, open: number, close: number): boolean {
  return open <= close ? day >= open && day <= close : day >= open || day <= close;
}

/** Is the resort support desk open at this very moment (resort-local time)? */
function isOpenNow(openDay: number, closeDay: number, openTime: string, closeTime: string): boolean {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: RESORT_TZ,
      hour12: false,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = WD[parts.weekday ?? 'Sun'] ?? 0;
  const cur = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  const o = toMinutes(openTime);
  const c = toMinutes(closeTime);
  const withinHours = o <= c ? cur >= o && cur < c : cur >= o || cur < c;
  // For an overnight window (close <= open, e.g. 22:00→02:00) the after-midnight
  // tail belongs to the day the session OPENED, so credit it to the previous
  // civil day for the working-day-range check.
  const sessionDay = o <= c || cur >= o ? day : (day + 6) % 7;
  return dayInRange(sessionDay, openDay, closeDay) && withinHours;
}

export default async function SupportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);
  // User-only page — guests are sent to sign in (the booking catalog stays open).
  await requireUser();

  const t = await getTranslations('support');
  const settings = await getSettings();

  const email = settings.supportEmail || FALLBACK_EMAIL;
  const phone = settings.supportPhone || FALLBACK_PHONE;
  const waDigits = phone.replace(/\D/g, '');

  const ar = locale === 'ar';
  const Arrow = ar ? ArrowLeftIcon : ArrowRightIcon;

  // Admin-set working days + hours (localized) and the live open/closed status.
  const hoursLine = `${dayRange(settings.supportOpenDay, settings.supportCloseDay, ar)} · ${timeRange(
    settings.supportOpenTime,
    settings.supportCloseTime,
    ar,
  )}`;
  const openNow = isOpenNow(
    settings.supportOpenDay,
    settings.supportCloseDay,
    settings.supportOpenTime,
    settings.supportCloseTime,
  );

  const contacts = [
    { key: 'email', Icon: MailIcon, label: t('contactEmail'), value: email, href: `mailto:${email}`, external: false },
    { key: 'phone', Icon: PhoneIcon, label: t('contactPhone'), value: phone, href: `tel:${phone.replace(/\s+/g, '')}`, external: false },
    { key: 'whatsapp', Icon: MessageCircleIcon, label: t('contactWhatsapp'), value: phone, href: `https://wa.me/${waDigits}`, external: true },
  ];

  return (
    <PageTransition>
      <div className="relative overflow-hidden">
        {/* Soft champagne glow at the top — theme-aware via the gold token. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_70%_100%_at_50%_0%,rgb(var(--ci-gold)/0.09),transparent_72%)]"
        />

        <div className="relative mx-auto flex max-w-lg flex-col items-center px-6 pb-16 pt-8 text-center">
          {/* Eyebrow */}
          <div className="mb-5 flex items-center gap-2.5">
            <span aria-hidden className="h-px w-5 bg-gold-400/45" />
            <span className="text-[11.5px] font-bold uppercase tracking-[0.18em] text-gold-adaptive">
              {t('eyebrow')}
            </span>
            <span aria-hidden className="h-px w-5 bg-gold-400/45" />
          </div>

          {/* Headset crest */}
          <div className="mb-7 grid size-[88px] place-items-center rounded-full border border-gold-400/30 bg-gold-400/[0.08] ring-8 ring-gold-400/[0.06]">
            <HeadphonesIcon className="size-9 text-gold-adaptive" strokeWidth={1.5} aria-hidden />
          </div>

          {/* Title */}
          <h1 className="font-display text-[40px] font-bold leading-[1.05] text-foreground sm:text-[46px]">
            {t('title')}
          </h1>

          {/* Divider */}
          <div aria-hidden className="my-10 h-px w-full bg-border" />

          {/* Contacts */}
          <div className="w-full">
            {contacts.map((c, i) => (
              <a
                key={c.key}
                href={c.href}
                {...(c.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                className={cn(
                  'group flex w-full items-center gap-4 py-[18px] text-start',
                  i < contacts.length - 1 && 'border-b border-border',
                )}
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-muted transition-colors group-hover:border-gold-400/40 group-hover:bg-gold-400/10">
                  <c.Icon
                    className="size-[19px] text-muted-foreground transition-colors group-hover:text-gold-600"
                    strokeWidth={1.7}
                    aria-hidden
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-semibold text-muted-foreground">{c.label}</span>
                  <span
                    dir="ltr"
                    className={cn(
                      'mt-0.5 block truncate text-[16px] font-semibold text-foreground',
                      ar ? 'text-right' : 'text-left',
                    )}
                  >
                    {c.value}
                  </span>
                </span>
                <Arrow
                  className="size-[18px] shrink-0 text-muted-foreground/50 transition-all group-hover:text-gold-600 ltr:group-hover:translate-x-1 rtl:group-hover:-translate-x-1"
                  strokeWidth={1.7}
                  aria-hidden
                />
              </a>
            ))}
          </div>

          {/* Hours footnote — live status + admin-set days/hours (resort time) */}
          <div className="mt-9 flex items-center gap-2.5">
            <span
              aria-hidden
              className={cn(
                'size-[7px] rounded-full ring-4',
                openNow ? 'bg-success ring-success/15' : 'bg-muted-foreground/50 ring-muted-foreground/10',
              )}
            />
            <span className="text-[13px] text-muted-foreground">
              {openNow ? t('statusOpen') : t('statusClosed')} ·{' '}
              <span className="font-semibold text-foreground">{hoursLine}</span>
            </span>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
