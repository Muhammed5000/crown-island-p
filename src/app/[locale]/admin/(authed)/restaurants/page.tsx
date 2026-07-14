import { setRequestLocale } from 'next-intl/server';
import { FileTextIcon, UtensilsIcon } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Card, CardBody } from '@/components/ui/Card';
import { requireAdmin } from '@/server/auth/guards';
import { adminListRestaurants } from '@/server/services/restaurants';
import { isLocale } from '@/i18n/config';

const STATUS_TONE: Record<string, BadgeTone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  DISABLED: 'muted',
};

/** Admin: all partner restaurants with owner + moderation status. */
export default async function AdminRestaurantsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);
  await requireAdmin();

  const restaurants = await adminListRestaurants();
  const pendingCount = restaurants.filter((r) => r.status === 'PENDING').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Restaurants</h1>
        <p className="text-sm text-muted-foreground">
          Partner restaurant profiles. New and edited rejected profiles arrive as{' '}
          <strong>pending</strong> and become visible to guests only once approved.
          {pendingCount > 0 ? ` ${pendingCount} awaiting review.` : ''}
        </p>
      </div>

      <Card>
        <CardBody className="overflow-x-auto p-0">
          {restaurants.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-5 py-14 text-center text-sm text-muted-foreground">
              <UtensilsIcon className="size-8 text-gold-400/50" strokeWidth={1.5} />
              No restaurant profiles yet. Assign a user the <Badge tone="gold">RESTAURANT</Badge>{' '}
              role from Users — they can then create their profile from the app.
            </div>
          ) : (
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-start">Restaurant</th>
                  <th className="px-4 py-3 text-start">Owner</th>
                  <th className="px-4 py-3 text-start">Phone</th>
                  <th className="px-4 py-3 text-start">Menu</th>
                  <th className="px-4 py-3 text-start">Status</th>
                  <th className="px-4 py-3 text-start">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {restaurants.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/restaurants/${r.id}`}
                        className="font-medium text-foreground underline-offset-4 hover:text-gold-700 hover:underline"
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <p>{r.owner.name ?? '—'}</p>
                      <p className="text-xs">{r.owner.email ?? r.owner.phone ?? r.ownerId}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground" dir="ltr">
                      {r.phone}
                    </td>
                    <td className="px-4 py-3">
                      {r.menuPdfUrl ? (
                        <a
                          href={r.menuPdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-gold-600 underline-offset-4 hover:underline"
                        >
                          <FileTextIcon className="size-3.5" />
                          PDF
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONE[r.status] ?? 'muted'}>{r.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.createdAt.toISOString().slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
