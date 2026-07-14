export function refundDisposition(input: {
  priorRefundedCents: number;
  amountCents: number;
  invoiceTotalCents: number;
  cancelBooking: boolean;
}): {
  isFull: boolean;
  shouldCancelBooking: boolean;
  paymentStatus: 'SUCCEEDED' | 'REFUNDED';
} {
  const isFull = input.priorRefundedCents + input.amountCents >= input.invoiceTotalCents;
  return {
    isFull,
    shouldCancelBooking: isFull || input.cancelBooking,
    paymentStatus: isFull ? 'REFUNDED' : 'SUCCEEDED',
  };
}

export function paymentStatusAfterRefund(isFull: boolean): 'SUCCEEDED' | 'REFUNDED' {
  return isFull ? 'REFUNDED' : 'SUCCEEDED';
}
