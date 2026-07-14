'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { createPromoAction, type PromoActionResult } from '@/features/admin/promo-actions';

const ERROR_MESSAGES: Record<string, string> = {
  code_taken: 'A code with that name already exists.',
  invalid_code: 'Code must be 2–40 characters.',
  invalid_percent: 'Percentage must be between 1 and 100.',
  invalid_window: 'The end date is before the start date.',
  invalid_max: 'Max redemptions must be a positive whole number.',
  invalid_input: 'Please check the highlighted fields.',
};

/**
 * Deliberately `onSubmit` + `useTransition` rather than `<form action={…}>`:
 * React 19 resets uncontrolled fields once a form action settles, which would
 * wipe everything the admin typed whenever validation fails. The form is
 * instead reset explicitly on success.
 */
export function PromoForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      setError(null);
      setFieldErrors({});
      const res: PromoActionResult | void = await createPromoAction(formData);
      if (res && !res.ok) {
        setError(res.code);
        if (res.fields) setFieldErrors(res.fields);
        return;
      }
      form.reset();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div>
          <Label htmlFor="code">Code</Label>
          <Input id="code" name="code" required placeholder="SUMMER20" invalid={!!fieldErrors.code} autoCapitalize="characters" />
          <p className="mt-1 text-xs text-muted-foreground">Stored upper-case; staff type it at the desk.</p>
        </div>

        <div>
          <Label htmlFor="percentOff">Percentage off</Label>
          <Input id="percentOff" name="percentOff" type="number" min={1} max={100} required placeholder="20" invalid={!!fieldErrors.percentOff} />
        </div>

        <div className="md:col-span-2">
          <Label htmlFor="description">Description (optional)</Label>
          <Input id="description" name="description" placeholder="Summer walk-in promotion" />
        </div>

        <div>
          <Label htmlFor="maxRedemptions">Max redemptions (optional)</Label>
          <Input id="maxRedemptions" name="maxRedemptions" type="number" min={1} placeholder="Unlimited" invalid={!!fieldErrors.maxRedemptions} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="startsAt">Starts (optional)</Label>
            <Input id="startsAt" name="startsAt" type="date" />
          </div>
          <div>
            <Label htmlFor="endsAt">Ends (optional)</Label>
            <Input id="endsAt" name="endsAt" type="date" />
          </div>
        </div>

        <div className="md:col-span-2">
          <label htmlFor="oncePerCustomer" className="flex items-start gap-3 rounded-2xl border border-border/60 bg-input/40 p-3">
            <input
              id="oncePerCustomer"
              name="oncePerCustomer"
              type="checkbox"
              defaultChecked
              className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
            />
            <span>
              <span className="text-sm font-medium text-foreground">Limit to one use per customer</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Checked: each customer phone can redeem this code only once. Unchecked: the same
                customer may reuse it (still bounded by the global max redemptions).
              </span>
            </span>
          </label>
        </div>
      </div>

      {error && (
        <p className="text-sm font-medium text-danger" role="alert">
          {ERROR_MESSAGES[error] ?? 'Something went wrong. Please try again.'}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" loading={pending} variant="primary">
          Create code
        </Button>
      </div>
    </form>
  );
}
