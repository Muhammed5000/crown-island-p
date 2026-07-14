'use client';

import React, { useRef, useState } from 'react';
import { FileTextIcon, Loader2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/date';
import { CrownLogo } from '@/components/brand/CrownLogo';

interface InvoiceLine {
  id: string;
  label: string;
  quantity: number;
  totalCents: number;
}

interface BookingData {
  reference: string;
  bookingDate: Date;
  people: number;
  cars: number;
  userName: string;
  userPhone?: string | null;
  serviceName: string;
  categoryName: string;
  totalCents: number;
  status: string;
  invoiceLines: InvoiceLine[];
}

interface Props {
  booking: BookingData;
  locale: string;
}

export function PremiumBookingExport({ booking, locale }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const tServices = useTranslations('services');
  const tBooking = useTranslations('booking');

  const handleExport = async () => {
    if (!cardRef.current || loading) return;
    setLoading(true);

    try {
      // Click-time only — lazy-load the rasteriser so it stays out of the
      // booking-detail page bundle.
      const { toPng } = await import('html-to-image');
      // High pixel ratio for sharp text on B&W invoice
      const dataUrl = await toPng(cardRef.current, {
        cacheBust: true,
        pixelRatio: 3, 
        backgroundColor: '#ffffff',
      });

      const link = document.createElement('a');
      link.download = `invoice-${booking.reference}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to export invoice:', err);
    } finally {
      setLoading(false);
    }
  };

  const isAr = locale === 'ar';

  return (
    <>
      <button
        onClick={handleExport}
        disabled={loading}
        className={cn(
          'flex items-center gap-2 rounded-xl border border-gold-400/20 bg-gold-400/5 px-4 py-2 text-xs font-bold uppercase tracking-wider text-gold-700 transition-all hover:bg-gold-400/10 active:scale-95 disabled:opacity-50',
          loading && 'cursor-wait'
        )}
      >
        {loading ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <FileTextIcon className="size-4" />
        )}
        <span>Professional Invoice</span>
      </button>

      {/* Hidden Invoice Template (Cashier Receipt Style) */}
      <div className="fixed -left-[9999px] top-0">
        <div
          ref={cardRef}
          dir={isAr ? 'rtl' : 'ltr'}
          className={cn(
            "relative flex w-[600px] flex-col bg-white p-12 text-black",
            isAr ? "font-sans" : "font-mono"
          )}
          style={{ minHeight: '800px' }}
        >
          {/* Logo & Header */}
          <div className="flex flex-col items-center border-b-2 border-black pb-6 text-center">
            <div className="mb-4 grayscale contrast-[200%]">
              <CrownLogo size="md" />
            </div>
            <h1 className="text-2xl font-bold uppercase tracking-tighter">Crown Island</h1>
            <p className="text-xs uppercase">El Montazah, Alexandria</p>
            <p className="text-[10px] mt-1 opacity-70">Premium Beach & Luxury Experiences</p>
          </div>

          {/* Info Section */}
          <div className="mt-8 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="font-bold">{isAr ? 'رقم الفاتورة:' : 'INVOICE NO:'}</span>
              <span className="font-bold">{booking.reference}</span>
            </div>
            <div className="flex justify-between">
              <span>{isAr ? 'التاريخ:' : 'DATE:'}</span>
              <span>{formatDate(booking.bookingDate, locale as 'ar' | 'en', { dateStyle: 'long' })}</span>
            </div>
            <div className="flex justify-between">
              <span>{isAr ? 'العميل:' : 'CUSTOMER:'}</span>
              <span className="uppercase">{booking.userName}</span>
            </div>
            {booking.userPhone && (
              <div className="flex justify-between">
                <span>{isAr ? 'الهاتف:' : 'PHONE:'}</span>
                <span dir="ltr">{booking.userPhone}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>{isAr ? 'الحالة:' : 'STATUS:'}</span>
              <span className="font-bold">{booking.status}</span>
            </div>
          </div>

          {/* Service Header */}
          <div className="mt-6 border-y border-black py-2 text-center">
            <p className="text-sm font-bold uppercase">{booking.serviceName}</p>
            <p className="text-[10px] uppercase opacity-80">{booking.categoryName}</p>
          </div>

          {/* Itemized List */}
          <div className="mt-6">
            <table className="w-full text-start text-xs">
              <thead>
                <tr className="border-b border-black">
                  <th className="pb-2 text-start">{isAr ? 'الوصف' : 'DESCRIPTION'}</th>
                  <th className="pb-2 text-center">{isAr ? 'الكمية' : 'QTY'}</th>
                  <th className="pb-2 text-end">{isAr ? 'المبلغ' : 'AMOUNT'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {booking.invoiceLines.map((line) => {
                  let label = line.label;
                  if (label.startsWith('services.')) {
                    label = tServices(label.replace('services.', '') as Parameters<typeof tServices>[0]);
                  } else if (label.startsWith('booking.')) {
                    label = tBooking(label.replace('booking.', '') as Parameters<typeof tBooking>[0]);
                  }

                  return (
                    <tr key={line.id}>
                      <td className="py-2 pe-4 uppercase leading-tight text-start">
                        {label}
                      </td>
                      <td className="py-2 text-center align-top">{line.quantity}</td>
                      <td className="py-2 text-end align-top tabular-nums">
                        {formatMoney(line.totalCents, { locale: locale as 'ar' | 'en', currency: 'EGP' })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="mt-8 border-t-2 border-black pt-4">
            <div className="flex justify-between text-lg font-bold">
              <span>{isAr ? 'إجمالي المدفوع' : 'TOTAL PAID'}</span>
              <span className="tabular-nums">
                {formatMoney(booking.totalCents, { locale: locale as 'ar' | 'en', currency: 'EGP' })}
              </span>
            </div>
            <div className="mt-1 flex justify-between text-[10px] uppercase opacity-70">
              <span>{isAr ? 'العملة' : 'Currency'}</span>
              <span>{isAr ? 'جنيه مصري (EGP)' : 'Egyptian Pound (EGP)'}</span>
            </div>
          </div>

          {/* Guest Count */}
          <div className="mt-6 flex justify-between border-t border-dashed border-black py-2 text-[10px] uppercase">
            <span>{isAr ? 'الأفراد:' : 'Guests:'} {booking.people}</span>
            <span>{isAr ? 'السيارات:' : 'Vehicles:'} {booking.cars}</span>
          </div>

          {/* Footer */}
          <div className="mt-auto pt-12 text-center">
            <div className="border-t border-black pt-6">
              <p className="text-xs font-bold uppercase tracking-widest">
                {isAr ? 'شكراً لزيارتكم' : 'Thank you for choosing us'}
              </p>
              <p className="mt-2 text-[9px] uppercase opacity-60">
                {isAr ? 'هذه فاتورة رسمية صادرة عن' : 'This is a professional receipt generated by'}<br />
                {isAr ? 'نظام إدارة كراون آيلاند' : 'Crown Island Management System'}
              </p>
              <div className="mt-6 flex justify-center opacity-30">
                 <div className="h-8 w-48 bg-[repeating-linear-gradient(90deg,black,black_2px,transparent_2px,transparent_4px)]" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
