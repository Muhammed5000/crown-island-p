'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, Link } from '@/i18n/navigation';
import { Stepper } from '@/components/ui/Stepper';
import { RatingStars } from '@/components/ui/RatingStars';
import { CategoryLogo } from '@/components/brand/CategoryLogo';
import { formatMoney } from '@/lib/money';
import { formatDate, formatDateRange, toIsoDate } from '@/lib/date';
import { cn } from '@/lib/cn';
import { useAppSelector } from '@/store/hooks';
import { quotePrice, commitBooking, type QuoteResult } from '@/features/booking/actions';
import { beachTicketCapacity, cabanaTicketCapacity, maxExtraPersonsFor } from '@/server/services/booking-calc-core';

export interface ServiceItem {
  id: string;
  slug: string;
  name: string;
  desc: string | null;
  priceCents: number;
  kind: 'DAY_USE' | 'CABANA' | 'EVENT' | 'OTHER';
  /** Cover image — the service's own `coverUrl`, falling back to the category cover. */
  image: string;
  tags: string[];
  maxPeoplePerBooking: number | null;
  maxCarsPerBooking: number | null;
  /** Per-unit / children / multi-day rules (drive the steppers + range picker). */
  includedPersonsPerUnit: number;
  /** When true (grouped-ticket services), show the paid "Extra Person" add-on counter. */
  allowExtraPeople: boolean;
  /** Price per extra add-on person, in piastres. */
  extraPersonPriceCents: number;
  /** Per-unit cap on the Extra Person counter (× units); null = no limit. */
  maxExtraPersonsPerUnit: number | null;
  allowChildren: boolean;
  maxChildAge: number;
  freeChildrenPerUnit: number;
  maxChildrenPerBooking: number | null;
  childrenCountAsPersons: boolean;
  allowMultiDay: boolean;
  maxBookingDays: number | null;
  /** Public review summary for the "see reviews" link; null when none or the
   * public-reviews master toggle is off. */
  rating: { average: number; count: number } | null;
}

interface Props {
  locale: 'ar' | 'en';
  category: {
    slug: string;
    name: string;
    desc: string | null;
    image: string;
    /** Optional category logo / brand mark (light mode), shown on entry. */
    logoUrl?: string | null;
    /** Dark-mode variant of the logo. */
    logoDarkUrl?: string | null;
    isActivity: boolean;
  };
  services: ServiceItem[];
  userId: string;
}

type QuoteOk = Extract<QuoteResult, { ok: true }>;

