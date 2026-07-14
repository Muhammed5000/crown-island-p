'use server';

import { revalidatePath } from 'next/cache';
import { requireDeveloper, requireUser } from '@/server/auth/guards';
import { 
  setSandboxMode, 
  cleanupTesterData, 
  confirmVirtualPayment 
} from '@/server/services/admin-developer';
import { getSettings } from '@/server/settings/settings';
import { AuthorizationError, DomainError } from '@/server/services/errors';

export async function toggleSandboxAction(enabled: boolean) {
  await requireDeveloper();
  await setSandboxMode(enabled);
  revalidatePath('/admin/developer');
  revalidatePath('/admin/settings');
  return { ok: true };
}

export async function cleanupTesterDataAction() {
  await requireDeveloper();
  const res = await cleanupTesterData();
  revalidatePath('/admin');
  revalidatePath('/admin/bookings');
  revalidatePath('/admin/invoices');
  revalidatePath('/admin/payments');
  return { ok: true, deleted: res.deletedBookings };
}

export async function virtualPayAction(bookingId: string) {
  const user = await requireUser();
  const settings = await getSettings();

  // Guard: Only TESTER or DEVELOPER can use virtual pay, 
  // and ONLY if sandbox mode is active.
  if (user.role !== 'TESTER' && user.role !== 'DEVELOPER') {
    throw new AuthorizationError();
  }
  
  if (!settings.sandboxMode) {
    throw new DomainError('sandbox_disabled', 'sandbox_disabled', 400);
  }

  await confirmVirtualPayment(bookingId, user.id);
  revalidatePath('/booking/payment');
  revalidatePath('/admin/bookings');
  return { ok: true };
}
