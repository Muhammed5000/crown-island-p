import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { InfoIcon, MailIcon, PhoneIcon, ShieldCheckIcon } from 'lucide-react';
import { PageTransition } from '@/components/layout/PageTransition';
import { getSettings } from '@/server/settings/settings';
import { isLocale } from '@/i18n/config';
import { cn } from '@/lib/cn';
import { PrivacyToc } from './PrivacyToc';

/**
 * Privacy Policy — long-form legal page, rebuilt on the "Crown Privacy
 * (Arabic Desktop)" design: a hero crest, a two-column "doc" grid and section
 * cards with gold-gradient badges, title/body bullet cards and teal callouts.
 *
 * Layout: on desktop the left column (TOC "Policy Contents" card + the Contact
 * card under it) is STICKY — it stays fixed in view while the policy section
 * cards scroll on the right. On mobile the sidebar is hidden and the Contact
 * card drops to the end of the content. The page uses a wide canvas.
 *
 * Only the *content section* follows the design — the surrounding chrome (rail,
 * top bar, breadcrumb) is the app shell and is untouched. The page stays:
 *  - public (linked from the sign-in screen, so guests can read it);
 *  - bilingual + RTL-aware (every string comes from the `privacy` namespace);
 *  - theme-aware (design colours mapped to theme tokens, so light/dark + the
 *    English locale all render correctly rather than the design's fixed cream).
 */

/** Shape of each entry in the `privacy.sections` i18n array. */
interface PrivacySection {
  id: string;
  heading: string;
  body: string[];
  bullets?: string[];
  /** Optional teal "callout" highlight (only on a few sections). */
  note?: string;
}

// Used only until the admin fills in contact details in Settings (same as Support).
const FALLBACK_EMAIL = 'support@crown-island.local';
const FALLBACK_PHONE = '+20 100 123 4567';

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

/** "12" → "١٢" for Arabic, untouched for English. */
function localeNum(n: number, ar: boolean): string {
  const s = String(n);
  return ar ? s.replace(/\d/g, (d) => AR_DIGITS[Number(d)] ?? d) : s;
}

/** Bullets are authored as "Title: body" — split into a bold lead + body. */
function splitBullet(b: string): { title: string | null; body: string } {
  const i = b.indexOf(': ');
  if (i === -1) return { title: null, body: b };
  return { title: b.slice(0, i), body: b.slice(i + 2) };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: 'privacy' });
  return { title: t('title') };
}

