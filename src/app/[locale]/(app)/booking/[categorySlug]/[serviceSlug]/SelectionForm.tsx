'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Card, CardBody } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Stepper } from '@/components/ui/Stepper';
import { Button } from '@/components/ui/Button';
import { formatMoney } from '@/lib/money';
import { toIsoDate } from '@/lib/date';
import { calcQuote, type QuoteResult } from '@/features/booking/actions';
import { beachTicketCapacity, cabanaTicketCapacity, maxExtraPersonsFor } from '@/server/services/booking-calc-core';
import { ErrorIllustration } from '@/components/ui/ErrorIllustration';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setDate as setFlowDate } from '@/store/slices/bookingFlow';

interface Props {
  locale: 'ar' | 'en';
  service: {
    id: string;
    nameEn: string;
    nameAr: string;
    descEn: string | null;
    descAr: string | null;
    basePriceCents: number;
    kind: 'DAY_USE' | 'CABANA' | 'EVENT' | 'OTHER';
    maxPeoplePerBooking: number | null;
    maxCarsPerBooking: number | null;
    includedPersonsPerUnit: number;
    /** When true (grouped-ticket services), show the paid "Extra Person" add-on counter. */
    allowExtraPeople: boolean;
    /** Price per extra add-on person, in piastres. */
    extraPersonPriceCents: number;
    /** Per-unit cap on the Extra Person counter (× units); null = no limit. */
    maxExtraPersonsPerUnit: number | null;
    allowChildren: boolean;
    maxChildAge: number;
    /** Children carried free before the extra-child price kicks in. */
    freeChildrenPerUnit: number;
    /** Hard cap on total children per booking (null = no limit). */
    maxChildrenPerBooking: number | null;
    /** Beach: when true, children fill the umbrella's people capacity. */
    childrenCountAsPersons: boolean;
    allowMultiDay: boolean;
    maxBookingDays: number | null;
  };
  category: {
    slug: string;
    nameEn: string;
    nameAr: string;
  };
  /** Guests can browse + price, but must sign in before reaching review/pay. */
  isAuthenticated?: boolean;
}

/** Stepper ceiling when a field has no configured limit (purely a UI guard;
 * the server is the real source of truth). */
const NO_LIMIT = 99;

