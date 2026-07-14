import 'server-only';
import type { EmailMessage, EmailProvider } from './provider';

/**
 * Mock email provider for development.
 *
 * Doesn't send a real email — prints a clearly-bordered block to the dev
 * server terminal so the developer can copy the verification / reset link
 * out of stdout. The block includes the tag, recipient, subject, and the
 * plain-text body (where the link lives), making it easy to scan.
 */
export class MockEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    const ts = new Date().toISOString();
    const tag = message.tag ? `[${message.tag}]` : '[email]';
    const banner = '─'.repeat(64);
    // The body carries verification / reset / magic-link URLs. Print it only in
    // development; if the mock is ever active in production (Resend unconfigured)
    // redact it so account-recovery links never land in server logs.
    const isProd = process.env.NODE_ENV === 'production';
    const lines = [
      '\n' + banner,
      `✉  ${tag}  ${ts}`,
      `   to:      ${message.to}`,
      `   subject: ${message.subject}`,
      banner,
      isProd ? '   [body redacted in production]' : message.text,
      banner + '\n',
    ];
    // Print as a single multiline payload so it's easy to find in the dev log.
    console.log(lines.join('\n'));
  }
}
