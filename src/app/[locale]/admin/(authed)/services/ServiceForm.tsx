'use client';

import { useState, useTransition } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { ErrorIllustration } from '@/components/ui/ErrorIllustration';
import { MediaUploadInput } from '@/components/admin/MediaUploadInput';

type ActionResult = { ok: false; code: string; fields?: Record<string, string[]> };

interface Props {
  action: (formData: FormData) => Promise<ActionResult | void>;
  categories: Array<{ id: string; nameEn: string; slug: string }>;
  defaultValues?: {
    categoryId?: string;
    slug?: string;
    nameEn?: string;
    nameAr?: string;
    descEn?: string;
    descAr?: string;
    longDescEn?: string | null;
    longDescAr?: string | null;
    highlightsEn?: string[] | null;
    highlightsAr?: string[] | null;
    galleryUrls?: string[] | null;
    kind?: 'DAY_USE' | 'CABANA' | 'EVENT' | 'OTHER';
    coverUrl?: string;
    /** Per-person price in piastres (DB unit). The form displays it as EGP. Covers the 1st person. */
    basePriceCents?: number;
    /** Price for each additional person beyond the included allowance, in piastres. */
    extraPersonPriceCents?: number;
    /** Per-car price in piastres. Loaded from the service's existing PER_CAR rule. */
    perCarPriceCents?: number;
    // Per-unit people & extra-people behaviour.
    includedPersonsPerUnit?: number;
    maxPersonsPerUnit?: number | null;
    allowExtraPeople?: boolean;
    extraPersonMode?: 'NEW_UNIT' | 'EXTRA_CHARGE';
    maxExtraPersonsPerUnit?: number | null;
    // Children.
    allowChildren?: boolean;
    maxChildAge?: number;
    freeChildrenPerUnit?: number;
    maxChildrenPerBooking?: number | null;
    extraChildPriceCents?: number;
    childrenCountAsPersons?: boolean;
    // Insurance deposit (docs/INSURANCE.md).
    insuranceEnabled?: boolean;
    insuranceType?: 'PERCENT' | 'FIXED';
    insurancePercent?: number;
    /** Fixed deposit in piastres (DB unit). The form displays it as EGP. */
    insuranceFixedCents?: number;
    // Multi-day.
    allowMultiDay?: boolean;
    maxBookingDays?: number | null;
    // Place assignment.
    placeAssignmentRequired?: boolean;
    placeType?: 'CABIN' | 'CABANA' | 'UMBRELLA' | 'SEAT' | 'SPOT';
    requiresAccessControl?: boolean;
    dailyCapacityPeople?: number | null;
    dailyCapacityCars?: number | null;
    maxPeoplePerBooking?: number | null;
    maxCarsPerBooking?: number | null;
    openTime?: string | null;
    closeTime?: string | null;
    isActive?: boolean;
    sortOrder?: number;
  };
  submitLabel: string;
}

/** Map a server-action error code to a friendly sentence. */
function errorMessage(code: string): string {
  switch (code) {
    case 'slug_taken':
      return 'A service with that slug already exists in this category. Pick a different slug.';
    case 'invalid_input':
      return 'Some fields are missing or invalid. Please review the form.';
    case 'not_found':
      return 'This service no longer exists.';
    default:
      return 'Something went wrong while saving. Please try again.';
  }
}

/** First error message for a given field, or null if the field is OK. */
function fieldError(
  errors: Record<string, string[]> | undefined,
  key: string,
): string | null {
  return errors?.[key]?.[0] ?? null;
}

