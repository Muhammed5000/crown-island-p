import type { BookingStatus } from '@prisma/client';
import type { DetailSheetCopy } from '../DetailSheet';

/**
 * Copy bundle shared by the desktop booking surface. Identical in shape to the
 * one `BookingGrid` (mobile) already receives from the booking page, so the
 * page can hand the exact same object to both trees.
 */
export interface CopyBundle extends DetailSheetCopy {
  filterAll: string;
  filterKind: Record<'DAY_USE' | 'CABANA' | 'EVENT' | 'OTHER', string>;
  sectionTitle: string;
  sectionAction: string;
  endOfList: string;
  featuredBadge: string;
  reserveCta: string;
  nextSlotNow: string;
  nextSlotOpens: string;
  nextSlotClosed: string;
  emptyTitle: string;
  emptyBody: string;
}

/** Desktop-only strings — the `aureliaDesktop` namespace, resolved server-side. */
export interface DeskCopy {
  headingSub: string;
  statOpenNow: string;
  statOpenNowSub: string;
  statReservations: string;
  statReservationsSub: string;
  statExperiences: string;
  statExperiencesSub: string;
  pickDate: string;
  sortRecommended: string;
  offeringsTitle: string;
  offeringsCount: string;
  hoursLabel: string;
  nextAvailabilityLabel: string;
  detailsLabel: string;
  briefReservationsLabel: string;
  briefViewAll: string;
  briefNoReservations: string;
  briefWeatherLabel: string;
  briefWeatherDetail: string;
  temperature?: number;
  sunriseMinutes?: number;
  sunsetMinutes?: number;
  briefConciergeLabel: string;
  briefConciergeName: string;
  briefConciergeShift: string;
  briefConciergeMessage: string;
  briefConciergeReply: string;
}

/** One day in the desktop date scrubber — pre-computed server-side. */
export interface DeskDate {
  key: string;
  weekday: string;
  day: number;
}

/**
 * A reservation row for the concierge brief. Times are formatted server-side
 * (in `page.tsx`) so the client component never reparses dates — that keeps
 * the SSR markup and the hydrated markup identical.
 */
export interface DeskReservation {
  id: string;
  time: string;
  title: string;
  sub: string;
  status: BookingStatus;
}
