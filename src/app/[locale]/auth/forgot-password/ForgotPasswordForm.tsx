'use client';

import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2Icon, MailIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { requestPasswordReset } from '@/features/auth/actions';

export function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const tCommon = useTranslations('common');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** Dev-only: server-provided reset URL when no real email provider is wired. */
  const [devLink, setDevLink] = useState<string | null>(null);
  /** True when the configured provider failed to send and we degraded. */
  const [providerDegraded, setProviderDegraded] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (cooldown <= 0) return;
    const h = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1_000);
    return () => clearTimeout(h);
  }, [cooldown]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setDevLink(null);
    setProviderDegraded(false);
    startTransition(async () => {
      const res = await requestPasswordReset({ email });
      if (!res.ok) {
        if (res.code === 'invalid_email') setError(t('invalidEmail'));
        else if (res.code === 'rate_limited') setError(t('rateLimited', { time: res.retryAfter ?? '' }));
        else if (res.code === 'email_send_failed') {
          setError('We could not deliver the reset email right now. Please try again in a moment.');
        } else setError(tCommon('error'));
        return;
      }
      setCooldown(res.cooldownSeconds);
      setDevLink(res.devLink ?? null);
      setProviderDegraded(!!res.providerDegraded);
      setSent(true);
    });
  }

  if (sent) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-gold-400/15 text-gold-600 ring-1 ring-gold-400/30">
          <CheckCircle2Icon className="size-7" strokeWidth={1.75} />
        </div>
        <div className="space-y-1">
          <p className="font-display text-lg font-semibold text-foreground">{t('linkSent')}</p>
          <p className="mx-auto max-w-xs text-sm text-muted-foreground">{t('linkSentBody')}</p>
          <p dir="ltr" className="pt-2 font-display text-sm tracking-[0.06em] text-gold-600">
            {email}
          </p>
        </div>

        {/* Dev-mode jump panel. See LoginForm.tsx for the full rationale. */}
        {devLink ? (
          <div
            className={
              'space-y-2 rounded-2xl border p-3 text-start ' +
              (providerDegraded
                ? 'border-amber-500/40 bg-amber-500/[0.1]'
                : 'border-gold-400/30 bg-gold-400/[0.1]')
            }
          >
            <p
              className={
                'text-[10px] font-semibold uppercase tracking-[0.22em] ' +
                (providerDegraded ? 'text-amber-700' : 'text-gold-700')
              }
            >
              {providerDegraded
                ? 'Email provider unreachable · using fallback'
                : 'Development shortcut'}
            </p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {providerDegraded
                ? 'The configured provider (Resend) could not send the email — likely a bad API key or blocked network. The link is shown here so you can keep developing. Check the dev terminal for the underlying error.'
                : 'Development mode — open this link to reset your password without waiting for the email to arrive in your inbox.'}
            </p>
            <a
              href={devLink}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gold-button px-4 py-2 text-[12px] font-bold uppercase tracking-[0.18em] text-ink shadow-gold transition-all hover:-translate-y-px"
            >
              Open reset link
            </a>
          </div>
        ) : null}

        {cooldown > 0 ? (
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            {t('resendIn', { time: formatCooldown(cooldown) })}
          </p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="md"
          fullWidth
          disabled={cooldown > 0 || isPending}
          loading={isPending}
          onClick={() => {
            startTransition(async () => {
              const res = await requestPasswordReset({ email });
              if (res.ok) {
                setCooldown(res.cooldownSeconds);
                setError(null);
                setDevLink(res.devLink ?? null);
                setProviderDegraded(!!res.providerDegraded);
              } else if (res.code === 'rate_limited') {
                setError(t('rateLimited', { time: res.retryAfter ?? '' }));
              } else if (res.code === 'email_send_failed') {
                setError('We could not deliver the reset email right now. Please try again in a moment.');
              }
            });
          }}
        >
          {cooldown > 0 ? formatCooldown(cooldown) : t('sendReset')}
        </Button>
        {error ? (
          <p
            className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-sm text-red-700"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form className="space-y-3" onSubmit={onSubmit}>
      <Field
        hint={t('email')}
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        dir="ltr"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        trailing={<MailIcon className="size-4" />}
      />
      <Button type="submit" variant="primary" size="lg" fullWidth loading={isPending}>
        {t('sendReset')}
      </Button>
      {error ? (
        <p
          className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-sm text-red-700"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}

function formatCooldown(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
