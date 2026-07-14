'use client';

import { useState } from 'react';
import { Trash2Icon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { deleteTagAction } from '@/features/admin/tag-actions';

export function TagDeleteButton({ tagId, assignmentCount }: { tagId: string; assignmentCount: number }) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    const warn =
      assignmentCount > 0
        ? `Delete this tag? It will be removed from ${assignmentCount} customer${assignmentCount === 1 ? '' : 's'}. This cannot be undone.`
        : 'Delete this tag? This cannot be undone.';
    if (!confirm(warn)) return;
    setLoading(true);
    try {
      const res = await deleteTagAction(tagId);
      if (!res.ok) toast('Could not delete the tag.', 'error');
      else toast('Tag deleted.', 'success');
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
      aria-label="Delete tag"
    >
      <Trash2Icon className="size-4" />
    </Button>
  );
}
