import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { prisma } from '@/server/db/prisma';
import { adminListPlaces } from '@/server/services/admin-places';
import { isLocale } from '@/i18n/config';
import { Link } from '@/i18n/navigation';
import { PlacesManager } from './PlacesManager';

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

/**
 * Per-service place inventory admin (`/admin/services/[id]/places`).
 *
 * Lists the physical places reception/gate can assign and lets the admin add
 * them singly or in numbered batches. The booking flow only requires assignment
 * when the service has `placeAssignmentRequired` — but places can be defined for
 * any service regardless.
 */
export default async function ServicePlacesPage({ params }: Props) {
  const { locale, id } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const service = await prisma.service.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      nameEn: true,
      placeType: true,
      placeAssignmentRequired: true,
      requiresAccessControl: true,
    },
  });
  if (!service) notFound();

  const places = await adminListPlaces(id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-semibold text-foreground">
          places · {service.nameEn}
        </h1>
        <Link
          href={`/admin/services/${id}/edit`}
          className="text-sm text-gold-600 underline-offset-4 hover:underline"
        >
          ← back to service
        </Link>
      </div>

      {!service.placeAssignmentRequired ? (
        <div className="rounded-2xl border border-warning/20 bg-warning/5 p-4 text-sm text-warning">
          Place assignment is currently <strong>not required</strong> for this service. You can
          still define places here; enable “require place assignment” on the service to use them at
          the gate.
        </div>
      ) : null}

      <PlacesManager
        serviceId={id}
        defaultType={service.placeType}
        requiresAccessControl={service.requiresAccessControl}
        places={places.map((p) => ({
          id: p.id,
          label: p.label,
          type: p.type,
          zone: p.zone,
          position: p.position,
          gridX: p.gridX,
          gridY: p.gridY,
          isActive: p.isActive,
          isHandicap: p.isHandicap,
          zkAccessLevelId: p.zkAccessLevelId,
          zkDoorLabel: p.zkDoorLabel,
          inUse: p._count.units > 0,
          outages: p.outages.map((o) => ({
            id: o.id,
            startsAt: o.startsAt.toISOString(),
            endsAt: o.endsAt.toISOString(),
            reason: o.reason,
          })),
        }))}
      />
    </div>
  );
}
