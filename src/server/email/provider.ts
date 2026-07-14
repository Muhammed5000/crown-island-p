import 'server-only';
import { MockEmailProvider } from './mock';
import { ResendProvider } from './resend';

/**
 * Email-sending interface.
 *
 * Two concrete implementations:
 *   - `MockEmailProvider` (dev): prints the message + link to the dev terminal.
 *     Also lets the server action expose the link back to the browser so
 *     local testing doesn't need a real email account.
 *   - `ResendProvider` (prod-ready): sends real email via the Resend API.
 *     Activated whenever `RESEND_API_KEY` is set in the environment.
 *
 * Adding another provider later (SendGrid, SES, SMTP) is a one-file change in
 * `getEmailProvider()`. Callsites never know which implementation is active.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body — required so links remain copyable from any client. */
  text: string;
  /** Optional HTML body. */
  html?: string;
  /** Tag stored alongside the log line — `verify-email`, `reset-password`, etc. */
  tag?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

/**
 * True when the active provider is the dev console mock. The auth server
 * actions use this to decide whether to forward the verification link back
 * to the browser as a convenience for local testing — never in production.
 */
export function isUsingMockProvider(): boolean {
  // Tied to the same heuristic as `getEmailProvider()`. When RESEND_API_KEY
  // is set we use the real ResendProvider; otherwise we fall back to the
  // dev mock so local testing keeps working without external dependencies.
  return !process.env.RESEND_API_KEY;
}

let cached: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (cached) return cached;

  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    cached = new ResendProvider(apiKey, process.env.RESEND_FROM_EMAIL);
  } else {
    // Dev fallback — prints the link to the `npm run dev` terminal AND lets
    // the LoginForm / ForgotPasswordForm surface the link in the browser so
    // you can click straight through without setting up Resend.
    cached = new MockEmailProvider();
  }
  return cached;
}
