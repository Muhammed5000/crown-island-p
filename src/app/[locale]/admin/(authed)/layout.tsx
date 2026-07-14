import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { AdminShell } from '@/components/layout/AdminShell';
import { Card, CardBody } from '@/components/ui/Card';
import { requireAdminOrNull } from '@/server/auth/guards';
import { assertTermsAccepted } from '@/server/auth/terms';
import { assertRefundPolicyAccepted } from '@/server/auth/refund-policy';
import { isLocale } from '@/i18n/config';

interface Props {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

/**
 * Root layout for /admin/**.
 *
 * - Unauthenticated → redirect to /admin/login (handled inside `requireAdminOrNull`).
 * - Authenticated but not admin → render an inline 403 panel instead of bouncing
 *   the user through the login loop. They can see exactly why they're blocked.
 * - Admin → render the full AdminShell with the requested page inside.
 */
export default async function AdminLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  await assertTermsAccepted(locale);
  await assertRefundPolicyAccepted(locale);

  const admin = await requireAdminOrNull();

  if (!admin) {
    const t = await getTranslations('admin');
    return (
      <main className="grid min-h-dvh place-items-center bg-background p-6">
        <Card variant="glass" className="w-full max-w-md">
          <CardBody className="space-y-4 text-center">
            <p className="font-display text-xl font-bold text-gold-600">403</p>
            <h1 className="text-base font-semibold text-foreground">{t('dashboard')}</h1>
            <p className="text-sm text-muted-foreground">
              You are signed in, but this account does not have admin access.
            </p>
            <Link
              href="/"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground"
            >
              ←
            </Link>
          </CardBody>
        </Card>
      </main>
    );
  }

  return (
    <AdminShell
      user={{ name: admin.name ?? null, email: admin.email ?? null, role: admin.role }}
    >
      {children}
    </AdminShell>
  );
}
