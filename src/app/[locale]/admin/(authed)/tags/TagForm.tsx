'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Badge } from '@/components/ui/Badge';
import { createTagAction, type TagActionResult } from '@/features/admin/tag-actions';

const COLORS = ['gold', 'navy', 'success', 'warning', 'danger', 'info', 'muted'] as const;
type Color = (typeof COLORS)[number];

const ERROR_MESSAGES: Record<string, string> = {
  tag_taken: 'A tag with that name already exists.',
  invalid_name: 'Tag name must be 1–40 characters.',
  invalid_color: 'Please pick a colour.',
  invalid_input: 'Please check the fields.',
};

export function TagForm() {
  const [name, setName] = useState('');
  const [color, setColor] = useState<Color>('muted');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setError(null);
    const res: TagActionResult | void = await createTagAction(formData);
    if (res && !res.ok) setError(res.code);
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div>
          <Label htmlFor="name">Tag name</Label>
          <Input id="name" name="name" required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="VIP" />
        </div>
        <div>
          <Label htmlFor="color">Colour</Label>
          <select
            id="color"
            name="color"
            value={color}
            onChange={(e) => setColor(e.target.value as Color)}
            className="flex h-12 w-full rounded-xl border border-gold-400/[0.12] bg-card px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {COLORS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="pb-1">
          <span className="block text-xs text-muted-foreground mb-1">Preview</span>
          <Badge tone={color}>{name.trim() || 'Tag'}</Badge>
        </div>
      </div>

      {error && (
        <p className="text-sm font-medium text-danger" role="alert">
          {ERROR_MESSAGES[error] ?? 'Something went wrong.'}
        </p>
      )}

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} variant="primary">
      Add tag
    </Button>
  );
}
