import { setRequestLocale } from 'next-intl/server';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { isLocale } from '@/i18n/config';
import { requireAdmin } from '@/server/auth/guards';
import { getRoleDiscountLimits } from '@/server/services/staff-discount';
import { DiscountLimitsForm } from './DiscountLimitsForm';

interface Props {
  params: Promise<{ locale: string }>;
}

export default async function DiscountsPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);
  await requireAdmin();

  const limits = await getRoleDiscountLimits();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Discount limits</h1>
        <p className="text-sm text-muted-foreground">
          The maximum manual discount each reception role can authorize with their PIN at the desk.
          Admin tiers always reach 100%.
        </p>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-foreground">Per-role ceilings</h2>
        </CardHeader>
        <CardBody>
          <DiscountLimitsForm limits={limits} />
        </CardBody>
      </Card>

      <Card variant="outline">
        <CardBody className="space-y-2 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">How the desk override works</p>
          <p>
            At reception, a staffer picks a custom discount and enters an authorizer&rsquo;s PIN.
            The booking is then recorded as made by that authorizer, and the discount is capped to
            their role&rsquo;s ceiling above.
          </p>
          <p>
            Set a staff member&rsquo;s PIN (and assign their role: Staff → Supervisor → Manager →
            Director) on the <span className="font-medium text-foreground">Users</span> page.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
