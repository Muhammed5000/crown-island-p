import { type NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/server/auth/guards';
import { exportDatabase, importDatabase } from '@/server/services/backup';
import { log, errFields } from '@/lib/log';

/**
 * Database backup endpoint — DEVELOPER-only.
 *  - GET  → streams a full JSON export as a file download.
 *  - POST → additively imports a previously-exported JSON file.
 *
 * Both verify the DEVELOPER role directly (rather than the redirecting guard)
 * so the responses stay machine-readable for the admin UI.
 */
export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

async function requireDeveloperJson() {
  const user = await getSessionUser().catch(() => null);
  if (!user || user.role !== 'DEVELOPER') return null;
  return user;
}

export async function GET() {
  const user = await requireDeveloperJson();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const exportedAt = new Date().toISOString();
  const backup = await exportDatabase(exportedAt);
  const body = JSON.stringify(backup, null, 2);
  const stamp = exportedAt.slice(0, 19).replace(/[:T]/g, '-');

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="crown-island-backup-${stamp}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}

export async function POST(req: NextRequest) {
  const user = await requireDeveloperJson();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'The uploaded file is not valid JSON.' }, { status: 400 });
  }

  try {
    const result = await importDatabase(payload);
    log.info('backup import', { userId: user.id, inserted: result.totalInserted });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed.';
    log.error('backup import failed', errFields(err));
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
