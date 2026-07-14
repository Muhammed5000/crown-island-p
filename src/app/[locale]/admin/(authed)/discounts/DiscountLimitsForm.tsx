'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { useToast } from '@/components/ui/Toast';
import { setRoleLimitsAction } from '@/features/admin/discount-actions';

interface Limit {
  role: string;
  maxPercent: number;
  isDefault: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  STAFF: 'Staff',
  SUPERVISOR: 'Supervisor',
  MANAGER: 'Manager',
  DIRECTOR: 'Director',
};

/**
 * Deliberately `onSubmit` + `useTransition` rather than `<form action={…}>`:
 * React 19 resets uncontrolled fields once a form action settles, which would
 * wipe everything the admin typed whenever validation fails.
 */
export function DiscountLimitsForm({ limits }: { limits: Limit[] }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function handle(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await setRoleLimitsAction(formData);
      if (res.ok) toast('Discount ceilings saved.', 'success');
      else toast('Could not save — check the values (0–100).', 'error');
    });
  }

  return (
    <form onSubmit={handle} className="space-y-6">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {limits.map((l) => (
          <div key={l.role}>
            <Label htmlFor={`percent_${l.role}`}>
              {ROLE_LABELS[l.role] ?? l.role}
              {l.isDefault && <span className="ms-2 text-[11px] font-normal text-muted-foreground">default</span>}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id={`percent_${l.role}`}
                name={`percent_${l.role}`}
                type="number"
                min={0}
                max={100}
                defaultValue={l.maxPercent}
                className="w-28"
              />
              <span className="text-sm text-muted-foreground">% maximum</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={pending} variant="primary">
          Save ceilings
        </Button>
      </div>
    </form>
  );
}
