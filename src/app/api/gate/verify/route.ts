import { getSessionUser } from '@/server/auth/guards';
import { GATE_ROLES, canViewGateMoney } from '@/server/auth/roles';
import { readVisitByScan } from '@/server/services/gate-scan';
import { apiError, apiOk, parseJsonBody } from '@/server/http/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/gate/verify
 *
 * Body: { token?: string, reference?: string, locale?: 'ar' | 'en' }
 *
 * Resolves a scanned value to the customer's DAILY VISIT GROUP — every booking
 * that customer made for the day — plus a `pass` (the group's primary booking)
 * for the scanner's card. One resolver accepts every shape: signed visit
 * tokens (all new QRs), legacy signed per-booking tokens, raw visit codes
 * ("V-…" barcodes) and booking references ("CI-…" bracelets / manual entry).
 * Staff-only. Returns 200 even for `invalid`/`used` verdicts so the UI can
 * render the deny/override states — only an unknown/forged value yields 404.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return apiError('unauthorized', 401);
  if (!GATE_ROLES.has(user.role)) return apiError('forbidden', 403);

  const body = await parseJsonBody<{ token?: string; reference?: string; locale?: string }>(request);
  if (!body) return apiError('bad_request', 400);

  const locale = body.locale === 'ar' ? 'ar' : 'en';
  // SECURITY operators never receive money fields (see canViewGateMoney).
  const includeMoney = canViewGateMoney(user.role);

  const scanned = body.token?.trim() || body.reference?.trim();
  const group = scanned ? await readVisitByScan(scanned, locale, includeMoney) : null;

  if (!group) return apiError('not_found', 404);
  // `pass` keeps the original single-pass contract; `visit` adds the group.
  return apiOk({ pass: group.primary, visit: group.visit });
}
