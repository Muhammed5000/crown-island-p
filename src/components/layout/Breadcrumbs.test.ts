/**
 * Tests for the pure `buildTrailFromPath()` derivation.
 *
 * We deliberately keep the derivation a free function so it can be tested
 * without a next-intl context or a React renderer. The translation lookup is
 * injected as a callback.
 *
 *   npx tsx --test src/components/layout/Breadcrumbs.test.ts
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildTrailFromPath } from './Breadcrumbs';

/** Tiny lookup that pretends `admin`, `bookings`, `edit`, and `_detail` are translated. */
function tStub(key: string): string | null {
  const dict: Record<string, string> = {
    admin: 'Admin',
    bookings: 'Bookings',
    edit: 'Edit',
    new: 'New',
    _detail: 'Details',
  };
  return dict[key] ?? null;
}

describe('buildTrailFromPath', () => {
  it('returns no trail for the root', () => {
    assert.deepEqual(buildTrailFromPath('/', tStub), []);
  });

  it('returns no trail for a single segment (no "up" to go to)', () => {
    assert.deepEqual(buildTrailFromPath('/admin', tStub), []);
  });

  it('builds an intermediate-link trail for a two-segment path', () => {
    const trail = buildTrailFromPath('/admin/bookings', tStub);
    assert.deepEqual(trail, [
      { label: 'Admin', href: '/admin' },
      { label: 'Bookings', href: undefined },
    ]);
  });

  it('does not link the last segment', () => {
    const trail = buildTrailFromPath('/admin/bookings/new', tStub);
    assert.equal(trail[trail.length - 1]!.href, undefined);
  });

  it('humanises unknown segments (kebab → Title Case)', () => {
    // `audit-logs` is not in our stub dict; it should be humanised.
    const trail = buildTrailFromPath('/admin/audit-logs', tStub);
    assert.equal(trail[1]!.label, 'Audit Logs');
  });

  it('replaces cuid-shaped segments with the _detail label', () => {
    const cuid = 'clxabcdefghijklmnopqrstu'; // 24-char cuid shape
    const trail = buildTrailFromPath(`/admin/bookings/${cuid}`, tStub);
    assert.deepEqual(
      trail.map((t) => t.label),
      ['Admin', 'Bookings', 'Details'],
    );
  });

  it('replaces uuid-shaped segments with the _detail label', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const trail = buildTrailFromPath(`/admin/users/${uuid}/edit`, tStub);
    assert.deepEqual(
      trail.map((t) => t.label),
      ['Admin', 'Users', 'Details', 'Edit'],
    );
  });

  it('does NOT misclassify a normal slug as an opaque id', () => {
    // Real slugs from this app: short, contain hyphens, contain non-cuid chars.
    const trail = buildTrailFromPath('/booking/crown-surge/about', tStub);
    assert.equal(trail[1]!.label, 'Crown Surge');
    assert.equal(trail[2]!.label, 'About');
  });

  it('builds href steps incrementally as you walk deeper', () => {
    const trail = buildTrailFromPath('/admin/categories/new', tStub);
    assert.deepEqual(trail, [
      { label: 'Admin', href: '/admin' },
      { label: 'Categories', href: '/admin/categories' },
      { label: 'New', href: undefined },
    ]);
  });

  it('suppresses href for non-clickable intermediate segments', () => {
    // Regression for the `/en/bookings` 404 — `/map` has no page.tsx, so the
    // "Map" crumb in `/map/<bookingId>` must not be a link.
    const trail = buildTrailFromPath(
      '/map/clxabcdefghijklmnopqrstu',
      tStub,
      ['map'],
    );
    assert.equal(trail[0]!.label, 'Map');
    assert.equal(trail[0]!.href, undefined, 'map must not be linkable');
    assert.equal(trail[1]!.label, 'Details');
  });

  it('non-clickable list does not affect last segment (which is already non-linked)', () => {
    const trail = buildTrailFromPath('/bookings/history', tStub, ['bookings']);
    assert.equal(trail[0]!.href, undefined);
    assert.equal(trail[1]!.href, undefined);
  });
});
