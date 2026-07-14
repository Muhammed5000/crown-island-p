import 'server-only';

/**
 * Crédit Agricole Egypt card acquiring via Mastercard Payment Gateway Services
 * (MPGS) — Hosted Checkout config helpers.
 *
 * Card data is entered on Mastercard's hosted form (Lightbox popup) and never
 * touches our server. Auth is HTTP Basic with username `merchant.{MERCHANT_ID}`.
 *
 * Required env (never hardcode secrets):
 *   MPGS_GATEWAY_HOST  — e.g. https://test-gateway.mastercard.com (prod differs)
 *   MPGS_MERCHANT_ID   — e.g. TestCaeMer03
 *   MPGS_PASSWORD      — API password (from the Entrust app). SECRET.
 * Optional:
 *   MPGS_VERSION       — API version (default '59')
 *   MPGS_CURRENCY      — default 'EGP'
 *   MPGS_MERCHANT_NAME — shown on the payment form (default 'Crown Island')
 *
 * Accessors throw `MpgsNotConfiguredError` rather than read undefined env vars,
 * so the rest of the app keeps booting in dev when the secrets are blank.
 */

export interface MpgsConfig {
  gatewayHost: string;
  version: string;
  merchantId: string;
  password: string;
  currency: string;
  merchantName: string;
  /** {host}/api/rest/version/{version}/merchant/{merchantId} */
  baseUrl: string;
  /** HTTP Basic header: merchant.{merchantId} : password */
  authHeader: string;
  /** {host}/static/checkout/checkout.min.js */
  checkoutScriptUrl: string;
}

export class MpgsNotConfiguredError extends Error {
  readonly code = 'mpgs_not_configured';
  constructor() {
    super(
      'MPGS credentials are not set. Add MPGS_GATEWAY_HOST, MPGS_MERCHANT_ID and MPGS_PASSWORD to your .env.',
    );
    this.name = 'MpgsNotConfiguredError';
  }
}

export function getMpgsConfig(): MpgsConfig {
  const gatewayHostRaw = process.env.MPGS_GATEWAY_HOST?.trim();
  const merchantId = process.env.MPGS_MERCHANT_ID?.trim();
  const password = process.env.MPGS_PASSWORD;

  if (!gatewayHostRaw || !merchantId || !password) {
    throw new MpgsNotConfiguredError();
  }

  const gatewayHost = gatewayHostRaw.replace(/\/+$/, '');
  const version = process.env.MPGS_VERSION?.trim() || '59';
  const currency = process.env.MPGS_CURRENCY?.trim() || 'EGP';
  const merchantName = process.env.MPGS_MERCHANT_NAME?.trim() || 'Crown Island';

  const baseUrl = `${gatewayHost}/api/rest/version/${version}/merchant/${merchantId}`;
  // Username carries the literal `merchant.` prefix per the MPGS contract.
  const authHeader =
    'Basic ' + Buffer.from(`merchant.${merchantId}:${password}`, 'utf8').toString('base64');
  const checkoutScriptUrl = `${gatewayHost}/static/checkout/checkout.min.js`;

  return {
    gatewayHost,
    version,
    merchantId,
    password,
    currency,
    merchantName,
    baseUrl,
    authHeader,
    checkoutScriptUrl,
  };
}

/** MPGS amounts are decimal major units as a string, e.g. 30000 piastres → "300.00". */
export function formatMpgsAmount(minorUnits: number): string {
  return (minorUnits / 100).toFixed(2);
}
