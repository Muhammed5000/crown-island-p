'use client';

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/date';

export interface ExportBookingData {
  bookingDate: Date;
  people: number;
  cars: number;
  userName: string;
  serviceName: string;
  categoryName: string;
  categorySlug: string;
  totalCents: number;
  status: string;
  coverUrl?: string | null;
  /** Category logo / brand mark — printed on the ticket when set. */
  logoUrl?: string | null;
}

/**
 * Premium downloadable ticket — a 1080×1920 "official invitation" card rendered
 * off-screen and rasterised with `html-to-image`. Shared by the mobile
 * `SuccessTicket` and the desktop `ConfirmationDesktop` so there is one export
 * implementation.
 */

/** Pre-loads the brand logo, cover, and category logo as data URLs so the
 *  rasteriser captures them (html-to-image can't fetch cross-origin at draw). */
function useTicketAssets(coverUrl?: string | null, categoryLogoUrl?: string | null) {
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [coverDataUrl, setCoverDataUrl] = useState<string | null>(null);
  const [categoryLogoDataUrl, setCategoryLogoDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function toDataUrl(url: string): Promise<string | null> {
      try {
        const isSameOrigin = url.startsWith('/') || url.startsWith(window.location.origin);
        const headers: HeadersInit = {};

        // ngrok-free.dev requires this header to bypass the browser warning
        // which otherwise causes fetch() to fail with CORS or network errors.
        if (isSameOrigin && window.location.hostname.includes('ngrok')) {
          headers['ngrok-skip-browser-warning'] = 'true';
        }

        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();

        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (err) {
        // We log as a warning because the export will still function (minus the image)
        // and we want to avoid loud 'Failed to fetch' TypeError reports in dev.
        // Network/CORS failures are expected for some external cover images.
        console.warn(`[TicketExport] Optional asset could not be loaded: ${url}`, err instanceof Error ? err.message : err);
        return null;
      }
    }

    (async () => {
      // 1. Brand wordmark — the cream variant reads on the dark ticket card.
      const logo = await toDataUrl('/brand/crown-island-logo-light.svg');
      if (!cancelled && logo) setLogoDataUrl(logo);

      // 2. Cover (Optional, might be external)
      if (coverUrl) {
        const cover = await toDataUrl(coverUrl);
        if (!cancelled && cover) setCoverDataUrl(cover);
      }

      // 3. Category logo (Optional, might be external)
      if (categoryLogoUrl) {
        const catLogo = await toDataUrl(categoryLogoUrl);
        if (!cancelled && catLogo) setCategoryLogoDataUrl(catLogo);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [coverUrl, categoryLogoUrl]);

  return { logoDataUrl, coverDataUrl, categoryLogoDataUrl };
}

/**
 * Wires up the export: pre-loads assets, owns the hidden-template ref, and
 * returns a `handleExport` that rasterises and downloads a PNG.
 */
export function useTicketExport({
  reference,
  coverUrl,
  categoryLogoUrl,
}: {
  reference: string;
  coverUrl?: string | null;
  categoryLogoUrl?: string | null;
}) {
  const { logoDataUrl, coverDataUrl, categoryLogoDataUrl } = useTicketAssets(
    coverUrl,
    categoryLogoUrl,
  );
  const cardRef = useRef<HTMLDivElement>(null);
  const [exportLoading, setExportLoading] = useState(false);

  const handleExport = async () => {
    if (!cardRef.current || exportLoading) return;
    setExportLoading(true);
    try {
      const { toBlob } = await import('html-to-image');
      const blob = await toBlob(cardRef.current, {
        cacheBust: false,
        pixelRatio: 2,
        backgroundColor: '#0a132a',
      });
      if (!blob) throw new Error('Failed to generate image blob');

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `crown-island-${reference}.png`;
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Unable to generate professional ticket. Please try again or take a screenshot.');
    } finally {
      setExportLoading(false);
    }
  };

  return { cardRef, handleExport, exportLoading, logoDataUrl, coverDataUrl, categoryLogoDataUrl };
}

interface TemplateProps {
  reference: string;
  qrDataUrl: string | null;
  logoDataUrl: string | null;
  coverDataUrl: string | null;
  /** Category logo / brand mark, pre-loaded as a data URL (optional). */
  categoryLogoDataUrl?: string | null;
  bookingData: ExportBookingData;
  locale: string;
}

export const PremiumTicketTemplate = forwardRef<HTMLDivElement, TemplateProps>(
  function PremiumTicketTemplate(
    { reference, qrDataUrl, logoDataUrl, coverDataUrl, categoryLogoDataUrl, bookingData, locale },
    ref,
  ) {
    const categoryStyle = useMemo(() => {
      const slug = bookingData.categorySlug || 'default';
      switch (slug) {
        case 'beach':
        case 'day-use':
          return { accent: 'text-sky-300' };
        case 'cabana':
          return { accent: 'text-gold-200' };
        case 'event':
        case 'wedding':
          return { accent: 'text-purple-300' };
        default:
          return { accent: 'text-gold-300' };
      }
    }, [bookingData.categorySlug]);

    return (
      <div className="fixed -left-[9999px] top-0">
        <div
          ref={ref}
          className="relative flex h-[1920px] w-[1080px] flex-col overflow-hidden bg-[#050a1a] font-sans text-white"
        >
          {/* 1. Header Background (Cover Image) */}
          <div className="absolute left-0 top-0 h-[750px] w-full overflow-hidden">
            {coverDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverDataUrl} alt="" className="h-full w-full object-cover grayscale-[0.2] brightness-50" />
            ) : (
              <div className="h-full w-full bg-[#0a132a]" />
            )}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#050a1a]/60 to-[#050a1a]" />
          </div>

          {/* 2. Top Branding Layer */}
          <div className="relative z-10 flex h-[420px] flex-col items-center justify-center pt-20">
            {categoryLogoDataUrl && (
              <div
                style={{
                  width: 150,
                  height: 150,
                  borderRadius: '9999px',
                  background: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  boxShadow: '0 14px 44px rgba(0,0,0,0.45)',
                  marginBottom: 28,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={categoryLogoDataUrl}
                  alt=""
                  style={{ width: '78%', height: '78%', objectFit: 'contain' }}
                />
              </div>
            )}
            {logoDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoDataUrl} alt="Logo" style={{ width: '420px', height: 'auto' }} />
            )}
            <div className="mt-8 flex flex-col items-center">
              <p className={cn('text-2xl font-black uppercase tracking-[0.6em]', categoryStyle.accent)}>
                Official Invitation
              </p>
              <div className="mt-4 h-1 w-20 bg-current opacity-20" />
            </div>
          </div>

          {/* 3. Primary Info (Reference & Name) */}
          <div className="relative z-10 flex flex-col items-center px-16 text-center">
            <p className="text-lg uppercase tracking-[0.3em] text-gray-500">Booking Reference</p>
            <h1 className="mt-4 font-display text-[130px] font-black leading-none tracking-tighter text-[#d4a557]">
              {reference}
            </h1>
            <div className="mt-12 flex flex-col items-center">
              <p className="text-xl uppercase tracking-widest text-gray-500">Guest Name</p>
              <p className="mt-4 text-6xl font-bold uppercase text-white">{bookingData.userName}</p>
            </div>
          </div>

          {/* 4. Details Grid */}
          <div className="relative z-10 mt-12 flex flex-col items-center px-20">
            <div className="w-full border-y border-white/10 py-12">
              <div className="grid grid-cols-2 gap-y-12">
                <div className="flex flex-col items-center text-center">
                  <p className="text-lg uppercase tracking-widest text-gray-500">Date</p>
                  <p className="mt-2 text-4xl font-bold text-white">
                    {formatDate(bookingData.bookingDate, locale as 'ar' | 'en', { dateStyle: 'long' })}
                  </p>
                </div>
                <div className="flex flex-col items-center text-center">
                  <p className="text-lg uppercase tracking-widest text-gray-500">Experience</p>
                  <p className="mt-2 text-4xl font-bold text-white">{bookingData.serviceName}</p>
                </div>
                <div className="flex flex-col items-center text-center">
                  <p className="text-lg uppercase tracking-widest text-gray-500">Group Size</p>
                  <p className="mt-2 text-4xl font-bold text-white">
                    {bookingData.people} Persons
                  </p>
                </div>
                <div className="flex flex-col items-center text-center">
                  <p className="text-lg uppercase tracking-widest text-gray-500">Vehicles</p>
                  <p className="mt-2 text-4xl font-bold text-white">{bookingData.cars} Cars</p>
                </div>
              </div>
            </div>
          </div>

          {/* 5. Gate Pass (QR Section) */}
          <div className="relative z-10 mt-auto flex flex-col items-center bg-white/5 pb-20 pt-12">
            <div className="rounded-[3.5rem] bg-white p-8 shadow-2xl shadow-black/50">
              {qrDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrDataUrl} alt="QR Code" className="size-[320px]" />
              )}
            </div>
            <p className="mt-10 text-2xl font-black uppercase tracking-[0.5em] text-[#d4a557]">Gate Pass</p>
            <p className="mt-2 text-lg uppercase tracking-widest text-gray-500 opacity-60">Scan for entry at gate</p>
          </div>

          {/* Aesthetic Border Frame */}
          <div className="pointer-events-none absolute inset-0 z-20 border-[40px] border-[#050a1a]/40" />
        </div>
      </div>
    );
  },
);
