import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/**
 * Locale-aware wrappers for Next's navigation primitives.
 * Use these instead of `next/link` / `useRouter` inside the app router tree.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
