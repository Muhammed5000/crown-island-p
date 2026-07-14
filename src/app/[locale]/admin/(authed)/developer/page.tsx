import { setRequestLocale } from 'next-intl/server';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { TerminalIcon, ShieldAlertIcon, Trash2Icon, InfoIcon, DatabaseIcon } from 'lucide-react';
import { requireDeveloper } from '@/server/auth/guards';
import { isLocale } from '@/i18n/config';
import { CleanupTestingDataButton, BackupTools } from './DeveloperTools';

interface Props {
  params: Promise<{ locale: string }>;
}

export default async function DeveloperSection({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const developer = await requireDeveloper();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-gold-600">
            System Architecture
          </p>
          <h1 className="text-gradient-gold mt-1 font-display text-3xl font-semibold md:text-4xl">
            Developer Section
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Administrative tools for system testing and sandbox environment.
          </p>
        </div>
        <div className="rounded-full bg-gold-400/10 p-3 ring-1 ring-gold-400/20">
          <TerminalIcon className="size-6 text-gold-600" />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Data Management */}
        <Card className="border-danger/20 bg-card md:col-span-2">
          <CardHeader className="flex flex-row items-center gap-3">
            <Trash2Icon className="size-5 text-danger" />
            <h2 className="font-display text-lg text-foreground">Data Cleanup</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Purge all bookings, invoices, and payments associated with users in the
              <Badge tone="info">TESTER</Badge> role to keep real metrics clean.
            </p>
            <CleanupTestingDataButton />
          </CardBody>
        </Card>

        {/* Database Backup */}
        <Card className="border-gold-400/20 bg-card md:col-span-2">
          <CardHeader className="flex flex-row items-center gap-3">
            <DatabaseIcon className="size-5 text-gold-600" />
            <h2 className="font-display text-lg text-foreground">Database Backup</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Export the entire database to a single JSON file, or import a previously exported
              file. Import is <strong className="text-foreground">additive</strong> — it only adds
              rows that aren&rsquo;t already present (existing data is never overwritten or deleted)
              and runs in one transaction, so a bad file rolls back cleanly.
            </p>
            <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 p-3">
              <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-danger" />
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                The export contains <strong className="text-foreground">sensitive data</strong>{' '}
                (password hashes, ID documents, customer details). Store it somewhere secure and
                never share it. Sessions &amp; auth tokens are excluded.
              </p>
            </div>
            <BackupTools />
          </CardBody>
        </Card>

        {/* System Info */}
        <Card className="border-border/20 bg-card md:col-span-2">
          <CardHeader className="flex flex-row items-center gap-3">
            <ShieldAlertIcon className="size-5 text-gold-600" />
            <h2 className="font-display text-lg text-foreground">System Credentials</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-xl bg-muted p-4 ring-1 ring-border">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gold-600">
                  Signed-in Developer
                </p>
                <p className="mt-1 font-mono text-xs text-foreground">
                  {developer.email ?? developer.id}
                </p>
              </div>
              <div className="rounded-xl bg-muted p-4 ring-1 ring-border">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gold-600">
                  System Role
                </p>
                <p className="mt-1 font-mono text-xs text-danger">DEVELOPER (Root)</p>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Guidelines */}
        <Card className="border-border/20 bg-card md:col-span-2">
          <CardHeader className="flex flex-row items-center gap-3">
            <InfoIcon className="size-5 text-muted-foreground" />
            <h2 className="font-display text-lg text-foreground">Developer Guidelines</h2>
          </CardHeader>
          <CardBody className="grid grid-cols-1 gap-6 text-sm sm:grid-cols-3">
            <div className="space-y-2">
              <h4 className="font-bold text-gold-600">TESTER Role</h4>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Create or promote accounts to TESTER role to use sandbox features. These accounts
                are isolated from real business metrics during cleanup.
              </p>
            </div>
            <div className="space-y-2">
              <h4 className="font-bold text-gold-600">Virtual Payments</h4>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Virtual payments record the full amount in the DB but do not contact the payment
                gateway. This allows testing the full confirmation and QR code flow.
              </p>
            </div>
            <div className="space-y-2">
              <h4 className="font-bold text-gold-600">Audit Logs</h4>
              <p className="text-xs leading-relaxed text-muted-foreground">
                All developer actions (Sandbox toggle, Cleanup) are recorded in the system audit
                logs for security transparency.
              </p>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
