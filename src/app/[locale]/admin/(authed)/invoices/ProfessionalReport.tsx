'use client';

import React, { useRef, useState, useEffect } from 'react';
import { FileTextIcon, Loader2Icon, BarChart3Icon, ZapIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/date';
import { CrownLogo } from '@/components/brand/CrownLogo';
import { getManagementSummaryAction } from '@/features/admin/report-actions';
import type { ManagementSummary } from '@/server/services/admin-reports';

interface Props {
  locale: string;
}

export function ProfessionalReportExport({ locale }: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ManagementSummary | null>(null);
  const [withGraphs, setWithGraphs] = useState(true);
  const [withWhatIf, setWithWhatIf] = useState(false);
  
  const page1Ref = useRef<HTMLDivElement>(null);
  const page2Ref = useRef<HTMLDivElement>(null);

  // Pre-fetch data so it's ready when the user clicks
  useEffect(() => {
    getManagementSummaryAction().then(setData);
  }, []);

  const handleExport = async () => {
    if (loading || !data) return;
    setLoading(true);

    try {
      // PDF + rasterisation libs are click-time only — lazy-load them so the
      // invoices page bundle doesn't carry ~200KB of export machinery.
      const [{ jsPDF }, { toPng }] = await Promise.all([
        import('jspdf'),
        import('html-to-image'),
      ]);
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();

      // Capture Page 1
      if (page1Ref.current) {
        const dataUrl1 = await toPng(page1Ref.current, {
          cacheBust: true,
          pixelRatio: 2,
          backgroundColor: '#0d1a2b',
        });
        const imgProps1 = pdf.getImageProperties(dataUrl1);
        const pdfHeight1 = (imgProps1.height * pdfWidth) / imgProps1.width;
        pdf.addImage(dataUrl1, 'PNG', 0, 0, pdfWidth, pdfHeight1);
      }

      // Capture Page 2 (if enabled or needed)
      if (page2Ref.current && (withGraphs || withWhatIf)) {
        const dataUrl2 = await toPng(page2Ref.current, {
          cacheBust: true,
          pixelRatio: 2,
          backgroundColor: '#0d1a2b',
        });
        pdf.addPage();
        const imgProps2 = pdf.getImageProperties(dataUrl2);
        const pdfHeight2 = (imgProps2.height * pdfWidth) / imgProps2.width;
        pdf.addImage(dataUrl2, 'PNG', 0, 0, pdfWidth, pdfHeight2);
      }

      pdf.save(`CrownIsland_Management_Summary_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err) {
      console.error('Report export failed:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-gold-400/20 bg-card p-4 shadow-inner ring-1 ring-border">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold-700/60">
            Management Reporting
          </span>
          <h3 className="font-display text-sm font-semibold text-foreground">Strategic Summary</h3>
        </div>
        
        <button
          onClick={handleExport}
          disabled={loading || !data}
          className={cn(
            'flex items-center gap-2 rounded-xl bg-gradient-to-br from-gold-300 via-gold-500 to-gold-700 px-6 py-2.5 text-xs font-black uppercase tracking-wider text-navy-950 shadow-gold transition-all hover:brightness-110 active:scale-95 disabled:opacity-50',
            loading && 'cursor-wait'
          )}
        >
          {loading ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <FileTextIcon className="size-4" />
          )}
          <span>{data ? 'Generate PDF Report' : 'Loading Data...'}</span>
        </button>
      </div>

      <div className="flex flex-wrap gap-6 border-t border-gold-400/10 pt-4">
        <label className="flex cursor-pointer items-center gap-2 group">
          <div className={cn(
            "flex size-5 items-center justify-center rounded border border-gold-400/30 transition-colors group-hover:border-gold-400",
            withGraphs ? "bg-gold-500 border-gold-500" : "bg-transparent"
          )}>
            <input 
              type="checkbox" 
              className="hidden" 
              checked={withGraphs} 
              onChange={() => setWithGraphs(!withGraphs)} 
            />
            {withGraphs && <div className="size-2 rounded-sm bg-navy-950" />}
          </div>
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground group-hover:text-gold-700 transition-colors">
            <BarChart3Icon className="size-3.5" />
            Include Visualizations
          </span>
        </label>

        <label className="flex cursor-pointer items-center gap-2 group">
          <div className={cn(
            "flex size-5 items-center justify-center rounded border border-gold-400/30 transition-colors group-hover:border-gold-400",
            withWhatIf ? "bg-gold-500 border-gold-500" : "bg-transparent"
          )}>
            <input 
              type="checkbox" 
              className="hidden" 
              checked={withWhatIf} 
              onChange={() => setWithWhatIf(!withWhatIf)} 
            />
            {withWhatIf && <div className="size-2 rounded-sm bg-navy-950" />}
          </div>
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground group-hover:text-gold-700 transition-colors">
            <ZapIcon className="size-3.5" />
            Strategic What-if Analysis
          </span>
        </label>
      </div>

      {/* Render the hidden templates only when data is ready */}
      {data && (
        <div className="fixed -left-[9999px] top-0 flex flex-col gap-0">
          <ReportPage ref={page1Ref} locale={locale} data={data}>
            <ExecutiveOverview data={data} locale={locale} />
            <PerformanceAnalysis data={data} locale={locale} />
          </ReportPage>
          
          <ReportPage ref={page2Ref} locale={locale} data={data}>
            {withGraphs && <StrategicVisuals data={data} />}
            {withWhatIf && <WhatIfAnalysis data={data} locale={locale} />}
            {!withGraphs && !withWhatIf && (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                Additional Analysis Section
              </div>
            )}
          </ReportPage>
        </div>
      )}
    </div>
  );
}

const ReportPage = React.forwardRef<HTMLDivElement, { children: React.ReactNode; locale: string; data: ManagementSummary }>(
  ({ children, locale, data }, ref) => (
    <div
      ref={ref}
      className="relative flex w-[1200px] flex-col bg-[#0d1a2b] p-20 font-sans text-cream"
      style={{ height: '1697px' }}
    >
      <div className="absolute inset-10 border border-gold-400/10 pointer-events-none" />
      <div className="absolute inset-12 border border-gold-400/5 pointer-events-none" />

      <header className="flex items-start justify-between">
        <div className="flex flex-col gap-2">
          <div className="scale-[1.5] origin-left">
            <CrownLogo />
          </div>
          <p className="mt-8 text-xl font-bold uppercase tracking-[0.5em] text-gold-400/60">
            Strategic Management Summary
          </p>
          <div className="rule-gold mt-4 w-32 border-t-2 border-gold-400/40" />
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-gold-300">CONFIDENTIAL</p>
          <p className="text-xs text-muted-foreground mt-1">
            Generated: {formatDate(data.timestamp, locale as 'ar' | 'en', { dateStyle: 'long', timeStyle: 'short' })}
          </p>
        </div>
      </header>

      <main className="mt-20 flex flex-1 flex-col gap-12">
        {children}
      </main>

      <footer className="mt-auto border-t border-gold-400/10 pt-10 flex justify-between items-center opacity-40">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-bold uppercase tracking-widest">Crown Island Portfolio</p>
          <p className="text-[10px]">El Montazah Premium Booking Ecosystem</p>
        </div>
        <p className="text-[10px] uppercase tracking-widest text-right">
          Internal Use Only · High Management Distribution
        </p>
      </footer>
    </div>
  )
);
ReportPage.displayName = 'ReportPage';

function ExecutiveOverview({ data, locale }: { data: ManagementSummary; locale: string }) {
  return (
    <section className="space-y-8">
      <h2 className="font-display text-4xl font-bold text-gradient-gold">Executive Overview</h2>
      <div className="grid grid-cols-3 gap-8">
        <div className="rounded-2xl border border-gold-400/10 bg-navy-900/40 p-8 shadow-inner">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Total Gross Revenue</p>
          <p className="mt-4 font-display text-5xl font-black text-gold-200">
            {formatMoney(data.overview.totalRevenueCents, { locale: locale as 'ar' | 'en', currency: 'EGP' })}
          </p>
        </div>
        <div className="rounded-2xl border border-gold-400/10 bg-navy-900/40 p-8 shadow-inner">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Confirmed Bookings</p>
          <p className="mt-4 font-display text-5xl font-black text-gold-200">
            {data.overview.confirmedBookings.toLocaleString()}
          </p>
        </div>
        <div className="rounded-2xl border border-gold-400/10 bg-navy-900/40 p-8 shadow-inner">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Average Order Value</p>
          <p className="mt-4 font-display text-5xl font-black text-gold-200">
            {formatMoney(data.overview.avgBookingValueCents, { locale: locale as 'ar' | 'en', currency: 'EGP' })}
          </p>
        </div>
      </div>
    </section>
  );
}

function PerformanceAnalysis({ data, locale }: { data: ManagementSummary; locale: string }) {
  return (
    <section className="grid grid-cols-2 gap-16">
      <div className="space-y-8">
        <h3 className="text-2xl font-bold text-gold-300">Performance (Last 30 Days)</h3>
        <div className="space-y-6">
          <div className="flex justify-between border-b border-gold-400/10 pb-4">
            <span className="text-muted-foreground">Period Revenue</span>
            <span className="font-bold text-cream">{formatMoney(data.overview.last30DaysRevenueCents, { locale: locale as 'ar' | 'en', currency: 'EGP' })}</span>
          </div>
          <div className="flex justify-between border-b border-gold-400/10 pb-4">
            <span className="text-muted-foreground">Period Bookings</span>
            <span className="font-bold text-cream">{data.overview.last30DaysBookings.toLocaleString()}</span>
          </div>
          <div className="flex justify-between border-b border-gold-400/10 pb-4">
            <span className="text-muted-foreground">Growth Trajectory</span>
            <span className="font-bold text-success">Scaling</span>
          </div>
        </div>
      </div>

      <div className="space-y-8">
        <h3 className="text-2xl font-bold text-gold-300">Revenue Contribution</h3>
        <div className="space-y-6">
          {data.categories.map((c, i) => (
            <div key={i} className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground uppercase tracking-widest">{c.name}</span>
                <span className="text-gold-200 font-bold">{Math.round((c.cents / data.overview.totalRevenueCents) * 100)}%</span>
              </div>
              <div className="h-1.5 w-full bg-navy-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-gold-600 to-gold-400" 
                  style={{ width: `${(c.cents / data.overview.totalRevenueCents) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StrategicVisuals({ data }: { data: ManagementSummary }) {
  const maxAmount = Math.max(...data.trends.map(x => x.amount)) || 1;
  return (
    <section className="space-y-8">
      <h2 className="font-display text-4xl font-bold text-gradient-gold">Strategic Visualizations</h2>
      <div className="rounded-3xl border border-gold-400/10 bg-navy-900/40 p-12 shadow-inner">
        <div className="flex items-end gap-2 h-64 w-full">
          {data.trends.map((t, i) => (
            <div 
              key={i} 
              className="flex-1 bg-gradient-to-t from-gold-600/60 to-gold-400 rounded-t-sm"
              style={{ height: `${Math.max(5, (t.amount / maxAmount) * 100)}%` }}
            />
          ))}
        </div>
        <div className="flex justify-between mt-6 text-[10px] uppercase tracking-widest text-muted-foreground">
          <span>30 Days Ago</span>
          <span>Revenue Trend (Daily)</span>
          <span>Current</span>
        </div>
      </div>
    </section>
  );
}

function WhatIfAnalysis({ data, locale }: { data: ManagementSummary; locale: string }) {
  const baselineRevenue = data.overview.totalRevenueCents / 100;
  const whatIfPriceIncrease = baselineRevenue * 1.15; // +15% optimized
  const whatIfDemandIncrease = baselineRevenue * 1.3; // +30% expansion

  return (
    <section className="space-y-8">
      <h2 className="font-display text-4xl font-bold text-gradient-gold">Strategic &ldquo;What-If&rdquo; Analysis</h2>
      <p className="text-muted-foreground max-w-2xl leading-relaxed">
        The following projections simulate future growth scenarios based on existing market demand and operational scalability metrics.
      </p>
      <div className="grid grid-cols-2 gap-8 mt-4">
        <div className="rounded-2xl border border-gold-400/20 bg-navy-950 p-8 ring-1 ring-gold-400/10">
          <p className="text-xs font-bold uppercase tracking-widest text-gold-400/80">Scenario A: Yield Optimization</p>
          <p className="text-lg font-bold mt-2">15% Strategic Pricing Shift</p>
          <div className="mt-6 flex items-baseline gap-2">
            <p className="font-display text-4xl font-black text-success">
              {formatMoney(whatIfPriceIncrease * 100, { locale: locale as 'ar' | 'en', currency: 'EGP' })}
            </p>
            <p className="text-xs text-muted-foreground">Projected Gross</p>
          </div>
          <p className="mt-4 text-xs text-muted-foreground leading-relaxed">
            Refined guest positioning and tiered pricing structures. Results in an estimated revenue uplift of 15%.
          </p>
        </div>

        <div className="rounded-2xl border border-gold-400/20 bg-navy-950 p-8 ring-1 ring-gold-400/10">
          <p className="text-xs font-bold uppercase tracking-widest text-gold-400/80">Scenario B: Scale Expansion</p>
          <p className="text-lg font-bold mt-2">30% Capacity Growth</p>
          <div className="mt-6 flex items-baseline gap-2">
            <p className="font-display text-4xl font-black text-info">
              {formatMoney(whatIfDemandIncrease * 100, { locale: locale as 'ar' | 'en', currency: 'EGP' })}
            </p>
            <p className="text-xs text-muted-foreground">Projected Gross</p>
          </div>
          <p className="mt-4 text-xs text-muted-foreground leading-relaxed">
            Scaling physical operational capacity to capture existing unfulfilled demand. Results in an estimated revenue uplift of 30%.
          </p>
        </div>
      </div>
    </section>
  );
}
