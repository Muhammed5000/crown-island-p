/**
 * Pure core of the reception "returning guest" prefill (no server-only/Prisma
 * deps, so it is directly unit-testable — same convention as blocklist-core).
 *
 * A returning customer's party members are DERIVED from their booking history's
 * `GuestIdDocument` rows — there is deliberately no denormalized "identity
 * vault" table to keep in sync; the documents stay the single source of truth.
 */

/** One distinct real person recovered from a customer's booking history. */
export interface KnownGuest {
  /** Latest GuestIdDocument.id carrying this person's ID — the reuse handle. */
  sourceDocumentId: string;
  /** The ID-card / passport NUMBER (GuestIdDocument.guestName). */
  idNumber: string;
  /** Latest stored photo for this person. */
  imageUrl: string;
  fileName: string;
  /** When this person was last seen (their newest document's timestamp). */
  lastSeenIso: string;
}

/** Raw material: one GuestIdDocument row + its recency key. */
export interface KnownGuestSourceRow {
  documentId: string;
  /** GuestIdDocument.guestName — the typed ID/passport number (may be blank). */
  idNumber: string | null;
  imageUrl: string;
  fileName: string;
  /** ISO timestamp used for newest-wins (the document's createdAt). */
  seenAtIso: string;
}

/**
 * Same-person key: identity numbers are case-insensitive (a passport typed
 * `ab123` and `AB123` is one person — mirrors the blocklist's PASSPORT
 * normalization) and whitespace-insensitive.
 */
function identityKey(idNumber: string): string {
  return idNumber.replace(/\s+/g, '').toUpperCase();
}

/**
 * Collapse a customer's document history into distinct people, newest-wins.
 *
 * - Rows WITHOUT a typed ID number are skipped: they can't be safely matched to
 *   a person, and reuse without a number would also bypass the identity
 *   blocklist re-check at booking creation.
 * - For each distinct number the NEWEST row wins (freshest photo — people renew
 *   documents), keyed by `seenAtIso`.
 * - Output is sorted newest-first and capped (the desk needs the recent party,
 *   not an unbounded archive).
 */
export function dedupeKnownGuests(rows: KnownGuestSourceRow[], cap = 12): KnownGuest[] {
  const byPerson = new Map<string, KnownGuest>();
  for (const row of rows) {
    const idNumber = (row.idNumber ?? '').trim();
    if (!idNumber || !row.imageUrl) continue;
    const key = identityKey(idNumber);
    const current = byPerson.get(key);
    if (current && current.lastSeenIso >= row.seenAtIso) continue;
    byPerson.set(key, {
      sourceDocumentId: row.documentId,
      idNumber,
      imageUrl: row.imageUrl,
      fileName: row.fileName,
      lastSeenIso: row.seenAtIso,
    });
  }
  return Array.from(byPerson.values())
    .sort((a, b) => b.lastSeenIso.localeCompare(a.lastSeenIso))
    .slice(0, Math.max(0, cap));
}

/**
 * Ownership predicate for reusing a stored ID document (the IDOR guard).
 *
 * A document may be reused for a new walk-in booking ONLY when the booking it
 * came from belongs to the SAME customer the desk is booking for, where the
 * customer is identified by the new booking's (E.164) guest phone:
 *  - a reception booking made for that phone (`guestPhone` matches), or
 *  - an ONLINE booking owned by the account holding that phone (`userId`
 *    matches; online bookings have no `createdByStaffId`).
 *
 * Everything here is server-derived from the phone — a client-sent customer id
 * is never trusted. Walk-in source bookings carry the STAFF member in `userId`,
 * so `userId` is only consulted for online bookings.
 */
export function guestDocBelongsToCustomer(
  source: {
    bookingUserId: string;
    bookingGuestPhone: string | null;
    bookingCreatedByStaffId: string | null;
  },
  customer: { guestPhone: string; accountUserId: string | null },
): boolean {
  if (source.bookingGuestPhone && source.bookingGuestPhone === customer.guestPhone) return true;
  if (
    customer.accountUserId &&
    source.bookingCreatedByStaffId === null &&
    source.bookingUserId === customer.accountUserId
  ) {
    return true;
  }
  return false;
}
