/**
 * Identity-document validation shared by every profile write path (web
 * `completeProfile`/profile-update actions and the mobile `me` / complete-profile
 * routes). Kept in one place so the "who is allowed to register" rule can never
 * drift between web and mobile.
 */

/** Egyptian National ID = 14 digits. Passport = 5–15 alphanumerics. */
export function isValidIdNumber(type: 'national' | 'passport', raw: string): boolean {
  const v = raw.replace(/\s/g, '');
  return type === 'national' ? /^\d{14}$/.test(v) : /^[A-Za-z0-9]{5,15}$/.test(v);
}

/** Map the form's idType/idNumber to the two profile columns (one is null). */
export function idColumns(idType: 'national' | 'passport', idNumber: string) {
  const value = idNumber.replace(/\s/g, '');
  return {
    nationalId: idType === 'national' ? value : null,
    passportId: idType === 'passport' ? value : null,
  };
}
