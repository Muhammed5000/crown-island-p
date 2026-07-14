'use client';

import { PolicyGate } from '@/components/policy/PolicyGate';
import { acceptTermsAction } from '@/features/auth/terms-actions';

interface Props {
  terms: string;
}

/**
 * Terms & Conditions gate. Thin wrapper over the shared {@link PolicyGate} —
 * the scroll-to-accept UI lives there so Terms and the Refund Policy stay
 * visually and behaviourally identical.
 */
export function TermsGate({ terms }: Props) {
  return (
    <PolicyGate document={terms} namespace="terms" acceptAction={acceptTermsAction} />
  );
}
