'use client';

import { useEffect, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2Icon, LockIcon, MailIcon } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import {
  AppleIcon,
  FacebookIcon,
  GoogleIcon,
} from '@/components/brand/ProviderIcons';
import {
  requestEmailVerification,
  signInWithEmail,
  signInWithProvider,
} from '@/features/auth/actions';
import { cn } from '@/lib/cn';

interface Props {
  enabledProviders: { google: boolean; facebook: boolean; apple: boolean };
  next?: string;
}

type Mode = 'choose' | 'email-magic' | 'email-magic-sent' | 'email-password';

/**
 * Social-provider button — restyled to match the Mediterranean Luxe direction.
 * Tactile lift on hover, focus-ring honored.
 */
function SocialBtn({
  label,
  bg,
  color,
  bordered,
  icon,
  onClick,
  loading,
  disabled,
  type = 'button',
}: {
  label: string;
  bg: string;
  color: string;
  bordered?: boolean;
  icon: ReactNode;
  onClick?: () => void;
  loading?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        'flex h-[54px] w-full items-center justify-center gap-2.5 rounded-xl px-4 text-sm font-semibold',
        'transition-[transform,box-shadow] duration-200 ease-out',
        'hover:-translate-y-px hover:shadow-[0_12px_28px_-10px_rgba(0,0,0,0.45)]',
        'active:translate-y-0 active:scale-[0.985]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        bordered && 'border-[1.5px] border-gold-400/40 hover:border-gold-500',
      )}
      style={{ background: bg, color }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function LoginForm({ enabledProviders, next }: Props) {
  const t = useTranslations('auth');
  const tCommon = useTranslations('common');
  const [mode, setMode] = useState<Mode>('choose');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Countdown the resend cooldown so the button feels alive.
  useEffect(() => {
    if (cooldown <= 0) return;
    const handle = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1_000);
    return () => clearTimeout(handle);
  }, [cooldown]);

  function handleOAuth(provider: 'google' | 'facebook' | 'apple') {
    startTransition(async () => {
      try {
        await signInWithProvider(provider, next);
      } catch (err) {
        if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err;
        setError(tCommon('error'));
      }
    });
  }

  async function submitMagicLink(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setRetryAfter(null);
    startTransition(async () => {
      const res = await requestEmailVerification({ email });
      if (!res.ok) {
        if (res.code === 'invalid_email') setError(t('invalidEmail'));
        else if (res.code === 'rate_limited') {
          setRetryAfter(res.retryAfter ?? null);
          setError(t('rateLimited', { time: res.retryAfter ?? '' }));
        } else if (res.code === 'email_send_failed') {
          setError(
            'We could not deliver the verification email right now. Please try again in a moment.',
          );
        }
        return;
      }
      setCooldown(res.cooldownSeconds);
      setMode('email-magic-sent');
    });
  }

  async function submitPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await signInWithEmail({ email, password, next });
      if (!res.ok) {
        setError(t('invalidCredentials'));
      }
      // signIn throws NEXT_REDIRECT on success — handled inside the action.
    });
  }

  return (
    <div className="space-y-3">
      {/* ─────── Step: choose method ─────── */}
      {mode === 'choose' ? (
        <div className="space-y-3 stagger">
          {enabledProviders.google ? (
            <SocialBtn
              label={t('continueWithGoogle')}
              bg="#ffffff"
              color="#1f1f1f"
              icon={<GoogleIcon size={18} />}
              onClick={() => handleOAuth('google')}
              loading={isPending}
            />
          ) : null}

          {enabledProviders.facebook ? (
            <SocialBtn
              label={t('continueWithFacebook')}
              bg="#1877F2"
              color="#ffffff"
              icon={<FacebookIcon size={20} />}
              onClick={() => handleOAuth('facebook')}
              loading={isPending}
            />
          ) : null}

          {enabledProviders.apple ? (
            <SocialBtn
              label={t('continueWithApple')}
              bg="#ffffff"
              color="#000000"
              icon={<AppleIcon size={16} />}
              onClick={() => handleOAuth('apple')}
              loading={isPending}
            />
          ) : null}

          {enabledProviders.google || enabledProviders.facebook || enabledProviders.apple ? (
            <div className="flex items-center gap-3 py-3">
              <span className="h-px flex-1 bg-gradient-to-r from-transparent via-gold-400/40 to-transparent" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-gold-600">
                {t('or')}
              </span>
              <span className="h-px flex-1 bg-gradient-to-l from-transparent via-gold-400/40 to-transparent" />
            </div>
          ) : null}

          <SocialBtn
            label={t('continueWithEmail')}
            bg="transparent"
            color="rgb(var(--ci-foreground))"
            bordered
            icon={<MailIcon size={18} />}
            onClick={() => {
              setError(null);
              setMode('email-magic');
            }}
          />

          {/* "Already have an account? Sign in" — kicks straight into password mode */}
          <p className="pt-1 text-center text-[12px] text-muted-foreground">
            {t('haveAccount')}{' '}
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode('email-password');
              }}
              className="font-semibold text-gold-600 underline-offset-4 transition-colors hover:text-gold-700 hover:underline"
            >
              {t('signInLink')}
            </button>
          </p>
        </div>
      ) : null}

      {/* ─────── Step: enter email to receive magic link ─────── */}
      {mode === 'email-magic' ? (
        <form className="space-y-3" onSubmit={submitMagicLink}>
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
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="md" onClick={() => setMode('choose')}>
              {tCommon('back')}
            </Button>
            <Button type="submit" variant="primary" size="md" fullWidth loading={isPending}>
              {t('send')}
            </Button>
          </div>

          <p className="pt-2 text-center text-[12px] text-muted-foreground">
            {t('haveAccount')}{' '}
            <button
              type="button"
              onClick={() => setMode('email-password')}
              className="font-semibold text-gold-600 underline-offset-4 transition-colors hover:text-gold-700 hover:underline"
            >
              {t('signInLink')}
            </button>
          </p>
        </form>
      ) : null}

      {/* ─────── Step: confirmation that link was sent ─────── */}
      {mode === 'email-magic-sent' ? (
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

          {cooldown > 0 ? (
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              {t('resendIn', { time: formatCooldown(cooldown) })}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => {
                setMode('email-magic');
                setError(null);
              }}
            >
              {tCommon('back')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="md"
              fullWidth
              disabled={cooldown > 0 || isPending}
              loading={isPending}
              onClick={() => {
                startTransition(async () => {
                  const res = await requestEmailVerification({ email });
                  if (res.ok) {
                    setCooldown(res.cooldownSeconds);
                    setError(null);
                  } else if (res.code === 'rate_limited') {
                    setRetryAfter(res.retryAfter ?? null);
                    setError(t('rateLimited', { time: res.retryAfter ?? '' }));
                  } else if (res.code === 'email_send_failed') {
                    setError(
                      'We could not deliver the verification email right now. Please try again in a moment.',
                    );
                  }
                });
              }}
            >
              {cooldown > 0 ? formatCooldown(cooldown) : t('send')}
            </Button>
          </div>
        </div>
      ) : null}

      {/* ─────── Step: email + password sign in (existing user) ─────── */}
      {mode === 'email-password' ? (
        <form className="space-y-3" onSubmit={submitPassword}>
          <Field
            hint={t('email')}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            dir="ltr"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            trailing={<MailIcon className="size-4" />}
          />
          <Field
            hint={t('password')}
            name="password"
            type="password"
            autoComplete="current-password"
            dir="ltr"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('passwordPlaceholder')}
            trailing={<LockIcon className="size-4" />}
          />

          <div className="flex items-center justify-between text-[12px]">
            <button
              type="button"
              onClick={() => setMode('choose')}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {tCommon('back')}
            </button>
            <Link
              href="/auth/forgot-password"
              className="font-semibold text-gold-600 underline-offset-4 transition-colors hover:text-gold-700 hover:underline"
            >
              {t('forgotPassword')}
            </Link>
          </div>

          <Button type="submit" variant="primary" size="lg" fullWidth loading={isPending}>
            {t('signIn')}
          </Button>

          <p className="pt-2 text-center text-[12px] text-muted-foreground">
            {t('noAccount')}{' '}
            <button
              type="button"
              onClick={() => setMode('email-magic')}
              className="font-semibold text-gold-600 underline-offset-4 transition-colors hover:text-gold-700 hover:underline"
            >
              {t('createAccount')}
            </button>
          </p>
        </form>
      ) : null}

      {/* Inline error pill — shared across modes */}
      {error ? (
        <p
          className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-center text-sm text-danger"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {/* Hidden — retain retryAfter in scope for accessibility tools / future telemetry */}
      <span className="sr-only" aria-live="polite">
        {retryAfter ?? ''}
      </span>
    </div>
  );
}

function formatCooldown(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
