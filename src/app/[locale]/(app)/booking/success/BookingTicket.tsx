'use client';

import { CrownIcon } from 'lucide-react';

interface Props {
  /** Tier / package chip (e.g. category name). */
  tier: string;
  reference: string;
  /** Whether the booking is confirmed and the QR is meaningful. */
  confirmed: boolean;
  qrDataUrl: string | null;
  brandLabel: string;
  entryLabel: string;
  referenceLabel: string;
  /** Caption under the QR when confirmed (e.g. "Show this code at the entrance"). */
  confirmedCaption: string;
  /** Caption when not yet confirmed — loading, or a status label. */
  pendingCaption: string;
}

/**
 * Boarding-pass style entry ticket from the Claude Design handoffs ("Crown
 * Confirmation Desktop" / "Crown Booking Details Desktop"). Branded header +
 * tier chip, the live QR on a cream tile, a dashed perforation with notch
 * cut-outs, and the reference in gold serif.
 *
 * Shared by the desktop confirmation and booking-detail pages so the ticket
 * is defined once.
 */
export function BookingTicket({
  tier,
  reference,
  confirmed,
  qrDataUrl,
  brandLabel,
  entryLabel,
  referenceLabel,
  confirmedCaption,
  pendingCaption,
}: Props) {
  return (
    <div className="relative">
      {/* glow */}
      <div
        className="pointer-events-none absolute -inset-8 rounded-[40px]"
        style={{
          background: 'radial-gradient(ellipse at 50% 30%, rgba(227,191,115,0.16), transparent 65%)',
        }}
      />
      <div
        className="relative overflow-hidden rounded-3xl border border-gold-400/25 shadow-[0_24px_60px_rgba(28,43,64,0.22)]"
        style={{ background: 'linear-gradient(180deg, #142436, #091322)' }}
      >
        {/* header band */}
        <div
          className="flex items-center justify-between border-b border-white/[0.06] px-[26px] py-5"
          style={{ background: 'linear-gradient(180deg, rgba(227,191,115,0.08), transparent)' }}
        >
          <div className="flex items-center gap-[11px]">
            <CrownIcon className="size-6 text-aurelia-gold" />
            <div>
              <div className="whitespace-nowrap font-aurelia-display text-[17px] font-semibold leading-none tracking-[0.12em] text-aurelia-cream">
                {brandLabel}
              </div>
              <div className="mt-1.5 whitespace-nowrap text-[8.5px] uppercase tracking-[0.28em] text-aurelia-cream/40">
                {entryLabel}
              </div>
            </div>
          </div>
          <span className="rounded-full border border-aurelia-gold/25 bg-aurelia-gold/[0.12] px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-aurelia-gold">
            {tier}
          </span>
        </div>

        {/* QR */}
        <div className="flex flex-col items-center px-[26px] pb-[22px] pt-[30px]">
          <div className="rounded-[18px] bg-aurelia-cream p-4 shadow-[0_10px_30px_rgba(0,0,0,0.4)]">
            {confirmed && qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt={confirmedCaption} className="size-[180px]" />
            ) : (
              <div className="size-[180px] animate-pulse rounded-lg bg-aurelia-ink/10" />
            )}
          </div>
          <div className="mt-4 text-[12.5px] tracking-[0.02em] text-aurelia-cream/60">
            {confirmed ? confirmedCaption : pendingCaption}
          </div>
        </div>

        {/* perforation */}
        <div className="relative h-7">
          <div className="absolute -left-3.5 top-1/2 size-7 -translate-y-1/2 rounded-full bg-background" />
          <div className="absolute -right-3.5 top-1/2 size-7 -translate-y-1/2 rounded-full bg-background" />
          <div className="absolute inset-x-[22px] top-1/2 border-t-2 border-dashed border-white/[0.06]" />
        </div>

        {/* reference */}
        <div className="px-[26px] pb-[26px] pt-2 text-center">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-aurelia-cream/40">
            {referenceLabel}
          </div>
          <div
            dir="ltr"
            className="mt-1.5 font-aurelia-display text-[26px] font-semibold tracking-[0.04em] text-aurelia-gold"
          >
            {reference}
          </div>
        </div>
      </div>
    </div>
  );
}
