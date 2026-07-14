import 'server-only';
import { NextResponse } from 'next/server';
import { DomainError } from '@/server/services/errors';
import { log, errFields } from '@/lib/log';

/**
 * Shared JSON response helpers for App-Router route handlers.
 *
 * Every route hand-rolled `NextResponse.json({ error }, { status })` and its own
 * `try { await req.json() } catch { 400 }`. These centralise the shape so a route
 * body reads as intent (guard → parse → work → respond) and a thrown DomainError
 * maps to its typed http status/code in one place.
 *
 * The response CONTRACT is unchanged: `apiError` still emits `{ error: <code> }`
 * with the given status, matching what clients already parse.
 */

/** `{ error: code }` with the given HTTP status. */
export function apiError(code: string, status: number): NextResponse {
  return NextResponse.json({ error: code }, { status });
}

/** Success body (defaults to 200). */
export function apiOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

/**
 * Parse a JSON request body, returning `null` on malformed JSON so the caller can
 * `return apiError('bad_request', 400)` — a 1:1 replacement for the hand-rolled
 * `try/catch` guard.
 */
export async function parseJsonBody<T = unknown>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Map a thrown value to a response: a typed DomainError becomes its own
 * `httpStatus`/`code`; anything else is logged and returned as a generic 500.
 */
export function respondError(err: unknown): NextResponse {
  if (err instanceof DomainError) {
    return apiError(err.code, err.httpStatus);
  }
  log.error('unhandled route error', errFields(err));
  return apiError('internal_error', 500);
}
