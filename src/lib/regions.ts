/**
 * Egyptian governorates — the option set for the required "User Region" profile
 * field. The stored value is the English name (stable, displayable everywhere
 * without a lookup); the Arabic label is shown to ar-locale users in the select.
 */
export interface RegionOption {
  /** Stored value (English governorate name). */
  value: string;
  ar: string;
}

export const EGYPT_REGIONS: RegionOption[] = [
  { value: 'Cairo', ar: 'القاهرة' },
  { value: 'Giza', ar: 'الجيزة' },
  { value: 'Alexandria', ar: 'الإسكندرية' },
  { value: 'Dakahlia', ar: 'الدقهلية' },
  { value: 'Red Sea', ar: 'البحر الأحمر' },
  { value: 'Beheira', ar: 'البحيرة' },
  { value: 'Fayoum', ar: 'الفيوم' },
  { value: 'Gharbia', ar: 'الغربية' },
  { value: 'Ismailia', ar: 'الإسماعيلية' },
  { value: 'Menofia', ar: 'المنوفية' },
  { value: 'Minya', ar: 'المنيا' },
  { value: 'Qaliubiya', ar: 'القليوبية' },
  { value: 'New Valley', ar: 'الوادي الجديد' },
  { value: 'Suez', ar: 'السويس' },
  { value: 'Aswan', ar: 'أسوان' },
  { value: 'Assiut', ar: 'أسيوط' },
  { value: 'Beni Suef', ar: 'بني سويف' },
  { value: 'Port Said', ar: 'بورسعيد' },
  { value: 'Damietta', ar: 'دمياط' },
  { value: 'Sharkia', ar: 'الشرقية' },
  { value: 'South Sinai', ar: 'جنوب سيناء' },
  { value: 'Kafr El Sheikh', ar: 'كفر الشيخ' },
  { value: 'Matrouh', ar: 'مطروح' },
  { value: 'Luxor', ar: 'الأقصر' },
  { value: 'Qena', ar: 'قنا' },
  { value: 'North Sinai', ar: 'شمال سيناء' },
  { value: 'Sohag', ar: 'سوهاج' },
];

const REGION_VALUES = new Set(EGYPT_REGIONS.map((r) => r.value));

/** True when `value` is one of the known Egyptian governorate names. */
export function isValidRegion(value: string): boolean {
  return REGION_VALUES.has(value);
}

/** Localized label for a stored region value (falls back to the raw value). */
export function regionLabel(value: string | null | undefined, locale: 'ar' | 'en'): string {
  if (!value) return '';
  if (locale !== 'ar') return value;
  return EGYPT_REGIONS.find((r) => r.value === value)?.ar ?? value;
}
