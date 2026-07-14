'use client';

import { useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { updateRefundPolicyAction } from '@/features/admin/settings-actions';

interface Props {
  initialRefundPolicyEn: string;
  initialRefundPolicyAr: string;
}

/**
 * Deliberately `onSubmit` + `useTransition` rather than `<form action={…}>`:
 * React 19 resets uncontrolled fields once a form action settles, which would
 * wipe everything the admin typed whenever validation fails.
 */
export function RefundPolicyForm({ initialRefundPolicyEn, initialRefundPolicyAr }: Props) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateRefundPolicyAction(formData);
      if (res.ok) {
        router.refresh();
      } else {
        alert('Failed to update refund policy. Check the console.');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="font-display text-lg font-semibold text-gold-600">
            Refund Policy (English)
          </h2>
          <p className="text-sm text-muted-foreground">
            This will be shown to English-speaking users. Supports plain text with line breaks.
          </p>
        </CardHeader>
        <CardBody>
          <textarea
            name="refundPolicyEn"
            defaultValue={initialRefundPolicyEn}
            required
            rows={15}
            className="w-full rounded-2xl border border-border/40 bg-input p-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            placeholder="Enter the full refund policy here..."
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-display text-lg font-semibold text-gold-600">
            سياسة الاسترداد (العربية)
          </h2>
          <p className="text-sm text-muted-foreground">
            سيتم عرض هذا للمستخدمين المتحدثين باللغة العربية. يدعم النص العادي مع فواصل الأسطر.
          </p>
        </CardHeader>
        <CardBody>
          <textarea
            name="refundPolicyAr"
            defaultValue={initialRefundPolicyAr}
            required
            dir="rtl"
            rows={15}
            className="w-full rounded-2xl border border-border/40 bg-input p-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            placeholder="أدخل سياسة الاسترداد الكاملة هنا..."
          />
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="h-11 rounded-xl bg-primary px-8 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? 'Saving...' : 'Save Refund Policy'}
        </button>
      </div>
    </form>
  );
}
