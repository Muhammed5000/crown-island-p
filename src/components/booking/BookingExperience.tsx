import { getMessages, getTranslations } from 'next-intl/server';
import { PageTransition } from '@/components/layout/PageTransition';
import { AureliaTopBar } from '@/components/booking/aurelia/AureliaTopBar';
import { ActivitySpotlight } from '@/components/booking/aurelia/ActivitySpotlight';
import { HeroVideo } from '@/components/booking/aurelia/HeroVideo';
import { DateScrubber } from '@/components/booking/aurelia/DateScrubber';
import { BookingGrid } from '@/components/booking/aurelia/BookingGrid';
import { BookingDesktop } from '@/components/booking/aurelia/desktop/BookingDesktop';
import type { DeskCopy } from '@/components/booking/aurelia/desktop/types';
import type { CategoryWithExtras } from '@/components/booking/aurelia/derive';
import { getSessionUser } from '@/server/auth/guards';
import { getSettings } from '@/server/settings/settings';
import { listUpcomingBookingsForNotifications } from '@/server/services/bookings-read';
import { getUserProfileImage } from '@/server/services/user-read';
import { getAlexandriaWeather } from '@/server/services/weather';
import type { Locale } from '@/i18n/config';
import { toIsoDate } from '@/lib/date';

interface Props {
  locale: Locale;
  categories: CategoryWithExtras[];
}

/**
 * Shared AURELIA booking experience — the mobile/tablet column plus the
 * wide-canvas desktop view, with a section tab strip (All / Beaches /
 * Activities). The three booking routes (`/booking`, `/booking/beaches`,
 * `/booking/activities`) render this with a different `categories` slice and
 * `activeTab`; everything else (weather, copy, notifications) is identical.
 *
 * The visual language and derive helpers are unchanged from the original
 * `booking/page.tsx`; only the category list is parameterised.
 */
