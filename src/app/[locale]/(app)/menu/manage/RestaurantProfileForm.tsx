'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { MediaUploadInput } from '@/components/admin/MediaUploadInput';
import { useToast } from '@/components/ui/Toast';
import { saveMyRestaurantAction, type RestaurantActionResult } from '@/features/restaurant/actions';

interface RestaurantValues {
  name: string;
  description: string | null;
  phone: string;
  address: string | null;
  openingHours: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  websiteUrl: string | null;
  coverUrl: string | null;
  menuPdfUrl: string | null;
  menuPdfName: string | null;
  menuPdfSize: number | null;
}

interface Props {
  initial: RestaurantValues | null;
}

/**
 * Restaurant partner profile form. All real validation runs in the server
 * action (`saveMyRestaurantAction`) — error codes come back per field and are
 * translated here; native `maxLength`/`required` only provide fast feedback.
 *
 * Deliberately `onSubmit` + `useTransition` rather than `<form action={…}>`:
 * React 19 resets uncontrolled fields once a form action settles, which would
 * wipe everything the user typed whenever validation fails.
 */
export function RestaurantProfileForm({ initial }: Props) {
  const t = useTranslations('menu.form');
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function errorFor(field: string): string | undefined {
    const code = fieldErrors[field];
    if (!code) return undefined;
    return t(`errors.${code}` as Parameters<typeof t>[0]);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      setFormError(null);
      setFieldErrors({});
      const res: RestaurantActionResult = await saveMyRestaurantAction(formData);
      if (!res.ok) {
        setFieldErrors(res.fields ?? {});
        setFormError(res.code === 'invalid_input' ? 'invalid_input' : 'unknown');
        return;
      }
      toast(t('saved'), 'success');
      router.refresh();
    });
  }

  const optional = ` (${t('optional')})`;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Identity */}
      <div>
        <Label htmlFor="r-name">{t('name')}</Label>
        <Input
          id="r-name"
          name="name"
          required
          maxLength={80}
          defaultValue={initial?.name ?? ''}
          placeholder={t('namePlaceholder')}
          invalid={!!fieldErrors.name}
          errorId="r-name-error"
        />
        {errorFor('name') ? (
          <p id="r-name-error" className="mt-1 text-xs text-danger">{errorFor('name')}</p>
        ) : null}
      </div>

      <div>
        <Label htmlFor="r-description">{t('description')}{optional}</Label>
        <textarea
          id="r-description"
          name="description"
          rows={5}
          maxLength={2000}
          defaultValue={initial?.description ?? ''}
          placeholder={t('descriptionPlaceholder')}
          className="block w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-accent/55 focus:border-accent/50"
          aria-invalid={!!fieldErrors.description || undefined}
        />
        {errorFor('description') ? (
          <p className="mt-1 text-xs text-danger">{errorFor('description')}</p>
        ) : null}
      </div>

      <MediaUploadInput
        name="coverUrl"
        label={t('cover') + optional}
        accept="image"
        endpoint="/api/restaurant/upload"
        allowUrlInput={false}
        defaultValue={initial?.coverUrl ?? ''}
        hint={t('coverHint')}
        error={errorFor('coverUrl')}
      />

      <MediaUploadInput
        name="menuPdfUrl"
        label={t('menuPdf') + optional}
        accept="pdf"
        endpoint="/api/restaurant/upload"
        allowUrlInput={false}
        defaultValue={initial?.menuPdfUrl ?? ''}
        fileNameField="menuPdfName"
        defaultFileName={initial?.menuPdfName ?? ''}
        fileSizeField="menuPdfSize"
        defaultFileSize={initial?.menuPdfSize ?? undefined}
        hint={t('menuPdfHint')}
        error={errorFor('menuPdfUrl')}
      />

      {/* Contact */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <Label htmlFor="r-phone">{t('phone')}</Label>
          <Input
            id="r-phone"
            name="phone"
            type="tel"
            dir="ltr"
            required
            maxLength={20}
            defaultValue={initial?.phone ?? ''}
            placeholder={t('phonePlaceholder')}
            invalid={!!fieldErrors.phone}
            errorId="r-phone-error"
          />
          {errorFor('phone') ? (
            <p id="r-phone-error" className="mt-1 text-xs text-danger">{errorFor('phone')}</p>
          ) : null}
        </div>
        <div>
          <Label htmlFor="r-hours">{t('hours')}{optional}</Label>
          <Input
            id="r-hours"
            name="openingHours"
            maxLength={120}
            defaultValue={initial?.openingHours ?? ''}
            placeholder={t('hoursPlaceholder')}
            invalid={!!fieldErrors.openingHours}
          />
          {errorFor('openingHours') ? (
            <p className="mt-1 text-xs text-danger">{errorFor('openingHours')}</p>
          ) : null}
        </div>
      </div>

      <div>
        <Label htmlFor="r-address">{t('address')}{optional}</Label>
        <Input
          id="r-address"
          name="address"
          maxLength={200}
          defaultValue={initial?.address ?? ''}
          placeholder={t('addressPlaceholder')}
          invalid={!!fieldErrors.address}
        />
        {errorFor('address') ? (
          <p className="mt-1 text-xs text-danger">{errorFor('address')}</p>
        ) : null}
      </div>

      {/* Links — validated server-side against per-platform domain allow-lists */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {(
          [
            { field: 'facebookUrl', label: t('facebook'), placeholder: 'https://facebook.com/your-page' },
            { field: 'instagramUrl', label: t('instagram'), placeholder: 'https://instagram.com/your-profile' },
            { field: 'tiktokUrl', label: t('tiktok'), placeholder: 'https://tiktok.com/@your-profile' },
            { field: 'websiteUrl', label: t('websiteLabel'), placeholder: t('websitePlaceholder') },
          ] as const
        ).map(({ field, label, placeholder }) => (
          <div key={field}>
            <Label htmlFor={`r-${field}`}>{label}{optional}</Label>
            <Input
              id={`r-${field}`}
              name={field}
              type="text"
              inputMode="url"
              dir="ltr"
              maxLength={300}
              defaultValue={(initial?.[field] as string | null) ?? ''}
              placeholder={placeholder}
              invalid={!!fieldErrors[field]}
              errorId={`r-${field}-error`}
            />
            {errorFor(field) ? (
              <p id={`r-${field}-error`} className="mt-1 text-xs text-danger">{errorFor(field)}</p>
            ) : null}
          </div>
        ))}
      </div>

      {formError ? (
        <p className="text-sm font-medium text-danger" role="alert">
          {t(`errors.${formError}` as Parameters<typeof t>[0])}
        </p>
      ) : null}

      <Button type="submit" loading={pending} fullWidth>
        {initial ? t('save') : t('create')}
      </Button>
    </form>
  );
}
