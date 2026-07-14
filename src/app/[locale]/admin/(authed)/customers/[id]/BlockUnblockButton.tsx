'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BanIcon, ShieldCheckIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { blockUserAction, unblockUserAction } from '@/features/admin/user-actions';

const ERR: Record<string, string> = {
  cannot_block_self: "You can't block your own account.",
  cannot_block_staff: "Staff and admin accounts can't be blocked here.",
  not_found: 'User not found.',
};

export function BlockUnblockButton({
  userId,
  isBlocked,
  blockedReason,
}: {
  userId: string;
  isBlocked: boolean;
  blockedReason?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');

  function block() {
    start(async () => {
      const res = await blockUserAction(userId, reason.trim() || null);
      if (res.ok) {
        toast('Customer blocked — they can no longer enter the app.', 'success');
        setConfirming(false);
        setReason('');
        router.refresh();
      } else {
        toast(ERR[res.code] ?? 'Could not block this customer.', 'error');
      }
    });
  }

  function unblock() {
    start(async () => {
      const res = await unblockUserAction(userId);
      if (res.ok) {
        toast('Customer unblocked.', 'success');
        router.refresh();
      } else {
        toast(ERR[res.code] ?? 'Could not unblock.', 'error');
      }
    });
  }

  if (isBlocked) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          <BanIcon className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-0.5">
            <p className="font-semibold">This customer is blocked.</p>
            <p className="text-[12.5px] text-danger/80">
              Their email, phone, national&nbsp;ID and passport are banned from registering again.
              {blockedReason ? <span className="block">Reason: {blockedReason}</span> : null}
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" size="md" loading={pending} onClick={unblock}>
          <ShieldCheckIcon className="size-4" />
          Unblock customer
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Blocking bans this person from the app — their email, phone, national&nbsp;ID and passport
        can&rsquo;t be used to sign in or register again.
      </p>
      {confirming ? (
        <div className="space-y-2">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            maxLength={300}
            aria-label="Block reason"
          />
          <div className="flex gap-2">
            <Button type="button" variant="danger" size="md" loading={pending} onClick={block}>
              Confirm block
            </Button>
            <Button type="button" variant="ghost" size="md" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="danger" size="md" onClick={() => setConfirming(true)}>
          <BanIcon className="size-4" />
          Block customer
        </Button>
      )}
    </div>
  );
}
