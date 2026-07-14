'use client';

import { useState } from 'react';
import { PowerIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { togglePromoAction, deletePromoAction } from '@/features/admin/promo-actions';

const ERROR_MESSAGES: Record<string, string> = {
  has_redemptions: 'This code has been used — deactivate it instead of deleting.',
  not_found: 'This code no longer exists.',
};

interface Props {
  promoId: string;
  isActive: boolean;
}

export function PromoRowActions({ promoId, isActive }: Props) {
  const toast = useToast();
  const [busy, setBusy] = useState<null | 'toggle' | 'delete'>(null);

  async function handleToggle() {
    setBusy('toggle');
    try {
      const res = await togglePromoAction(promoId);
      if (!res.ok) toast(ERROR_MESSAGES[res.code] ?? 'Something went wrong.', 'error');
      else toast(isActive ? 'Code deactivated.' : 'Code activated.', 'success');
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this promo code? This cannot be undone.')) return;
    setBusy('delete');
    try {
      const res = await deletePromoAction(promoId);
      if (!res.ok) toast(ERROR_MESSAGES[res.code] ?? 'Something went wrong.', 'error');
      else toast('Promo code deleted.', 'success');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleToggle}
        loading={busy === 'toggle'}
        aria-label={isActive ? 'Deactivate' : 'Activate'}
        title={isActive ? 'Deactivate' : 'Activate'}
      >
        <PowerIcon className="size-4" />
        <span className="ms-1">{isActive ? 'Deactivate' : 'Activate'}</span>
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="size-8 p-0 text-danger hover:bg-danger/10"
        onClick={handleDelete}
        loading={busy === 'delete'}
        aria-label="Delete"
      >
        <Trash2Icon className="size-4" />
      </Button>
    </div>
  );
}
