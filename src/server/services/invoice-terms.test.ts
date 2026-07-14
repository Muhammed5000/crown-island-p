import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveInvoiceTerms } from './invoice-terms';

const NO_GLOBAL = { termsEn: null, termsAr: null };

test('category terms win when present (English)', () => {
  const terms = resolveInvoiceTerms(
    { termsEn: ['No outside food', 'Check out by 6pm'], termsAr: ['ممنوع الطعام الخارجي'] },
    { termsEn: 'Some global rule', termsAr: 'قاعدة عامة' },
    'en',
  );
  assert.deepEqual(terms, ['No outside food', 'Check out by 6pm']);
});

test('category terms are locale-specific (Arabic)', () => {
  const terms = resolveInvoiceTerms(
    { termsEn: ['No outside food'], termsAr: ['ممنوع الطعام الخارجي', 'المغادرة قبل السادسة'] },
    NO_GLOBAL,
    'ar',
  );
  assert.deepEqual(terms, ['ممنوع الطعام الخارجي', 'المغادرة قبل السادسة']);
});

test('falls back to global Settings terms only when the category has none', () => {
  const terms = resolveInvoiceTerms(
    { termsEn: null, termsAr: null },
    { termsEn: 'Rule one\nRule two\n\nRule three', termsAr: null },
    'en',
  );
  assert.deepEqual(terms, ['Rule one', 'Rule two', 'Rule three']);
});

test('global fallback splits newlines and strips bullet prefixes', () => {
  const terms = resolveInvoiceTerms(
    { termsEn: [], termsAr: [] },
    { termsEn: '• First\n-   Second\n* Third', termsAr: null },
    'en',
  );
  assert.deepEqual(terms, ['First', 'Second', 'Third']);
});

test('an empty category array does NOT block the global fallback', () => {
  const terms = resolveInvoiceTerms({ termsEn: [], termsAr: [] }, { termsEn: 'Global', termsAr: null }, 'en');
  assert.deepEqual(terms, ['Global']);
});

test('returns [] when neither category nor global terms exist', () => {
  assert.deepEqual(resolveInvoiceTerms({ termsEn: null, termsAr: null }, NO_GLOBAL, 'en'), []);
  assert.deepEqual(resolveInvoiceTerms({ termsEn: undefined, termsAr: undefined }, NO_GLOBAL, 'ar'), []);
});

test('ignores non-string / blank entries in the category JSON', () => {
  const terms = resolveInvoiceTerms(
    { termsEn: ['  Keep me  ', '', 42, null, 'And me'], termsAr: null },
    NO_GLOBAL,
    'en',
  );
  assert.deepEqual(terms, ['Keep me', 'And me']);
});

test('falls back to global when the requested locale category terms are empty but the other locale has some', () => {
  // Arabic invoice, category only has English terms -> use global Arabic terms.
  const terms = resolveInvoiceTerms(
    { termsEn: ['English only'], termsAr: [] },
    { termsEn: 'EN global', termsAr: 'قاعدة عامة' },
    'ar',
  );
  assert.deepEqual(terms, ['قاعدة عامة']);
});
