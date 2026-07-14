'use client';

import { useState, useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';
import type { RestaurantStatus } from '@prisma/client';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Label';
import { useToast } from '@/components/ui/Toast';
import {
  deleteRestaurantAction,
  setRestaurantStatusAction,
} from '@/features/admin/restaurant-actions';

interface Props {
  id: string;
  status: RestaurantStatus;
  statusNote: string | null;
}

/**
 * Admin moderation controls for one restaurant: approve / reject / disable /
 * re-queue, with an optional note that is shown to the owner, plus delete.
 */
export function RestaurantModerationPanel({ id, status, statusNote }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState(statusNote ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  function setStatus(next: RestaurantStatus) {
    startTransition(async () => {
      const formData = new FormData();
      formData.set('status', next);
      formData.set('note', note);
      const res = await setRestaurantStatusAction(id, formData);
      if (!res.ok) {
        toast('Could not update the restaurant status.', 'error');
        return;
      }
      toast(`Restaurant ${next.toLowerCase()}.`, 'success');
      router.refresh();
    });
  }

  function remove() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    startTransition(async () => {
      const res = await deleteRestaurantAction(id);
      if (!res.ok) {
        toast('Could not delete the restaurant.', 'error');
        setConfirmDelete(false);
        return;
      }
      toast('Restaurant deleted.', 'success');
      router.push('/admin/restaurants');
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="status-note">Note to the owner (shown on rejection / disable)</Label>
        <textarea
          id="status-note"
          rows={2}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. The menu PDF is unreadable — please re-upload it."
          className="block w-full rounded-xl border border-gold-400/[0.12] bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {status !== 'APPROVED' ? (
          <Button size="sm" onClick={() => setStatus('APPROVED')} disabled={pending}>
            Approve
          </Button>
        ) : null}
        {status !== 'REJECTED' ? (
          <Button size="sm" variant="outline" onClick={() => setStatus('REJECTED')} disabled={pending}>
            Reject
          </Button>
        ) : null}
        {status === 'APPROVED' ? (
          <Button size="sm" variant="outline" onClick={() => setStatus('DISABLED')} disabled={pending}>
            Disable
          </Button>
        ) : null}
        {status !== 'PENDING' ? (
          <Button size="sm" variant="ghost" onClick={() => setStatus('PENDING')} disabled={pending}>
            Move to pending
          </Button>
        ) : null}
        <Button size="sm" variant="danger" onClick={remove} disabled={pending}>
          {confirmDelete ? 'Click again to confirm delete' : 'Delete'}
        </Button>
      </div>
    </div>
  );
}
