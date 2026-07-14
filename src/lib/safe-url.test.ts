/**
 * Security regression tests for the external-link validator.
 *
 * Run with the repo's existing zero-dependency convention:
 *
 *   npx tsx --test src/lib/safe-url.test.ts
 *
 * What we're guarding against: a future tweak quietly re-opening any of the
 * classic "trojan link" shapes — lookalike domains (`facebook.com.evil.com`),
 * dangerous protocols (`javascript:`), credential spoofing
 * (`https://facebook.com@evil.com`) or substring-match validation.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateSocialUrl, validateWebsiteUrl } from './safe-url';

describe('validateSocialUrl — accepts real platform links', () => {
  it('accepts canonical and www hosts', () => {
    for (const raw of [
      'https://facebook.com/crownisland',
      'https://www.facebook.com/crownisland',
      'https://m.facebook.com/crownisland',
      'https://web.facebook.com/profile.php?id=1',
    ]) {
      const res = validateSocialUrl(raw, 'facebook');
      assert.equal(res.ok, true, `expected ok for ${raw}`);
    }
    assert.equal(validateSocialUrl('https://www.instagram.com/crown.island/', 'instagram').ok, true);
    assert.equal(validateSocialUrl('https://www.tiktok.com/@crownisland', 'tiktok').ok, true);
    assert.equal(validateSocialUrl('https://vm.tiktok.com/ZM2abc/', 'tiktok').ok, true);
  });

  it('tolerates a missing scheme and normalises to https', () => {
    const res = validateSocialUrl('facebook.com/crownisland', 'facebook');
    assert.equal(res.ok, true);
    assert.equal(res.ok && res.url, 'https://facebook.com/crownisland');
  });

  it('upgrades http:// to https:// and lower-cases the host', () => {
    const res = validateSocialUrl('http://WWW.Instagram.COM/crown', 'instagram');
    assert.equal(res.ok, true);
    assert.equal(res.ok && res.url, 'https://www.instagram.com/crown');
  });
});

describe('validateSocialUrl — rejects lookalike / hostile links', () => {
  it('rejects fake suffix domains (facebook.com.evil.com)', () => {
    for (const [raw, platform] of [
      ['https://facebook.com.evil.com/page', 'facebook'],
      ['https://instagram.com.attacker.net/x', 'instagram'],
      ['https://tiktok.com.fake-domain.com/@x', 'tiktok'],
      ['https://notfacebook.com/page', 'facebook'],
      ['https://myfacebook.com/page', 'facebook'],
      ['https://facebook.com.co/page', 'facebook'],
    ] as const) {
      const res = validateSocialUrl(raw, platform);
      assert.deepEqual(res, { ok: false, code: 'wrong_domain' }, `expected wrong_domain for ${raw}`);
    }
  });

  it('rejects redirect-bait on a foreign domain', () => {
    const res = validateSocialUrl('https://evil.com?redirect=facebook.com', 'facebook');
    assert.deepEqual(res, { ok: false, code: 'wrong_domain' });
  });

  it('rejects dangerous protocols outright', () => {
    for (const raw of [
      'javascript:alert(1)',
      'javascript://facebook.com/%0aalert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'ftp://facebook.com/menu',
      'blob:https://facebook.com/x',
      'chrome://settings',
      'about:blank',
      'vbscript:msgbox(1)',
    ]) {
      const res = validateSocialUrl(raw, 'facebook');
      assert.equal(res.ok, false, `expected rejection for ${raw}`);
      assert.notEqual(
        (res as { code: string }).code,
        'wrong_domain',
        `${raw} must die on protocol/shape, not domain`,
      );
    }
  });

  it('rejects credential spoofing (real host hidden behind @)', () => {
    for (const raw of [
      'https://facebook.com@evil.com/page',
      'https://user:pass@facebook.com/page',
    ]) {
      const res = validateSocialUrl(raw, 'facebook');
      assert.equal(res.ok, false, `expected rejection for ${raw}`);
    }
  });

  it('rejects malformed and oversized values', () => {
    assert.equal(validateSocialUrl('https://', 'facebook').ok, false);
    assert.equal(validateSocialUrl('not a url at all', 'facebook').ok, false);
    assert.equal(validateSocialUrl(`https://facebook.com/${'a'.repeat(400)}`, 'facebook').ok, false);
  });

  it('does not allow one platform link in another platform field', () => {
    const res = validateSocialUrl('https://instagram.com/crown', 'facebook');
    assert.deepEqual(res, { ok: false, code: 'wrong_domain' });
  });

  it('rejects trailing-dot host tricks against the allow-list', () => {
    // "facebook.com." (FQDN dot) normalises to facebook.com and passes;
    // "facebook.com.evil.com." stays evil.
    assert.equal(validateSocialUrl('https://facebook.com./page', 'facebook').ok, true);
    assert.equal(validateSocialUrl('https://facebook.com.evil.com./p', 'facebook').ok, false);
  });
});

describe('validateWebsiteUrl', () => {
  it('accepts normal http(s) sites', () => {
    assert.equal(validateWebsiteUrl('https://crown-restaurant.com').ok, true);
    assert.equal(validateWebsiteUrl('http://example.org/menu?lang=ar').ok, true);
    assert.equal(validateWebsiteUrl('my-restaurant.com/about').ok, true);
  });

  it('rejects every non-http protocol', () => {
    for (const raw of ['javascript:alert(1)', 'data:text/html,x', 'file:///x', 'ftp://x.com']) {
      assert.equal(validateWebsiteUrl(raw).ok, false, `expected rejection for ${raw}`);
    }
  });

  it('rejects credentials and dotless hosts', () => {
    assert.equal(validateWebsiteUrl('https://safe.com@evil.com').ok, false);
    assert.equal(validateWebsiteUrl('https://localhost/admin').ok, false);
    assert.equal(validateWebsiteUrl('https://intranet').ok, false);
  });
});
