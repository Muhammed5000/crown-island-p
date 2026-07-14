'use client';

import { useState } from 'react';
import { FileDownIcon, Loader2Icon } from 'lucide-react';
import { cn } from '@/lib/cn';

interface Props {
  type: 'bookings' | 'invoices' | 'customers';
}

export function ExportButton({ type }: Props) {
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    if (loading) return;
    setLoading(true);
    try {
      // Create a temporary link and click it to trigger the download
      const url = `/api/admin/export?type=${type}&limit=${limit}`;
      window.location.href = url;
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      // Keep loading state for a bit to show it's working
      setTimeout(() => setLoading(false), 2000);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center overflow-hidden rounded-2xl border border-border bg-card p-1 shadow-soft transition-all hover:border-gold-400/40">
        <div className="hidden px-3 py-1.5 md:block">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            Export Limit
          </span>
        </div>

        <div className="flex items-center border-border bg-muted/60 px-3 md:border-l">
          <input
            type="number"
            min="1"
            max="5000"
            value={limit}
            onChange={(e) => setLimit(parseInt(e.target.value, 10) || 1)}
            className="w-14 bg-transparent py-1.5 text-center text-xs font-display font-bold text-foreground focus:outline-none"
          />
        </div>

        <button
          onClick={handleExport}
          disabled={loading}
          className={cn(
            'ml-1 flex items-center gap-2 rounded-xl bg-gradient-to-br from-gold-300 via-gold-400 to-gold-600 px-5 py-2 text-[11px] font-black uppercase tracking-wider text-navy-950 shadow-gold transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50',
            loading && 'cursor-wait animate-pulse'
          )}
        >
          {loading ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <FileDownIcon className="size-3.5" />
          )}
          <span>Excel</span>
        </button>
      </div>
    </div>
  );
}
