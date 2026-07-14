import { setRequestLocale } from 'next-intl/server';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { isLocale } from '@/i18n/config';
import { requireAdmin } from '@/server/auth/guards';
import { adminListPromos } from '@/server/services/admin-promos';
import { PromoForm } from './PromoForm';
import { PromoRowActions } from './PromoRowActions';

interface Props {
  params: Promise<{ locale: string }>;
}

function fmtDate(d: Date | null): string {
  return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

export default async function PromosPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);
  await requireAdmin();

  const promos = await adminListPromos();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Promo codes</h1>
        <p className="text-sm text-muted-foreground">
          Percentage discounts applied by reception staff at the desk. Each code can be limited to
          one use per customer, or allowed to be reused.
        </p>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-foreground">New code</h2>
        </CardHeader>
        <CardBody>
          <PromoForm />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-foreground">All codes</h2>
        </CardHeader>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-start">Code</th>
                  <th className="px-4 py-3 text-start">Discount</th>
                  <th className="px-4 py-3 text-start">Window</th>
                  <th className="px-4 py-3 text-start">Used</th>
                  <th className="px-4 py-3 text-start">Per customer</th>
                  <th className="px-4 py-3 text-start">Status</th>
                  <th className="px-4 py-3 text-end">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {promos.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                      No promo codes yet. Create one above.
                    </td>
                  </tr>
                ) : (
                  promos.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <span className="font-mono font-semibold text-foreground">{p.code}</span>
                        {p.description && (
                          <span className="block text-xs text-muted-foreground">{p.description}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-foreground">{p.percentOff}%</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {fmtDate(p.startsAt)} → {fmtDate(p.endsAt)}
                      </td>
                      <td className="px-4 py-3 text-foreground">
                        {p._count.redemptions}
                        {p.maxRedemptions != null ? ` / ${p.maxRedemptions}` : ' / ∞'}
                      </td>
                      <td className="px-4 py-3">
                        {p.oncePerCustomer ? (
                          <span className="text-xs text-muted-foreground">Once</span>
                        ) : (
                          <Badge tone="info">Reusable</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={p.isActive ? 'success' : 'muted'}>
                          {p.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <PromoRowActions promoId={p.id} isActive={p.isActive} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
