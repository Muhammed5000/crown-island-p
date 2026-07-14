'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/server/auth/guards';
import { cancelBooking } from '@/server/services/bookings-read';
import { DomainError } from '@/server/services/errors';

const schema = z.object({ bookingId: z.string().min(1) });

export type CancelResult = { ok: true } | { ok: false; code: string };

export async function cancelMyBooking(input: unknown): Promise<CancelResult> {
  const user = await requireUser();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  try {
    await cancelBooking(parsed.data.bookingId, user.id);
    revalidatePath('/bookings/history');
    revalidatePath(`/bookings/${parsed.data.bookingId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}
