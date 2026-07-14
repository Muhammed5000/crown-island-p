import { getCountries, getCountryCallingCode, type CountryCode } from 'libphonenumber-js';

export interface CountryOption {
  code: CountryCode;
  callingCode: string;
  name: string;
  flag: string;
}

// Helper to convert country code (e.g., 'US') to emoji flag
function getFlagEmoji(countryCode: string) {
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });

// Pin collation to a fixed locale. A bare `localeCompare()` uses the runtime's
// default locale, so the server (Node) and an Arabic-locale browser order the
// list differently — the Nth <option> becomes a different country on each side,
// and its flag/text mismatches at hydration. A fixed `en` collator (ICU/CLDR on
// both Node and browsers) guarantees one identical, deterministic order.
const collator = new Intl.Collator('en');

export const COUNTRY_OPTIONS: CountryOption[] = getCountries()
  .map((code) => ({
    code,
    callingCode: getCountryCallingCode(code),
    name: displayNames.of(code) ?? code,
    flag: getFlagEmoji(code),
  }))
  .sort((a, b) => collator.compare(a.name, b.name));
