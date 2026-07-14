'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Trash2Icon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { deleteUserAction } from '@/features/admin/user-actions';

interface Props {
  userId: string;
}

export function DeleteUserButton({ userId }: Props) {
  const t = useTranslations('common');
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      return;
    }

    setLoading(true);
    try {
      const res = await deleteUserAction(userId);
      if (!res.ok) {
        alert(res.code);
      }
    } catch {
      alert(t('error'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="size-8 p-0 text-danger hover:bg-danger/10"
      onClick={handleDelete}
      loading={loading}
      aria-label={t('delete')}
    >
      <Trash2Icon className="size-4" />
    </Button>
  );
}
