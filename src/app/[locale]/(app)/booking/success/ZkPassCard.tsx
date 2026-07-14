'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { KeyRoundIcon, Loader2Icon } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';

interface Pass {
  status: 'none' | 'pending' | 'provisioned' | 'failed' | 'revoked';
  cardNo: string | null;
  qr: string | null;
}

/**
 * Cabin (ZK) access pass — shown IN ADDITION to the resort-gate QR for bookings
 * of services flagged “requires access control”. Fetches the door QR + card
 * number from the owner-scoped `/zk-pass` route and polls briefly while
 * provisioning is still catching up. Renders nothing for non-ZK bookings.
 */
export function ZkPassCard({ bookingId }: { bookingId: string }) {
  const t = useTranslations('booking');
  const [pass, setPass] = useState<Pass | null>(null);

  useEffect(() => {
    let cancelled = false;
    let tries = 0;

    async function load() {
      try {
        const res = await fetch(`/api/bookings/${bookingId}/zk-pass`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as Pass;
        if (cancelled) return;
        setPass(data);
        // Keep polling while the card/QR isn't ready yet (ZK catching up).
        const notReady = data.status === 'pending' || (data.status === 'provisioned' && !data.qr);
        if (notReady && tries < 10) {
          tries += 1;
          setTimeout(load, 3000);
        }
      } catch {
        /* transient — ignore, the interval or a reload retries */
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  // Hide entirely for non-ZK bookings, torn-down access, or hard failures.
  if (!pass || pass.status === 'none' || pass.status === 'revoked' || pass.status === 'failed') {
    return null;
  }

  const ready = !!pass.qr || !!pass.cardNo;

  return (
    <Card variant="glass" className="overflow-hidden">
      <CardBody className="flex flex-col items-center gap-4 p-6 text-center">
        <div className="flex items-center gap-2 text-gold-700">
          <KeyRoundIcon className="size-5" />
          <h2 className="font-display text-lg font-semibold text-foreground">{t('zkPassTitle')}</h2>
        </div>
        <p className="text-sm text-muted-foreground">{t('zkPassSubtitle')}</p>

        {pass.qr ? (
          <div className="rounded-2xl bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pass.qr} alt={t('zkQrCaption')} className="size-44" />
          </div>
        ) : (
          <div className="grid size-44 place-items-center rounded-2xl bg-muted/40">
            <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {pass.cardNo ? (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t('zkCardLabel')}</p>
            <p dir="ltr" className="font-mono text-base font-semibold text-gold-700">
              {pass.cardNo}
            </p>
          </div>
        ) : null}

        {!ready || pass.status === 'pending' ? (
          <p className="text-xs text-muted-foreground">{t('zkPassPending')}</p>
        ) : null}
      </CardBody>
    </Card>
  );
}
