'use client';

import dynamic from 'next/dynamic';
import { Card, CardBody } from '@/components/ui/Card';

const BookingMap = dynamic(
  () => import('@/components/map/BookingMap').then((m) => m.BookingMap),
  {
    ssr: false,
    loading: () => (
      <Card>
        <CardBody className="h-[50dvh] animate-pulse rounded-3xl bg-muted/40" />
      </Card>
    ),
  },
);

export function MapClient({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-border/60">
      <BookingMap lat={lat} lng={lng} label={label} />
    </div>
  );
}
