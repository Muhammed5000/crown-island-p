/**
 * Domain errors thrown by service-layer code.
 *
 * These are *typed* on purpose so route handlers and server actions can
 * map them to user-facing messages without sniffing error strings.
 */

export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus = 400,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class ServiceInactiveError extends DomainError {
  constructor() {
    super('Service or category is not active', 'service_inactive', 400);
    this.name = 'ServiceInactiveError';
  }
}

export class PastDateError extends DomainError {
  constructor() {
    super('Booking date is in the past', 'past_date', 400);
    this.name = 'PastDateError';
  }
}

export class CapacityError extends DomainError {
  constructor(
    reason:
      | 'people'
      | 'cars'
      | 'max_per_booking_people'
      | 'max_per_booking_cars'
      | 'max_children'
      | 'max_extra_persons',
  ) {
    super(`Insufficient capacity (${reason})`, `capacity_${reason}`, 409);
    this.name = 'CapacityError';
  }
}

export class PriceChangedError extends DomainError {
  constructor(public expectedCents: number, public actualCents: number) {
    super('Price has changed since the quote', 'price_changed', 409);
    this.name = 'PriceChangedError';
  }
}

export class WorkingHoursError extends DomainError {
  constructor() {
    super('Operational hours for today have ended', 'working_hours_ended', 400);
    this.name = 'WorkingHoursError';
  }
}

export class AuthorizationError extends DomainError {
  constructor() {
    super('Not authorized', 'forbidden', 403);
    this.name = 'AuthorizationError';
  }
}

/**
 * Thrown when the admin "Bookings enabled" toggle is OFF. Surfaces a 503
 * because the site is intentionally in maintenance mode — clients can
 * retry later.
 */
export class BookingsDisabledError extends DomainError {
  constructor() {
    super('Bookings are currently disabled', 'bookings_disabled', 503);
    this.name = 'BookingsDisabledError';
  }
}

/**
 * Thrown on the on-prem LOCAL node (APP_MODE=local) when it tries to CREATE a
 * booking while offline. Online is the sole booking writer, so new bookings need
 * connectivity; everything else (gate scan, check-in, ops, …) works offline and
 * syncs up when the link returns. 503 = retry when back online.
 */
export class SyncOfflineError extends DomainError {
  constructor() {
    super('New bookings are unavailable while the venue is offline', 'sync_offline', 503);
    this.name = 'SyncOfflineError';
  }
}

/**
 * Thrown when the booking date is closer to "now" than the admin-configured
 * lead time allows. Carries the lead-time value so the UI can render a
 * specific message ("must book at least N hours ahead").
 */
export class LeadTimeError extends DomainError {
  constructor(public requiredHours: number) {
    super(`Bookings must be at least ${requiredHours}h in advance`, 'lead_time', 409);
    this.name = 'LeadTimeError';
  }
}

/**
 * Thrown by the customer cancel flow when the booking date is closer to
 * "now" than the admin-configured cancellation cutoff. Carries the cutoff
 * value so the UI can render a specific message.
 */
export class CancellationCutoffError extends DomainError {
  constructor(public cutoffHours: number) {
    super(
      `Cancellation closed — within ${cutoffHours}h of the booking date`,
      'cancellation_cutoff',
      409,
    );
    this.name = 'CancellationCutoffError';
  }
}