export default async function PrivacyPolicyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const t = await getTranslations('privacy');
  const settings = await getSettings();

  const ar = locale === 'ar';
  const email = settings.supportEmail || FALLBACK_EMAIL;
  const phone = settings.supportPhone || FALLBACK_PHONE;

  const sections = t.raw('sections') as PrivacySection[];

  const contact = {
    heading: t('contactHeading'),
    body: t('contactBody'),
    email,
    phone,
    callCta: t('contactCallCta'),
  };

  return (
    <PageTransition>
      <div className="relative overflow-hidden">
        {/* Soft champagne glow at the top — theme-aware via the gold token. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_70%_100%_at_50%_0%,rgb(var(--ci-gold)/0.09),transparent_72%)]"
        />

        {/* ───────────────────────── Hero ───────────────────────── */}
        <section className="relative px-6 pb-2 pt-8 text-center md:pt-12">
          <div className="mb-6 flex items-center justify-center gap-3">
            <span aria-hidden className="h-px w-8 bg-gradient-to-r from-transparent to-gold-400/70" />
            <span className="text-[12px] font-extrabold uppercase tracking-[0.3em] text-gold-adaptive">
              {t('eyebrow')}
            </span>
            <span aria-hidden className="h-px w-8 bg-gradient-to-l from-transparent to-gold-400/70" />
          </div>

          <div className="mx-auto mb-6 grid size-[84px] place-items-center rounded-full border border-gold-400/40 bg-card shadow-[0_14px_34px_rgba(168,134,63,0.16)] ring-1 ring-gold-400/10">
            <ShieldCheckIcon className="size-9 text-gold-600" strokeWidth={1.6} aria-hidden />
          </div>

          <h1 className="font-display text-[40px] font-black leading-[1.05] tracking-tight text-foreground sm:text-[52px]">
            {t('title')}
          </h1>

          <div className="mt-4 inline-block rounded-full border border-gold-400/25 bg-gold-400/10 px-4 py-1.5 text-[12.5px] font-bold text-gold-700">
            {t('updated')}
          </div>

          <p className="mx-auto mt-5 max-w-[640px] text-[16px] font-medium leading-[1.9] text-muted-foreground">
            {t('intro')}
          </p>
        </section>

        {/* ───────────────────────── Doc grid (full width) ───────────────────────── */}
        <div className="mx-auto grid w-full max-w-[1800px] items-start gap-8 px-5 pb-20 pt-8 md:px-8 lg:grid-cols-[330px_1fr] lg:gap-12 lg:px-12 xl:px-16">
          {/* Sticky sidebar — TOC + Contact stay fixed in view while the policy
              scrolls. No inner scroll: the column is compact enough to fit the
              viewport height, so it never needs its own scrollbar. */}
          <aside className="sticky top-6 hidden space-y-3 self-start lg:block">
            <PrivacyToc
              items={sections.map((s, i) => ({ id: s.id, num: localeNum(i + 1, ar), label: s.heading }))}
              tocHeading={t('tocHeading')}
            />
            <ContactCard {...contact} />
          </aside>

          {/* Policy section cards */}
          <div className="flex flex-col gap-4 lg:gap-[18px]">
            {sections.map((section, i) => (
              <section
                key={section.id}
                id={section.id}
                className="scroll-mt-28 rounded-[22px] border border-border bg-card p-6 shadow-[0_10px_30px_rgba(22,41,75,0.045)] sm:p-[30px] lg:p-9"
              >
                <div className="mb-2 flex items-center gap-3.5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-gold-300 via-gold-400 to-gold-600 text-[16px] font-black text-white shadow-[0_8px_18px_rgba(168,134,63,0.3)]">
                    {localeNum(i + 1, ar)}
                  </span>
                  <h2 className="font-display text-[22px] font-extrabold tracking-tight text-foreground sm:text-[25px]">
                    {section.heading}
                  </h2>
                </div>

                {section.body.map((para, p) => (
                  <p
                    key={p}
                    className={cn(
                      'text-[15.5px] font-medium leading-[1.95] text-muted-foreground',
                      p === 0 ? 'mt-1.5' : 'mt-3.5',
                    )}
                  >
                    {para}
                  </p>
                ))}

                {section.note ? <Callout text={section.note} /> : null}

                {section.bullets && section.bullets.length > 0 ? (
                  <div className="mt-[18px] grid gap-3 lg:grid-cols-2">
                    {section.bullets.map((b, bi) => {
                      const { title, body } = splitBullet(b);
                      return (
                        <div
                          key={bi}
                          className="flex gap-3.5 rounded-[15px] border border-border/70 bg-muted/50 p-4"
                        >
                          <span
                            aria-hidden
                            className="mt-[7px] size-2.5 shrink-0 rounded-full bg-gold-500 shadow-[0_0_0_4px_rgba(194,162,92,0.16)]"
                          />
                          <div className="min-w-0 flex-1">
                            {title ? (
                              <div className="mb-1 text-[15px] font-bold text-foreground">{title}</div>
                            ) : null}
                            <div className="text-[14px] font-medium leading-[1.85] text-muted-foreground">
                              {body}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            ))}

            {/* Mobile-only contact card (the sidebar is hidden below lg). */}
            <div className="lg:hidden">
              <ContactCard {...contact} />
            </div>

            <p className="mt-1 text-center text-[12.5px] font-medium text-muted-foreground">{t('endnote')}</p>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}

/** Teal info callout — bolds the lead sentence, like the design. */
function Callout({ text }: { text: string }) {
  const i = text.indexOf('. ');
  const lead = i > -1 ? text.slice(0, i + 1) : null;
  const rest = i > -1 ? text.slice(i + 2) : text;
  return (
    <div className="mt-[18px] flex gap-3 rounded-[15px] border border-teal-500/30 bg-teal-500/[0.09] p-4">
      <InfoIcon className="mt-0.5 size-5 shrink-0 text-teal-600" strokeWidth={1.8} aria-hidden />
      <p className="text-[14px] font-medium leading-[1.8] text-foreground/80">
        {lead ? <b className="font-extrabold text-foreground">{lead}</b> : null}
        {lead ? ' ' : ''}
        {rest}
      </p>
    </div>
  );
}

/** Contact card — lives in the sticky sidebar (desktop) and at the page foot (mobile). */
function ContactCard({
  heading,
  body,
  email,
  phone,
  callCta,
}: {
  heading: string;
  body: string;
  email: string;
  phone: string;
  callCta: string;
}) {
  return (
    <section className="rounded-[18px] border border-gold-400/35 bg-gradient-to-br from-card to-gold-400/[0.07] p-4 shadow-[0_14px_36px_rgba(168,134,63,0.12)]">
      <h3 className="font-display text-[17px] font-black text-foreground">{heading}</h3>
      <p className="mt-1 text-[12px] font-medium leading-[1.55] text-muted-foreground">{body}</p>
      <div className="mt-3.5 flex flex-col gap-2">
        <a
          href={`mailto:${email}`}
          dir="ltr"
          className="inline-flex h-10 items-center justify-center gap-2 truncate rounded-[12px] bg-gradient-to-br from-gold-300 via-gold-400 to-gold-600 px-4 text-[13px] font-extrabold text-white shadow-[0_10px_24px_rgba(168,134,63,0.3)] transition hover:brightness-[1.03]"
        >
          <MailIcon className="size-[16px] shrink-0" strokeWidth={1.9} aria-hidden />
          <span className="truncate">{email}</span>
        </a>
        <a
          href={`tel:${phone.replace(/\s+/g, '')}`}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-[12px] border border-border bg-card px-4 text-[13px] font-extrabold text-foreground transition hover:bg-muted"
        >
          <PhoneIcon className="size-[16px] shrink-0" strokeWidth={1.9} aria-hidden />
          {callCta}
        </a>
      </div>
    </section>
  );
}
