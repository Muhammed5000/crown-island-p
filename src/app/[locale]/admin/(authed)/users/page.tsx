import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Edit2Icon, PlusIcon } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { prisma } from '@/server/db/prisma';
import { formatDate } from '@/lib/date';
import { isLocale } from '@/i18n/config';
import { requireSuperAdminOrNull } from '@/server/auth/guards';
import { Link } from '@/i18n/navigation';
import { DeleteUserButton } from './DeleteUserButton';
import { ErrorIllustration } from '@/components/ui/ErrorIllustration';
import { Pagination } from '@/components/ui/Pagination';

const ROLE_TONES: Record<string, 'gold' | 'navy' | 'muted' | 'info' | 'success' | 'danger'> = {
  DEVELOPER: 'danger',
  SUPER_ADMIN: 'gold',
  ADMIN: 'success',
  STAFF: 'info',
  SECURITY: 'navy',
  TESTER: 'info',
  CUSTOMER: 'muted',
};

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}

export default async function AdminUsersPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const admin = await requireSuperAdminOrNull();

  if (!admin) {
    const t = await getTranslations('admin');
    return (
      <div className="grid h-full place-items-center p-6">
        <Card variant="glass" className="w-full max-w-md">
          <CardBody className="space-y-6 flex flex-col items-center py-10 text-center">
            <ErrorIllustration type="forbidden" />
            <div className="space-y-2">
              <h1 className="font-display text-2xl font-bold text-gradient-gold uppercase tracking-wider">
                {t('users')}
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                This administrative sector is restricted to <strong>Super Admins</strong> only.
              </p>
            </div>
            <Link
              href="/admin"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-8 text-sm font-black text-primary-foreground shadow-sm transition-all hover:brightness-110 active:scale-95"
            >
              Return to Dashboard
            </Link>
          </CardBody>
        </Card>
      </div>
    );
  }

  const sp = await searchParams;
  const t = await getTranslations('admin');
  const tCommon = await getTranslations('common');

  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const pageSize = 50;

  // Exclude archived (soft-deleted) accounts from the staff/user list.
  const where = {
    deletedAt: null,
    ...(sp.q
      ? {
          OR: [
            { name: { contains: sp.q, mode: 'insensitive' as const } },
            { email: { contains: sp.q, mode: 'insensitive' as const } },
            { phone: { contains: sp.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      include: {
        _count: { select: { bookings: true } },
        profile: { select: { region: true, nationalId: true, passportId: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-gold-700">{t('users')}</h1>
        <Link
          href="/admin/users/new"
          className="inline-flex h-10 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          <PlusIcon className="size-4" />
          <span>{t('newUser')}</span>
        </Link>
      </header>

      <form className="flex items-center gap-2">
        <input
          type="text"
          name="q"
          defaultValue={sp.q ?? ''}
          placeholder={tCommon('search')}
          className="h-10 rounded-2xl border border-border/60 bg-input px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          type="submit"
          className="h-10 rounded-2xl bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          {tCommon('search')}
        </button>
      </form>

      <Card>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start">name</th>
                <th className="px-4 py-3 text-start">email</th>
                <th className="px-4 py-3 text-start">phone</th>
                <th className="px-4 py-3 text-start">ID / region</th>
                <th className="px-4 py-3 text-end">bookings</th>
                <th className="px-4 py-3 text-end">role</th>
                <th className="px-4 py-3 text-end">joined</th>
                <th className="px-4 py-3 text-end">actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">{u.name ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground" dir="ltr">
                    {u.email ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground" dir="ltr">
                    {u.phone ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    <span dir="ltr">{u.profile?.nationalId ?? u.profile?.passportId ?? '—'}</span>
                    {u.profile?.region ? <span className="block text-[11px]">{u.profile.region}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums">{u._count.bookings}</td>
                  <td className="px-4 py-3 text-end">
                    <Badge tone={ROLE_TONES[u.role] ?? 'muted'}>{u.role}</Badge>
                  </td>
                  <td className="px-4 py-3 text-end text-xs text-muted-foreground">
                    {formatDate(u.createdAt, locale)}
                  </td>
                  <td className="px-4 py-3 text-end">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`/admin/users/${u.id}/edit`}
                        className="inline-flex size-8 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground hover:bg-accent/15 hover:text-accent"
                        aria-label={tCommon('edit')}
                      >
                        <Edit2Icon className="size-4" />
                      </Link>
                      <DeleteUserButton userId={u.id} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Pagination
        currentPage={page}
        totalPages={Math.ceil(total / pageSize)}
        baseUrl="/admin/users"
        searchParams={sp}
      />
    </div>
  );
}
