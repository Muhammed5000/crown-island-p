import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * Booking-flow wizard state.
 *
 * ⚠️ This is *UI* state only. None of these values are trusted by the server —
 * the booking is created with a server-side recompute against PriceRule rows
 * inside a transaction (see docs/booking-flow.md).
 */
export interface BookingFlowState {
  categorySlug: string | null;
  serviceSlug: string | null;
  /** ISO date string yyyy-mm-dd, or null if not picked yet. */
  date: string | null;
  people: number;
  cars: number;
  /** Client idempotency key, generated when the user lands on the review screen. */
  clientRequestId: string | null;
  /** Last server-quoted total in piastres, used purely for the review UI. */
  quotedTotalCents: number | null;
}

const initialState: BookingFlowState = {
  categorySlug: null,
  serviceSlug: null,
  date: null,
  people: 1,
  cars: 0,
  clientRequestId: null,
  quotedTotalCents: null,
};

const slice = createSlice({
  name: 'bookingFlow',
  initialState,
  reducers: {
    setCategory(state, action: PayloadAction<string | null>) {
      state.categorySlug = action.payload;
      // changing category invalidates downstream choices
      state.serviceSlug = null;
      state.quotedTotalCents = null;
    },
    setService(state, action: PayloadAction<string | null>) {
      state.serviceSlug = action.payload;
      state.quotedTotalCents = null;
    },
    setDate(state, action: PayloadAction<string | null>) {
      state.date = action.payload;
      state.quotedTotalCents = null;
    },
    setPeople(state, action: PayloadAction<number>) {
      state.people = Math.max(1, action.payload);
      state.quotedTotalCents = null;
    },
    setCars(state, action: PayloadAction<number>) {
      state.cars = Math.max(0, action.payload);
      state.quotedTotalCents = null;
    },
    setClientRequestId(state, action: PayloadAction<string | null>) {
      state.clientRequestId = action.payload;
    },
    setQuotedTotal(state, action: PayloadAction<number | null>) {
      state.quotedTotalCents = action.payload;
    },
    reset() {
      return initialState;
    },
  },
});

export const {
  setCategory,
  setService,
  setDate,
  setPeople,
  setCars,
  setClientRequestId,
  setQuotedTotal,
  reset: resetBookingFlow,
} = slice.actions;

export default slice.reducer;
