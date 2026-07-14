'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Button } from '@/components/ui/Button';
import { ErrorIllustration } from '@/components/ui/ErrorIllustration';
import { MediaUploadInput } from '@/components/admin/MediaUploadInput';
import { MediaGalleryUpload } from '@/components/admin/MediaGalleryUpload';

type ActionResult = { ok: false; code: string; fields?: Record<string, string[]> };

interface Props {
  action: (formData: FormData) => Promise<ActionResult | void>;
  /** Category kind to persist. NORMAL (beach) by default; ACTIVITY for the activities section. */
  type?: 'NORMAL' | 'ACTIVITY';
  defaultValues?: {
    slug?: string;
    nameEn?: string;
    nameAr?: string;
    descEn?: string;
    descAr?: string;
    longDescEn?: string;
    longDescAr?: string;
    coverUrl?: string;
    /** Category logo / brand mark (light mode) — shown on entry + the ticket. */
    logoUrl?: string;
    /** Dark-mode variant of the logo. */
    logoDarkUrl?: string;
    /** One URL per line — serialised back from the stored JSON array. */
    galleryUrls?: string;
    videoUrl?: string;
    /** One highlight per line. */
    highlightsEn?: string;
    highlightsAr?: string;
    /** One Terms & Policy bullet per line. */
    termsEn?: string;
    termsAr?: string;
    latitude?: number | null;
    longitude?: number | null;
    addressEn?: string;
    addressAr?: string;
    /** Minimum age (years) required to enter the category; null = no limit. */
    minAge?: number | null;
    isActive?: boolean;
    sortOrder?: number;
  };
  submitLabel: string;
}

