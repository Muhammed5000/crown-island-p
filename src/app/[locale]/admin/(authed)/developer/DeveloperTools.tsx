'use client';

import { useRef, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { cleanupTesterDataAction } from '@/features/admin/developer-actions';
import { cn } from '@/lib/cn';
import { Trash2Icon, Loader2Icon, DownloadIcon, UploadCloudIcon } from 'lucide-react';

export function CleanupTestingDataButton() {
  const [isPending, startTransition] = useTransition();

  const handleCleanup = () => {
    if (
      !confirm(
        'Are you sure you want to PERMANENTLY delete ALL bookings and payments for TESTER users? This cannot be undone.',
      )
    ) {
      return;
    }

    startTransition(async () => {
      try {
        const res = await cleanupTesterDataAction();
        if (res.ok) {
          alert(`Successfully deleted ${res.deleted} records.`);
        }
      } catch {
        alert('Cleanup failed — check the console and try again.');
      }
    });
  };

  return (
    <Button
      variant="outline"
      onClick={handleCleanup}
      loading={isPending}
      className="w-full gap-2 border-danger/30 text-danger hover:bg-danger/10"
    >
      <Trash2Icon className="size-4" />
      Purge TESTER Data
    </Button>
  );
}

/**
 * Database backup: export the whole DB to a JSON file, or import a previously
 * exported file back in. Import is additive (only missing rows are added) and
 * runs in one transaction, so a bad file rolls back cleanly.
 */
export function BackupTools() {
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (
      !confirm(
        `Import "${file.name}"?\n\nThis ADDS any rows from the file that aren't already in the database (existing rows are never changed or deleted). It runs as a single transaction. Continue?`,
      )
    ) {
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    startTransition(async () => {
      try {
        const text = await file.text();
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          alert('That file is not valid JSON.');
          return;
        }
        const res = await fetch('/api/admin/backup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(json),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok) {
          alert(`Import failed: ${body.error ?? `HTTP ${res.status}`}`);
          return;
        }
        const tables = Object.entries(body.inserted as Record<string, number>)
          .filter(([, n]) => n > 0)
          .map(([t, n]) => `${t}: ${n}`)
          .join('\n');
        alert(
          `Import complete — ${body.totalInserted} rows added.\n\n${tables || 'No new rows (everything was already present).'}`,
        );
      } catch (err) {
        console.error('[backup] import error', err);
        alert('Import failed — check the console and try again.');
      } finally {
        if (fileRef.current) fileRef.current.value = '';
      }
    });
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {/* Plain <a> (not next/link) so it isn't prefetched and triggers a native
          file download from the GET endpoint. */}
      <a
        href="/api/admin/backup"
        download
        className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-sm font-bold text-primary-foreground transition hover:bg-primary/90"
      >
        <DownloadIcon className="size-4" />
        Export database (JSON)
      </a>
      <label
        className={cn(
          'inline-flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-border bg-card px-5 text-sm font-bold text-foreground transition hover:bg-muted',
          isPending && 'pointer-events-none opacity-60',
        )}
      >
        {isPending ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <UploadCloudIcon className="size-4" />
        )}
        {isPending ? 'Importing…' : 'Import from JSON'}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={handleImport}
          disabled={isPending}
        />
      </label>
    </div>
  );
}
