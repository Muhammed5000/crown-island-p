import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Conditional className builder that also dedupes conflicting Tailwind utilities.
 *   cn('px-4', condition && 'px-6')  →  'px-6'
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
