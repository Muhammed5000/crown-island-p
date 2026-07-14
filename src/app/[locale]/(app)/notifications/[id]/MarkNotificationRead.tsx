'use client';

import { useEffect } from 'react';
import { markCustomerNotificationsReadAction } from '@/features/notifications/actions';

/**
 * Marks a notification read when its detail page is viewed (idempotent). Covers
 * the case where the user lands here directly (push click / deep link) rather
 * than via the list, which already marks on click.
 */
export function MarkNotificationRead({ id }: { id: string }) {
  useEffect(() => {
    void markCustomerNotificationsReadAction([id]).catch((e) => {
      if (process.env.NODE_ENV !== 'production') console.error('[notifications] mark read failed', e);
    });
  }, [id]);
  return null;
}
