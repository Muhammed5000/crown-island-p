import 'server-only';
import { getZkConfig } from './client';
import { ZkApiError, zkErrorMessage } from './errors';
import { log, errFields } from '@/lib/log';
import { fetchWithTimeout } from '@/lib/fetch-timeout';

/**
 * Low-level ZKBio CVSecurity REST wrappers — the ONLY place that performs
 * outbound HTTP to the ZK server. Every call:
 *   - is backend-only (`server-only`);
 *   - appends the SECRET `access_token` from config (never logged, never returned);
 *   - has a hard timeout;
 *   - parses the `{ code, message, data }` envelope and throws `ZkApiError` on a
 *     negative code (transport failures throw a plain Error).
 *
 * Only the handful of endpoints this integration actually needs are implemented.
 */

interface ZkEnvelope<T> {
  code: number;
  message?: string;
  data?: T;
}

type QueryValue = string | number | undefined | null;

async function zkFetch<T>(
  path: string,
  opts: {
    method: 'GET' | 'POST' | 'DELETE';
    query?: Record<string, QueryValue>;
    body?: unknown;
  },
): Promise<T> {
  const config = await getZkConfig();

  const url = new URL(config.baseUrl + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  // Auth rides on every call as a query param, per the ZK contract.
  url.searchParams.set('access_token', config.accessToken);

  let res: Response;
  try {
    res = await fetchWithTimeout(url, {
      method: opts.method,
      headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      timeoutMs: config.timeoutMs,
      cache: 'no-store',
    });
  } catch (err) {
    // Timeout / DNS / connection refused — transport failure (transient).
    log.error('zk transport error', { method: opts.method, path, ...errFields(err) });
    throw new Error(`zk_transport_error:${(err as Error).name}`);
  }

  if (!res.ok) {
    // A proxy/gateway error (non-2xx). Body may not be JSON; keep it short.
    const text = await res.text().catch(() => '');
    log.error('zk HTTP error', { method: opts.method, path, status: res.status, body: text.slice(0, 200) });
    throw new Error(`zk_http_${res.status}`);
  }

  let envelope: ZkEnvelope<T>;
  try {
    envelope = (await res.json()) as ZkEnvelope<T>;
  } catch {
    log.error('zk returned non-JSON body', { method: opts.method, path });
    throw new Error('zk_bad_response');
  }

  if (typeof envelope.code !== 'number') {
    log.error('zk envelope missing code', { method: opts.method, path });
    throw new Error('zk_bad_response');
  }

  if (envelope.code < 0) {
    throw new ZkApiError(envelope.code, zkErrorMessage(envelope.code, envelope.message), path);
  }

  return envelope.data as T;
}

// ── Person ───────────────────────────────────────────────────────────────────

export interface ZkPersonInput {
  /** Personnel id / universal person key. */
  pin: string;
  deptCode: string;
  name: string;
  /** Card number to bind (empty string clears; omit to keep existing). */
  cardNo?: string;
  /** Comma-separated access-level-group ids to grant. */
  accLevelIds?: string;
  /** Access window bounds, "yyyy-MM-dd HH:mm:ss" in ZK-server-local time. */
  accStartTime?: string;
  accEndTime?: string;
}

/** Create or edit a person (upsert by `pin`). Binds card + levels + window. */
export async function personAdd(input: ZkPersonInput): Promise<void> {
  await zkFetch<unknown>('/api/person/add', { method: 'POST', body: input });
}

/** Delete a person by pin. Callers treat a `-22` (not found) as already-gone. */
export async function personDelete(pin: string): Promise<void> {
  await zkFetch<unknown>(`/api/person/delete/${encodeURIComponent(pin)}`, { method: 'DELETE' });
}

/** Fetch the person's dynamic door QR code (base64 string). */
export async function getPersonQrCode(pin: string): Promise<string> {
  const data = await zkFetch<string>(`/api/person/getQrCode/${encodeURIComponent(pin)}`, {
    method: 'POST',
    body: { pin },
  });
  return typeof data === 'string' ? data : String(data ?? '');
}

// ── Access levels ──────────────────────────────────────────────────────────--

/** Bind a person to one or more access-level groups (csv of level ids). */
export async function accLevelSyncPerson(pin: string, levelIds: string): Promise<void> {
  await zkFetch<unknown>('/api/accLevel/syncPerson', {
    method: 'POST',
    query: { pin, levelIds },
  });
}

/** Remove a person from one or more access-level groups (csv of level ids). */
export async function accLevelDeletePerson(pin: string, levelIds: string): Promise<void> {
  await zkFetch<unknown>('/api/accLevel/deleteLevel', {
    method: 'POST',
    query: { pin, levelIds },
  });
}

export interface ZkLevel {
  id: string;
  name: string;
}

/** List access-level groups (for the admin picker). */
export async function accLevelList(pageNo = 1, pageSize = 100): Promise<ZkLevel[]> {
  const data = await zkFetch<ZkLevel[]>('/api/accLevel/list', {
    method: 'GET',
    query: { pageNo, pageSize },
  });
  return Array.isArray(data) ? data : [];
}

// ── Department ─────────────────────────────────────────────────────────────--

/** Create/ensure the guest department exists (idempotent on the server). */
export async function departmentAdd(name: string, code: string): Promise<void> {
  await zkFetch<unknown>('/api/department/add', { method: 'POST', body: { name, code } });
}
