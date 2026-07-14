'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { AlertTriangleIcon, CheckCircle2Icon, FilmIcon, HeadphonesIcon, KeyRoundIcon, LockIcon, MailIcon, PhoneIcon, ShieldIcon } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Button } from '@/components/ui/Button';
import { MediaUploadInput } from '@/components/admin/MediaUploadInput';
import {
  updateSettingsAction,
  type UpdateSettingsResult,
} from '@/features/admin/settings-actions';

// Admin-facing day labels (the dashboard's chrome is English); index = JS getDay().
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface Props {
  initialValues: {
    siteName: string;
    supportEmail: string;
    supportPhone: string;
    adminNotifyEmail: string;
    defaultCurrency: string;
    defaultLocale: 'ar' | 'en';
    bookingLeadTimeHours: number;
    cancellationCutoffHours: number;
    holdTtlMinutes: number;
    bookingsEnabled: boolean;
    heroVideoUrl: string;
    heroPosterUrl: string;
    supportOpenDay: number;
    supportCloseDay: number;
    supportOpenTime: string;
    supportCloseTime: string;
    zkEnabled: boolean;
    zkServerUrl: string;
    zkServerPort: number | null;
    zkGuestDeptCode: string;
  };
  /** Whether the ZK_ACCESS_TOKEN secret is present in the environment. */
  zkTokenPresent: boolean;
}

/** Group header used inside each section card — kept tight. */
function SectionHeader({
  title,
  subtitle,
  Icon,
}: {
  title: string;
  subtitle?: string;
  Icon?: typeof MailIcon;
}) {
  return (
    <CardHeader>
      <div className="flex items-center gap-2">
        {Icon ? <Icon className="size-4 text-gold-600" /> : null}
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold-600">
          {title}
        </p>
      </div>
      {subtitle ? (
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{subtitle}</p>
      ) : null}
    </CardHeader>
  );
}