export async function BookingExperience({ locale, categories }: Props) {
  const [t, tCommon, user, weatherData, settings] = await Promise.all([
    getTranslations('aurelia'),
    getTranslations('common'),
    getSessionUser().catch(() => null),
    getAlexandriaWeather(locale),
    getSettings(),
  ]);

  // Admin-controlled hero "video slot". When a video is set it replaces the
  // rotating ActivitySpotlight; otherwise the spotlight stays.
  const heroVideoUrl = settings.heroVideoUrl;
  const heroPosterUrl = settings.heroPosterUrl;

  // Notifications panel feed — empty for guests; the bell still renders but
  // shows the "no notifications" empty state.
  const notifications = user
    ? await listUpcomingBookingsForNotifications(user.id).catch(() => [])
    : [];

  // Fresh profile photo from the DB so the home avatar matches the Settings page
  // (the session image can be stale after a profile-photo change).
  const profileImage = user ? await getUserProfileImage(user.id) : null;

  const now = new Date();
  const initialNowM = now.getHours() * 60 + now.getMinutes();

  const weekdayList = t.raw('weekdays') as string[];
  // Weekday shown in the date strips AND the eyebrow: FULL name in Arabic
  // (e.g. الخميس), 3-letter abbreviation in English.
  const dateWeekdays = locale === 'ar' ? (t.raw('weekdaysFull') as string[]) : weekdayList;
  const monthList = t.raw('months') as string[];
  const weekday = dateWeekdays[now.getDay()] ?? '';
  const monthName = monthList[now.getMonth()] ?? '';

  const weatherDisplay = `${weatherData.temperature}° ${weatherData.conditionText}`;

  const eyebrow = t('eyebrow', {
    weekday: weekday.toUpperCase(),
    day: now.getDate(),
    month: monthName.toUpperCase(),
    weather: weatherDisplay.toUpperCase(),
  });

  const initials = pickInitials(user?.name, user?.email);

  const copy = {
    filterAll: t('filterAll'),
    filterKind: {
      DAY_USE: t('filterDayUse'),
      CABANA: t('filterCabana'),
      EVENT: t('filterEvent'),
      OTHER: t('filterOther'),
    } as const,
    sectionTitle: t('sectionToday'),
    sectionAction: t('sectionAction'),
    endOfList: t('endOfList'),
    featuredBadge: t('featuredBadge'),
    statusOpen: t('statusOpen'),
    statusFilling: t('statusFilling'),
    statusClosed: t('statusClosed'),
    statusSoon: t('statusSoon'),
    reserveCta: t('reserveCta'),
    nextSlotNow: t('nextSlotNow'),
    nextSlotOpens: t('nextSlotOpens'),
    nextSlotClosed: t('nextSlotClosed'),
    emptyTitle: t('emptyTitle'),
    emptyBody: t('emptyBody'),
    close: t('sheetClose'),
    infoHours: t('sheetInfoHours'),
    infoPrice: t('sheetInfoPrice'),
    infoStatus: t('sheetInfoStatus'),
    infoFromPrice: t('sheetInfoFromPrice'),
    whatsIncluded: t('sheetWhatsIncluded'),
    capacityToday: t('sheetCapacityToday'),
    whereTitle: t('sheetWhereTitle'),
    openInMaps: t('sheetOpenInMaps'),
    galleryTitle: t('sheetGalleryTitle'),
    videoTitle: t('sheetVideoTitle'),
    termsTitle: t('sheetTermsTitle'),
    capacityFullTemplate: t.raw('sheetCapacityFull') as string,
    capacityLeftTemplate: t.raw('sheetCapacityLeft') as string,
    reservationsClosed: t('sheetReservationsClosed'),
    reserveCtaTemplate: t.raw('sheetCtaReserve') as string,
    currency: t('currency'),
    slotNow: t('nextSlotNow'),
    slotOpens: t('nextSlotOpens'),
    slotClosed: t('nextSlotClosed'),
  };

  const headlineLines = t('heading').split('\n');

  const messages = await getMessages();
  const desk = (messages as Record<string, unknown>).aureliaDesktop as DeskCopy;

  desk.briefWeatherDetail = `${weatherData.conditionText} · ${t('sheetInfoHours')} ${weatherData.sunrise}-${weatherData.sunset}`;
  desk.temperature = weatherData.temperature;
  desk.sunriseMinutes = weatherData.sunriseMinutes;
  desk.sunsetMinutes = weatherData.sunsetMinutes;

  const deskDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    return {
      // LOCAL yyyy-mm-dd to stay in lockstep with the displayed `day`
      // (getDate()). toISOString() would be UTC and could roll back a day,
      // making the strip show one day but store the day before.
      key: toIsoDate(d),
      weekday: dateWeekdays[d.getDay()] ?? '',
      day: d.getDate(),
    };
  });

  const deskReservations = notifications.map((n) => {
    const dt = new Date(n.bookingAtIso);
    const time = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    const categoryName = locale === 'ar' ? n.categoryNameAr : n.categoryNameEn;
    const serviceName = locale === 'ar' ? n.serviceNameAr : n.serviceNameEn;

    return {
      id: n.id,
      time,
      title: `${categoryName} - ${serviceName}`,
      sub: n.reference,
      status: n.status,
    };
  });

  return (
    <PageTransition>
      {/* Mobile + tablet (< xl) — unchanged centered column. */}
      <main
        className="exp-tajawal relative -mt-5 min-h-dvh w-full overflow-hidden bg-background text-foreground xl:hidden"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 80% 50% at 20% 0%, rgba(194,161,78,0.08) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 80% 100%, rgba(42,157,168,0.10) 0%, transparent 60%)',
        }}
      >
        {/* Full-bleed hero — edge-to-edge and flush to the very top of the page.
            The `-mt-5` on <main> cancels the global headerless top-pad floor so
            nothing sits between the hero and the top of the viewport. An
            admin-set video takes the slot; otherwise the rotating photo
            spotlight does. */}
        {heroVideoUrl ? (
          <HeroVideo videoUrl={heroVideoUrl} posterUrl={heroPosterUrl} locale={locale} padClassName="" />
        ) : (
          <ActivitySpotlight categories={categories} locale={locale} padClassName="" />
        )}

        <div className="mx-auto flex max-w-[640px] flex-col gap-[14px] pb-32 pt-6">
          {/* Signed-in users keep the AURELIA brand bar (notifications + avatar).
              Guests get the global GuestTopBar (logo + Login) pinned at the very
              top of the shell instead, so the login sits above the hero. */}
          {user ? (
            <AureliaTopBar
              brandName={tCommon('appName')}
              tagline={t('topBarTagline')}
              initials={initials}
              imageUrl={profileImage}
              userName={user.name}
              notifications={notifications}
              locale={locale}
              isAuthenticated
            />
          ) : null}

          <DateScrubber
            weekdayLabels={dateWeekdays}
            todayLabel={t('today')}
            tomorrowLabel={t('tomorrow')}
            pickDateLabel={t('pickDate')}
          />

          <header className="px-5 pb-2 pt-4">
            <p className="mb-1.5 font-aurelia-sans text-[10px] font-semibold uppercase tracking-[0.3em] text-gold-600 max-sm:text-[11px] rtl:tracking-normal rtl:normal-case">
              {eyebrow}
            </p>
            <h1 className="m-0 font-aurelia-display text-[34px] font-extrabold leading-[1] tracking-[-0.01em] text-foreground max-sm:text-[38px]">
              {headlineLines.map((line, i) => (
                <span key={i} className="block">
                  {line}
                </span>
              ))}
            </h1>
          </header>

          <BookingGrid categories={categories} locale={locale} copy={copy} />
        </div>
      </main>

      {/* Desktop (≥ xl) — wide-canvas AURELIA redesign. */}
      <div className="exp-tajawal hidden xl:block">
        <BookingDesktop
          categories={categories}
          locale={locale}
          copy={copy}
          desk={desk}
          eyebrow={eyebrow}
          headline={t('heading')}
          dates={deskDates}
          reservations={deskReservations}
          initialNowM={initialNowM}
          heroVideoUrl={heroVideoUrl}
          heroPosterUrl={heroPosterUrl}
        />
      </div>
    </PageTransition>
  );
}

/** "Ehab Hegazy" → "EH" · "ehab@example.com" → "EH" · null → "CI". */
function pickInitials(name?: string | null, email?: string | null): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  if (email && email.includes('@')) {
    const local = email.split('@')[0]!;
    return local.slice(0, 2).toUpperCase();
  }
  return 'CI';
}
