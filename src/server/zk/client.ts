import 'server-only';
import { prisma } from '@/server/db/prisma';

/**
 * ZKBio CVSecurity connection config — assembled from the admin-editable Settings
 * row (server URL / port / dept / enable switch) and the SECRET API token in env.
 *
 * The token is NEVER stored in the DB and NEVER sent to the client — it lives in
 * `ZK_ACCESS_TOKEN` only. Accessors throw `ZkNotConfiguredError` (rather than
 * fall back to an undefined URL/token) so the rest of the app keeps working when
 * the integration is off or not yet configured.
 *
 *   Settings.zkEnabled       — master switch (admin)
 *   Settings.zkServerUrl     — scheme+host, e.g. https://192.168.1.100
 *   Settings.zkServerPort    — e.g. 8098
 *   Settings.zkGuestDeptCode — dept code for guest persons (default "GUESTS")
 *   env ZK_ACCESS_TOKEN      — SECRET API client token
 *   env ZK_API_TIMEOUT_MS    — per-request timeout (default 15000)
 */

const SETTINGS_ID = 'default';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_DEPT_CODE = 'GUESTS';

export interface ZkConfig {
  /** Origin only, no trailing slash, e.g. "https://192.168.1.100:8098". */
  baseUrl: string;
  /** SECRET API token, appended as `access_token` on every call. */
  accessToken: string;
  /** Department code guest persons are created under. */
  guestDeptCode: string;
  /** Per-request timeout in ms. */
  timeoutMs: number;
}

export class ZkNotConfiguredError extends Error {
  readonly code = 'zk_not_configured';
  constructor(reason: string) {
    super(`ZK integration is not configured: ${reason}`);
    this.name = 'ZkNotConfiguredError';
  }
}

/**
 * Build the base origin from the admin URL + optional port, validating that it is
 * a well-formed http(s) URL. Rejects anything else (SSRF hygiene: outbound calls
 * only ever go to the exact origin an admin configured).
 */
export function buildZkBaseUrl(serverUrl: string, serverPort: number | null): string {
  let url: URL;
  try {
    url = new URL(serverUrl.trim());
  } catch {
    throw new ZkNotConfiguredError('server URL is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ZkNotConfiguredError('server URL must be http(s)');
  }
  if (serverPort != null) {
    if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65_535) {
      throw new ZkNotConfiguredError('server port is out of range');
    }
    url.port = String(serverPort);
  }
  // Discard any path/query/hash — we only want the origin.
  return url.origin;
}

/**
 * Reads the ZK config or throws `ZkNotConfiguredError`. Reads Settings directly
 * (not the React-cached `getSettings`) so it is safe to call from background jobs
 * (the reconciler) that run outside a request context.
 */
export async function getZkConfig(): Promise<ZkConfig> {
  const accessToken = process.env.ZK_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    throw new ZkNotConfiguredError('ZK_ACCESS_TOKEN env var is not set');
  }

  const s = await prisma.settings.findUnique({
    where: { id: SETTINGS_ID },
    select: {
      zkEnabled: true,
      zkServerUrl: true,
      zkServerPort: true,
      zkGuestDeptCode: true,
    },
  });

  if (!s?.zkEnabled) {
    throw new ZkNotConfiguredError('integration is disabled in Settings');
  }
  if (!s.zkServerUrl?.trim()) {
    throw new ZkNotConfiguredError('server URL is not set in Settings');
  }

  const baseUrl = buildZkBaseUrl(s.zkServerUrl, s.zkServerPort ?? null);

  const timeoutRaw = Number(process.env.ZK_API_TIMEOUT_MS);
  const timeoutMs =
    Number.isFinite(timeoutRaw) && timeoutRaw >= 1_000 && timeoutRaw <= 60_000
      ? timeoutRaw
      : DEFAULT_TIMEOUT_MS;

  return {
    baseUrl,
    accessToken,
    guestDeptCode: s.zkGuestDeptCode?.trim() || DEFAULT_DEPT_CODE,
    timeoutMs,
  };
}

/** Cheap check used by the reconciler to skip work when ZK is off/unconfigured. */
export async function isZkConfigured(): Promise<boolean> {
  try {
    await getZkConfig();
    return true;
  } catch {
    return false;
  }
}
