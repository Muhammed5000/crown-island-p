import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidRating,
  isValidComment,
  cleanComment,
  isBookingReviewable,
  publicReviewerName,
  average,
  buildDistribution,
  type ReviewableBooking,
} from './review-core';

describe('isValidRating', () => {
  it('accepts integers 1–5', () => {
    for (const r of [1, 2, 3, 4, 5]) assert.equal(isValidRating(r), true);
  });
  it('rejects out-of-range, fractional, and non-numbers', () => {
    for (const r of [0, 6, -1, 4.5, NaN, '5', null, undefined]) assert.equal(isValidRating(r as number), false);
  });
});

describe('isValidComment', () => {
  it('accepts 1–500 chars after trimming', () => {
    assert.equal(isValidComment('Great visit'), true);
    assert.equal(isValidComment('x'), true);
    assert.equal(isValidComment('a'.repeat(500)), true);
  });
  it('rejects empty/whitespace-only and over-500', () => {
    assert.equal(isValidComment(''), false);
    assert.equal(isValidComment('   '), false);
    assert.equal(isValidComment('a'.repeat(501)), false);
    assert.equal(isValidComment(42 as unknown as string), false);
  });
  it('cleanComment trims', () => {
    assert.equal(cleanComment('  hi  '), 'hi');
  });
});

describe('isBookingReviewable', () => {
  const base: ReviewableBooking = { status: 'CONFIRMED', userRole: 'CUSTOMER', hasReview: false };

  it('allows a CONFIRMED customer booking with no review — from confirmation onward', () => {
    assert.equal(isBookingReviewable(base), true);
  });

  it('allows an EXPIRED (past confirmed) customer booking', () => {
    assert.equal(isBookingReviewable({ ...base, status: 'EXPIRED' }), true);
  });

  it('rejects non-CUSTOMER owners (walk-in reception bookings are owned by staff)', () => {
    assert.equal(isBookingReviewable({ ...base, userRole: 'STAFF' }), false);
    assert.equal(isBookingReviewable({ ...base, userRole: 'DEVELOPER' }), false);
  });

  it('rejects not-yet-confirmed or terminal-unpaid states', () => {
    assert.equal(isBookingReviewable({ ...base, status: 'PENDING_PAYMENT' }), false);
    assert.equal(isBookingReviewable({ ...base, status: 'CANCELLED' }), false);
    assert.equal(isBookingReviewable({ ...base, status: 'FAILED' }), false);
  });

  it('rejects a booking that already has a review', () => {
    assert.equal(isBookingReviewable({ ...base, hasReview: true }), false);
  });
});

describe('publicReviewerName', () => {
  it('shows first name + last initial', () => {
    assert.equal(publicReviewerName('Ahmed Mohamed'), 'Ahmed M.');
    assert.equal(publicReviewerName('  Sara Ali Hassan '), 'Sara H.');
  });
  it('handles single name and blanks', () => {
    assert.equal(publicReviewerName('Ahmed'), 'Ahmed');
    assert.equal(publicReviewerName(''), 'Guest');
    assert.equal(publicReviewerName(null), 'Guest');
  });
});

describe('average', () => {
  it('rounds to one decimal and returns 0 for empty', () => {
    assert.equal(average([5, 4, 4]), 4.3);
    assert.equal(average([5, 5]), 5);
    assert.equal(average([]), 0);
  });
});

describe('buildDistribution', () => {
  it('fills 5→1 with zeros and sums duplicate rows', () => {
    const dist = buildDistribution([
      { rating: 5, count: 10 },
      { rating: 3, count: 2 },
      { rating: 5, count: 1 },
    ]);
    assert.deepEqual(dist, [
      { star: 5, count: 11 },
      { star: 4, count: 0 },
      { star: 3, count: 2 },
      { star: 2, count: 0 },
      { star: 1, count: 0 },
    ]);
  });
});
