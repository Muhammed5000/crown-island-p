import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidIdNumber, idColumns } from './national-id';

describe('isValidIdNumber', () => {
  it('accepts a national id of exactly 14 digits', () => {
    assert.equal(isValidIdNumber('national', '12345678901234'), true);
    assert.equal(isValidIdNumber('national', '1234567890123'), false); // 13
    assert.equal(isValidIdNumber('national', '123456789012345'), false); // 15
    assert.equal(isValidIdNumber('national', '1234567890123a'), false); // non-digit
  });

  it('strips all whitespace before validating', () => {
    assert.equal(isValidIdNumber('national', '  12345678901234  '), true);
    assert.equal(isValidIdNumber('national', '1234 5678 9012 34'), true);
  });

  it('accepts a passport of 5–15 alphanumerics only', () => {
    assert.equal(isValidIdNumber('passport', 'A1234'), true);
    assert.equal(isValidIdNumber('passport', 'ABC12345XYZ'), true);
    assert.equal(isValidIdNumber('passport', '1234'), false); // 4, too short
    assert.equal(isValidIdNumber('passport', 'ABCDEFGHIJKLMNOP'), false); // 16, too long
    assert.equal(isValidIdNumber('passport', 'AB-123'), false); // hyphen not allowed
  });
});

describe('idColumns', () => {
  it('populates exactly one column and strips whitespace', () => {
    assert.deepEqual(idColumns('national', ' 12345678901234 '), {
      nationalId: '12345678901234',
      passportId: null,
    });
    assert.deepEqual(idColumns('passport', ' A1234 '), {
      nationalId: null,
      passportId: 'A1234',
    });
  });
});
