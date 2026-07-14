import { setRequestLocale, getTranslations } from 'next-intl/server';
import { redirect, Link } from '@/i18n/navigation';
import { Card, CardBody } from '@/components/ui/Card';
import { CrownLogo } from '@/components/brand/CrownLogo';
import { AdminLoginForm } from './AdminLoginForm';
import { getSessionUser } from '@/server/auth/guards';
import { canAccessAdmin } from '@/server/auth/roles';
import { safeRedirectPath } from '@/lib/auth/safe-redirect';
import { isLocale } from '@/i18n/config';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ denied?: string; next?: string }>;
}

/**
 * Admin sign-in page.
 *
 * - Already admin → bounce straight to /admin (or `?next=`).
 * - Signed in but NOT admin → show "this account isn't an admin" message
 *   alongside the credentials form so they can sign in with a different
 *   admin account without first signing out.
 * - Not signed in → render the email/password form.
 *
 * NOTE: This page lives OUTSIDE the `(authed)` route group so it does NOT
 * inherit the admin-only layout — no redirect loop is possible.
 */
export default async function AdminLoginPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const sp = await searchParams;
  const user = await getSessionUser();
  // Sanitise the post-login destination — `next` is attacker-controllable.
  const safeNext = safeRedirectPath(sp.next);

  // If they're already a valid admin, skip the form. Use the SAME role policy
  // as the real admin guard (`canAccessAdmin` → ADMIN/SUPER_ADMIN/DEVELOPER) so
  // the login redirect never disagrees with it — STAFF is not admin, and
  // DEVELOPER is (the old inline check had both wrong).
  if (user && canAccessAdmin(user.role)) {
    redirect({ href: safeNext || '/admin', locale });
  }

  const tAuth = await getTranslations('auth');

  const initialError = sp.denied
    ? tAuth('invalidCredentials')
    : null;

  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6">
      <Card variant="glass" className="w-full max-w-md">
        <CardBody className="space-y-5">
          <div className="flex justify-center">
            <CrownLogo size="md" />
          </div>
          <div className="space-y-1 text-center">
            <h1 className="font-display text-xl font-bold text-gold-700">
              {tAuth('adminSignInTitle')}
            </h1>
            <p className="text-sm text-muted-foreground">{tAuth('adminSignInSubtitle')}</p>
          </div>

          {user ? (
            <p className="rounded-xl border border-gold-400/30 bg-gold-400/10 px-3 py-2 text-center text-xs text-gold-700">
              Signed in as{' '}
              <span dir="ltr" className="text-foreground">
                {user.email ?? user.name ?? user.id}
              </span>{' '}
              — this account doesn&apos;t have admin access.
            </p>
          ) : null}

          <AdminLoginForm next={safeNext} initialError={initialError} />

          <p className="border-t border-border pt-4 text-center text-xs text-muted-foreground">
            <Link href="/" className="text-gold-600 underline-offset-4 hover:underline">
              ←
            </Link>
          </p>
        </CardBody>
      </Card>
    </main>
  );
}
