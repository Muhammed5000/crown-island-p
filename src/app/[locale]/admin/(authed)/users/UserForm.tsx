'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { cn } from '@/lib/cn';
import { UserRole } from '@prisma/client';
import type { UserActionResult } from '@/features/admin/user-actions';

interface Props {
  initialValues?: {
    name?: string;
    email?: string;
    phone?: string;
    role: UserRole;
  };
  action: (formData: FormData) => Promise<UserActionResult | void>;
  submitLabel: string;
}

/**
 * Deliberately `onSubmit` + `useTransition` rather than `<form action={…}>`:
 * React 19 resets uncontrolled fields once a form action settles, which would
 * wipe everything the admin typed whenever validation fails.
 */
export function UserForm({ initialValues, action, submitLabel }: Props) {
  const t = useTranslations('admin');
  const tAuth = useTranslations('auth');
  const tCommon = useTranslations('common');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      setError(null);
      setFieldErrors({});
      const res = await action(formData);
      if (res && !res.ok) {
        setError(res.code);
        if (res.fields) setFieldErrors(res.fields);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <Label htmlFor="name">{tAuth('profile.fullName')}</Label>
          <Input
            id="name"
            name="name"
            defaultValue={initialValues?.name}
            placeholder="John Doe"
            invalid={!!fieldErrors.name}
            errorId="name-error"
          />
          {fieldErrors.name && (
            <p id="name-error" className="mt-1 text-xs text-danger">{fieldErrors.name[0]}</p>
          )}
        </div>

        <div>
          <Label htmlFor="role">{t('role')}</Label>
          <select
            id="role"
            name="role"
            defaultValue={initialValues?.role ?? 'CUSTOMER'}
            className={cn(
              'flex h-12 w-full rounded-xl border bg-card px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent',
              fieldErrors.role ? 'border-danger/60' : 'border-border'
            )}
          >
            {Object.values(UserRole).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          {fieldErrors.role && (
            <p className="mt-1 text-xs text-danger">{fieldErrors.role[0]}</p>
          )}
        </div>

        <div>
          <Label htmlFor="email">{tAuth('email')}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            defaultValue={initialValues?.email}
            placeholder="john@example.com"
            invalid={!!fieldErrors.email}
            errorId="email-error"
          />
          {fieldErrors.email && (
            <p id="email-error" className="mt-1 text-xs text-danger">{fieldErrors.email[0]}</p>
          )}
        </div>

        <div>
          <Label htmlFor="phone">{tAuth('profile.phone')}</Label>
          <Input
            id="phone"
            name="phone"
            defaultValue={initialValues?.phone}
            placeholder="+20..."
            invalid={!!fieldErrors.phone}
            errorId="phone-error"
          />
          {fieldErrors.phone && (
            <p id="phone-error" className="mt-1 text-xs text-danger">{fieldErrors.phone[0]}</p>
          )}
        </div>

        <div>
          <Label htmlFor="password">{tAuth('password')}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="••••••••"
            invalid={!!fieldErrors.password}
            errorId="password-error"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {initialValues ? 'Leave blank to keep current password.' : tAuth('passwordRule')}
          </p>
          {fieldErrors.password && (
            <p id="password-error" className="mt-1 text-xs text-danger">{fieldErrors.password[0]}</p>
          )}
        </div>
      </div>

      {error && (
        <p className="text-sm font-medium text-danger" role="alert">
          {error === 'email_taken'
            ? tAuth('emailTaken')
            : error === 'phone_taken'
            ? tAuth('phoneTaken')
            : error === 'cannot_assign_developer'
            ? 'Only a Developer can grant the Developer role.'
            : error === 'cannot_change_own_role'
            ? 'You cannot change your own role — ask another Super Admin.'
            : error === 'cannot_demote_last_developer'
            ? 'This is the last Developer account — assign another before changing this one.'
            : error === 'cannot_remove_last_admin'
            ? 'This is the last account that can manage users — promote another first.'
            : tCommon('error')}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" loading={pending} variant="primary">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
