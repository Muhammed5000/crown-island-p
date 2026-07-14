import 'server-only';
import { NextResponse } from 'next/server';

/**
 * ───────────────────────────────────────────────────────────────────────────
 * TEMPORARILY DISABLED: Mobile application API delivery is currently disabled.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Master kill-switch for every `/api/mobile/**` endpoint — the Crown Island
 * mobile (Expo) app's bearer-token API namespace. While `MOBILE_API_DISABLED`
 * is `true`, each mobile route short-circuits at the very top of its handler
 * and returns the uniform 503 below instead of delivering live data. The
 * original handler logic is preserved untouched behind the guard — nothing was
 * deleted and the change is fully reversible.
 *
 * Scope: ONLY `/api/mobile/**`. The website, admin panel, gate tooling and the
 * web auth/booking APIs are intentionally unaffected.
 *
 * ── TO RE-ENABLE THE MOBILE API LATER ──
 *   Flip the single switch below back to `false`:
 *       export const MOBILE_API_DISABLED = false;
 *   (Optionally also remove the guard line from each route file — search the
 *    codebase for "TEMPORARILY DISABLED" or "MOBILE_API_DISABLED".)
 *
 * Disabled by request:
 *   "disable all the api that deliver to mobile application comment it for now
 *    until we enable it later"
 */

// Annotated as `boolean` (not the literal `true`) on purpose: this keeps the
// code AFTER each `if (MOBILE_API_DISABLED) return …` guard reachable for the
// type-checker and linter, so every preserved handler still compiles cleanly
// and no imports are reported as unused / no `no-unreachable` errors are raised.
// Re-enabling the whole mobile API is therefore a one-line change right here.
export const MOBILE_API_DISABLED: boolean = true;

/**
 * Uniform "temporarily disabled" response returned by every mobile endpoint
 * while {@link MOBILE_API_DISABLED} is on.
 *
 * 503 Service Unavailable is the correct status for a temporarily-off service;
 * the `Retry-After` hint asks clients to back off rather than hammer the route.
 */
export function mobileApiDisabled(): NextResponse {
  return NextResponse.json(
    { success: false, message: 'Mobile API is temporarily disabled.' },
    { status: 503, headers: { 'Retry-After': '3600' } },
  );
}
