'use client';

import { useRef, useState, useTransition, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Card, CardBody } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { MediaUploadInput } from '@/components/admin/MediaUploadInput';
import { cn } from '@/lib/cn';
import {
  previewAudienceCountAction,
  type NotificationActionResult,
} from '@/features/admin/notification-actions';
import { CustomerPicker, type SelectedCustomer } from './CustomerPicker';

type Audience = 'ALL' | 'TAG' | 'SPECIFIC';
type Intent = 'draft' | 'send' | 'schedule';

export interface NotificationFormDefaults {
  id?: string;
  titleEn?: string;
  titleAr?: string;
  bodyEn?: string;
  bodyAr?: string;
  iconUrl?: string;
  url?: string;
  audience?: Audience;
  tagId?: string | null;
  /** datetime-local value, e.g. "2026-07-01T09:00". */
  scheduledAtLocal?: string;
  recipients?: SelectedCustomer[];
}

interface Props {
  mode: 'create' | 'edit';
  action: (formData: FormData) => Promise<NotificationActionResult | void>;
  tags: { id: string; name: string }[];
  defaultValues?: NotificationFormDefaults;
}

function errorMessage(code: string): string {
  switch (code) {
    case 'invalid_input':
      return 'Please fix the highlighted fields.';
    case 'not_editable':
      return 'This notification has already been sent and can no longer be edited.';
    case 'not_found':
      return 'This notification no longer exists.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

const textareaCls =
  'block w-full rounded-xl border border-border bg-card px-4 py-3 text-foreground placeholder:text-muted-foreground transition-colors focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/55';

export function NotificationForm({ mode, action, tags, defaultValues = {} }: Props) {
  const [audience, setAudience] = useState<Audience>(defaultValues.audience ?? 'ALL');
  const [tagId, setTagId] = useState<string>(defaultValues.tagId ?? '');
  const [recipients, setRecipients] = useState<SelectedCustomer[]>(defaultValues.recipients ?? []);
  const [intent, setIntent] = useState<Intent>(defaultValues.scheduledAtLocal ? 'schedule' : 'draft');

  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();
  const [pending, startTransition] = useTransition();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const pendingFd = useRef<FormData | null>(null);

  const fieldError = (key: string) => fieldErrors?.[key]?.[0];

  function submit(fd: FormData) {
    setError(null);
    setFieldErrors(undefined);
    startTransition(async () => {
      try {
        const res = await action(fd);
        if (res && 'ok' in res && !res.ok) {
          setError(errorMessage(res.code));
          setFieldErrors(res.fields);
          setConfirmOpen(false);
        }
      } catch (err) {
        if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err;
        setError(errorMessage('unknown'));
        setConfirmOpen(false);
      }
    });
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set('intent', intent);

    if (intent === 'send') {
      // Preview the resolved recipient count, then confirm before fanning out.
      pendingFd.current = fd;
      startTransition(async () => {
        const res = await previewAudienceCountAction({
          audience,
          tagId: audience === 'TAG' ? tagId || null : null,
          recipientUserIds: recipients.map((r) => r.id),
        });
        setPreviewCount(res.ok ? res.count : 0);
        setConfirmOpen(true);
      });
      return;
    }
    submit(fd);
  }

  const submitLabel =
    intent === 'send' ? 'Send now' : intent === 'schedule' ? 'Schedule' : 'Save draft';

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {mode === 'edit' && defaultValues.id ? (
        <input type="hidden" name="id" value={defaultValues.id} />
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-2xl border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger"
        >
          <p className="font-medium">{error}</p>
          {fieldErrors ? (
            <ul className="mt-1 list-disc space-y-0.5 ps-5 text-[12px]">
              {Object.entries(fieldErrors).map(([k, msgs]) => (
                <li key={k}>
                  <span className="uppercase">{k}</span> — {msgs.join(', ')}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* ── Message ── */}
      <Card>
        <CardBody className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Message
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="titleEn">Title (EN)</Label>
              <Input
                id="titleEn"
                name="titleEn"
                required
                maxLength={120}
                dir="ltr"
                defaultValue={defaultValues.titleEn}
                invalid={!!fieldError('titleEn')}
                placeholder="Summer offer — 20% off"
              />
              {fieldError('titleEn') ? (
                <p className="mt-1 text-xs text-danger">{fieldError('titleEn')}</p>
              ) : null}
            </div>
            <div>
              <Label htmlFor="titleAr">Title (AR)</Label>
              <Input
                id="titleAr"
                name="titleAr"
                required
                maxLength={120}
                dir="rtl"
                defaultValue={defaultValues.titleAr}
                invalid={!!fieldError('titleAr')}
                placeholder="عرض الصيف — خصم ٢٠٪"
              />
              {fieldError('titleAr') ? (
                <p className="mt-1 text-xs text-danger">{fieldError('titleAr')}</p>
              ) : null}
            </div>
            <div>
              <Label htmlFor="bodyEn">Body (EN)</Label>
              <textarea
                id="bodyEn"
                name="bodyEn"
                required
                maxLength={2000}
                rows={5}
                dir="ltr"
                defaultValue={defaultValues.bodyEn}
                className={cn(textareaCls, fieldError('bodyEn') && 'border-danger/60')}
                placeholder="20% off all beach day passes this weekend."
              />
              {fieldError('bodyEn') ? (
                <p className="mt-1 text-xs text-danger">{fieldError('bodyEn')}</p>
              ) : null}
            </div>
            <div>
              <Label htmlFor="bodyAr">Body (AR)</Label>
              <textarea
                id="bodyAr"
                name="bodyAr"
                required
                maxLength={2000}
                rows={5}
                dir="rtl"
                defaultValue={defaultValues.bodyAr}
                className={cn(textareaCls, fieldError('bodyAr') && 'border-danger/60')}
                placeholder="خصم ٢٠٪ على كل تذاكر الشاطئ هذا الأسبوع."
              />
              {fieldError('bodyAr') ? (
                <p className="mt-1 text-xs text-danger">{fieldError('bodyAr')}</p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <MediaUploadInput
              name="iconUrl"
              accept="image"
              label="Icon / image (optional)"
              defaultValue={defaultValues.iconUrl}
              hint="Shown on the push notification. Falls back to the app icon."
            />
            <div>
              <Label htmlFor="url">Link (optional)</Label>
              <Input
                id="url"
                name="url"
                dir="ltr"
                defaultValue={defaultValues.url}
                invalid={!!fieldError('url')}
                placeholder="/booking"
              />
              {fieldError('url') ? (
                <p className="mt-1 text-xs text-danger">{fieldError('url')}</p>
              ) : (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Internal path opened on tap, e.g. <code>/booking</code> or{' '}
                  <code>/bookings/history</code>.
                </p>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ── Audience ── */}
      <Card>
        <CardBody className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Audience
          </h2>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { v: 'ALL', label: 'All customers' },
                { v: 'TAG', label: 'By tag' },
                { v: 'SPECIFIC', label: 'Specific customers' },
              ] as const
            ).map((opt) => (
              <label
                key={opt.v}
                className={cn(
                  'cursor-pointer rounded-xl border px-4 py-2 text-sm transition-colors',
                  audience === opt.v
                    ? 'border-accent/50 bg-accent/10 text-accent'
                    : 'border-border text-muted-foreground hover:bg-muted/50',
                )}
              >
                <input
                  type="radio"
                  name="audience"
                  value={opt.v}
                  checked={audience === opt.v}
                  onChange={() => setAudience(opt.v)}
                  className="sr-only"
                />
                {opt.label}
              </label>
            ))}
          </div>

          {audience === 'TAG' ? (
            <div>
              <Label htmlFor="tagId">Tag</Label>
              <select
                id="tagId"
                name="tagId"
                value={tagId}
                onChange={(e) => setTagId(e.target.value)}
                className={cn(
                  'block h-12 w-full rounded-xl border bg-card px-4 text-foreground focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/55',
                  fieldError('tagId') ? 'border-danger/60' : 'border-border',
                )}
              >
                <option value="">— choose a tag —</option>
                {tags.map((tg) => (
                  <option key={tg.id} value={tg.id}>
                    {tg.name}
                  </option>
                ))}
              </select>
              {fieldError('tagId') ? (
                <p className="mt-1 text-xs text-danger">{fieldError('tagId')}</p>
              ) : null}
            </div>
          ) : null}

          {audience === 'SPECIFIC' ? (
            <div>
              <Label>Customers</Label>
              <CustomerPicker initial={recipients} onChange={setRecipients} />
              {fieldError('recipientIds') ? (
                <p className="mt-1 text-xs text-danger">{fieldError('recipientIds')}</p>
              ) : null}
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/* ── Delivery ── */}
      <Card>
        <CardBody className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Delivery
          </h2>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { v: 'draft', label: 'Save as draft' },
                { v: 'send', label: 'Send now' },
                { v: 'schedule', label: 'Schedule' },
              ] as const
            ).map((opt) => (
              <label
                key={opt.v}
                className={cn(
                  'cursor-pointer rounded-xl border px-4 py-2 text-sm transition-colors',
                  intent === opt.v
                    ? 'border-accent/50 bg-accent/10 text-accent'
                    : 'border-border text-muted-foreground hover:bg-muted/50',
                )}
              >
                <input
                  type="radio"
                  name="intentRadio"
                  value={opt.v}
                  checked={intent === opt.v}
                  onChange={() => setIntent(opt.v)}
                  className="sr-only"
                />
                {opt.label}
              </label>
            ))}
          </div>

          {intent === 'schedule' ? (
            <div className="max-w-xs">
              <Label htmlFor="scheduledAt">Send at (resort time)</Label>
              <Input
                id="scheduledAt"
                name="scheduledAt"
                type="datetime-local"
                dir="ltr"
                defaultValue={defaultValues.scheduledAtLocal}
                invalid={!!fieldError('scheduledAt')}
              />
              {fieldError('scheduledAt') ? (
                <p className="mt-1 text-xs text-danger">{fieldError('scheduledAt')}</p>
              ) : null}
            </div>
          ) : null}
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" variant={intent === 'send' ? 'gold' : 'primary'} loading={pending}>
          {submitLabel}
        </Button>
      </div>

      <Modal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Send notification now"
      >
        <div className="space-y-4 pt-2">
          <p className="text-sm text-foreground">
            This will send to{' '}
            <span className="font-semibold text-gold-600">
              {previewCount === null ? '…' : previewCount.toLocaleString()}
            </span>{' '}
            customer{previewCount === 1 ? '' : 's'} and push to those with notifications enabled.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="gold"
              size="sm"
              loading={pending}
              onClick={() => pendingFd.current && submit(pendingFd.current)}
            >
              Send now
            </Button>
          </div>
        </div>
      </Modal>
    </form>
  );
}