export function SettingsForm({ initialValues, zkTokenPresent }: Props) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<UpdateSettingsResult | null>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResult(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateSettingsAction(formData);
      setResult(res);
    });
  }

  return (
    <form className="space-y-4 stagger" onSubmit={onSubmit}>
      {/* ─── Result banner — sticky to the top of the form ─── */}
      {result?.ok ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.08] px-4 py-3 text-sm text-emerald-700"
        >
          <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" />
          <p>Settings saved. New values are active immediately.</p>
        </div>
      ) : null}
      {result && !result.ok ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700"
        >
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <div>
            <p>
              {result.code === 'save_failed'
                ? 'Could not save — something went wrong on our end. Your change was not applied. Please try again.'
                : 'Some values are invalid — please review the highlighted fields.'}
            </p>
            {result.code === 'invalid_input' && result.fields ? (
              <ul className="mt-1.5 list-disc ps-5 text-[12px] text-red-600">
                {Object.entries(result.fields).map(([k, msgs]) => (
                  <li key={k}>
                    <span className="font-display tracking-[0.12em]">{k}</span>:{' '}
                    {msgs.join(', ')}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ─── 1. Brand ─── */}
      <Card>
        <SectionHeader
          title="Brand"
          subtitle="Public name and contact info shown on receipts, the support screen, and outbound emails."
          Icon={ShieldIcon}
        />
        <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label htmlFor="siteName">Site name</Label>
            <Input
              id="siteName"
              name="siteName"
              required
              maxLength={120}
              defaultValue={initialValues.siteName}
              placeholder="Crown Island"
            />
          </div>
          <div>
            <Label htmlFor="supportEmail">Support email</Label>
            <div className="relative">
              <Input
                id="supportEmail"
                name="supportEmail"
                type="email"
                inputMode="email"
                dir="ltr"
                defaultValue={initialValues.supportEmail}
                placeholder="support@your-domain.com"
                className="ps-11"
              />
              <MailIcon className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-gold-600" />
            </div>
          </div>
          <div>
            <Label htmlFor="supportPhone">Support phone</Label>
            <div className="relative">
              <Input
                id="supportPhone"
                name="supportPhone"
                type="tel"
                inputMode="tel"
                dir="ltr"
                defaultValue={initialValues.supportPhone}
                placeholder="+20 1xx xxx xxxx"
                className="ps-11"
              />
              <PhoneIcon className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-gold-600" />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ─── 2. Booking ─── */}
      <Card>
        <SectionHeader
          title="Booking"
          subtitle="Controls how customers can book and cancel. Limits are enforced server-side."
        />
        <CardBody className="space-y-4">
          {/* Maintenance toggle — visually emphasised since it's a big switch */}
          <label
            htmlFor="bookingsEnabled"
            className="flex cursor-pointer items-start justify-between gap-3 rounded-2xl border border-gold-400/20 bg-card/40 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-foreground">Bookings enabled</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                When off, the customer booking screens show a maintenance state
                and refuse new reservations. Existing bookings are unaffected.
              </p>
            </div>
            <input
              id="bookingsEnabled"
              type="checkbox"
              name="bookingsEnabled"
              defaultChecked={initialValues.bookingsEnabled}
              className="mt-1 size-5 rounded border-gold-400/30 bg-card/80 accent-accent"
            />
          </label>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="bookingLeadTimeHours">Lead time (hours)</Label>
              <Input
                id="bookingLeadTimeHours"
                name="bookingLeadTimeHours"
                type="number"
                min={0}
                max={24 * 30}
                dir="ltr"
                defaultValue={initialValues.bookingLeadTimeHours}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Minimum hours between now and the booking date. 0 allows same-day.
              </p>
            </div>
            <div>
              <Label htmlFor="cancellationCutoffHours">Cancellation cutoff (hours)</Label>
              <Input
                id="cancellationCutoffHours"
                name="cancellationCutoffHours"
                type="number"
                min={0}
                max={24 * 30}
                dir="ltr"
                defaultValue={initialValues.cancellationCutoffHours}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Hours before the booking date when a customer can still cancel.
              </p>
            </div>
            <div>
              <Label htmlFor="holdTtlMinutes">Hold TTL (minutes)</Label>
              <Input
                id="holdTtlMinutes"
                name="holdTtlMinutes"
                type="number"
                min={1}
                max={60 * 24}
                dir="ltr"
                defaultValue={initialValues.holdTtlMinutes}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                How long an unpaid booking holds its slot before expiring.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ─── 3. Notifications ─── */}
      <Card>
        <SectionHeader
          title="Notifications"
          subtitle="Where operations alerts are sent. Customer-facing emails are still managed via the email provider."
          Icon={MailIcon}
        />
        <CardBody>
          <Label htmlFor="adminNotifyEmail">Admin notify email</Label>
          <div className="relative">
            <Input
              id="adminNotifyEmail"
              name="adminNotifyEmail"
              type="email"
              inputMode="email"
              dir="ltr"
              defaultValue={initialValues.adminNotifyEmail}
              placeholder="ops@your-domain.com"
              className="ps-11"
            />
            <MailIcon className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-gold-600" />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            New-booking alerts go here. Leave blank to fall back to the
            ADMIN_BOOTSTRAP_EMAIL env var.
          </p>
        </CardBody>
      </Card>

      {/* ─── 4. Display ─── */}
      <Card>
        <SectionHeader
          title="Display"
          subtitle="Defaults shown to visitors who haven't picked a locale or currency yet."
        />
        <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="defaultLocale">Default locale</Label>
            <select
              id="defaultLocale"
              name="defaultLocale"
              defaultValue={initialValues.defaultLocale}
              dir="ltr"
              className="block h-12 w-full rounded-2xl border border-border/60 bg-input px-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="ar">Arabic — العربية</option>
              <option value="en">English</option>
            </select>
          </div>
          <div>
            <Label htmlFor="defaultCurrency">Default currency (ISO 4217)</Label>
            <Input
              id="defaultCurrency"
              name="defaultCurrency"
              dir="ltr"
              maxLength={6}
              required
              defaultValue={initialValues.defaultCurrency}
              placeholder="EGP"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Uppercase code such as <span className="font-display">EGP</span>,
              <span className="font-display"> USD</span>,
              <span className="font-display"> AED</span>.
            </p>
          </div>
        </CardBody>
      </Card>

      {/* ─── 5. Homepage hero video ─── */}
      <Card>
        <SectionHeader
          title="Homepage hero video"
          subtitle="A single video that plays full-width at the very top of the booking page, in place of the rotating photo spotlight. It autoplays muted on a loop. Leave the video blank to keep the rotating spotlight."
          Icon={FilmIcon}
        />
        <CardBody className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <MediaUploadInput
            name="heroVideoUrl"
            accept="video"
            label="Hero video"
            defaultValue={initialValues.heroVideoUrl}
            hint="MP4 or WebM, up to 100MB. Best as a short, silent, looping clip."
          />
          <MediaUploadInput
            name="heroPosterUrl"
            accept="image"
            label="Poster image"
            defaultValue={initialValues.heroPosterUrl}
            hint="Shown instantly while the video loads, then it fades to the video. Also the still shown to visitors who prefer reduced motion."
          />
        </CardBody>
      </Card>

      {/* ─── 6. Support availability ─── */}
      <Card>
        <SectionHeader
          title="Support availability"
          subtitle="Working days and hours shown on the customer Support page. Drives the localized hours line and the live “available now / currently closed” status (resort time)."
          Icon={HeadphonesIcon}
        />
        <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="supportOpenDay">Open from (day)</Label>
            <select
              id="supportOpenDay"
              name="supportOpenDay"
              defaultValue={String(initialValues.supportOpenDay)}
              dir="ltr"
              className="block h-12 w-full rounded-2xl border border-border/60 bg-input px-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="supportCloseDay">Open until (day)</Label>
            <select
              id="supportCloseDay"
              name="supportCloseDay"
              defaultValue={String(initialValues.supportCloseDay)}
              dir="ltr"
              className="block h-12 w-full rounded-2xl border border-border/60 bg-input px-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="supportOpenTime">Opens at</Label>
            <Input
              id="supportOpenTime"
              name="supportOpenTime"
              type="time"
              dir="ltr"
              required
              defaultValue={initialValues.supportOpenTime}
            />
          </div>
          <div>
            <Label htmlFor="supportCloseTime">Closes at</Label>
            <Input
              id="supportCloseTime"
              name="supportCloseTime"
              type="time"
              dir="ltr"
              required
              defaultValue={initialValues.supportCloseTime}
            />
          </div>
          <p className="text-[11px] text-muted-foreground md:col-span-2">
            The day range wraps around the week — e.g. Saturday → Thursday means open every day except Friday.
          </p>
        </CardBody>
      </Card>

      {/* ─── 7. ZKBio access control ─── */}
      <Card>
        <SectionHeader
          title="ZKBio access control"
          subtitle="Physical cabin-door access via an on-prem ZKBio CVSecurity server. When enabled, confirming a booking for a service flagged “requires access control” provisions the guest a card + door-opening QR. The API token is a secret and lives in the ZK_ACCESS_TOKEN env var — never here."
          Icon={KeyRoundIcon}
        />
        <CardBody className="space-y-4">
          <label
            htmlFor="zkEnabled"
            className="flex cursor-pointer items-start justify-between gap-3 rounded-2xl border border-gold-400/20 bg-card/40 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-foreground">Enable ZK integration</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                When off, cabin bookings behave like normal gate-QR bookings and no
                ZK calls are made. Turning it on requires a server URL below and the
                ZK_ACCESS_TOKEN env var.
              </p>
            </div>
            <input
              id="zkEnabled"
              type="checkbox"
              name="zkEnabled"
              defaultChecked={initialValues.zkEnabled}
              className="mt-1 size-5 rounded border-gold-400/30 bg-card/80 accent-accent"
            />
          </label>

          <div
            className={`flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-[12px] ${
              zkTokenPresent
                ? 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700'
                : 'border-amber-500/30 bg-amber-500/[0.06] text-amber-700'
            }`}
          >
            {zkTokenPresent ? (
              <CheckCircle2Icon className="size-4 shrink-0" />
            ) : (
              <AlertTriangleIcon className="size-4 shrink-0" />
            )}
            <span>
              <span className="font-display tracking-[0.12em]">ZK_ACCESS_TOKEN</span>{' '}
              {zkTokenPresent
                ? 'is set in the environment.'
                : 'is NOT set — provisioning will stay pending until it is added to the server env.'}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label htmlFor="zkServerUrl">Server URL</Label>
              <Input
                id="zkServerUrl"
                name="zkServerUrl"
                type="url"
                dir="ltr"
                maxLength={200}
                defaultValue={initialValues.zkServerUrl}
                placeholder="https://192.168.1.100"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Scheme + host of the ZKBio server, reachable from this app (LAN / VPN).
                Must start with http:// or https://.
              </p>
            </div>
            <div>
              <Label htmlFor="zkServerPort">Server port</Label>
              <Input
                id="zkServerPort"
                name="zkServerPort"
                type="number"
                min={1}
                max={65535}
                dir="ltr"
                defaultValue={initialValues.zkServerPort ?? ''}
                placeholder="8098"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Optional — leave blank if the port is already part of the URL.
              </p>
            </div>
            <div>
              <Label htmlFor="zkGuestDeptCode">Guest department code</Label>
              <Input
                id="zkGuestDeptCode"
                name="zkGuestDeptCode"
                dir="ltr"
                maxLength={64}
                defaultValue={initialValues.zkGuestDeptCode}
                placeholder="GUESTS"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Department guests are created under in ZKBio. Default “GUESTS”.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card variant="glass">
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <p className="inline-flex items-center gap-2 text-[12px] text-muted-foreground">
            <LockIcon className="size-3.5" />
            <span>Audited — your change is recorded against your admin account.</span>
          </p>
          <Button type="submit" variant="primary" size="md" loading={isPending}>
            Save settings
          </Button>
        </CardBody>
      </Card>
    </form>
  );
}
