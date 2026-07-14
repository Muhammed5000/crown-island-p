import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Card, CardBody } from '@/components/ui/Card';
import { UserForm } from '../UserForm';
import { createUserAction } from '@/features/admin/user-actions';
import { isLocale } from '@/i18n/config';
import { requireSuperAdmin } from '@/server/auth/guards';

interface Props {
  params: Promise<{ locale: string }>;
}

export default async function NewUserPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  await requireSuperAdmin();

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
          Create a new user account with a specific role.
        </p>
        <div className="rule-gold mt-5 max-w-[260px]" />
      </header>

      <Card>
        <CardBody className="p-6 md:p-8">
          <UserForm action={createUserAction} submitLabel={tCommon('save')} />
        </CardBody>
      </Card>
    </div>
  );
}