/** Add `days` days to a yyyy-mm-dd string, returning yyyy-mm-dd. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function SelectionForm({ locale, service, category, isAuthenticated = true }: Props) {
  const t = useTranslations('booking');
  const tSvc = useTranslations('services');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const dispatch = useAppDispatch();
  const flowDate = useAppSelector((s) => s.bookingFlow.date);

  const todayIso = useMemo(() => toIsoDate(new Date()), []);

  const [date, setDate] = useState(() =>
    flowDate && flowDate >= todayIso ? flowDate : todayIso,
  );
  const [endDate, setEndDate] = useState<string>('');
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [extraPersons, setExtraPersons] = useState(0);
  const [cars, setCars] = useState(0);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const multiDay = service.allowMultiDay && !!endDate && endDate > date;

  function quoteErrorMessage(code: string): string {
    if (code === 'past_date') return t('errors.pastDate');
    if (code === 'working_hours_ended') return t('errors.workingHoursEnded');
    if (code === 'multi_day_not_allowed' || code === 'too_many_days') return t('errors.invalidDays');
    if (code === 'children_not_allowed') return t('errors.childrenNotAllowed');
    if (code === 'capacity_max_children') return t('errors.maxChildren');
    if (code === 'capacity_max_extra_persons') return t('errors.maxExtraPersons');
    if (code === 'capacity_max_per_booking_people')
      return t('errors.maxPeople', { max: service.maxPeoplePerBooking ?? '' });
    if (code === 'capacity_max_per_booking_cars')
      return t('errors.maxCars', { max: service.maxCarsPerBooking ?? '' });
    // Only the genuine daily-capacity codes (capacity_people / capacity_cars)
    // mean "this date is full"; the per-booking caps above are about party size.
    if (code.startsWith('capacity')) return t('errors.capacity');
    return tCommon('error');
  }

  // Re-quote whenever any input changes. Debounced; only the async transition
  // mutates state.
  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      startTransition(async () => {
        const res = await calcQuote({
          serviceId: service.id,
          date,
          endDate: service.allowMultiDay && endDate ? endDate : undefined,
          adults,
          children,
          extraPersons,
          cars,
        });
        if (cancelled) return;
        if (!res.ok) {
          setError(quoteErrorMessage(res.code));
          setQuote(null);
          return;
        }
        setError(null);
        setQuote(res);
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, endDate, adults, children, extraPersons, cars, service.id, service.allowMultiDay]);

  const wipe = () => {
    setQuote(null);
  };
  const onDateChange = (v: string) => {
    setDate(v);
    if (endDate && endDate < v) setEndDate('');
    wipe();
    dispatch(setFlowDate(v));
  };
  const onEndDateChange = (v: string) => {
    setEndDate(v);
    wipe();
  };
  const onAdultsChange = (v: number) => {
    setAdults(v);
    // Beach / cabana: fewer adults ⇒ fewer umbrellas/cabanas ⇒ lower children
    // ceiling — clamp the current children down so the selection can never
    // exceed the server cap.
    if (service.maxChildrenPerBooking != null) {
      let capChildren: number | null = null;
      if (isBeach) {
        capChildren = beachTicketCapacity({
          adults: v,
          ticketCapacity: service.includedPersonsPerUnit,
          maxChildrenPerUmbrella: service.maxChildrenPerBooking,
        }).maxChildren;
      } else if (isCabana) {
        capChildren = cabanaTicketCapacity({
          adults: v,
          ticketCapacity: service.includedPersonsPerUnit,
          maxChildrenPerCabana: service.maxChildrenPerBooking,
        }).maxChildren;
      }
      if (capChildren != null) setChildren((c) => Math.min(c, capChildren!));
    }
    // Fewer adults ⇒ fewer units ⇒ lower extra-person ceiling — clamp to match.
    if (service.allowExtraPeople && service.maxExtraPersonsPerUnit != null) {
      const capExtra = maxExtraPersonsFor({
        adults: v,
        ticketCapacity: service.includedPersonsPerUnit,
        maxExtraPersonsPerUnit: service.maxExtraPersonsPerUnit,
      });
      if (capExtra != null) setExtraPersons((e) => Math.min(e, capExtra));
    }
    wipe();
  };

  function onContinue() {
    if (!quote || !quote.ok) return;
    const params = new URLSearchParams({
      service: service.id,
      cat: category.slug,
      date,
      adults: String(adults),
      children: String(children),
      extraPersons: String(extraPersons),
      cars: String(cars),
      total: String(quote.totalCents),
    });
    if (multiDay) params.set('endDate', endDate);
    const reviewUrl = `/booking/review?${params.toString()}`;
    if (!isAuthenticated) {
      router.push(`/login?next=${encodeURIComponent(reviewUrl)}`);
      return;
    }
    router.push(reviewUrl);
  }

  const totalCents = quote?.ok ? quote.totalCents : null;
  // Beach (DAY_USE): people overflow into additional umbrellas, so nothing is
  // capped per-ticket — only the per-booking total cap applies to both adults
  // and children. Other kinds keep their own per-booking caps.
  const isBeach = service.kind === 'DAY_USE';
  const isCabana = service.kind === 'CABANA';
  // Optional paid "Extra Person" add-on counter — only for grouped-ticket
  // services that enable it (it's billed via the extra-person line, which the
  // engine emits for beach / cabana only).
  const showExtraPersons = service.allowExtraPeople && (isBeach || isCabana);
  // Per-unit cap scales with the adults-driven umbrella/cabana count (shared
  // engine fn ⇒ the stepper ceiling matches the server's check exactly).
  const maxExtraPersons = showExtraPersons
    ? (maxExtraPersonsFor({
        adults,
        ticketCapacity: service.includedPersonsPerUnit,
        maxExtraPersonsPerUnit: service.maxExtraPersonsPerUnit,
      }) ?? NO_LIMIT)
    : NO_LIMIT;
  // Beach: ADULTS drive umbrellas; "maximum children" is PER UMBRELLA, so the
  // child ceiling grows with the umbrellas the adults open. Uses the shared
  // engine fn so the stepper matches the server exactly.
  const beachCap = isBeach
    ? beachTicketCapacity({
        adults,
        ticketCapacity: service.includedPersonsPerUnit,
        maxChildrenPerUmbrella: service.maxChildrenPerBooking,
      })
    : null;
  // Cabana: ADULTS drive cabanas; "maximum children" is PER CABANA, so the child
  // ceiling grows with the cabanas the adults open (same grouped-ticket rule as
  // beach). Shared engine fn ⇒ stepper matches the server exactly.
  const cabanaCap = isCabana
    ? cabanaTicketCapacity({
        adults,
        ticketCapacity: service.includedPersonsPerUnit,
        maxChildrenPerCabana: service.maxChildrenPerBooking,
      })
    : null;
  const maxAdults = service.maxPeoplePerBooking ?? NO_LIMIT;
  const maxChildren = isBeach
    ? (beachCap!.maxChildren ?? NO_LIMIT)
    : isCabana
      ? (cabanaCap!.maxChildren ?? service.maxPeoplePerBooking ?? NO_LIMIT)
      // Children are NOT bounded by the adults cap (maxPeoplePerBooking is
      // adults-only); their own flat cap applies, else no limit.
      : (service.maxChildrenPerBooking ?? NO_LIMIT);
  // End date max respects the admin's day cap.
  const endDateMax =
    service.maxBookingDays != null ? addDays(date, service.maxBookingDays - 1) : undefined;

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-2">
          <h2 className="font-display text-lg font-semibold text-gold-700">
            {locale === 'ar' ? service.nameAr : service.nameEn}
          </h2>
          {(locale === 'ar' ? service.descAr : service.descEn) ? (
            <p className="text-sm text-muted-foreground">
              {locale === 'ar' ? service.descAr : service.descEn}
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-5">
          <div>
            <Label htmlFor="date">{service.allowMultiDay ? t('stepStartDate') : t('stepDate')}</Label>
            <Input
              id="date"
              name="date"
              type="date"
              dir="ltr"
              min={todayIso}
              value={date}
              onChange={(e) => onDateChange(e.target.value)}
              required
            />
          </div>

          {service.allowMultiDay ? (
            <div>
              <Label htmlFor="endDate">{t('stepEndDate')}</Label>
              <Input
                id="endDate"
                name="endDate"
                type="date"
                dir="ltr"
                min={date}
                max={endDateMax}
                value={endDate}
                onChange={(e) => onEndDateChange(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">{t('multiDayHint')}</p>
            </div>
          ) : null}

          <Stepper
            label={service.includedPersonsPerUnit > 1 ? t('stepAdults') : t('stepPeople')}
            value={adults}
            min={1}
            max={maxAdults}
            onChange={onAdultsChange}
            decrementLabel={tCommon('back')}
            incrementLabel={tCommon('next')}
          />

          {service.allowChildren ? (
            <div>
              <Stepper
                label={t('stepChildren')}
                value={children}
                min={0}
                max={maxChildren}
                onChange={(v) => {
                  setChildren(v);
                  wipe();
                }}
                decrementLabel={tCommon('back')}
                incrementLabel={tCommon('next')}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t('childrenAgeNote', { age: service.maxChildAge })}
              </p>
              {isBeach ? (
                service.maxChildrenPerBooking != null ? (
                  <p className="mt-1 text-[11px] font-medium text-accent">
                    {t('childrenPerUmbrellaNote', { count: service.maxChildrenPerBooking })}
                  </p>
                ) : null
              ) : service.freeChildrenPerUnit > 0 ? (
                <p className="mt-1 text-[11px] font-medium text-success">
                  {t('childrenFreeAllowanceNote', { count: service.freeChildrenPerUnit })}
                </p>
              ) : null}
            </div>
          ) : null}

          {showExtraPersons ? (
            <div>
              <Stepper
                label={t('stepExtraPersons')}
                value={extraPersons}
                min={0}
                max={maxExtraPersons}
                onChange={(v) => {
                  setExtraPersons(v);
                  wipe();
                }}
                decrementLabel={tCommon('back')}
                incrementLabel={tCommon('next')}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {service.extraPersonPriceCents > 0
                  ? t('extraPersonsNotePriced', {
                      price: formatMoney(service.extraPersonPriceCents, { locale, currency: 'EGP' }),
                    })
                  : t('extraPersonsNote')}
              </p>
            </div>
          ) : null}

          <Stepper
            label={t('stepCars')}
            value={cars}
            min={0}
            max={service.maxCarsPerBooking ?? NO_LIMIT}
            onChange={(v) => {
              setCars(v);
              wipe();
            }}
            decrementLabel={tCommon('back')}
            incrementLabel={tCommon('next')}
          />
        </CardBody>
      </Card>

      {/* Unit / umbrella / multi-day explanation banner. */}
      {quote?.ok && (isBeach || quote.unitsPerDay > 1 || quote.extraPersons > 0 || quote.extraChildren > 0 || quote.days > 1) ? (
        <Card>
          <CardBody className="space-y-1 text-[13px] text-muted-foreground">
            {isBeach ? (
              <p className="text-foreground">
                {t('explainUmbrellas', {
                  units: quote.unitsPerDay,
                  capacity: service.includedPersonsPerUnit,
                })}
              </p>
            ) : quote.unitsPerDay > 1 ? (
              <p className="text-foreground">{t('explainUnits', { units: quote.unitsPerDay })}</p>
            ) : null}
            {quote.extraPersons > 0 ? (
              <p>{t('explainExtraPeople', { count: quote.extraPersons })}</p>
            ) : null}
            {quote.extraChildren > 0 ? (
              <p>{t('explainExtraChildren', { count: quote.extraChildren })}</p>
            ) : null}
            {quote.days > 1 ? <p>{t('explainDays', { days: quote.days })}</p> : null}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardBody className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">{t('total')}</span>
          <span className="font-display text-2xl font-semibold text-gold-700 tabular-nums">
            {isPending && totalCents == null
              ? '…'
              : formatMoney(totalCents ?? service.basePriceCents, { locale, currency: 'EGP' })}
          </span>
        </CardBody>
      </Card>

      {error ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-danger/20 bg-danger/5 p-5 text-center animate-fade-in">
          <ErrorIllustration type="storm" className="size-16 opacity-60" />
          <p className="text-xs font-medium text-danger uppercase tracking-wider" role="alert">
            {error}
          </p>
        </div>
      ) : null}

      <Button
        type="button"
        variant="primary"
        size="lg"
        fullWidth
        loading={isPending}
        disabled={totalCents == null}
        onClick={onContinue}
      >
        {isAuthenticated ? `${tSvc('selectService')} · ${tCommon('continue')}` : t('signInToBook')}
      </Button>
    </div>
  );
}