function makeRequestId(userId: string) {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${userId || 'anon'}-${random}`;
}

/**
 * Crown — desktop single-page booking wizard.
 *
 * Completes the whole flow on one screen using the "Crown Select Service
 * Desktop" design language: a sticky left context column (cover + step
 * tracker) beside a right panel that advances through
 *   2. Select a service   3. Date & guests   4. Review & pay
 * and then commits + launches payment — all without leaving the page.
 *
 * The MOBILE experience keeps the original multi-page flow (this component is
 * only rendered inside an `xl:block` wrapper); the server actions reused here
 * (`quotePrice` and `commitBooking`)
 * are the exact same ones the mobile pages call, so behaviour stays identical.
 */
export function SelectServiceWizard({
  locale,
  category,
  services,
  userId,
}: Props) {
  const t = useTranslations('services');
  const tBooking = useTranslations('booking');
  const tCommon = useTranslations('common');
  const tReviews = useTranslations('reviews');
  const router = useRouter();

  // Guests may browse every step; only the final commit requires an account.
  const isAuthenticated = !!userId;

  const todayIso = useMemo(() => toIsoDate(new Date()), []);
  const flowDate = useAppSelector((s) => s.bookingFlow.date);

  // Wizard step: 2 = select service, 3 = date & guests, 4 = review & pay.
  const [step, setStep] = useState<2 | 3 | 4>(2);

  const [selectedId, setSelectedId] = useState<string | null>(services[0]?.id ?? null);
  const chosen = services.find((s) => s.id === selectedId) ?? null;

  const [date, setDate] = useState(() =>
    flowDate && flowDate >= todayIso ? flowDate : todayIso,
  );
  const [endDate, setEndDate] = useState('');
  const [people, setPeople] = useState(1);
  const [children, setChildren] = useState(0);
  const [extraPersons, setExtraPersons] = useState(0);
  const [cars, setCars] = useState(0);

  const [quote, setQuote] = useState<QuoteOk | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [isQuoting, startQuote] = useTransition();

  const [payError, setPayError] = useState<string | null>(null);
  const [isPaying, startPay] = useTransition();
  const [clientRequestId] = useState(() => makeRequestId(userId));

  // Re-quote whenever the date/guests inputs change (steps 3 & 4 both rely on it).
  useEffect(() => {
    if (!chosen || step < 3 || !date) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      startQuote(async () => {
        const res = await quotePrice({
          serviceId: chosen.id,
          date,
          endDate: chosen.allowMultiDay && endDate ? endDate : undefined,
          adults: people,
          children,
          extraPersons,
          cars,
        });
        if (cancelled) return;
        if (!res.ok) {
          setQuote(null);
          if (res.code === 'past_date') setQuoteError(tBooking('errors.pastDate'));
          else if (res.code === 'working_hours_ended') setQuoteError(tBooking('errors.workingHoursEnded'));
          else if (res.code === 'multi_day_not_allowed' || res.code === 'too_many_days') setQuoteError(tBooking('errors.invalidDays'));
          else if (res.code === 'children_not_allowed') setQuoteError(tBooking('errors.childrenNotAllowed'));
          else if (res.code === 'capacity_max_children') setQuoteError(tBooking('errors.maxChildren'));
          else if (res.code === 'capacity_max_extra_persons') setQuoteError(tBooking('errors.maxExtraPersons'));
          else if (res.code === 'capacity_max_per_booking_people') setQuoteError(tBooking('errors.maxPeople', { max: chosen?.maxPeoplePerBooking ?? '' }));
          else if (res.code === 'capacity_max_per_booking_cars') setQuoteError(tBooking('errors.maxCars', { max: chosen?.maxCarsPerBooking ?? '' }));
          else if (res.code.startsWith('capacity')) setQuoteError(tBooking('errors.capacity'));
          else setQuoteError(tCommon('error'));
          return;
        }
        setQuoteError(null);
        setQuote(res);
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [chosen, date, endDate, people, children, extraPersons, cars, step, tBooking, tCommon]);

  // Reset the quote when the chosen service changes so stale totals never show.
  function selectService(id: string) {
    setSelectedId(id);
    setChildren(0);
    setExtraPersons(0);
    setEndDate('');
    setQuote(null);
    setQuoteError(null);
  }

  function pay() {
    if (!chosen || !quote) return;
    // Guests can review everything, but committing a booking requires an
    // account. Carry the complete selection in the review URL so the auth
    // round-trip cannot reset this component's in-memory state.
    if (!isAuthenticated) {
      const params = new URLSearchParams({
        service: chosen.id,
        date,
        adults: String(people),
        children: String(children),
        extraPersons: String(extraPersons),
        cars: String(cars),
        total: String(quote.totalCents),
      });
      if (chosen.allowMultiDay && endDate) params.set('endDate', endDate);
      const reviewUrl = `/booking/review?${params.toString()}`;
      router.push(`/login?next=${encodeURIComponent(reviewUrl)}`);
      return;
    }
    setPayError(null);
    startPay(async () => {
      const res = await commitBooking({
        serviceId: chosen.id,
        date,
        endDate: chosen.allowMultiDay && endDate ? endDate : undefined,
        adults: people,
        children,
        extraPersons,
        cars,
        clientRequestId,
        // Must include outstanding penalties AND the insurance deposit:
        // createBooking adds both to the grand total and rejects a mismatch, so
        // a service-only total would permanently block this flow with
        // price_changed for penalized users / insured services.
        expectedTotalCents:
          quote.totalCents + quote.pendingPenaltyCents + quote.insuranceCents,
        locale,
      });
      if (!res.ok) {
        if (res.code === 'price_changed') setPayError(tBooking('errors.priceChanged'));
        else if (res.code === 'past_date') setPayError(tBooking('errors.pastDate'));
        else if (res.code === 'service_inactive') setPayError(tBooking('errors.serviceInactive'));
        else if (res.code === 'bookings_disabled') setPayError(tBooking('errors.bookingsDisabled'));
        else if (res.code === 'lead_time') setPayError(tBooking('errors.leadTime'));
        else if (res.code === 'capacity_max_children') setPayError(tBooking('errors.maxChildren'));
        else if (res.code === 'capacity_max_extra_persons') setPayError(tBooking('errors.maxExtraPersons'));
        else if (res.code === 'capacity_max_per_booking_people') setPayError(tBooking('errors.maxPeople', { max: chosen?.maxPeoplePerBooking ?? '' }));
        else if (res.code === 'capacity_max_per_booking_cars') setPayError(tBooking('errors.maxCars', { max: chosen?.maxCarsPerBooking ?? '' }));
        else if (res.code.startsWith('capacity')) setPayError(tBooking('errors.capacity'));
        else setPayError(tCommon('error'));
        return;
      }

      // The dedicated payment page owns the single Hosted Checkout startup flow.
      const prefix = locale === 'en' ? '/en' : '';
      window.location.href = `${prefix}/booking/payment?bid=${res.bookingId}`;
    });
  }

  const steps = [
    { n: 1, label: t('stepChooseExperience'), state: 'done' as const },
    { n: 2, label: t('stepSelectService'), state: step > 2 ? ('done' as const) : ('current' as const) },
    { n: 3, label: t('stepDateGuests'), state: step > 3 ? 'done' : step === 3 ? 'current' : 'todo' },
    { n: 4, label: t('stepReviewPay'), state: step === 4 ? 'current' : 'todo' },
  ];

  // When the category has a logo, give it a dedicated panel on the far left and
  // widen the shell by exactly the logo column + gap so the service column keeps
  // its width. No logo → original two-column layout, unchanged.
  const hasLogo = !!category.logoUrl;

  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_45%_at_65%_0%,rgba(194,161,78,0.06),transparent_60%)]"
      />

      <div
        className={cn(
          'relative mx-auto px-11 pb-40 pt-5',
          hasLogo ? 'max-w-[1380px]' : 'max-w-[1140px]',
        )}
      >
        <div
          className={cn(
            'grid items-start gap-8',
            hasLogo ? 'grid-cols-[210px_330px_1fr]' : 'grid-cols-[330px_1fr]',
          )}
        >
          {/* ── FAR LEFT: category logo (only when a logo is set) — no card /
              background, theme-aware, ~70% of the previous size. ── */}
          {hasLogo ? (
            <div className="sticky top-4 flex justify-center pt-1">
              <CategoryLogo
                lightUrl={category.logoUrl!}
                darkUrl={category.logoDarkUrl}
                className="h-auto max-h-[230px] w-full max-w-[160px] object-contain"
              />
            </div>
          ) : null}

          {/* ── LEFT: context (sticky) ── */}
          <div className="sticky top-4 flex flex-col gap-4">
            <div className="overflow-hidden rounded-[20px] border border-border bg-card">
              <div className="relative h-[150px] bg-[#0e1828]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={category.image} alt="" className="h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-b from-[rgba(8,14,24,0.2)] to-[rgba(8,14,24,0.85)]" />
                <div className="absolute start-3.5 top-3.5 rounded-full border border-aurelia-gold/20 bg-[rgba(14,22,34,0.7)] px-[11px] py-[5px] font-aurelia-sans text-[9.5px] font-bold uppercase tracking-[0.16em] text-aurelia-gold backdrop-blur-md">
                  {category.isActivity ? t('tierActivity') : t('tierBeach')}
                </div>
              </div>
              <div className="px-5 pb-5 pt-[18px]">
                <div className="mb-[7px] font-aurelia-sans text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  {t('youreBooking')}
                </div>
                <h2 className="m-0 font-aurelia-display text-[28px] font-semibold leading-none text-foreground">
                  {category.name}
                </h2>
                {category.desc ? (
                  <p className="mt-2.5 font-aurelia-sans text-[12.5px] leading-[1.5] text-muted-foreground">
                    {category.desc}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="rounded-[20px] border border-border bg-card px-5 py-[18px]">
              <div className="mb-3.5 font-aurelia-sans text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                {t('bookingSteps')}
              </div>
              {steps.map((st) => (
                <div key={st.n} className="flex items-center gap-3 py-[7px]">
                  <span
                    className={cn(
                      'flex size-[26px] shrink-0 items-center justify-center rounded-full font-aurelia-sans text-[12px] font-bold',
                      st.state === 'current'
                        ? 'bg-accent text-accent-foreground'
                        : st.state === 'done'
                          ? 'border border-success/40 bg-success/15 text-success'
                          : 'border border-border bg-muted text-muted-foreground',
                    )}
                  >
                    {st.state === 'done' ? '✓' : st.n}
                  </span>
                  <span
                    className={cn(
                      'font-aurelia-sans text-[13.5px]',
                      st.state === 'current'
                        ? 'font-semibold text-foreground'
                        : st.state === 'done'
                          ? 'font-medium text-muted-foreground'
                          : 'font-medium text-muted-foreground',
                    )}
                  >
                    {st.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ── RIGHT: step content ── */}
          <div>
            {step === 2 ? (
              <StepSelect
                category={category}
                services={services}
                selectedId={selectedId}
                onSelect={selectService}
                locale={locale}
                t={t}
                categorySlug={category.slug}
                tReviews={tReviews}
              />
            ) : null}

            {step === 3 && chosen ? (
              <StepDates
                chosen={chosen}
                date={date}
                endDate={endDate}
                people={people}
                childCount={children}
                extraPersons={extraPersons}
                cars={cars}
                todayIso={todayIso}
                onDate={(v) => {
                  setDate(v);
                  if (endDate && endDate < v) setEndDate('');
                  setQuote(null);
                }}
                onEndDate={(v) => {
                  setEndDate(v);
                  setQuote(null);
                }}
                onPeople={(v) => {
                  setPeople(v);
                  // Beach / cabana: fewer adults ⇒ fewer umbrellas/cabanas ⇒ lower
                  // children ceiling — clamp so the selection can't exceed the server cap.
                  if (chosen && chosen.maxChildrenPerBooking != null) {
                    let capChildren: number | null = null;
                    if (chosen.kind === 'DAY_USE') {
                      capChildren = beachTicketCapacity({
                        adults: v,
                        ticketCapacity: chosen.includedPersonsPerUnit,
                        maxChildrenPerUmbrella: chosen.maxChildrenPerBooking,
                      }).maxChildren;
                    } else if (chosen.kind === 'CABANA') {
                      capChildren = cabanaTicketCapacity({
                        adults: v,
                        ticketCapacity: chosen.includedPersonsPerUnit,
                        maxChildrenPerCabana: chosen.maxChildrenPerBooking,
                      }).maxChildren;
                    }
                    if (capChildren != null) setChildren((c) => Math.min(c, capChildren!));
                  }
                  // Fewer adults ⇒ fewer units ⇒ lower extra-person ceiling — clamp.
                  if (chosen && chosen.allowExtraPeople && chosen.maxExtraPersonsPerUnit != null) {
                    const capExtra = maxExtraPersonsFor({
                      adults: v,
                      ticketCapacity: chosen.includedPersonsPerUnit,
                      maxExtraPersonsPerUnit: chosen.maxExtraPersonsPerUnit,
                    });
                    if (capExtra != null) setExtraPersons((e) => Math.min(e, capExtra));
                  }
                  setQuote(null);
                }}
                onChildren={(v) => {
                  setChildren(v);
                  setQuote(null);
                }}
                onExtraPersons={(v) => {
                  setExtraPersons(v);
                  setQuote(null);
                }}
                onCars={(v) => {
                  setCars(v);
                  setQuote(null);
                }}
                quote={quote}
                quoteError={quoteError}
                isQuoting={isQuoting}
                locale={locale}
                t={t}
                tBooking={tBooking}
                tCommon={tCommon}
              />
            ) : null}

            {step === 4 && chosen ? (
              <StepReview
                chosen={chosen}
                category={category}
                date={date}
                endDate={endDate}
                people={people}
                childCount={children}
                extraPersons={extraPersons}
                cars={cars}
                quote={quote}
                payError={payError}
                locale={locale}
                t={t}
                tBooking={tBooking}
              />
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Sticky action bar ── */}
      <div className="sticky bottom-0 z-20 border-t border-border bg-card/92 px-11 py-4 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1140px] items-center justify-between gap-5">
          <div className="flex min-w-0 items-center gap-3.5">
            {step === 2 ? (
              <>
                <span className="font-aurelia-sans text-[12.5px] text-muted-foreground">
                  {t('selected')}
                </span>
                <span className="truncate font-aurelia-display text-[22px] font-semibold text-foreground">
                  {chosen ? chosen.name : '—'}
                </span>
                {chosen ? (
                  <span className="shrink-0 rounded-full border border-gold-400/40 bg-gold-400/[0.15] px-3 py-[5px] font-aurelia-sans text-[13px] font-bold text-gold-700">
                    {formatMoney(chosen.priceCents, { locale, currency: 'EGP' })}
                  </span>
                ) : null}
              </>
            ) : (
              <>
                <span className="font-aurelia-sans text-[12.5px] text-muted-foreground">
                  {tBooking('total')}
                </span>
                <span className="font-aurelia-display text-[24px] font-semibold tabular-nums text-foreground">
                  {quote
                    ? formatMoney(
                        quote.totalCents + quote.insuranceCents + quote.pendingPenaltyCents,
                        { locale, currency: 'EGP' },
                      )
                    : isQuoting
                      ? '…'
                      : '—'}
                </span>
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {step > 2 ? (
              <button
                type="button"
                disabled={isPaying}
                onClick={() => setStep((s) => (s === 4 ? 3 : 2))}
                className="inline-flex h-[52px] items-center rounded-[14px] border border-border px-6 font-aurelia-sans text-[14px] font-semibold text-muted-foreground transition hover:bg-muted disabled:opacity-50"
              >
                {tCommon('back')}
              </button>
            ) : null}

            {step === 2 ? (
              <PrimaryBtn disabled={!chosen} onClick={() => setStep(3)}>
                {tCommon('continue')} <Arrow />
              </PrimaryBtn>
            ) : null}

            {step === 3 ? (
              <PrimaryBtn disabled={!quote} loading={isQuoting} onClick={() => setStep(4)}>
                {tCommon('continue')} <Arrow />
              </PrimaryBtn>
            ) : null}

            {step === 4 ? (
              <PrimaryBtn disabled={!quote} loading={isPaying} onClick={pay}>
                {isAuthenticated ? tBooking('payNow') : tBooking('signInToBook')} <Arrow />
              </PrimaryBtn>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Step 2: select service ─────────────────────────────────────────────────
function StepSelect({
  category,
  services,
  selectedId,
  onSelect,
  locale,
  t,
  categorySlug,
  tReviews,
}: {
  category: Props['category'];
  services: ServiceItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  locale: 'ar' | 'en';
  t: ReturnType<typeof useTranslations<'services'>>;
  categorySlug: string;
  tReviews: ReturnType<typeof useTranslations<'reviews'>>;
}) {
  return (
    <div>
      <div className="mb-5">
        <div
          className={`mb-2 font-aurelia-sans font-semibold uppercase tracking-[0.25em] text-gold-600 ${
            locale === 'ar' ? 'text-[17px]' : 'text-[11px]'
          }`}
        >
          {category.name}
        </div>
        <h1 className="m-0 font-aurelia-display text-[44px] font-semibold leading-none tracking-[-0.01em] text-foreground">
          {t('selectService')}
        </h1>
        <p className="mt-2.5 font-aurelia-sans text-[14px] text-muted-foreground">
          {t('selectServiceSubtitle')}
        </p>
      </div>

      {services.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card p-8 text-center font-aurelia-sans text-sm text-muted-foreground">
          {t('noAvailability')}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {services.map((s) => (
            <div key={s.id} className="flex flex-col gap-2.5">
              <ServiceCard
                s={s}
                locale={locale}
                selected={s.id === selectedId}
                onSelect={() => onSelect(s.id)}
                selectLabel={t('select')}
                selectedLabel={t('selected')}
              />
              {/* Public reviews jump-off — mirrors the mobile service page's
                  reviews bar (the desktop wizard never visits that page). */}
              {s.rating ? (
                <Link
                  href={`/booking/${categorySlug}/${s.slug}/reviews`}
                  className="flex items-center justify-center gap-2 rounded-[14px] border border-border bg-card px-3 py-2.5 font-aurelia-sans text-[12.5px] transition hover:border-accent/40"
                >
                  <RatingStars value={Math.round(s.rating.average)} readOnly size={13} />
                  <span className="font-bold tabular-nums text-foreground">
                    {s.rating.average.toFixed(1)}
                  </span>
                  <span className="text-muted-foreground">
                    {tReviews('reviewsCount', { count: s.rating.count })}
                  </span>
                  <span className="font-semibold text-accent">· {tReviews('seeAll')}</span>
                </Link>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Step 3: date & guests ──────────────────────────────────────────────────
function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function StepDates({
  chosen,
  date,
  endDate,
  people,
  childCount,
  extraPersons,
  cars,
  todayIso,
  onDate,
  onEndDate,
  onPeople,
  onChildren,
  onExtraPersons,
  onCars,
  quote,
  quoteError,
  isQuoting,
  locale,
  t,
  tBooking,
  tCommon,
}: {
  chosen: ServiceItem;
  date: string;
  endDate: string;
  people: number;
  childCount: number;
  extraPersons: number;
  cars: number;
  todayIso: string;
  onDate: (v: string) => void;
  onEndDate: (v: string) => void;
  onPeople: (v: number) => void;
  onChildren: (v: number) => void;
  onExtraPersons: (v: number) => void;
  onCars: (v: number) => void;
  quote: QuoteOk | null;
  quoteError: string | null;
  isQuoting: boolean;
  locale: 'ar' | 'en';
  t: ReturnType<typeof useTranslations<'services'>>;
  tBooking: ReturnType<typeof useTranslations<'booking'>>;
  tCommon: ReturnType<typeof useTranslations<'common'>>;
}) {
  const endMax =
    chosen.maxBookingDays != null ? addDaysIso(date, chosen.maxBookingDays - 1) : undefined;
  return (
    <div>
      <div className="mb-5">
        <div className="mb-2 font-aurelia-sans text-[11px] font-semibold uppercase tracking-[0.25em] text-gold-600">
          {chosen.name}
        </div>
        <h1 className="m-0 font-aurelia-display text-[44px] font-semibold leading-none tracking-[-0.01em] text-foreground">
          {t('stepDateGuests')}
        </h1>
      </div>

      <div className="max-w-[560px] space-y-4">
        <div className="rounded-[18px] border border-border bg-card p-6">
          <label
            htmlFor="wiz-date"
            className="mb-2 block font-aurelia-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
          >
            {tBooking('stepDate')}
          </label>
          <input
            id="wiz-date"
            type="date"
            dir="ltr"
            min={todayIso}
            value={date}
            onChange={(e) => onDate(e.target.value)}
            className="h-12 w-full rounded-xl border border-border bg-input px-4 font-aurelia-sans text-[15px] text-foreground outline-none focus:border-accent/60"
          />
          {chosen.allowMultiDay ? (
            <>
              <label
                htmlFor="wiz-end-date"
                className="mb-2 mt-5 block font-aurelia-sans text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
              >
                {tBooking('stepEndDate')}
              </label>
              <input
                id="wiz-end-date"
                type="date"
                dir="ltr"
                min={date}
                max={endMax}
                value={endDate}
                onChange={(e) => onEndDate(e.target.value)}
                className="h-12 w-full rounded-xl border border-border bg-input px-4 font-aurelia-sans text-[15px] text-foreground outline-none focus:border-accent/60"
              />
              <p className="mt-2 font-aurelia-sans text-[11px] text-muted-foreground">
                {tBooking('multiDayHint')}
              </p>
            </>
          ) : null}
        </div>

        <div className="rounded-[18px] border border-border bg-card p-6">
          <Stepper
            label={chosen.includedPersonsPerUnit > 1 ? tBooking('stepAdults') : tBooking('stepPeople')}
            value={people}
            min={1}
            // Beach overflows into more umbrellas, so adults are bounded only by
            // the per-booking total cap (same as other kinds), not a per-ticket cap.
            max={chosen.maxPeoplePerBooking ?? 99}
            onChange={onPeople}
            decrementLabel={tCommon('back')}
            incrementLabel={tCommon('next')}
          />
          {chosen.allowChildren ? (
            <>
              <div className="my-5 h-px bg-border" />
              <Stepper
                label={tBooking('stepChildren')}
                value={childCount}
                min={0}
                // Beach / cabana: "maximum children" is PER UMBRELLA / PER CABANA,
                // so the ceiling = cap × tickets (driven by adults). Other kinds
                // use the flat cap.
                max={
                  chosen.kind === 'DAY_USE'
                    ? (beachTicketCapacity({
                        adults: people,
                        ticketCapacity: chosen.includedPersonsPerUnit,
                        maxChildrenPerUmbrella: chosen.maxChildrenPerBooking,
                      }).maxChildren ?? 99)
                    : chosen.kind === 'CABANA'
                      ? (cabanaTicketCapacity({
                          adults: people,
                          ticketCapacity: chosen.includedPersonsPerUnit,
                          maxChildrenPerCabana: chosen.maxChildrenPerBooking,
                        }).maxChildren ?? chosen.maxPeoplePerBooking ?? 99)
                      : (chosen.maxChildrenPerBooking ?? 99) // adults cap never bounds children
                }
                onChange={onChildren}
                decrementLabel={tCommon('back')}
                incrementLabel={tCommon('next')}
              />
              <p className="mt-2 font-aurelia-sans text-[11px] text-muted-foreground">
                {tBooking('childrenAgeNote', { age: chosen.maxChildAge })}
              </p>
              {chosen.kind === 'DAY_USE' && chosen.maxChildrenPerBooking != null ? (
                <p className="mt-1 font-aurelia-sans text-[11px] font-medium text-accent">
                  {tBooking('childrenPerUmbrellaNote', { count: chosen.maxChildrenPerBooking })}
                </p>
              ) : null}
            </>
          ) : null}
          {chosen.allowExtraPeople && (chosen.kind === 'DAY_USE' || chosen.kind === 'CABANA') ? (
            <>
              <div className="my-5 h-px bg-border" />
              <Stepper
                label={tBooking('stepExtraPersons')}
                value={extraPersons}
                min={0}
                max={
                  maxExtraPersonsFor({
                    adults: people,
                    ticketCapacity: chosen.includedPersonsPerUnit,
                    maxExtraPersonsPerUnit: chosen.maxExtraPersonsPerUnit,
                  }) ?? 99
                }
                onChange={onExtraPersons}
                decrementLabel={tCommon('back')}
                incrementLabel={tCommon('next')}
              />
              <p className="mt-2 font-aurelia-sans text-[11px] text-muted-foreground">
                {chosen.extraPersonPriceCents > 0
                  ? tBooking('extraPersonsNotePriced', {
                      price: formatMoney(chosen.extraPersonPriceCents, { locale, currency: 'EGP' }),
                    })
                  : tBooking('extraPersonsNote')}
              </p>
            </>
          ) : null}
          <div className="my-5 h-px bg-border" />
          <Stepper
            label={tBooking('stepCars')}
            value={cars}
            min={0}
            max={chosen.maxCarsPerBooking ?? 99}
            onChange={onCars}
            decrementLabel={tCommon('back')}
            incrementLabel={tCommon('next')}
          />
        </div>

        {quote && (quote.unitsPerDay > 1 || quote.extraPersons > 0 || quote.extraChildren > 0 || quote.days > 1) ? (
          <div className="space-y-1 rounded-[18px] border border-border bg-card px-6 py-4 font-aurelia-sans text-[12.5px] text-muted-foreground">
            {quote.unitsPerDay > 1 ? (
              <p className="text-foreground">{tBooking('explainUnits', { units: quote.unitsPerDay })}</p>
            ) : null}
            {quote.extraPersons > 0 ? <p>{tBooking('explainExtraPeople', { count: quote.extraPersons })}</p> : null}
            {quote.extraChildren > 0 ? <p>{tBooking('explainExtraChildren', { count: quote.extraChildren })}</p> : null}
            {quote.days > 1 ? <p>{tBooking('explainDays', { days: quote.days })}</p> : null}
          </div>
        ) : null}

        {quote && quote.insuranceCents > 0 ? (
          <div className="flex items-center justify-between rounded-[18px] border border-border bg-card px-6 py-4">
            <span className="font-aurelia-sans text-[13px] text-muted-foreground">
              {tBooking('insuranceDeposit')}
            </span>
            <span className="font-aurelia-sans text-[15px] font-semibold tabular-nums text-foreground">
              {formatMoney(quote.insuranceCents, { locale, currency: 'EGP' })}
            </span>
          </div>
        ) : null}

        <div className="flex items-center justify-between rounded-[18px] border border-border bg-card px-6 py-5">
          <span className="font-aurelia-sans text-[13px] text-muted-foreground">
            {tBooking('total')}
          </span>
          <span className="font-aurelia-display text-[26px] font-semibold tabular-nums text-gold-700">
            {quote
              ? formatMoney(quote.totalCents + quote.insuranceCents + quote.pendingPenaltyCents, {
                  locale,
                  currency: 'EGP',
                })
              : isQuoting
                ? '…'
                : formatMoney(chosen.priceCents, { locale, currency: 'EGP' })}
          </span>
        </div>

        {quoteError ? (
          <p
            role="alert"
            className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-center font-aurelia-sans text-[13px] font-medium text-danger"
          >
            {quoteError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ── Step 4: review & pay ───────────────────────────────────────────────────
function StepReview({
  chosen,
  category,
  date,
  endDate,
  people,
  childCount,
  extraPersons: _extraPersons,
  cars,
  quote,
  payError,
  locale,
  t,
  tBooking,
}: {
  chosen: ServiceItem;
  category: Props['category'];
  date: string;
  endDate: string;
  people: number;
  childCount: number;
  extraPersons: number;
  cars: number;
  quote: QuoteOk | null;
  payError: string | null;
  locale: 'ar' | 'en';
  t: ReturnType<typeof useTranslations<'services'>>;
  tBooking: ReturnType<typeof useTranslations<'booking'>>;
}) {
  const tServices = t;
  const multiDay = chosen.allowMultiDay && !!endDate && endDate > date;
  return (
    <div>
      <div className="mb-5">
        <div className="mb-2 font-aurelia-sans text-[11px] font-semibold uppercase tracking-[0.25em] text-gold-600">
          {category.name}
        </div>
        <h1 className="m-0 font-aurelia-display text-[44px] font-semibold leading-none tracking-[-0.01em] text-foreground">
          {t('stepReviewPay')}
        </h1>
      </div>

      <div className="max-w-[560px] space-y-4">
        <div className="rounded-[18px] border border-border bg-card px-6 py-2">
          <Row label={tBooking('reviewTitle')} value={`${category.name} · ${chosen.name}`} />
          <Row
            label={tBooking('stepDate')}
            dirLtr={multiDay}
            value={
              multiDay
                ? formatDateRange(new Date(date), new Date(endDate), locale)
                : formatDate(new Date(date), locale)
            }
          />
          <Row
            label={chosen.includedPersonsPerUnit > 1 ? tBooking('stepAdults') : tBooking('stepPeople')}
            value={String(people)}
          />
          {childCount > 0 ? <Row label={tBooking('stepChildren')} value={String(childCount)} /> : null}
          {quote && quote.extraPersons > 0 ? (
            <Row label={tBooking('stepExtraPersons')} value={String(quote.extraPersons)} />
          ) : null}
          {chosen.kind === 'DAY_USE' && quote ? (
            <Row
              label={tBooking('umbrellasLabel', { capacity: chosen.includedPersonsPerUnit })}
              value={String(quote.unitsPerDay)}
            />
          ) : quote && quote.unitsPerDay > 1 ? (
            <Row label={tBooking('explainUnits', { units: quote.unitsPerDay })} value={`×${quote.unitsPerDay}`} />
          ) : null}
          <Row label={tBooking('stepCars')} value={String(cars)} />
          <div className="my-1 h-px bg-border" />
          {quote && quote.insuranceCents > 0 ? (
            <Row
              label={tBooking('insuranceDeposit')}
              value={formatMoney(quote.insuranceCents, { locale, currency: 'EGP' })}
            />
          ) : null}
          {quote && quote.pendingPenaltyCents > 0 ? (
            <Row
              label={tBooking('penalties')}
              value={formatMoney(quote.pendingPenaltyCents, { locale, currency: 'EGP' })}
            />
          ) : null}
          <Row
            label={tBooking('total')}
            value={
              quote
                ? formatMoney(
                    quote.totalCents + quote.insuranceCents + quote.pendingPenaltyCents,
                    { locale, currency: 'EGP' },
                  )
                : '—'
            }
            bold
          />
        </div>

        {quote && quote.lines.length > 0 ? (
          <div className="divide-y divide-border rounded-[18px] border border-border bg-card px-6 py-2">
            {quote.lines.map((line, idx) => (
              <div key={idx} className="flex items-center justify-between py-2.5 font-aurelia-sans text-[13px]">
                <span className="text-muted-foreground">
                  {line.labelKey.startsWith('services.')
                    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      tServices(line.labelKey.replace('services.', '') as any)
                    : line.labelKey.startsWith('booking.')
                      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        tBooking(line.labelKey.replace('booking.', '') as any)
                      : line.labelKey}{' '}
                  × {line.quantity}
                </span>
                <span className="tabular-nums text-foreground">
                  {formatMoney(line.totalCents, { locale, currency: 'EGP' })}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {payError ? (
          <p
            role="alert"
            className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-center font-aurelia-sans text-[13px] font-medium text-danger"
          >
            {payError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, value, bold, dirLtr }: { label: string; value: string; bold?: boolean; dirLtr?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span
        className={cn(
          'font-aurelia-sans text-[13px]',
          bold ? 'font-bold text-foreground' : 'font-medium text-muted-foreground',
        )}
      >
        {label}
      </span>
      <span
        {...(dirLtr ? { dir: 'ltr' as const } : {})}
        className={cn(
          'font-aurelia-sans text-[13px] tabular-nums',
          bold ? 'font-bold text-gold-700' : 'font-semibold text-foreground',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function PrimaryBtn({
  children,
  disabled,
  loading,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  const off = disabled || loading;
  return (
    <button
      type="button"
      disabled={off}
      onClick={onClick}
      className={cn(
        'inline-flex h-[52px] items-center gap-2.5 rounded-[14px] px-[34px] font-aurelia-sans text-[14.5px] font-bold tracking-[0.02em] transition active:scale-[0.98]',
        off
          ? 'cursor-not-allowed bg-muted text-muted-foreground'
          : 'bg-primary text-primary-foreground shadow-[0_12px_30px_rgba(22,48,79,0.28)] hover:brightness-110',
      )}
    >
      {loading ? '…' : children}
    </button>
  );
}

function Arrow() {
  return <span className="text-[17px] rtl:rotate-180">→</span>;
}

// ── Service card ───────────────────────────────────────────────────────────
function ServiceCard({
  s,
  locale,
  selected,
  onSelect,
  selectLabel,
  selectedLabel,
}: {
  s: ServiceItem;
  locale: 'ar' | 'en';
  selected: boolean;
  onSelect: () => void;
  selectLabel: string;
  selectedLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'group relative flex min-h-[188px] flex-col overflow-hidden rounded-[18px] border p-0 text-start transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        selected
          ? 'border-accent bg-accent/[0.07] shadow-[0_0_0_1px_rgb(var(--ci-accent)),0_16px_40px_rgba(28,43,64,0.12)]'
          : 'border-border bg-card hover:-translate-y-[3px] hover:border-accent/40 hover:shadow-[0_16px_40px_rgba(28,43,64,0.10)]',
      )}
    >
      <div className="flex-1 px-[22px] pt-[22px]">
        <div className="flex items-start gap-3.5">
          <div
            className={cn(
              'size-[58px] shrink-0 overflow-hidden rounded-[13px] border transition-colors',
              selected ? 'border-accent' : 'border-border',
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.image} alt="" className="size-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <h3 className="m-0 min-w-0 flex-1 truncate font-aurelia-display text-[25px] font-semibold leading-none tracking-[-0.01em] text-foreground">
                {s.name}
              </h3>
              <span
                className={cn(
                  'shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 font-aurelia-sans text-[12px] font-bold tracking-[0.02em]',
                  selected
                    ? 'border-accent bg-accent text-accent-foreground'
                    : 'border-gold-400/40 bg-gold-400/[0.15] text-gold-700',
                )}
              >
                {formatMoney(s.priceCents, { locale, currency: 'EGP' })}
              </span>
            </div>
            {s.desc ? (
              <p className="mt-2.5 line-clamp-2 font-aurelia-sans text-[13px] leading-[1.5] text-muted-foreground">
                {s.desc}
              </p>
            ) : null}
            {s.tags.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {s.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-border bg-muted px-[9px] py-[3px] font-aurelia-sans text-[10.5px] font-medium text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div
        className={cn(
          'mt-4 flex items-center justify-between border-t px-[22px] py-[13px]',
          selected ? 'border-accent/40 bg-accent/[0.06]' : 'border-border',
        )}
      >
        <span
          className={cn(
            'font-aurelia-sans text-[12px] font-bold uppercase tracking-[0.14em]',
            selected ? 'text-accent' : 'text-muted-foreground',
          )}
        >
          {selected ? selectedLabel : selectLabel}
        </span>
        <span
          className={cn(
            'flex size-[26px] items-center justify-center rounded-full border-[1.6px] text-[14px] font-bold',
            selected
              ? 'border-accent bg-accent text-accent-foreground'
              : 'border-border text-transparent',
          )}
        >
          {selected ? '✓' : ''}
        </span>
      </div>
    </button>
  );
}