export function ServiceForm({ action, categories, defaultValues = {}, submitLabel }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>(
    undefined,
  );

  async function onSubmit(formData: FormData) {
    setError(null);
    setFieldErrors(undefined);
    startTransition(async () => {
      try {
        const res = await action(formData);
        if (res && 'ok' in res && !res.ok) {
          setError(errorMessage(res.code));
          setFieldErrors(res.fields);
        }
      } catch (err) {
        if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err;
        setError(errorMessage('unknown'));
      }
    });
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error ? (
        <div
          role="alert"
          className="flex flex-col items-center gap-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-center animate-fade-in"
        >
          <ErrorIllustration type="storm" className="size-20" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="font-bold text-red-700 uppercase tracking-widest">{error}</p>
            {fieldErrors ? (
              <ul className="list-disc space-y-0.5 ps-5 text-[12px] text-red-600 text-start">
                {Object.entries(fieldErrors).map(([k, msgs]) => (
                  <li key={k}>
                    <span className="font-bold tracking-wider uppercase text-[10px]">{k}</span> — {msgs.join(', ')}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-600">basics</h2>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="categoryId">category</Label>
            <select
              id="categoryId"
              name="categoryId"
              required
              defaultValue={defaultValues.categoryId ?? ''}
              dir="ltr"
              className={cn(
                'block h-12 w-full rounded-2xl border bg-input px-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent',
                fieldError(fieldErrors, 'categoryId') ? 'border-danger/60' : 'border-border/60'
              )}
            >
              <option value="" disabled>
                —
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.slug} · {c.nameEn}
                </option>
              ))}
            </select>
            {fieldError(fieldErrors, 'categoryId') && (
              <p className="mt-1 text-xs text-danger">{fieldError(fieldErrors, 'categoryId')}</p>
            )}
          </div>
          <div>
            <Label htmlFor="slug">slug</Label>
            <Input
              id="slug"
              name="slug"
              required
              dir="ltr"
              defaultValue={defaultValues.slug}
              pattern="[a-z0-9-]+"
              placeholder="day-use"
              invalid={!!fieldError(fieldErrors, 'slug')}
            />
            {fieldError(fieldErrors, 'slug') ? (
              <p className="mt-1 text-xs text-danger">{fieldError(fieldErrors, 'slug')}</p>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Lowercase letters, digits, hyphens — no spaces.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="nameEn">name (EN)</Label>
            <Input 
              id="nameEn" 
              name="nameEn" 
              required 
              dir="ltr" 
              defaultValue={defaultValues.nameEn} 
              invalid={!!fieldError(fieldErrors, 'nameEn')}
            />
            {fieldError(fieldErrors, 'nameEn') && (
              <p className="mt-1 text-xs text-danger">{fieldError(fieldErrors, 'nameEn')}</p>
            )}
          </div>
          <div>
            <Label htmlFor="nameAr">name (AR)</Label>
            <Input 
              id="nameAr" 
              name="nameAr" 
              required 
              defaultValue={defaultValues.nameAr} 
              invalid={!!fieldError(fieldErrors, 'nameAr')}
            />
            {fieldError(fieldErrors, 'nameAr') && (
              <p className="mt-1 text-xs text-danger">{fieldError(fieldErrors, 'nameAr')}</p>
            )}
          </div>
          <div>
            <Label htmlFor="kind">category type</Label>
            <select
              id="kind"
              name="kind"
              defaultValue={defaultValues.kind ?? 'DAY_USE'}
              dir="ltr"
              className={cn(
                'block h-12 w-full rounded-2xl border bg-input px-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent',
                fieldError(fieldErrors, 'kind') ? 'border-danger/60' : 'border-border/60'
              )}
            >
              <option value="DAY_USE">Beach — one umbrella covers N adults (included persons per unit); extra adults open another umbrella; children capped per umbrella</option>
              <option value="CABANA">Cabana — 4 adults + 2 children per ticket, extras = new ticket</option>
              <option value="EVENT">Event — charged per person</option>
              <option value="OTHER">Other — legacy per-person pricing</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Drives how guests are counted and priced. Beach &amp; Cabana use the
              ticket prices below; Event multiplies the base price per person.
            </p>
          </div>
          <div>
            <Label htmlFor="sortOrder">sortOrder</Label>
            <Input
              id="sortOrder"
              name="sortOrder"
              type="number"
              dir="ltr"
              defaultValue={defaultValues.sortOrder ?? 0}
              invalid={!!fieldError(fieldErrors, 'sortOrder')}
            />
            {fieldError(fieldErrors, 'sortOrder') && (
              <p className="mt-1 text-xs text-danger">{fieldError(fieldErrors, 'sortOrder')}</p>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-600">description · cover</h2>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="descEn">description (EN)</Label>
            <textarea
              id="descEn"
              name="descEn"
              rows={4}
              dir="ltr"
              defaultValue={defaultValues.descEn ?? ''}
              className={cn(
                'block w-full rounded-2xl border bg-input p-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent',
                fieldError(fieldErrors, 'descEn') ? 'border-danger/60' : 'border-border/60'
              )}
            />
            {fieldError(fieldErrors, 'descEn') && (
              <p className="mt-1 text-xs text-danger">{fieldError(fieldErrors, 'descEn')}</p>
            )}
          </div>
          <div>
            <Label htmlFor="descAr">description (AR)</Label>
            <textarea
              id="descAr"
              name="descAr"
              rows={4}
              defaultValue={defaultValues.descAr ?? ''}
              className={cn(
                'block w-full rounded-2xl border bg-input p-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent',
                fieldError(fieldErrors, 'descAr') ? 'border-danger/60' : 'border-border/60'
              )}
            />
            {fieldError(fieldErrors, 'descAr') && (
              <p className="mt-1 text-xs text-danger">{fieldError(fieldErrors, 'descAr')}</p>
            )}
          </div>
          <div className="md:col-span-2">
            <MediaUploadInput
              name="coverUrl"
              label="cover image"
              accept="image"
              defaultValue={defaultValues.coverUrl}
              error={fieldError(fieldErrors, 'coverUrl')}
              hint="The hero photo customers see on the service card. Auto-compressed to ≤1MB before upload."
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-600">extended content</h2>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="longDescEn">long description (EN)</Label>
            <textarea
              id="longDescEn"
              name="longDescEn"
              rows={6}
              dir="ltr"
              defaultValue={defaultValues.longDescEn ?? ''}
              className="block w-full rounded-2xl border border-border/60 bg-input p-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <Label htmlFor="longDescAr">long description (AR)</Label>
            <textarea
              id="longDescAr"
              name="longDescAr"
              rows={6}
              defaultValue={defaultValues.longDescAr ?? ''}
              className="block w-full rounded-2xl border border-border/60 bg-input p-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <Label htmlFor="highlightsEn">highlights (EN) · one per line</Label>
            <textarea
              id="highlightsEn"
              name="highlightsEn"
              rows={4}
              dir="ltr"
              placeholder="Private terrace&#10;Sunset view"
              defaultValue={defaultValues.highlightsEn?.join('\n') ?? ''}
              className="block w-full rounded-2xl border border-border/60 bg-input p-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <Label htmlFor="highlightsAr">highlights (AR) · one per line</Label>
            <textarea
              id="highlightsAr"
              name="highlightsAr"
              rows={4}
              placeholder="تراس خاص&#10;إطلالة على الغروب"
              defaultValue={defaultValues.highlightsAr?.join('\n') ?? ''}
              className="block w-full rounded-2xl border border-border/60 bg-input p-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="galleryUrls">gallery images · one URL per line</Label>
            <textarea
              id="galleryUrls"
              name="galleryUrls"
              rows={4}
              dir="ltr"
              placeholder="https://..."
              defaultValue={defaultValues.galleryUrls?.join('\n') ?? ''}
              className="block w-full rounded-2xl border border-border/60 bg-input p-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-600">operational hours</h2>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="openTime">opening time</Label>
            <input
              id="openTime"
              name="openTime"
              type="time"
              defaultValue={defaultValues.openTime ?? '09:00'}
              className="block h-12 w-full rounded-2xl border border-border/60 bg-input px-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <Label htmlFor="closeTime">closing time</Label>
            <input
              id="closeTime"
              name="closeTime"
              type="time"
              defaultValue={defaultValues.closeTime ?? '18:00'}
              className="block h-12 w-full rounded-2xl border border-border/60 bg-input px-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-600">pricing · capacity</h2>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="pricePerPersonEgp">base ticket price (EGP)</Label>
            <Input
              id="pricePerPersonEgp"
              name="pricePerPersonEgp"
              type="number"
              min={0}
              step="0.01"
              required
              dir="ltr"
              defaultValue={
                defaultValues.basePriceCents != null
                  ? (defaultValues.basePriceCents / 100).toString()
                  : ''
              }
              placeholder="100"
              invalid={!!fieldError(fieldErrors, 'basePriceCents')}
            />
            {fieldError(fieldErrors, 'basePriceCents') ? (
              <p className="mt-1 text-xs text-danger">{fieldError(fieldErrors, 'basePriceCents')}</p>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">
                The active price charged for the ticket (covers the first person). This is the
                single source of truth — it&apos;s what guests pay.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="extraPersonPriceEgp">extra person price (EGP)</Label>
            <Input
              id="extraPersonPriceEgp"
              name="extraPersonPriceEgp"
              type="number"
              min={0}
              step="0.01"
              required
              dir="ltr"
              defaultValue={
                defaultValues.extraPersonPriceCents != null
                  ? (defaultValues.extraPersonPriceCents / 100).toString()
                  : ''
              }
              placeholder="50"
              invalid={!!fieldError(fieldErrors, 'extraPersonPriceCents')}
            />
            {fieldError(fieldErrors, 'extraPersonPriceCents') ? (
              <p className="mt-1 text-xs text-danger">{fieldError(fieldErrors, 'extraPersonPriceCents')}</p>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Price charged per person on the &quot;Extra Person&quot; add-on counter (enabled
                below). Billed as its own line; does not change the umbrella/cabana count.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="pricePerCarEgp">price per car (EGP)</Label>
            <Input
              id="pricePerCarEgp"
              name="pricePerCarEgp"
              type="number"
              min={0}
              step="0.01"
              dir="ltr"
              defaultValue={
                defaultValues.perCarPriceCents != null
                  ? (defaultValues.perCarPriceCents / 100).toString()
                  : ''
              }
              placeholder="0"
              invalid={!!fieldError(fieldErrors, 'perCarPriceCents')}
            />
            {fieldError(fieldErrors, 'perCarPriceCents') ? (
              <p className="mt-1 text-xs text-danger">{fieldError(fieldErrors, 'perCarPriceCents')}</p>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Optional. Leave 0 if cars are included in the per-person price.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="dailyCapacityPeople">dailyCapacityPeople</Label>
            <Input
              id="dailyCapacityPeople"
              name="dailyCapacityPeople"
              type="number"
              min={0}
              dir="ltr"
              defaultValue={defaultValues.dailyCapacityPeople ?? ''}
              invalid={!!fieldError(fieldErrors, 'dailyCapacityPeople')}
            />
            {fieldError(fieldErrors, 'dailyCapacityPeople') ? (
              <p className="mt-1 text-xs text-danger">{fieldError(fieldErrors, 'dailyCapacityPeople')}</p>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Max sold per day. For beach/cabana this counts UNITS (umbrellas/cabanas), not guests;
                for events it counts people. Required (&gt; 0) when place assignment is on — it&apos;s the
                only daily sell limit; leaving it blank for a place service allows overbooking.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="dailyCapacityCars">dailyCapacityCars</Label>
            <Input
              id="dailyCapacityCars"
              name="dailyCapacityCars"
              type="number"
              min={0}
              dir="ltr"
              defaultValue={defaultValues.dailyCapacityCars ?? ''}
              invalid={!!fieldError(fieldErrors, 'dailyCapacityCars')}
            />
            {fieldError(fieldErrors, 'dailyCapacityCars') ? (
              <p className="mt-1 text-xs text-danger">{fieldError(fieldErrors, 'dailyCapacityCars')}</p>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Daily car limit. Blank = unlimited; enter 0 to forbid cars.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="maxPeoplePerBooking">maxPeoplePerBooking</Label>
            <Input
              id="maxPeoplePerBooking"
              name="maxPeoplePerBooking"
              type="number"
              min={1}
              dir="ltr"
              defaultValue={defaultValues.maxPeoplePerBooking ?? ''}
              invalid={!!fieldError(fieldErrors, 'maxPeoplePerBooking')}
            />
            {fieldError(fieldErrors, 'maxPeoplePerBooking') && (
              <p className="mt-1 text-xs text-danger">{fieldError(fieldErrors, 'maxPeoplePerBooking')}</p>
            )}
          </div>
          <div>
            <Label htmlFor="maxCarsPerBooking">maxCarsPerBooking</Label>
            <Input
              id="maxCarsPerBooking"
              name="maxCarsPerBooking"
              type="number"
              min={0}
              dir="ltr"
              defaultValue={defaultValues.maxCarsPerBooking ?? ''}
              invalid={!!fieldError(fieldErrors, 'maxCarsPerBooking')}
            />
            {fieldError(fieldErrors, 'maxCarsPerBooking') && (
              <p className="mt-1 text-xs text-danger">{fieldError(fieldErrors, 'maxCarsPerBooking')}</p>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-600">insurance deposit</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            A refundable deposit collected together with the booking payment and returned
            (or retained, with a reason) at reception checkout. It is a SEPARATE balance:
            promo codes and manual discounts never reduce it. Changes apply to NEW bookings
            only — existing bookings keep the deposit they were charged.
          </p>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <input
                type="checkbox"
                name="insuranceEnabled"
                defaultChecked={defaultValues.insuranceEnabled ?? false}
                className="size-5 rounded border-border/60 bg-input accent-accent"
              />
              <span className="text-foreground">collect an insurance deposit on this service</span>
            </label>
          </div>
          <div>
            <Label htmlFor="insuranceType">calculation type</Label>
            <select
              id="insuranceType"
              name="insuranceType"
              defaultValue={defaultValues.insuranceType ?? 'FIXED'}
              className="block h-12 w-full rounded-2xl border border-border/60 bg-input px-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="FIXED">Fixed amount (EGP)</option>
              <option value="PERCENT">Percentage of the service total</option>
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Percentage is computed from the service total BEFORE any discount, so a
              voucher can never shrink the deposit.
            </p>
          </div>
          <div>
            <Label htmlFor="insurancePercent">percentage (1–100)</Label>
            <Input
              id="insurancePercent"
              name="insurancePercent"
              type="number"
              min={0}
              max={100}
              dir="ltr"
              defaultValue={defaultValues.insurancePercent || ''}
              placeholder="10"
              invalid={!!fieldError(fieldErrors, 'insurancePercent')}
            />
            {fieldError(fieldErrors, 'insurancePercent') ? (
              <p className="mt-1 text-xs text-danger">{fieldError(fieldErrors, 'insurancePercent')}</p>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Used only when the type is &quot;Percentage&quot;.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="insuranceFixedEgp">fixed deposit (EGP)</Label>
            <Input
              id="insuranceFixedEgp"
              name="insuranceFixedEgp"
              type="number"
              min={0}
              step="0.01"
              dir="ltr"
              defaultValue={
                defaultValues.insuranceFixedCents != null && defaultValues.insuranceFixedCents > 0
                  ? (defaultValues.insuranceFixedCents / 100).toString()
                  : ''
              }
              placeholder="150"
              invalid={!!fieldError(fieldErrors, 'insuranceFixedCents')}
            />
            {fieldError(fieldErrors, 'insuranceFixedCents') ? (
              <p className="mt-1 text-xs text-danger">{fieldError(fieldErrors, 'insuranceFixedCents')}</p>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Used only when the type is &quot;Fixed amount&quot;.
              </p>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-600">people per booking unit</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            A booking unit (cabana / umbrella / seat …) carries up to{' '}
            <strong>included persons</strong> at the base price. Set this to 1 to keep
            classic per-person pricing.
          </p>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="includedPersonsPerUnit">included persons per unit</Label>
            <Input
              id="includedPersonsPerUnit"
              name="includedPersonsPerUnit"
              type="number"
              min={1}
              dir="ltr"
              defaultValue={defaultValues.includedPersonsPerUnit ?? 1}
              invalid={!!fieldError(fieldErrors, 'includedPersonsPerUnit')}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              People covered by one unit&apos;s base price. For BEACH this is the umbrella&apos;s
              ADULT capacity — e.g. 4 adults per umbrella; a 5th adult opens another umbrella
              (children never use this space).
            </p>
          </div>
          <div>
            <Label htmlFor="maxPersonsPerUnit">max persons per unit (hard cap)</Label>
            <Input
              id="maxPersonsPerUnit"
              name="maxPersonsPerUnit"
              type="number"
              min={1}
              dir="ltr"
              defaultValue={defaultValues.maxPersonsPerUnit ?? ''}
              invalid={!!fieldError(fieldErrors, 'maxPersonsPerUnit')}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Physical limit when charging extra people. Blank = no over-fill.
            </p>
          </div>
          <div className="md:col-span-2">
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <input
                type="checkbox"
                name="allowExtraPeople"
                defaultChecked={defaultValues.allowExtraPeople ?? false}
                className="size-5 rounded border-border/60 bg-input accent-accent"
              />
              <span className="text-foreground">
                offer a paid &quot;Extra Person&quot; add-on counter on the booking page
              </span>
            </label>
            <p className="mt-1 ps-8 text-[11px] text-muted-foreground">
              Shows customers a separate Extra Person stepper (beside adults / children / cars) on
              beach &amp; cabana services. Each extra person is billed at the <strong>extra person
              price</strong> above as its own line — it never opens another umbrella/cabana nor
              counts toward capacity.
            </p>
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="maxExtraPersonsPerUnit">max extra persons per unit</Label>
            <Input
              id="maxExtraPersonsPerUnit"
              name="maxExtraPersonsPerUnit"
              type="number"
              min={1}
              dir="ltr"
              defaultValue={defaultValues.maxExtraPersonsPerUnit ?? ''}
              invalid={!!fieldError(fieldErrors, 'maxExtraPersonsPerUnit')}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Cap on the Extra Person counter PER UNIT — e.g. 2 here lets a 2-umbrella booking add
              up to 4 extra persons (scales with the umbrella/cabana count). Blank = no limit.
            </p>
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="extraPersonMode">when the party exceeds the included allowance…</Label>
            <select
              id="extraPersonMode"
              name="extraPersonMode"
              defaultValue={defaultValues.extraPersonMode ?? 'NEW_UNIT'}
              dir="ltr"
              className="block h-12 w-full rounded-2xl border border-border/60 bg-input px-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="NEW_UNIT">NEW_UNIT — add another booking unit (e.g. 6 people → 2 cabanas)</option>
              <option value="EXTRA_CHARGE">EXTRA_CHARGE — keep one unit, charge per extra person</option>
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              EXTRA_CHARGE uses the <strong>extra person price</strong> above, up to the hard cap.
            </p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-600">children</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Children are guests up to the maximum child age (declared to customers on the
            booking page).
          </p>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <input
                type="checkbox"
                name="allowChildren"
                defaultChecked={defaultValues.allowChildren ?? false}
                className="size-5 rounded border-border/60 bg-input accent-accent"
              />
              <span className="text-foreground">allow children on this service</span>
            </label>
          </div>
          <div>
            <Label htmlFor="maxChildAge">maximum child AGE (years)</Label>
            <Input
              id="maxChildAge"
              name="maxChildAge"
              type="number"
              min={0}
              max={17}
              dir="ltr"
              defaultValue={defaultValues.maxChildAge ?? 8}
              invalid={!!fieldError(fieldErrors, 'maxChildAge')}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Age threshold — a guest at or below this age counts as a child. This is NOT a
              limit on how many children can be booked.
            </p>
          </div>
          <div>
            <Label htmlFor="maxChildrenPerBooking">maximum children per booking</Label>
            <Input
              id="maxChildrenPerBooking"
              name="maxChildrenPerBooking"
              type="number"
              min={1}
              dir="ltr"
              defaultValue={defaultValues.maxChildrenPerBooking ?? ''}
              invalid={!!fieldError(fieldErrors, 'maxChildrenPerBooking')}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Cabana / event: hard cap on total children per booking. BEACH: this is PER
              UMBRELLA — e.g. 3 here means a 2-umbrella booking allows 6 children. Blank = no limit.
            </p>
          </div>
          <div>
            <Label htmlFor="freeChildrenPerUnit">free children per unit</Label>
            <Input
              id="freeChildrenPerUnit"
              name="freeChildrenPerUnit"
              type="number"
              min={0}
              dir="ltr"
              defaultValue={defaultValues.freeChildrenPerUnit ?? 0}
              invalid={!!fieldError(fieldErrors, 'freeChildrenPerUnit')}
            />
          </div>
          <div>
            <Label htmlFor="extraChildPriceEgp">extra child price (EGP)</Label>
            <Input
              id="extraChildPriceEgp"
              name="extraChildPriceEgp"
              type="number"
              min={0}
              step="0.01"
              dir="ltr"
              defaultValue={
                defaultValues.extraChildPriceCents != null
                  ? (defaultValues.extraChildPriceCents / 100).toString()
                  : ''
              }
              placeholder="0"
            />
          </div>
          <div className="flex flex-col justify-end">
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <input
                type="checkbox"
                name="childrenCountAsPersons"
                defaultChecked={defaultValues.childrenCountAsPersons ?? false}
                className="size-5 rounded border-border/60 bg-input accent-accent"
              />
              <span className="text-foreground">count children as people</span>
            </label>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Advanced (cabana / event only). Does NOT affect beach — beach children never
              use umbrella space; their limit is &quot;maximum children&quot; per umbrella.
            </p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-600">multi-day · place assignment</h2>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <input
                type="checkbox"
                name="allowMultiDay"
                defaultChecked={defaultValues.allowMultiDay ?? false}
                className="size-5 rounded border-border/60 bg-input accent-accent"
              />
              <span className="text-foreground">allow multi-day bookings</span>
            </label>
          </div>
          <div>
            <Label htmlFor="maxBookingDays">max days per booking</Label>
            <Input
              id="maxBookingDays"
              name="maxBookingDays"
              type="number"
              min={1}
              dir="ltr"
              defaultValue={defaultValues.maxBookingDays ?? ''}
              invalid={!!fieldError(fieldErrors, 'maxBookingDays')}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">Blank = no limit.</p>
          </div>
          <div className="md:col-span-2">
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <input
                type="checkbox"
                name="placeAssignmentRequired"
                defaultChecked={defaultValues.placeAssignmentRequired ?? false}
                className="size-5 rounded border-border/60 bg-input accent-accent"
              />
              <span className="text-foreground">
                require reception/gate to assign a physical place before check-in
              </span>
            </label>
          </div>
          <div>
            <Label htmlFor="placeType">place type</Label>
            <select
              id="placeType"
              name="placeType"
              defaultValue={defaultValues.placeType ?? 'SEAT'}
              dir="ltr"
              className="block h-12 w-full rounded-2xl border border-border/60 bg-input px-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="CABIN">CABIN</option>
              <option value="CABANA">CABANA</option>
              <option value="UMBRELLA">UMBRELLA</option>
              <option value="SEAT">SEAT</option>
              <option value="SPOT">SPOT</option>
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Manage the actual places under <strong>Edit → Places</strong> after saving.
            </p>
          </div>
          <div className="md:col-span-2">
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="requiresAccessControl"
                defaultChecked={defaultValues.requiresAccessControl ?? false}
                className="mt-0.5 size-5 rounded border-border/60 bg-input accent-accent"
              />
              <span className="text-foreground">
                requires ZK access control — provision each guest a card + door QR on
                confirmation so they can unlock their assigned cabin (needs place
                assignment on; set each place’s ZK level under <strong>Edit → Places</strong>)
              </span>
            </label>
            {fieldError(fieldErrors, 'requiresAccessControl') ? (
              <p className="mt-1 text-[11px] text-red-600">
                {fieldError(fieldErrors, 'requiresAccessControl')}
              </p>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={defaultValues.isActive ?? true}
              className="size-5 rounded border-border/60 bg-input accent-accent"
            />
            <span className="text-foreground">isActive</span>
          </label>
          <Button type="submit" variant="primary" size="md" loading={isPending}>
            {submitLabel}
          </Button>
        </CardBody>
      </Card>
    </form>
  );
}
