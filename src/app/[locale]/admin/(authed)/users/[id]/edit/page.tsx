import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { UserForm } from '../../UserForm';
import { StaffPinForm } from './StaffPinForm';
import { updateUserAction } from '@/features/admin/user-actions';
import { prisma } from '@/server/db/prisma';
import { isLocale } from '@/i18n/config';
import { requireSuperAdmin } from '@/server/auth/guards';

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

export default async function EditUserPage({ params }: Props) {
  const { locale, id } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  await requireSuperAdmin();

  const user = await prisma.user.findUnique({
    where: { id },
  });

  if (!user) notFound();

  const t = await getTranslations('admin');
  const tCommon = await getTranslations('common');

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-gold-700/80">
          CROWN · ADMIN
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold text-gradient-gold md:text-4xl">
          {t('users')}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Edit user profile and permissions.
        </p>
        <div className="rule-gold mt-5 max-w-[260px]" />
      </header>

      <Card>
        <CardBody className="p-6 md:p-8">
          <UserForm
            initialValues={{
              name: user.name ?? undefined,
              email: user.email ?? undefined,
              phone: user.phone ?? undefined,
              role: user.role,
            }}
            action={updateUserAction.bind(null, id)}
            submitLabel={tCommon('save')}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-foreground">Reception override</h2>
        </CardHeader>
        <CardBody>
          <StaffPinForm userId={id} hasPin={!!user.pinHash} />
        </CardBody>
      </Card>
    </div>
  );
}
