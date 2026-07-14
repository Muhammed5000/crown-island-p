'use client';

import { useState, useTransition } from 'react';
import { KeyRoundIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { setStaffPinAction } from '@/features/admin/discount-actions';

const ERRORS: Record<string, string> = {
  pin_taken: 'That PIN is already used by another staff member.',
  invalid_pin: 'PIN must be 4–8 digits.',
  not_found: 'User not found.',
};

export function StaffPinForm({ userId, hasPin }: { userId: string; hasPin: boolean }) {
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [pending, start] = useTransition();

  function save(value: string | null) {
    start(async () => {
      const res = await setStaffPinAction(userId, value);
      if (res.ok) {
        toast(value ? 'Desk PIN set.' : 'Desk PIN removed.', 'success');
        setPin('');
      } else {
        toast(ERRORS[res.code] ?? 'Could not update the PIN.', 'error');
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <KeyRoundIcon className="size-4 text-gold-600" />
        <span className="text-sm font-medium text-foreground">Desk override PIN</span>
        <Badge tone={hasPin ? 'success' : 'muted'}>{hasPin ? 'Set' : 'Not set'}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        A 4–8 digit PIN this staff member types at reception to authorize a manual discount up to
        their role&rsquo;s ceiling. Stored hashed; never shown again.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="staff-pin">{hasPin ? 'New PIN' : 'PIN'}</Label>
          <Input
            id="staff-pin"
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 4821"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            className="w-40 tracking-[0.3em]"
          />
        </div>
        <Button type="button" variant="primary" size="md" loading={pending} disabled={pin.length < 4} onClick={() => save(pin)}>
          {hasPin ? 'Replace PIN' : 'Set PIN'}
        </Button>
        {hasPin && (
          <Button type="button" variant="ghost" size="md" loading={pending} onClick={() => save(null)}>
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
