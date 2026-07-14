'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { deleteCategoryAction } from '@/features/admin/catalog-actions';

interface Props {
  id: string;
  name: string;
  serviceCount: number;
  /**
   * True for the built-in "Uncategorized" bucket. It is the re-homing target for
   * orphaned services, so it can be deleted only while empty; if it still holds
   * services they must be moved to a real category first.
   */
  isUncategorized?: boolean;
}

function errorMessage(code: string): string {
  switch (code) {
    case 'uncategorized_has_services':
      return 'Move its services to another category first — Uncategorized can’t be deleted while it still holds services.';
    // Legacy code — the server no longer emits this (the empty bucket is now
    // deletable); kept as a defensive fallback only.
    case 'cannot_delete_uncategorized':
      return 'The Uncategorized bucket cannot be deleted.';
    case 'not_found':
      return 'This category no longer exists.';
    default:
      return 'Something went wrong while deleting. Please try again.';
  }
}

export function CategoryDeleteButton({ id, name, serviceCount, isUncategorized = false }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The Uncategorized bucket can only be deleted while empty (its services have
  // nowhere to be re-homed to). The button stays available so the rule is
  // discoverable, but the confirm's Delete action is blocked while it has
  // services — matching the server-side guard.
  const blocked = isUncategorized && serviceCount > 0;

  function go() {
    if (blocked) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteCategoryAction({ id });
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
        ✕ delete
      </button>

      <Modal isOpen={confirming} onClose={() => setConfirming(false)} title="Delete category">
        <div className="space-y-4 pt-2">
          <p className="text-sm text-foreground">
            Delete <span className="font-semibold text-gold-600">{name}</span>?
          </p>
          <p className="text-sm text-muted-foreground">
            {isUncategorized ? (
              serviceCount > 0 ? (
                <>
                  This bucket still holds {serviceCount} service{serviceCount === 1 ? '' : 's'}. Move{' '}
                  {serviceCount === 1 ? 'it' : 'them'} to another category first — Uncategorized
                  can’t be deleted while it holds services.
                </>
              ) : (
                <>
                  This bucket is empty and can be safely deleted. It is recreated automatically only
                  if a later category deletion needs somewhere to re-home its services.
                </>
              )
            ) : serviceCount > 0 ? (
              <>
                Its {serviceCount} service{serviceCount === 1 ? '' : 's'} will be moved to{' '}
                <span className="font-semibold">Uncategorized</span> (category set to none) and will
                not be deleted.
              </>
            ) : (
              'This category has no services.'
            )}
          </p>
          {error ? <p className="text-sm font-medium text-red-700">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={isPending}
              disabled={blocked}
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
