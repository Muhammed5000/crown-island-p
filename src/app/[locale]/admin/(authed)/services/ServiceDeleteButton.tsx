'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { deleteServiceAction } from '@/features/admin/catalog-actions';

interface Props {
  id: string;
  name: string;
  /** Number of bookings attached — a service with bookings cannot be deleted. */
  bookingCount: number;
}

function errorMessage(code: string): string {
  switch (code) {
    case 'service_has_bookings':
      return 'This service has bookings and cannot be deleted. Deactivate it instead.';
    case 'not_found':
      return 'This service no longer exists.';
    default:
      return 'Something went wrong while deleting. Please try again.';
  }
}

export function ServiceDeleteButton({ id, name, bookingCount }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasBookings = bookingCount > 0;

  function go() {
    setError(null);
    startTransition(async () => {
      const res = await deleteServiceAction({ id });
      if (res.ok) {
        setConfirming(false);
        router.refresh();
      } else {
        setError(errorMessage(res.code));
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
      >
        ✕
      </button>

      <Modal isOpen={confirming} onClose={() => setConfirming(false)} title="Delete service">
        <div className="space-y-4 pt-2">
          <p className="text-sm text-foreground">
            Delete <span className="font-semibold text-gold-600">{name}</span>?
          </p>
          {hasBookings ? (
            <p className="text-sm text-red-700">
              This service has {bookingCount} booking{bookingCount === 1 ? '' : 's'} and cannot be
              deleted. Deactivate it from the edit screen instead so existing bookings stay intact.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              This permanently removes the service and its price rules. This cannot be undone.
            </p>
          )}
          {error ? <p className="text-sm font-medium text-red-700">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={isPending}
              disabled={hasBookings}
              onClick={go}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
