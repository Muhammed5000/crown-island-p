'use server';

import { getSessionUser } from '@/server/auth/guards';
import {
  listForUser,
  markRead,
  type CustomerNotificationRow,
} from '@/server/services/customer-notifications';

/**
 * Customer notification actions — session-authed. The customer bell + inbox
 * poll `listCustomerNotificationsAction`; clicking / "mark all read" call the
 * mark actions. All are scoped to the signed-in user inside the service.
 */

export type CustomerNotificationsResult =
  | { ok: true; rows: CustomerNotificationRow[]; unread: number }
  | { ok: false; code: string };

export async function listCustomerNotificationsAction(): Promise<CustomerNotificationsResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, code: 'forbidden' };
  try {
    const res = await listForUser(user.id);
    return { ok: true, ...res };
  } catch {
    return { ok: false, code: 'unknown' };
  }
}

export async function markCustomerNotificationsReadAction(
  ids: string[] | 'all',
): Promise<{ ok: boolean }> {
  const user = await getSessionUser();
  if (!user) return { ok: false };
  try {
    await markRead(user.id, ids === 'all' ? 'all' : ids.map(String).slice(0, 100));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
