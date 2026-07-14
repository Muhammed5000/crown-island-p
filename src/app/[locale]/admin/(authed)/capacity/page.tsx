import { setRequestLocale, getTranslations } from 'next-intl/server';
import { prisma } from '@/server/db/prisma';
import { isLocale } from '@/i18n/config';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { toIsoDate, formatDate } from '@/lib/date';
import { TicketIcon, HomeIcon, CalendarIcon, LayoutGridIcon } from 'lucide-react';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ sid?: string; date?: string }>;
}

export default async function CapacityPreviewPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const sp = await searchParams;
  const sid = sp.sid;
  const dateStr = sp.date ?? toIsoDate(new Date());
  const date = new Date(dateStr);
  const [categories, selectedService] = await Promise.all([
    prisma.category.findMany({
      include: {
        services: {
          select: { id: true, nameEn: true, slug: true, kind: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { sortOrder: 'asc' },
    }),    sid ? prisma.service.findUnique({
      where: { id: sid },
      include: {
        places: {
          where: { isActive: true },
          orderBy: [{ gridY: 'asc' }, { gridX: 'asc' }, { position: 'asc' }, { label: 'asc' }],
        },
      },
    }) : null,
  ]);

  const tServ = await getTranslations('services');

  // If no service is selected, show a beautiful categorized picker.
  if (!selectedService) {
    return (
      <div className="space-y-8 animate-fade-in">
        <header className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-gold-600">
            <LayoutGridIcon className="size-5" />
            <span className="text-[10px] font-bold uppercase tracking-[0.3em]">Operational Dashboard</span>
          </div>
          <h1 className="font-display text-4xl font-black tracking-tight text-foreground">Capacity Preview</h1>
          <p className="text-muted-foreground text-[15px] max-w-lg">
            Monitor real-time occupancy and booking density across all experiences. Select a service to view the detailed seating chart.
          </p>
        </header>

        <div className="grid gap-8">
          {categories.map((category) => (
            <section key={category.id} className="space-y-4">
              <div className="flex items-center gap-4">
                <h2 className="font-display text-xl font-bold text-gold-600 shrink-0">
                  {locale === 'ar' ? category.nameAr : category.nameEn}
                </h2>
                <div className="h-px flex-1 bg-gradient-to-r from-gold-400/20 to-transparent" />
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {category.services.map((s) => (
                  <Link 
                    key={s.id} 
                    href={`/admin/capacity?sid=${s.id}&date=${dateStr}`}
                    className="group"
                  >
                    <Card className="h-full border-border bg-card transition-all duration-300 group-hover:border-gold-400/40 group-hover:bg-gold-400/[0.03] group-hover:-translate-y-1 group-active:scale-[0.98]">
                      <CardBody className="p-5 flex flex-col gap-4">
                        <div className="flex justify-between items-start">
                          <div className="size-10 rounded-xl bg-muted flex items-center justify-center text-gold-600 group-hover:bg-gold-400/10 transition-colors">
                            {s.kind === 'DAY_USE' && <CalendarIcon className="size-5" />}
                            {s.kind === 'CABANA' && <HomeIcon className="size-5" />}
                            {s.kind === 'EVENT' && <TicketIcon className="size-5" />}
                            {s.kind === 'OTHER' && <LayoutGridIcon className="size-5" />}
                          </div>
                          <Badge tone="gold" className="opacity-80">
                            {(() => {
                              const k = s.kind.toLowerCase();
                              if (k === 'day_use') return tServ('dayUse');
                              return tServ(k as 'cabana' | 'event' | 'other');
                            })()}
                          </Badge>
                        </div>
                        
                        <div>
                          <h3 className="font-bold text-foreground text-lg leading-tight group-hover:text-foreground transition-colors">
                            {s.nameEn}
                          </h3>
                          <p className="text-xs text-muted-foreground mt-1 uppercase tracking-widest font-medium">
                            Click to view chart →
                          </p>
                        </div>
                      </CardBody>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    );
  }

  // ── Real occupancy for the selected day ──────────────────────────────────────
  // Driven by BookingUnit (one row per physical unit per day), so the chart
  // reflects the actual party→units split, the actual assigned places, and
  // multi-day bookings (which have a unit row for every day they cover).
  const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
  const nextDay = new Date(dayStart.getTime() + 86_400_000);
  const placeRequired = selectedService.placeAssignmentRequired && selectedService.places.length > 0;

  const [units, slot] = await Promise.all([
    prisma.bookingUnit.findMany({
      where: {
        date: { gte: dayStart, lt: nextDay },
        booking: { serviceId: selectedService.id, status: 'CONFIRMED' },
      },
      include: { booking: { select: { id: true, reference: true, guestName: true } } },
      orderBy: [{ unitIndex: 'asc' }],
    }),
    prisma.bookingSlot.findUnique({
      where: { serviceId_date: { serviceId: selectedService.id, date: dayStart } },
    }),
  ]);

  // Map placeId → booking reference for the assigned units.
  const placedRef = new Map<string, string>();
  const placedBookingId = new Map<string, string>();
  for (const u of units)
    if (u.placeId) {
      placedRef.set(u.placeId, u.booking.reference);
      placedBookingId.set(u.placeId, u.booking.id);
    }
  const unplaced = units.filter((u) => !u.placeId).length;

  // Real ceiling: the explicit daily cap, else (for place-required services) the
  // physical place count — a genuine limit. A non-place service with no cap is
  // truly UNLIMITED (null); never fabricate a fake "100" the sell engine doesn't
  // enforce. `hasCap` drives whether we show a finite Available figure.
  const capacityNum =
    selectedService.dailyCapacityPeople ?? (placeRequired ? selectedService.places.length : null);
  const hasCap = capacityNum != null;
  // Authoritative booked count from the confirmed slot counter (units for
  // non-EVENT, people for EVENT) — falls back to the unit count.
  const totalBooked = slot?.reservedPeople ?? units.length;
  const gridSize = hasCap ? Math.max(capacityNum, totalBooked) : totalBooked;
  const occupancyPct = hasCap && capacityNum > 0 ? Math.min(100, (totalBooked / capacityNum) * 100) : 0;

  // Build the cell list. For place-required services each cell IS a real place
  // (gold when a confirmed unit is assigned to it). Confirmed bookings that have
  // not been given a place yet ("awaiting placement" — the normal state for an
  // online booking before reception check-in) used to light NO cell at all, so a
  // fully-booked day looked empty on the map even though the summary counted them.
  // We now surface those on the next free cells in amber so the chart reflects the
  // real occupancy. Non-place services keep the generic numbered-slot fill.
  const unplacedUnits = units.filter((u) => !u.placeId);
  let awaitingFilled = 0;
  const chairs: Array<{
    id: string;
    label: string;
    reference?: string;
    /** The booking that holds this cell — clicking the cell opens it. */
    bookingId?: string;
    status: 'booked' | 'awaiting' | 'available';
  }> = placeRequired
    ? selectedService.places.map((p) => {
        if (placedRef.has(p.id)) {
          return {
            id: p.id,
            label: p.label,
            reference: placedRef.get(p.id),
            bookingId: placedBookingId.get(p.id),
            status: 'booked' as const,
          };
        }
        // No unit pinned to this place — borrow the next free cell to surface an
        // as-yet-unplaced booking so it isn't invisible on the chart.
        const pending =
          awaitingFilled < unplacedUnits.length ? unplacedUnits[awaitingFilled++] : undefined;
        return {
          id: p.id,
          label: p.label,
          reference: pending?.booking.reference,
          bookingId: pending?.booking.id,
          status: pending ? ('awaiting' as const) : ('available' as const),
        };
      })
    : Array.from({ length: gridSize }, (_, i) => {
        // Generic slots map 1:1 to the day's booked units (ordered by unitIndex),
        // so slot i resolves to that unit's booking when one exists.
        const unit = i < totalBooked ? units[i] : undefined;
        return {
          id: `slot-${i}`,
          label: String(i + 1),
          reference: unit?.booking.reference,
          bookingId: unit?.booking.id,
          status: (i < totalBooked ? 'booked' : 'available') as 'booked' | 'available',
        };
      });

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
           <Link href="/admin/capacity" className="text-xs text-gold-600 hover:text-gold-700 mb-2 inline-block">← Back to selection</Link>
           <h1 className="font-display text-3xl font-bold text-foreground">{selectedService.nameEn}</h1>
           <p className="text-muted-foreground text-sm mt-1">Viewing capacity for <span className="text-foreground font-bold">{formatDate(date, locale as 'en' | 'ar', { dateStyle: 'full' })}</span></p>
        </div>

        <div className="flex items-center gap-3">
           <form className="flex items-center gap-2">
              <input type="hidden" name="sid" value={selectedService.id} />
              <input 
                type="date" 
                name="date" 
                defaultValue={dateStr}
                className="bg-input border border-border rounded-xl px-3 h-10 text-foreground text-sm focus:ring-1 focus:ring-accent outline-none"
              />
              <Button type="submit" variant="primary" size="sm">Go</Button>
           </form>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="md:col-span-1 h-fit">
          <CardHeader>
            <h3 className="font-bold text-sm text-gold-600 uppercase tracking-widest">Summary</h3>
          </CardHeader>
          <CardBody className="space-y-4">
             <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Total Capacity</span>
                <span className="text-lg font-bold text-foreground">{hasCap ? capacityNum : 'Unlimited'}</span>
             </div>
             <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Booked Slots</span>
                <span className="text-lg font-bold text-gold-600">{totalBooked}</span>
             </div>
             <div className="flex justify-between items-center border-t border-border pt-4">
                <span className="text-sm text-muted-foreground">Available</span>
                <span className="text-lg font-bold text-green-700">{hasCap ? Math.max(0, capacityNum - totalBooked) : '—'}</span>
             </div>
             {placeRequired && unplaced > 0 ? (
                <div className="flex justify-between items-center">
                   <span className="text-sm text-muted-foreground">Awaiting placement</span>
                   <span className="text-lg font-bold text-amber-700">{unplaced}</span>
                </div>
             ) : null}

             <div className="mt-6 space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                   <div className="size-3 rounded-sm bg-gold-400 shadow-[0_0_8px_rgba(212,165,87,0.4)]" />
                   <span>Booked &amp; placed</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                   <div className="size-3 rounded-sm bg-amber-400/90 ring-1 ring-amber-300/60" />
                   <span>Awaiting placement</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                   <div className="size-3 rounded-sm bg-muted border border-border" />
                   <span>Available Slot</span>
                </div>
             </div>
          </CardBody>
        </Card>

        <Card className="md:col-span-3 overflow-hidden" variant="glass">
          <CardHeader className="flex items-center justify-between border-b border-border pb-4">
             <h3 className="font-bold text-sm text-gold-600 uppercase tracking-widest">Top-Down View (Entrance)</h3>
             <div className="h-1.5 w-32 bg-gold-400/20 rounded-full overflow-hidden">
                <div className="h-full bg-gold-400" style={{ width: `${occupancyPct}%` }} />
             </div>
          </CardHeader>
          <CardBody className="p-10 flex flex-col items-center">
             {/* The "Screen" or Entrance */}
             <div className="w-full max-w-2xl h-1.5 bg-gradient-to-r from-transparent via-gold-400/50 to-transparent rounded-full mb-16 shadow-[0_8px_20px_-4px_rgba(212,165,87,0.3)]" />

             {/* The Chairs Grid */}
             <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-3">
                {chairs.map((chair) => {
                  const booked = chair.status === 'booked';
                  const awaiting = chair.status === 'awaiting';
                  const occupied = booked || awaiting;
                  const cellClass = cn(
                    "group relative size-8 sm:size-10 flex items-center justify-center rounded-lg text-[10px] font-bold transition-all duration-300",
                    booked && "bg-gold-500 text-navy-950 shadow-[0_4px_12px_rgba(212,165,87,0.4)] scale-105",
                    awaiting &&
                      "bg-amber-400/90 text-navy-950 shadow-[0_4px_12px_rgba(245,158,11,0.35)] ring-1 ring-amber-300/60",
                    !occupied &&
                      "bg-muted border border-border text-muted-foreground/50 hover:border-gold-400/30 hover:text-gold-700",
                    chair.bookingId &&
                      "cursor-pointer hover:z-10 hover:ring-2 hover:ring-gold-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300"
                  );
                  const stateLabel = awaiting ? 'awaiting placement' : 'booked';
                  const title = occupied
                    ? `${chair.label} · ${chair.reference ?? stateLabel}${awaiting ? ' · awaiting placement' : ''}${chair.bookingId ? ' · click to open booking' : ''}`
                    : `${chair.label} · available`;
                  const inner = (
                    <>
                      {chair.label.length > 3 ? chair.label.slice(0, 3) : chair.label}

                      {occupied && (
                        <div className="absolute -top-10 left-1/2 -translate-x-1/2 px-2 py-1 bg-card border border-gold-400/40 rounded text-[9px] text-gold-700 opacity-0 group-hover:opacity-100 transition-opacity z-50 whitespace-nowrap pointer-events-none shadow-xl">
                          {chair.reference ?? chair.label}
                          {awaiting ? ' · awaiting' : ''}
                          {chair.bookingId ? ' →' : ''}
                        </div>
                      )}

                      {/* Armrests effect */}
                      <div className="absolute -left-1 top-2 bottom-2 w-0.5 bg-foreground/15 rounded-full" />
                      <div className="absolute -right-1 top-2 bottom-2 w-0.5 bg-foreground/15 rounded-full" />
                    </>
                  );

                  // Booked cells with a known booking open it; everything else
                  // (available slots, un-mappable cells) stays a static tile.
                  return chair.bookingId ? (
                    <Link key={chair.id} href={`/admin/bookings/${chair.bookingId}`} title={title} className={cellClass}>
                      {inner}
                    </Link>
                  ) : (
                    <div key={chair.id} title={title} className={cellClass}>
                      {inner}
                    </div>
                  );
                })}
             </div>

             <div className="mt-20 w-full text-center">
                <p className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground/40 font-bold">— Back of House —</p>
             </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
