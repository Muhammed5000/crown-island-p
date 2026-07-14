'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { deleteNotificationAction } from '@/features/admin/notification-actions';

interface Props {
  id: string;
  title: string;
}

export function NotificationDeleteButton({ id, title }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function go() {
    setError(null);
    startTransition(async () => {
      const res = await deleteNotificationAction({ id });
      if (res.ok) {
        setConfirming(false);
        router.refresh();
      } else {
        setError('Could not delete this notification. It may already be gone.');
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        className="text-xs text-red-600 underline-offset-4 hover:underline"
        aria-label="Delete"
      >
        ✕
      </button>

      <Modal isOpen={confirming} onClose={() => setConfirming(false)} title="Delete notification">
        <div className="space-y-4 pt-2">
          <p className="text-sm text-foreground">
            Delete <span className="font-semibold text-gold-600">{title}</span>?
          </p>
          <p className="text-sm text-muted-foreground">
            This removes the campaign and clears it from every recipient&apos;s in-app inbox. Already
            delivered push notifications can&apos;t be recalled. This cannot be undone.
          </p>
          {error ? <p className="text-sm font-medium text-red-700">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" loading={isPending} onClick={go}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
