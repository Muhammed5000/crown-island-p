import { setRequestLocale } from 'next-intl/server';
import { isLocale } from '@/i18n/config';
import { adminListZkCards, adminZkCardStats } from '@/server/services/admin-zk-cards';
import { ZkCardsManager } from './ZkCardsManager';

interface Props {
  params: Promise<{ locale: string }>;
}

/**
 * Admin management of the ZKBio physical-card pool (`/admin/zk-cards`).
 *
 * Register the card numbers the resort owns; the provisioner auto-assigns a free
 * card to each confirmed ZK (cabin) booking and releases it when the booking ends.
 */
export default async function AdminZkCardsPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const [cards, stats] = await Promise.all([adminListZkCards(), adminZkCardStats()]);

  return (
    <div className="space-y-4">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-gold-600">
          CROWN · ADMIN
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-foreground md:text-3xl">
          Access cards
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
          The pool of physical ZKBio cards. Register the numbers the resort owns; the system
          auto-assigns a free card to each confirmed cabin booking (services flagged “requires
          access control”) and releases it when the booking ends. Retire lost cards so they are
          never handed out again.
        </p>
        <div className="rule-gold mt-5 max-w-[260px]" />
      </header>

      <ZkCardsManager
        stats={stats}
        cards={cards.map((c) => ({
          id: c.id,
          cardNo: c.cardNo,
          label: c.label,
          isActive: c.isActive,
          assignedBookingRef: c.assignedBooking?.reference ?? null,
          assignedBookingStatus: c.assignedBooking?.status ?? null,
          assignedGuest: c.assignedBooking?.guestName ?? null,
          assignedAt: c.assignedAt ? c.assignedAt.toISOString() : null,
        }))}
      />
    </div>
  );
}
