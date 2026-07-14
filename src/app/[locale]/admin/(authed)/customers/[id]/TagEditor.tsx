'use client';

import { useState, useTransition } from 'react';
import { XIcon, PlusIcon } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { assignTagAction, unassignTagAction } from '@/features/admin/tag-actions';

interface TagChip {
  id: string;
  name: string;
  color: string;
}

interface Props {
  userId: string;
  tags: TagChip[];
  library: TagChip[];
}

export function TagEditor({ userId, tags, library }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState('');

  const assignedIds = new Set(tags.map((t) => t.id));
  const available = library.filter((t) => !assignedIds.has(t.id));

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function remove(tagId: string, tagName: string) {
    const res = await unassignTagAction(userId, tagId);
    if (!res.ok) {
      toast('Could not remove the tag.', 'error');
    } else {
      toast(`Removed “${tagName}”.`, 'success');
      refresh();
    }
  }

  async function add(tagId: string) {
    if (!tagId) return;
    setAdding('');
    const res = await assignTagAction(userId, tagId);
    if (!res.ok) {
      toast('Could not add the tag.', 'error');
    } else {
      toast('Tag added.', 'success');
      refresh();
    }
  }

  return (
    <div className="space-y-3" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2">
        {tags.length === 0 ? (
          <span className="text-sm text-muted-foreground">No tags yet.</span>
        ) : (
          tags.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1">
              <Badge tone={t.color as BadgeTone}>{t.name}</Badge>
              <button
                type="button"
                onClick={() => remove(t.id, t.name)}
                disabled={pending}
                aria-label={`Remove ${t.name}`}
                className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-danger/10 hover:text-danger disabled:opacity-50"
              >
                <XIcon className="size-3.5" />
              </button>
            </span>
          ))
        )}
      </div>

      {available.length > 0 ? (
        <div className="flex items-center gap-2">
          <PlusIcon className="size-4 text-muted-foreground" />
          <select
            value={adding}
            disabled={pending}
            onChange={(e) => add(e.target.value)}
            className="h-9 rounded-xl border border-border/60 bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
            aria-label="Add a tag"
          >
            <option value="">Add a tag…</option>
            {available.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      ) : library.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No tags in the library yet — create some under Tags.
        </p>
      ) : null}
    </div>
  );
}
