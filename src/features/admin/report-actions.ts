'use server';

import { getManagementSummary } from '@/server/services/admin-reports';
import { requireAdmin } from '@/server/auth/guards';

export async function getManagementSummaryAction() {
  await requireAdmin();
  return await getManagementSummary();
}
