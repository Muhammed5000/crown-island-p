import 'server-only';
import { Resend } from 'resend';
import type { EmailMessage, EmailProvider } from './provider';

/**
 * Resend-backed email provider.
 *
 * Reads the API key from `RESEND_API_KEY` and the sender identity from
 * `RESEND_FROM_EMAIL` (default `onboarding@resend.dev`, the unverified-sandbox
 * sender that Resend gives every account so you can ship without owning a
 * domain). For production you'd verify a real domain in the Resend dashboard
 * and set `RESEND_FROM_EMAIL=noreply@your-domain.com`.
 *
 * Errors from the Resend API are re-thrown so the caller (the server action)
 * can decide what to do — the auth actions currently let them bubble up to
 * the route, which logs them as `internal_error`. That's the right default:
 * a failed send shouldn't silently look like success.
 */
export class ResendProvider implements EmailProvider {
  private readonly client: Resend;
  private readonly from: string;

  constructor(apiKey: string, from?: string) {
    this.client = new Resend(apiKey);
    this.from = from || 'Crown Island <onboarding@resend.dev>';
  }

  async send(message: EmailMessage): Promise<void> {
    const result = await this.client.emails.send({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      // Resend accepts either text or html; we keep both populated when present.
      ...(message.html ? { html: message.html } : {}),
    });

    if (result.error) {
      // Surface the real error class + name so dev can see what Resend complained about.
      const err = new Error(
        `Resend send failed: ${result.error.name} — ${result.error.message}`,
      );
      err.name = 'ResendError';
      throw err;
    }
  }
}