function errorMessage(code: string): string {
  switch (code) {
    case 'slug_taken':
      return 'A category with that slug already exists. Pick a different slug.';
    case 'invalid_input':
      return 'Some fields are missing or invalid. Please review the form.';
    case 'not_found':
      return 'This category no longer exists.';
    case 'category_has_services':
      return 'This category has services attached — delete them first.';
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

export function CategoryForm({ action, type = 'NORMAL', defaultValues = {}, submitLabel }: Props) {
  const tCommon = useTranslations('common');
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
          <h2 className="font-display text-base text-gold-600">slug · names</h2>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="slug">slug</Label>
            <Input
              id="slug"
              name="slug"
              required
              dir="ltr"
              defaultValue={defaultValues.slug}
              pattern="[a-z0-9-]+"
              placeholder="crown-surge"
              invalid={!!fieldError(fieldErrors, 'slug')}
            />
            {fieldError(fieldErrors, 'slug') ? (
              <p className="mt-1 text-[11px] text-danger">{fieldError(fieldErrors, 'slug')}</p>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Lowercase letters, digits, hyphens — no spaces.
              </p>
            )}
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
            {fieldError(fieldErrors, 'sortOrder') ? (
              <p className="mt-1 text-[11px] text-danger">
                {fieldError(fieldErrors, 'sortOrder')}
              </p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="type">type</Label>
            <select
              id="type"
              name="type"
              defaultValue={type}
              dir="ltr"
              className="block h-12 w-full rounded-2xl border border-border/60 bg-input px-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="NORMAL">Beach (normal)</option>
              <option value="ACTIVITY">Activity</option>
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Beach categories show on the Beaches tab; Activity categories on the Activities tab.
              Switching moves the category between sections.
            </p>
          </div>
          <div>
            <Label htmlFor="minAge">minimum age</Label>
            <Input
              id="minAge"
              name="minAge"
              type="number"
              min={0}
              max={120}
              dir="ltr"
              placeholder="e.g. 18 — leave blank for no limit"
              defaultValue={defaultValues.minAge ?? ''}
              invalid={!!fieldError(fieldErrors, 'minAge')}
            />
            {fieldError(fieldErrors, 'minAge') ? (
              <p className="mt-1 text-[11px] text-danger">{fieldError(fieldErrors, 'minAge')}</p>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Customers younger than this can&apos;t enter or book this category. Leave blank
                (or 0) to allow all ages.
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
            {fieldError(fieldErrors, 'nameEn') ? (
              <p className="mt-1 text-[11px] text-danger">
                {fieldError(fieldErrors, 'nameEn')}
              </p>
            ) : null}
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
            {fieldError(fieldErrors, 'nameAr') ? (
              <p className="mt-1 text-[11px] text-danger">
                {fieldError(fieldErrors, 'nameAr')}
              </p>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-600">description</h2>
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
              className="block w-full rounded-2xl border border-border/60 bg-input p-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <Label htmlFor="descAr">description (AR)</Label>
            <textarea
              id="descAr"
              name="descAr"
              rows={4}
              defaultValue={defaultValues.descAr ?? ''}
              className="block w-full rounded-2xl border border-border/60 bg-input p-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div className="md:col-span-2">
            <MediaUploadInput
              name="coverUrl"
              label="cover image"
              accept="image"
              defaultValue={defaultValues.coverUrl}
              error={fieldError(fieldErrors, 'coverUrl')}
              hint="The hero photo customers see on the booking card and on the about page. Auto-compressed to ≤1MB before upload."
            />
          </div>
          <div>
            <MediaUploadInput
              name="logoUrl"
              label="logo · light mode"
              accept="image"
              defaultValue={defaultValues.logoUrl}
              error={fieldError(fieldErrors, 'logoUrl')}
              hint="Shown when a customer enters the category on a LIGHT theme. SVG is ideal (stays crisp at any size); a transparent PNG also works. SVG is kept as-is; raster is compressed to ≤1MB."
            />
          </div>
          <div>
            <MediaUploadInput
              name="logoDarkUrl"
              label="logo · dark mode"
              accept="image"
              defaultValue={defaultValues.logoDarkUrl}
              error={fieldError(fieldErrors, 'logoDarkUrl')}
              hint="Shown in DARK theme and on the dark downloadable ticket — use a light-coloured logo so it reads on dark. Optional: falls back to the light logo when empty."
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="space-y-1">
          <h2 className="font-display text-base text-gold-600">about this experience</h2>
          <p className="text-[11px] text-muted-foreground">
            Optional. Powers the dedicated &ldquo;About this experience&rdquo; page customers
            see when they tap the info button on a category card.
          </p>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label htmlFor="longDescEn">long description (EN)</Label>
            <textarea
              id="longDescEn"
              name="longDescEn"
              rows={6}
              dir="ltr"
              defaultValue={defaultValues.longDescEn ?? ''}
              placeholder="Paint the journey. Two or three short paragraphs work best — describe the setting, the feeling, what makes this place worth booking."
              className="block w-full rounded-2xl border border-border/60 bg-input p-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
            {fieldError(fieldErrors, 'longDescEn') ? (
              <p className="mt-1 text-[11px] text-danger">
                {fieldError(fieldErrors, 'longDescEn')}
              </p>
            ) : null}
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="longDescAr">long description (AR)</Label>
            <textarea
              id="longDescAr"
              name="longDescAr"
              rows={6}
              defaultValue={defaultValues.longDescAr ?? ''}
              placeholder="نفس الفكرة بالعربية — اروِ تجربة المكان في فقرتين أو ثلاث."
              className="block w-full rounded-2xl border border-border/60 bg-input p-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
            {fieldError(fieldErrors, 'longDescAr') ? (
              <p className="mt-1 text-[11px] text-danger">
                {fieldError(fieldErrors, 'longDescAr')}
              </p>
            ) : null}
          </div>
          <div className="md:col-span-2">
            <MediaUploadInput
              name="videoUrl"
              label="promo video"
              accept="video"
              defaultValue={defaultValues.videoUrl}
              error={fieldError(fieldErrors, 'videoUrl')}
              hint="Upload an MP4/WebM/MOV up to 100MB, or paste a YouTube/Vimeo URL. Browser-side video compression isn't supported — export your clip at the lowest acceptable bitrate before uploading."
            />
          </div>
          <div className="md:col-span-2">
            <MediaGalleryUpload
              name="galleryUrls"
              label="gallery images"
              defaultValue={defaultValues.galleryUrls}
              error={fieldError(fieldErrors, 'galleryUrls')}
              hint="Pick multiple files at once. Each image is compressed to ≤1MB and resized to 1920px on the long edge before upload. Drag the tiles to reorder."
              max={20}
            />
          </div>
          <div>
            <Label htmlFor="highlightsEn">highlights (EN) · one per line</Label>
            <textarea
              id="highlightsEn"
              name="highlightsEn"
              rows={5}
              dir="ltr"
              defaultValue={defaultValues.highlightsEn ?? ''}
              placeholder={'Private cabana\nSunset beach access\nValet parking'}
              className="block w-full rounded-2xl border border-border/60 bg-input p-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
            {fieldError(fieldErrors, 'highlightsEn') ? (
              <p className="mt-1 text-[11px] text-danger">
                {fieldError(fieldErrors, 'highlightsEn')}
              </p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="highlightsAr">highlights (AR) · one per line</Label>
            <textarea
              id="highlightsAr"
              name="highlightsAr"
              rows={5}
              defaultValue={defaultValues.highlightsAr ?? ''}
              placeholder={'كبانة خاصة\nمدخل خاص للشاطئ وقت الغروب\nخدمة صف السيارات'}
              className="block w-full rounded-2xl border border-border/60 bg-input p-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
            {fieldError(fieldErrors, 'highlightsAr') ? (
              <p className="mt-1 text-[11px] text-danger">
                {fieldError(fieldErrors, 'highlightsAr')}
              </p>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-600">location</h2>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="latitude">latitude</Label>
            <Input
              id="latitude"
              name="latitude"
              type="number"
              step="0.0001"
              dir="ltr"
              defaultValue={defaultValues.latitude ?? ''}
              invalid={!!fieldError(fieldErrors, 'latitude')}
            />
            {fieldError(fieldErrors, 'latitude') ? (
              <p className="mt-1 text-[11px] text-danger">
                {fieldError(fieldErrors, 'latitude')}
              </p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="longitude">longitude</Label>
            <Input
              id="longitude"
              name="longitude"
              type="number"
              step="0.0001"
              dir="ltr"
              defaultValue={defaultValues.longitude ?? ''}
              invalid={!!fieldError(fieldErrors, 'longitude')}
            />
            {fieldError(fieldErrors, 'longitude') ? (
              <p className="mt-1 text-[11px] text-danger">
                {fieldError(fieldErrors, 'longitude')}
              </p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="addressEn">address (EN)</Label>
            <Input
              id="addressEn"
              name="addressEn"
              dir="ltr"
              defaultValue={defaultValues.addressEn ?? ''}
              invalid={!!fieldError(fieldErrors, 'addressEn')}
            />
            {fieldError(fieldErrors, 'addressEn') ? (
              <p className="mt-1 text-[11px] text-danger">
                {fieldError(fieldErrors, 'addressEn')}
              </p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="addressAr">address (AR)</Label>
            <Input
              id="addressAr"
              name="addressAr"
              defaultValue={defaultValues.addressAr ?? ''}
              invalid={!!fieldError(fieldErrors, 'addressAr')}
            />
            {fieldError(fieldErrors, 'addressAr') ? (
              <p className="mt-1 text-[11px] text-danger">
                {fieldError(fieldErrors, 'addressAr')}
              </p>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="space-y-1">
          <h2 className="font-display text-base text-gold-600">terms &amp; policy</h2>
          <p className="text-[11px] text-muted-foreground">
            One point per line. Shown to customers on the category&rsquo;s about page
            so they can read the rules before booking. Independent EN / AR copies.
          </p>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="termsEn">terms (EN) · one per line</Label>
            <textarea
              id="termsEn"
              name="termsEn"
              rows={8}
              dir="ltr"
              defaultValue={defaultValues.termsEn ?? ''}
              placeholder={
                'Cancellations accepted up to 24h before the booking date.\n' +
                'Outside food and drinks are not permitted.\n' +
                'Children under 12 must be accompanied by an adult.'
              }
              className="block w-full rounded-2xl border border-border/60 bg-input p-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
            {fieldError(fieldErrors, 'termsEn') ? (
              <p className="mt-1 text-[11px] text-danger">
                {fieldError(fieldErrors, 'termsEn')}
              </p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="termsAr">terms (AR) · one per line</Label>
            <textarea
              id="termsAr"
              name="termsAr"
              rows={8}
              defaultValue={defaultValues.termsAr ?? ''}
              placeholder={
                'يمكن إلغاء الحجز قبل التاريخ المحجوز بـ 24 ساعة على الأقل.\n' +
                'لا يُسمح بإحضار الأطعمة أو المشروبات من خارج المكان.\n' +
                'يجب أن يكون الأطفال دون 12 سنة برفقة شخص بالغ.'
              }
              className="block w-full rounded-2xl border border-border/60 bg-input p-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
            {fieldError(fieldErrors, 'termsAr') ? (
              <p className="mt-1 text-[11px] text-danger">
                {fieldError(fieldErrors, 'termsAr')}
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
            {submitLabel ?? tCommon('save')}
          </Button>
        </CardBody>
      </Card>
    </form>
  );
}
