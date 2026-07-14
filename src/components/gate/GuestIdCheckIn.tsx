'use client';

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type DragEvent,
} from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import {
  recordGuestIdAction,
  removeGuestIdAction,
  setGuestIdNameAction,
  completeCheckInAction,
} from '@/features/reception/guest-id-actions';
import { PlacePicker } from './PlacePicker';
import { CrownLogo } from '@/components/brand/CrownLogo';
import { ImageLightbox, EyeGlyph } from '@/components/ui/ImageLightbox';
import { SuccessTicket, CopyReferenceButton, EntryTracker, PrinterGlyph, successGhostBtn, successGoldBtn } from './SuccessPass';
import { formatMoney } from '@/lib/money';
import { CROWN, type PlacementView } from './tokens';

/**
 * Reception check-in — mandatory guest ID collection.
 *
 * Renders one upload card per guest on the booking (Guest 1 … Guest N) in a
 * responsive grid (1 / 2 / 4 columns). Each card supports drag-and-drop, click
 * upload, mobile camera capture and gallery selection, with client-side
 * compression, a live progress bar, preview, replace/remove and per-card
 * validation. The "Complete Check-In" button stays disabled until every guest's
 * ID is uploaded — and the server re-enforces that gate in `checkInBooking`, so
 * the button is convenience only.
 *
 * Styling mirrors the reception desk (CROWN midnight + gold tokens, inline
 * styles) for a consistent kiosk look; the grid uses Tailwind for responsive
 * columns.
 */

// ── CROWN tokens — single source of truth in ./tokens ──
const { cream, dim, faint, gold, bg, panel, line, ok, bad, serif, sans } = CROWN;

const ACCEPT = 'image/jpeg,image/png,image/webp';
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — mirrors the server limit
const COMPRESS_ABOVE = 1.2 * 1024 * 1024; // only compress images larger than this

export interface GuestIdDocView {
  guestSeq: number;
  imageUrl: string;
  fileName: string;
  verificationStatus: string;
  /** Reception-entered ID/passport NUMBER (also the gate-picker label). */
  guestName?: string | null;
  /** True once this specific guest has been admitted. */
  entered?: boolean;
}

export interface CheckInBookingSummary {
  id: string;
  reference: string;
  guestName: string;
  guestPhone: string;
  serviceName: string;
  categoryName: string;
  dateLabel: string;
  people: number;
  adults: number;
  children: number;
  /** Paid "Extra Person" add-ons — each needs an ID and counts at the gate. */
  extraPersons: number;
  cars: number;
  /** Guests already admitted on this ticket (partial check-in). */
  enteredCount: number;
  alreadyCheckedIn: boolean;
  /** Service requires a physical place per unit before admit. */
  requiresPlacement: boolean;
  /** Current placement roll-up. */
  placementStatus: 'NOT_REQUIRED' | 'PENDING' | 'PARTIAL' | 'COMPLETE';
  /** Invoice total in piastres (null when the booking has no invoice). */
  totalCents: number | null;
  /** Human label of the successful payment ("Cash", "Card (Paymob)", …). */
  paymentLabel: string | null;
  /** Server-rendered SVG of the daily visit-pass QR (null → reference fallback). */
  qrSvg: string | null;
}

interface Props {
  locale: 'ar' | 'en';
  booking: CheckInBookingSummary;
  initialDocs: GuestIdDocView[];
}

type SlotState = 'empty' | 'uploading' | 'uploaded' | 'error';
interface Slot {
  seq: number;
  state: SlotState;
  url?: string;
  previewUrl?: string;
  fileName?: string;
  name?: string;
  /** True once this specific guest has already been admitted. */
  entered?: boolean;
  progress: number;
  error?: string;
}

// ── Bilingual copy (gate area is inline-localized, like ReceptionDesk) ──
interface Copy {
  eyebrow: string;
  title: string;
  subtitle: string;
  booking: string;
  guest: string;
  guests: string;
  progress: (n: number, t: number) => string;
  dropHere: string;
  or: string;
  browse: string;
  camera: string;
  replace: string;
  remove: string;
  uploading: string;
  uploaded: string;
  pending: string;
  failed: string;
  retry: string;
  complete: string;
  completing: string;
  allRequired: string;
  accepted: string;
  /** Label/placeholder for the per-guest ID/passport NUMBER field. */
  idNumber: string;
  /** Label for a child guest (e.g. "Child"). */
  child: string;
  /** Sub-label clarifying children need no ID (e.g. "No ID image required"). */
  childNoId: string;
  admitted: string;
  admittedNote: string;
  printPasses: string;
  printInvoice: string;
  invoice: string;
  tickets: string;
  brand: string;
  brandSub: string;
  backToDesk: string;
  alreadyIn: string;
  // wizard
  stepData: string;
  stepIds: string;
  stepPlaces: string;
  stepConfirm: string;
  next: string;
  prev: string;
  confirmAdmit: string;
  reviewTitle: string;
  phone: string;
  service: string;
  date: string;
  party: string;
  cars: string;
  placesTitle: string;
  placesSubtitle: string;
  placesAssign: string;
  placesEdit: string;
  placesDone: string;
  placesNotRequired: string;
  confirmTitle: string;
  confirmNote: string;
  idsDoneShort: string;
  // partial check-in (headcount)
  enteringNow: string;
  alreadyEntered: (entered: number, total: number) => string;
  remainingLabel: (n: number) => string;
  partialTitle: string;
  partialNote: (entered: number, remaining: number) => string;
  admitMore: string;
  // outcome screen (Crown Booking Created design)
  outcomeEyebrowFull: string;
  outcomeEyebrowPartial: string;
  summaryTitle: string;
  totalPaid: string;
  paymentMethod: string;
  trackerTitle: string;
  trackerAdmittedOf: (entered: number, guests: number) => string;
  trackerNone: (guests: number) => string;
  trackerPartial: (entered: number, remaining: number) => string;
  trackerAll: string;
  copyReference: string;
  referenceCopied: string;
  errors: Record<string, string>;
}

const COPY: Record<'en' | 'ar', Copy> = {
  en: {
    eyebrow: 'Reception · Check-In',
    title: 'Guest Identity Verification',
    subtitle: 'Upload a clear photo of each guest’s ID before admitting the party.',
    booking: 'Booking',
    guest: 'Guest',
    guests: 'guests',
    progress: (n: number, t: number) => `${n} of ${t} IDs uploaded`,
    dropHere: 'Drag & drop ID photo',
    or: 'or',
    browse: 'Browse',
    camera: 'Camera',
    replace: 'Replace',
    remove: 'Remove',
    uploading: 'Uploading…',
    uploaded: 'Uploaded',
    pending: 'Pending',
    failed: 'Failed',
    retry: 'Retry',
    complete: 'Complete Check-In',
    completing: 'Admitting…',
    allRequired: 'All adult + extra-person IDs are required',
    accepted: 'JPG, PNG or WEBP · max 10MB',
    idNumber: 'ID / Passport Number',
    child: 'Child',
    childNoId: 'No ID image required',
    admitted: 'Guest admitted',
    admittedNote: 'All IDs verified and check-in recorded.',
    printPasses: 'Print tickets',
    printInvoice: 'Print invoice',
    invoice: 'Invoice',
    tickets: 'Tickets',
    brand: 'Crown Island',
    brandSub: 'Reception · Check-in',
    backToDesk: 'Back to reception',
    alreadyIn: 'This booking is already checked in.',
    stepData: 'Guest data',
    stepIds: 'Identity',
    stepPlaces: 'Placement',
    stepConfirm: 'Confirm',
    next: 'Next',
    prev: 'Back',
    confirmAdmit: 'Confirm & admit',
    reviewTitle: 'Review the booking',
    phone: 'Phone',
    service: 'Service',
    date: 'Date',
    party: 'Party',
    cars: 'Vehicles',
    placesTitle: 'Assign places on the map',
    placesSubtitle: 'Every unit must have a place before admitting.',
    placesAssign: 'Open place map',
    placesEdit: 'Edit places',
    placesDone: 'All places assigned',
    placesNotRequired: 'This service does not need place assignment.',
    confirmTitle: 'Confirm check-in',
    confirmNote: 'Review everything below, then admit the guests entering now.',
    idsDoneShort: 'IDs uploaded',
    enteringNow: 'Guests entering now',
    alreadyEntered: (e, total) => `${e} of ${total} already entered`,
    remainingLabel: (n) => `${n} remaining on this ticket`,
    partialTitle: 'Group admitted',
    partialNote: (e, r) => `${e} entered · ${r} can still enter later on this ticket.`,
    admitMore: 'Admit more now',
    outcomeEyebrowFull: 'CHECK-IN COMPLETE',
    outcomeEyebrowPartial: 'PARTIAL CHECK-IN',
    summaryTitle: 'Booking summary',
    totalPaid: 'TOTAL PAID',
    paymentMethod: 'Payment method',
    trackerTitle: 'GATE ENTRY STATUS',
    trackerAdmittedOf: (e, g) => `${e} of ${g} admitted`,
    trackerNone: (g) => `No one admitted yet — all ${g} will scan in at the gate.`,
    trackerPartial: (e, r) => `${e} entered now · ${r} can still enter at the gate.`,
    trackerAll: 'All guests admitted.',
    copyReference: 'Copy reference',
    referenceCopied: '✓ Reference copied',
    errors: {
      unsupported_type: 'Only JPG, PNG or WEBP images are accepted.',
      too_large: 'Image exceeds the 10MB limit.',
      empty_file: 'That file is empty or unreadable.',
      no_file: 'No file was attached.',
      network: 'Upload failed — check the connection and retry.',
      guest_seq_out_of_range: 'Guest number is out of range.',
      invalid_upload: 'Upload could not be verified. Try again.',
      forbidden: 'You are not authorised for this action.',
      guest_id_required: 'Upload every guest ID before completing check-in.',
      placement_required: 'Assign all places before check-in.',
      not_admissible: 'This pass cannot be admitted.',
      blocked: 'This guest is blocked — entry is not allowed.',
      storage_error: 'Storage error — please retry.',
      upload_failed: 'Upload failed. Please retry.',
      unknown: 'Something went wrong. Please retry.',
    } as Record<string, string>,
  },
  ar: {
    eyebrow: 'الاستقبال · تسجيل الدخول',
    title: 'التحقق من هوية الضيوف',
    subtitle: 'ارفع صورة واضحة لبطاقة هوية كل ضيف قبل السماح بالدخول.',
    booking: 'الحجز',
    guest: 'ضيف',
    guests: 'ضيوف',
    progress: (n: number, t: number) => `تم رفع ${n} من ${t} بطاقات`,
    dropHere: 'اسحب وأفلت صورة الهوية',
    or: 'أو',
    browse: 'تصفّح',
    camera: 'الكاميرا',
    replace: 'استبدال',
    remove: 'حذف',
    uploading: 'جارٍ الرفع…',
    uploaded: 'تم الرفع',
    pending: 'بانتظار',
    failed: 'فشل',
    retry: 'إعادة',
    complete: 'إتمام تسجيل الدخول',
    completing: 'جارٍ السماح بالدخول…',
    allRequired: 'بطاقات هوية البالغين والأشخاص الإضافيين مطلوبة',
    accepted: 'JPG أو PNG أو WEBP · بحد أقصى 10 ميجابايت',
    idNumber: 'رقم الهوية / جواز السفر',
    child: 'طفل',
    childNoId: 'لا تتطلب صورة هوية',
    admitted: 'تم السماح بالدخول',
    admittedNote: 'تم التحقق من جميع البطاقات وتسجيل الدخول.',
    printPasses: 'طباعة التذاكر',
    printInvoice: 'طباعة الفاتورة',
    invoice: 'الفاتورة',
    tickets: 'التذاكر',
    brand: 'كراون آيلاند',
    brandSub: 'الاستقبال · تسجيل الدخول',
    backToDesk: 'العودة للاستقبال',
    alreadyIn: 'تم تسجيل دخول هذا الحجز بالفعل.',
    stepData: 'بيانات الضيف',
    stepIds: 'الهوية',
    stepPlaces: 'الأماكن',
    stepConfirm: 'تأكيد',
    next: 'التالي',
    prev: 'السابق',
    confirmAdmit: 'تأكيد والسماح بالدخول',
    reviewTitle: 'مراجعة الحجز',
    phone: 'الهاتف',
    service: 'الخدمة',
    date: 'التاريخ',
    party: 'المجموعة',
    cars: 'المركبات',
    placesTitle: 'تعيين الأماكن على الخريطة',
    placesSubtitle: 'يجب تعيين مكان لكل وحدة قبل الدخول.',
    placesAssign: 'فتح خريطة الأماكن',
    placesEdit: 'تعديل الأماكن',
    placesDone: 'تم تعيين جميع الأماكن',
    placesNotRequired: 'هذه الخدمة لا تتطلب تعيين مكان.',
    confirmTitle: 'تأكيد تسجيل الدخول',
    confirmNote: 'راجع التفاصيل أدناه ثم اسمح بدخول الضيوف الداخلين الآن.',
    idsDoneShort: 'تم رفع الهويات',
    enteringNow: 'الضيوف الداخلون الآن',
    alreadyEntered: (e, total) => `دخل ${e} من ${total} بالفعل`,
    remainingLabel: (n) => `${n} متبقّون على هذه التذكرة`,
    partialTitle: 'تم إدخال المجموعة',
    partialNote: (e, r) => `دخل ${e} · يمكن لـ ${r} الدخول لاحقًا على نفس التذكرة.`,
    admitMore: 'إدخال المزيد الآن',
    outcomeEyebrowFull: 'اكتمل تسجيل الدخول',
    outcomeEyebrowPartial: 'تسجيل دخول جزئي',
    summaryTitle: 'ملخص الحجز',
    totalPaid: 'الإجمالي المدفوع',
    paymentMethod: 'طريقة الدفع',
    trackerTitle: 'حالة الدخول عند البوابة',
    trackerAdmittedOf: (e, g) => `دخل ${e} من ${g}`,
    trackerNone: (g) => `لم يدخل أحد بعد — سيدخل جميع الضيوف (${g}) عند البوابة.`,
    trackerPartial: (e, r) => `دخل ${e} الآن · يمكن لـ ${r} الدخول عند البوابة.`,
    trackerAll: 'تم دخول جميع الضيوف.',
    copyReference: 'نسخ المرجع',
    referenceCopied: '✓ تم نسخ المرجع',
    errors: {
      unsupported_type: 'يُقبل فقط JPG أو PNG أو WEBP.',
      too_large: 'الصورة تتجاوز حد 10 ميجابايت.',
      empty_file: 'هذا الملف فارغ أو غير قابل للقراءة.',
      no_file: 'لم يتم إرفاق ملف.',
      network: 'فشل الرفع — تحقق من الاتصال وأعد المحاولة.',
      guest_seq_out_of_range: 'رقم الضيف خارج النطاق.',
      invalid_upload: 'تعذّر التحقق من الرفع. حاول مجددًا.',
      forbidden: 'غير مصرّح لك بهذا الإجراء.',
      guest_id_required: 'ارفع بطاقات جميع الضيوف قبل الإتمام.',
      placement_required: 'خصّص جميع الأماكن قبل تسجيل الدخول.',
      not_admissible: 'لا يمكن قبول هذه التذكرة.',
      blocked: 'هذا الضيف محظور — لا يُسمح بالدخول.',
      storage_error: 'خطأ في التخزين — أعد المحاولة.',
      upload_failed: 'فشل الرفع. أعد المحاولة.',
      unknown: 'حدث خطأ ما. أعد المحاولة.',
    },
  },
};

class UploadError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** XHR upload so we get a real progress event (fetch can't report upload %). */
function uploadWithProgress(file: File, onProgress: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/reception/upload');
    if (typeof window !== 'undefined' && window.location.hostname.includes('ngrok')) {
      xhr.setRequestHeader('ngrok-skip-browser-warning', 'true');
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      let body: { ok?: boolean; url?: string; code?: string; detail?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* fall through to error */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.url) resolve(body.url);
      else reject(new UploadError(body.code ?? 'upload_failed'));
    };
    xhr.onerror = () => reject(new UploadError('network'));
    xhr.onabort = () => reject(new UploadError('network'));
    xhr.send(fd);
  });
}

/** Best-effort client compression. Falls back to the original file on failure. */
async function maybeCompress(file: File): Promise<File> {
  if (file.size <= COMPRESS_ABOVE) return file;
  try {
    const { default: imageCompression } = await import('browser-image-compression');
    const out = await imageCompression(file, {
      maxSizeMB: 1.5,
      maxWidthOrHeight: 2200,
      useWebWorker: true,
      fileType: file.type,
    });
    // Never let compression *grow* a file or strip the name.
    return out.size < file.size
      ? new File([out], file.name, { type: out.type || file.type })
      : file;
  } catch {
    return file;
  }
}

export function GuestIdCheckIn({ locale, booking, initialDocs }: Props) {
  const t = COPY[locale];
  const errMsg = useCallback((code: string): string => t.errors[code] ?? t.errors.unknown ?? 'Error', [t]);
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // ID-upload slots are for ADULTS (slots 1 … adults) AND paid EXTRA PERSONS
  // (slots people+1 … people+extraPersons). Children carry no ID.
  const requiredIds = booking.adults + booking.extraPersons;
  const [slots, setSlots] = useState<Slot[]>(() => {
    const bySeq = new Map(initialDocs.map((d) => [d.guestSeq, d]));
    const seqs = [
      ...Array.from({ length: booking.adults }, (_, i) => i + 1),
      ...Array.from({ length: booking.extraPersons }, (_, i) => booking.people + i + 1),
    ];
    return seqs.map((seq) => {
      const doc = bySeq.get(seq);
      return doc
        ? { seq, state: 'uploaded' as const, url: doc.imageUrl, fileName: doc.fileName, name: doc.guestName ?? undefined, entered: doc.entered ?? false, progress: 100 }
        : { seq, state: 'empty' as const, progress: 0 };
    });
  });
  const [formError, setFormError] = useState<string | null>(null);

  // Child guest slots (adults+1 … people) — shown as icon cards, no ID upload.
  const childSeqs = Array.from({ length: booking.children }, (_, i) => booking.adults + i + 1);

  // ── Partial check-in: pick WHICH guests enter now, by their ID photo ──
  const [enteredSoFar, setEnteredSoFar] = useState(booking.enteredCount);
  const remainingToAdmit = Math.max(0, booking.people + booking.extraPersons - enteredSoFar);
  // Default selection = everyone not yet entered (adults by photo + children by
  // icon). Children have no per-row "entered" flag, so we derive how many already
  // entered from the headcount and pre-select only the remaining child slots.
  const [admitSeqs, setAdmitSeqs] = useState<Set<number>>(() => {
    const adultsEntered = initialDocs.filter((d) => d.entered).length;
    const childrenEntered = Math.max(0, booking.enteredCount - adultsEntered);
    return new Set<number>([
      ...initialDocs.filter((d) => !d.entered).map((d) => d.guestSeq),
      ...childSeqs.slice(childrenEntered),
    ]);
  });
  const toggleAdmit = (seq: number) =>
    setAdmitSeqs((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  // Enlarge an ID photo in a lightbox (without toggling the guest's selection).
  const [zoomDoc, setZoomDoc] = useState<{ src: string; caption: string } | null>(null);
  // Outcome screen: null while in the wizard; set after an admit (or if the
  // booking was already fully checked in on load).
  const [outcome, setOutcome] = useState<{ entered: number; remaining: number; total: number } | null>(
    booking.alreadyCheckedIn
      ? {
          entered: booking.people + booking.extraPersons,
          remaining: 0,
          total: booking.people + booking.extraPersons,
        }
      : null,
  );

  const uploadedCount = slots.filter((s) => s.state === 'uploaded').length;
  // "Done" once every required ID (adults + paid extra persons) is uploaded.
  const allDone = uploadedCount >= requiredIds;
  // How many children have already entered (derived from headcount — children
  // have no per-row stamp). Drives the entered/disabled state of child cards.
  const childrenEntered = Math.max(0, enteredSoFar - slots.filter((s) => s.entered).length);

  const patchSlot = useCallback((seq: number, patch: Partial<Slot>) => {
    setSlots((prev) => prev.map((s) => (s.seq === seq ? { ...s, ...patch } : s)));
  }, []);

  // Latest slots, readable inside async callbacks without stale closures (e.g.
  // to grab a name typed before the photo finished uploading).
  const slotsRef = useRef<Slot[]>(slots);
  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);

  // Local ID/passport-number edit; persisted on blur (the row must exist first).
  const onNameChange = useCallback((seq: number, name: string) => patchSlot(seq, { name }), [patchSlot]);
  const onNameCommit = useCallback(
    (seq: number) => {
      const slot = slotsRef.current.find((s) => s.seq === seq);
      if (slot?.state !== 'uploaded') return;
      const value = (slot.name ?? '').trim() || null;
      void (async () => {
        // Saving the number runs the server-side blocklist check; a blocked
        // guest comes back as `blocked`. Surface a safe, generic message and
        // flag the slot — the authoritative stop is re-enforced at check-in.
        const res = await setGuestIdNameAction({ bookingId: booking.id, guestSeq: seq, guestName: value });
        if (!res.ok && res.code === 'blocked') {
          const msg = errMsg('blocked');
          patchSlot(seq, { error: msg });
          setFormError(msg);
        } else {
          patchSlot(seq, { error: undefined });
        }
      })();
    },
    [booking.id, patchSlot, errMsg],
  );

  const handleFile = useCallback(
    async (seq: number, file: File) => {
      setFormError(null);
      // Client-side validation (the server re-validates independently).
      if (file.size === 0) return patchSlot(seq, { state: 'error', error: t.errors.empty_file });
      if (!ALLOWED_TYPES.has(file.type))
        return patchSlot(seq, { state: 'error', error: t.errors.unsupported_type });
      if (file.size > MAX_BYTES)
        return patchSlot(seq, { state: 'error', error: t.errors.too_large });

      const previewUrl = URL.createObjectURL(file);
      patchSlot(seq, { state: 'uploading', progress: 0, error: undefined, previewUrl, fileName: file.name });

      try {
        const compressed = await maybeCompress(file);
        const url = await uploadWithProgress(compressed, (pct) => patchSlot(seq, { progress: pct }));
        const res = await recordGuestIdAction({
          bookingId: booking.id,
          guestSeq: seq,
          imageUrl: url,
          fileName: file.name,
          // Persist any name typed before the upload finished.
          guestName: slotsRef.current.find((s) => s.seq === seq)?.name?.trim() || null,
        });
        if (!res.ok) {
          patchSlot(seq, { state: 'error', error: errMsg(res.code) });
          return;
        }
        patchSlot(seq, { state: 'uploaded', url, progress: 100, error: undefined });
      } catch (err) {
        const code = err instanceof UploadError ? err.code : 'unknown';
        patchSlot(seq, { state: 'error', error: errMsg(code) });
      }
    },
    [booking.id, patchSlot, t, errMsg],
  );

  const handleRemove = useCallback(
    async (seq: number) => {
      setFormError(null);
      patchSlot(seq, { state: 'empty', url: undefined, previewUrl: undefined, progress: 0, error: undefined });
      const res = await removeGuestIdAction({ bookingId: booking.id, guestSeq: seq });
      if (!res.ok && res.code !== 'unknown') {
        // Re-surface only hard failures; a vanished row is fine.
        setFormError(errMsg(res.code));
      }
    },
    [booking.id, patchSlot, errMsg],
  );

  const onComplete = useCallback(() => {
    setFormError(null);
    startTransition(async () => {
      const res = await completeCheckInAction({ bookingId: booking.id, locale, admitGuestSeqs: [...admitSeqs] });
      if (res.ok) {
        setEnteredSoFar(res.entered);
        // Mark the just-admitted guests entered so they lock if more are added.
        setSlots((prev) => prev.map((s) => (admitSeqs.has(s.seq) ? { ...s, entered: true } : s)));
        setAdmitSeqs(new Set());
        setOutcome({ entered: res.entered, remaining: res.remaining, total: res.total });
        router.refresh();
      } else {
        setFormError(errMsg(res.code));
      }
    });
  }, [booking.id, locale, admitSeqs, router, errMsg]);

  // Dismiss the partial-outcome screen to admit another group right away
  // (the wizard is already on the confirm step, so just clear the outcome).
  const admitMore = useCallback(() => setOutcome(null), []);

  // ── Wizard navigation (4 stages: Data → IDs → Places → Confirm) ──
  const [step, setStep] = useState(1);
  const [placement, setPlacement] = useState<PlacementView['status']>(booking.placementStatus);
  const [showPicker, setShowPicker] = useState(false);

  const placesOk = !booking.requiresPlacement || placement === 'COMPLETE';
  const stepValid = (s: number): boolean => {
    if (s === 2) return allDone;
    if (s === 3) return placesOk;
    return true; // step 1 (review) + step 4 (confirm) gate via their own action
  };
  const goNext = () => {
    if (!stepValid(step)) return;
    setFormError(null);
    setStep((s) => Math.min(4, s + 1));
  };
  const goPrev = () => {
    setFormError(null);
    setStep((s) => Math.max(1, s - 1));
  };
  const STEPS = [t.stepData, t.stepIds, t.stepPlaces, t.stepConfirm];
  const SEP = '·';
  // Print routes open in a new tab (ar is the default locale → no prefix).
  const invoiceHref = `/${locale === 'en' ? 'en/' : ''}gate/reception/invoice/${booking.id}`;
  const passesHref = `/${locale === 'en' ? 'en/' : ''}gate/reception/passes/${booking.id}`;
  const topBar = <TopBar t={t} reference={booking.reference} invoiceHref={invoiceHref} passesHref={passesHref} />;

  // ── Admitted outcome — two-column layout matching the "Booking created"
  //    screen (Crown Booking Created Desktop design): entry-pass ticket with
  //    the daily visit QR on the left; summary, gate entry tracker and the
  //    action row on the right. ──
  if (outcome) {
    const full = outcome.remaining === 0;
    const warnC = '#b7791f';
    return (
      <Shell dir={dir} top={topBar}>
        <div style={{ maxWidth: 1040, margin: '0 auto', padding: '6px 0 40px' }}>
          {/* banner */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 32 }}>
            <div
              style={{
                width: 64, height: 64, borderRadius: 999, flexShrink: 0,
                background: `radial-gradient(circle, ${full ? 'rgba(31,157,99,0.35)' : 'rgba(194,161,78,0.35)'}, transparent 72%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {full ? (
                <div style={{ width: 46, height: 46, borderRadius: 999, background: ok, color: panel, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 700 }}>
                  ✓
                </div>
              ) : (
                <div style={{ width: 46, height: 46, borderRadius: 999, background: 'rgba(194,161,78,0.16)', border: `1px solid ${gold}`, color: gold, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: serif, fontSize: 17, fontWeight: 600 }}>
                  {outcome.entered}/{outcome.total}
                </div>
              )}
            </div>
            <div>
              <div style={{ fontFamily: sans, fontSize: 11, letterSpacing: 2.4, fontWeight: 700, color: full ? ok : warnC, marginBottom: 6 }}>
                {full ? t.outcomeEyebrowFull : t.outcomeEyebrowPartial}
              </div>
              <h1 style={{ margin: 0, fontFamily: serif, fontSize: 44, fontWeight: 600, color: cream, lineHeight: 1, letterSpacing: -0.3 }}>
                {full ? t.admitted : t.partialTitle}
              </h1>
              <p style={{ margin: '10px 0 0', fontFamily: sans, fontSize: 14, color: full ? dim : warnC }}>
                {full ? t.admittedNote : t.partialNote(outcome.entered, outcome.remaining)}
              </p>
            </div>
          </div>

          {/* two columns */}
          <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 32, alignItems: 'start' }}>
            {/* LEFT — entry-pass ticket + copy reference */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <SuccessTicket reference={booking.reference} serviceName={booking.serviceName} qrSvg={booking.qrSvg} />
              <CopyReferenceButton reference={booking.reference} label={t.copyReference} copiedLabel={t.referenceCopied} />
            </div>

            {/* RIGHT — summary + entry tracker + actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ borderRadius: 20, background: panel, border: `1px solid ${line}`, overflow: 'hidden' }}>
                <div style={{ padding: '22px 26px' }}>
                  <h2 style={{ margin: '0 0 18px', fontFamily: serif, fontSize: 22, fontWeight: 600, color: cream }}>{t.summaryTitle}</h2>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 20, columnGap: 24 }}>
                    {(
                      [
                        [t.guest, booking.guestName],
                        [t.phone, booking.guestPhone],
                        [t.service, `${booking.categoryName} · ${booking.serviceName}`],
                        [t.date, booking.dateLabel],
                        [t.party, `${booking.adults} ${t.guests}${booking.children ? ` + ${booking.children}` : ''}${booking.extraPersons ? ` + ${booking.extraPersons} extra` : ''}`],
                        [t.cars, String(booking.cars)],
                        ...(booking.paymentLabel ? ([[t.paymentMethod, booking.paymentLabel]] as [string, string][]) : []),
                      ] as [string, string][]
                    ).map(([k, v]) => (
                      <div key={k}>
                        <div style={{ fontFamily: sans, fontSize: 11, letterSpacing: 1.2, fontWeight: 600, color: faint }}>{k.toUpperCase()}</div>
                        <div style={{ fontFamily: sans, fontSize: 15.5, fontWeight: 600, color: cream, marginTop: 5 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
                {booking.totalCents != null ? (
                  <div
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 26px',
                      background: 'linear-gradient(135deg, rgba(194,161,78,0.12), rgba(194,161,78,0.04))',
                      borderTop: `1px solid ${gold}55`,
                    }}
                  >
                    <span style={{ fontFamily: sans, fontSize: 13, letterSpacing: 0.4, color: dim, fontWeight: 600 }}>{t.totalPaid}</span>
                    <span style={{ fontFamily: serif, fontSize: 30, fontWeight: 600, color: gold, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {formatMoney(booking.totalCents, { locale, currency: 'EGP' })}
                    </span>
                  </div>
                ) : null}
              </div>

              <EntryTracker
                entered={outcome.entered}
                guests={outcome.total}
                copy={{
                  title: t.trackerTitle,
                  admittedOf: t.trackerAdmittedOf,
                  msgNone: t.trackerNone,
                  msgPartial: t.trackerPartial,
                  msgAll: t.trackerAll,
                }}
              />

              {/* actions */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <a href={invoiceHref} target="_blank" rel="noreferrer" style={successGhostBtn}>
                    <PrinterGlyph /> {t.printInvoice}
                  </a>
                  <a href={passesHref} target="_blank" rel="noreferrer" style={successGhostBtn}>
                    <PrinterGlyph /> {t.printPasses}
                  </a>
                  {!full && (
                    <Link href="/gate/reception" style={successGhostBtn}>
                      {t.backToDesk}
                    </Link>
                  )}
                </div>
                {full ? (
                  <Link href="/gate/reception" style={successGoldBtn}>
                    {t.backToDesk}
                  </Link>
                ) : (
                  <button type="button" onClick={admitMore} style={successGoldBtn}>
                    <span style={{ fontSize: 19, lineHeight: 0 }}>+</span> {t.admitMore}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell dir={dir} top={topBar}>
      {/* Header */}
      <header style={{ maxWidth: 1100, margin: '0 auto', padding: '4px 4px 18px' }}>
        <p style={{ color: gold, fontSize: 11, letterSpacing: '0.32em', textTransform: 'uppercase', margin: '0 0 8px', fontWeight: 700 }}>
          {t.eyebrow}
        </p>
        <h1 style={{ fontFamily: serif, fontSize: 'clamp(24px, 3.6vw, 34px)', color: cream, margin: '0 0 4px', lineHeight: 1.1 }}>
          {t.title}
        </h1>
        <p style={{ color: dim, fontSize: 13.5, margin: 0 }}>
          {booking.guestName} {SEP} {booking.serviceName}
        </p>
      </header>

      <div style={{ maxWidth: 1100, margin: '0 auto 22px' }}>
        <StepBar steps={STEPS} active={step} />
      </div>

      {/* Active step */}
      <div style={{ maxWidth: 1100, margin: '0 auto', minHeight: 280 }}>
        {step === 1 && (
          <Panel title={t.reviewTitle}>
            <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
              <Field label={t.guest} value={booking.guestName} />
              <Field label={t.phone} value={booking.guestPhone} mono />
              <Field label={t.service} value={`${booking.categoryName} ${SEP} ${booking.serviceName}`} />
              <Field label={t.date} value={booking.dateLabel} />
              <Field label={t.party} value={`${booking.adults} ${t.guests}${booking.children ? ` + ${booking.children}` : ''}${booking.extraPersons ? ` + ${booking.extraPersons} extra` : ''}`} />
              <Field label={t.cars} value={String(booking.cars)} />
            </div>
          </Panel>
        )}

        {step === 2 && (
          <Panel title={t.title} subtitle={`${t.progress(uploadedCount, requiredIds)} ${SEP} ${t.accepted}`}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {slots.map((slot) => (
                <GuestCard key={slot.seq} slot={slot} t={t} onFile={handleFile} onRemove={handleRemove} onNameChange={onNameChange} onNameCommit={onNameCommit} />
              ))}
              {/* Children — shown in the same grid with a child icon, NO ID upload. */}
              {childSeqs.map((seq) => (
                <ChildIdCard key={`child-${seq}`} seq={seq} t={t} />
              ))}
            </div>
          </Panel>
        )}

        {step === 3 && (
          <Panel title={t.placesTitle} subtitle={booking.requiresPlacement ? t.placesSubtitle : t.placesNotRequired}>
            {booking.requiresPlacement ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 16 }}>
                <span
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 999,
                    fontSize: 13, fontWeight: 700,
                    color: placement === 'COMPLETE' ? ok : '#b7791f',
                    background: placement === 'COMPLETE' ? 'rgba(31,157,99,0.12)' : 'rgba(183,121,31,0.12)',
                    border: `1px solid ${placement === 'COMPLETE' ? `${ok}55` : 'rgba(183,121,31,0.4)'}`,
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: placement === 'COMPLETE' ? ok : '#b7791f' }} />
                  {placement === 'COMPLETE' ? t.placesDone : placement === 'PARTIAL' ? 'Partially placed' : 'Not placed'}
                </span>
                <button type="button" onClick={() => setShowPicker(true)} style={primaryBtn}>
                  {placement === 'COMPLETE' ? t.placesEdit : t.placesAssign}
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderRadius: 14,
                  background: 'rgba(31,157,99,0.10)', border: `1px solid ${ok}40`, color: ok, fontSize: 14, fontWeight: 600,
                }}
              >
                {t.placesNotRequired}
              </div>
            )}
          </Panel>
        )}

        {step === 4 && (
          <Panel title={t.confirmTitle} subtitle={t.confirmNote}>
            <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
              <Field label={t.guest} value={booking.guestName} />
              <Field label={t.service} value={`${booking.categoryName} ${SEP} ${booking.serviceName}`} />
              <Field label={t.date} value={booking.dateLabel} />
              <Field label={t.party} value={`${booking.adults} ${t.guests}${booking.children ? ` + ${booking.children}` : ''}${booking.extraPersons ? ` + ${booking.extraPersons} extra` : ''}`} />
              <Field label={t.stepIds} value={`${uploadedCount}/${requiredIds} ${t.idsDoneShort}`} good />
              <Field
                label={t.stepPlaces}
                value={!booking.requiresPlacement ? t.placesNotRequired : placement === 'COMPLETE' ? t.placesDone : '-'}
                good={!booking.requiresPlacement || placement === 'COMPLETE'}
              />
            </div>

            {/* Per-guest check-in — pick exactly who is entering now by ID photo */}
            <div style={{ marginTop: 22, paddingTop: 20, borderTop: `1px solid ${line}` }}>
              {enteredSoFar > 0 && (
                <p style={{ color: ok, fontSize: 13, margin: '0 0 12px', fontWeight: 600 }}>
                  ✓ {t.alreadyEntered(enteredSoFar, booking.people + booking.extraPersons)} · {t.remainingLabel(remainingToAdmit)}
                </p>
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 10px' }}>
                <p style={{ color: faint, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', margin: 0 }}>
                  {t.enteringNow}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: gold, fontSize: 13, fontWeight: 700 }}>{admitSeqs.size} / {remainingToAdmit}</span>
                  <button type="button" onClick={() => setAdmitSeqs(new Set([...slots.filter((s) => s.state === 'uploaded' && !s.entered).map((s) => s.seq), ...childSeqs.slice(childrenEntered)]))} style={miniBtn}>All</button>
                  <button type="button" onClick={() => setAdmitSeqs(new Set())} style={miniBtn}>None</button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 10 }}>
                {slots.filter((s) => s.state === 'uploaded').map((s) => {
                  const sel = admitSeqs.has(s.seq);
                  const name = s.name?.trim() || `${t.guest} ${s.seq}`;
                  return (
                    <button
                      key={s.seq}
                      type="button"
                      disabled={s.entered}
                      onClick={() => toggleAdmit(s.seq)}
                      aria-pressed={!s.entered && sel}
                      title={name}
                      style={{
                        position: 'relative', padding: 0, borderRadius: 12, overflow: 'hidden', cursor: s.entered ? 'default' : 'pointer',
                        border: s.entered ? `1px solid ${ok}66` : sel ? `2px solid ${gold}` : `1px solid ${line}`,
                        background: panel, opacity: s.entered ? 0.55 : 1, textAlign: 'start', transition: 'border 0.15s',
                      }}
                    >
                      <div style={{ position: 'relative', aspectRatio: '3 / 4', background: '#e3e8ec' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={s.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: sel || s.entered ? 1 : 0.82 }} />
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={`Enlarge ${name} ID`}
                          onClick={(e) => { e.stopPropagation(); setZoomDoc({ src: s.url!, caption: name }); }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); setZoomDoc({ src: s.url!, caption: name }); } }}
                          style={{
                            position: 'absolute', top: 6, insetInlineStart: 6, width: 24, height: 24, borderRadius: '50%',
                            display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.55)',
                            border: '1px solid rgba(255,255,255,0.25)', color: '#f5ead0', cursor: 'pointer',
                          }}
                        >
                          <EyeGlyph />
                        </span>
                        <div
                          style={{
                            position: 'absolute', top: 6, insetInlineEnd: 6, width: 22, height: 22, borderRadius: '50%',
                            display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800,
                            background: s.entered ? ok : sel ? gold : 'rgba(0,0,0,0.45)', color: s.entered || sel ? '#ffffff' : 'rgba(255,255,255,0.55)',
                            border: s.entered || sel ? 'none' : '1px solid rgba(255,255,255,0.3)',
                          }}
                        >
                          {s.entered || sel ? '✓' : ''}
                        </div>
                      </div>
                      <div style={{ padding: '6px 8px', fontFamily: sans, fontSize: 11.5, fontWeight: 600, color: s.entered ? dim : cream, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {s.entered ? `✓ ${name}` : name}
                      </div>
                    </button>
                  );
                })}
                {/* Children — selectable icon cards (no ID photo); admitted as
                    headcount. The first `childrenEntered` are already in. */}
                {childSeqs.map((seq, i) => {
                  const entered = i < childrenEntered;
                  const sel = !entered && admitSeqs.has(seq);
                  const name = `${t.child} ${seq}`;
                  return (
                    <button
                      key={`child-${seq}`}
                      type="button"
                      disabled={entered}
                      onClick={() => toggleAdmit(seq)}
                      aria-pressed={sel}
                      title={name}
                      style={{
                        position: 'relative', padding: 0, borderRadius: 12, overflow: 'hidden', cursor: entered ? 'default' : 'pointer',
                        border: entered ? `1px solid ${ok}66` : sel ? `2px solid ${gold}` : `1px solid ${line}`,
                        background: panel, opacity: entered ? 0.55 : 1, textAlign: 'start', transition: 'border 0.15s',
                      }}
                    >
                      <div style={{ position: 'relative', aspectRatio: '3 / 4', background: 'rgba(194,161,78,0.06)', display: 'grid', placeItems: 'center' }}>
                        <ChildGlyph />
                        <div
                          style={{
                            position: 'absolute', top: 6, insetInlineEnd: 6, width: 22, height: 22, borderRadius: '50%',
                            display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800,
                            background: entered ? ok : sel ? gold : 'rgba(0,0,0,0.45)', color: entered || sel ? '#ffffff' : 'rgba(255,255,255,0.55)',
                            border: entered || sel ? 'none' : '1px solid rgba(255,255,255,0.3)',
                          }}
                        >
                          {entered || sel ? '✓' : ''}
                        </div>
                      </div>
                      <div style={{ padding: '6px 8px', fontFamily: sans, fontSize: 11.5, fontWeight: 600, color: entered ? dim : cream, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {entered ? `✓ ${name}` : name}
                      </div>
                    </button>
                  );
                })}
              </div>
              {remainingToAdmit > 0 && admitSeqs.size === 0 ? (
                <p style={{ color: '#b7791f', fontSize: 12, margin: '10px 0 0', fontFamily: sans }}>Select who is entering now.</p>
              ) : null}
            </div>
          </Panel>
        )}
      </div>

      {/* Nav footer */}
      <div
        style={{
          position: 'sticky', bottom: 0, marginTop: 26, padding: '16px 4px',
          background: `linear-gradient(180deg, transparent, ${bg} 38%)`,
        }}
      >
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={goPrev}
            disabled={step === 1}
            style={{ ...ghostBtn, opacity: step === 1 ? 0.4 : 1, cursor: step === 1 ? 'not-allowed' : 'pointer' }}
          >
            {t.prev}
          </button>
          <div style={{ flex: 1, minWidth: 120 }}>
            {formError ? (
              <p style={{ color: bad, fontSize: 13, margin: 0 }}>{formError}</p>
            ) : step === 2 && !allDone ? (
              <p style={{ color: faint, fontSize: 13, margin: 0 }}>{t.allRequired}</p>
            ) : null}
          </div>
          {step < 4 ? (
            <button
              type="button"
              onClick={goNext}
              disabled={!stepValid(step)}
              style={{ ...primaryBtn, opacity: stepValid(step) ? 1 : 0.45, cursor: stepValid(step) ? 'pointer' : 'not-allowed', minWidth: 170 }}
            >
              {t.next}
            </button>
          ) : (
            <button
              type="button"
              onClick={onComplete}
              disabled={pending || !allDone || !placesOk || admitSeqs.size === 0}
              style={{ ...primaryBtn, opacity: pending || !allDone || !placesOk || admitSeqs.size === 0 ? 0.45 : 1, cursor: pending || !allDone || !placesOk || admitSeqs.size === 0 ? 'not-allowed' : 'pointer', minWidth: 200 }}
            >
              {pending ? t.completing : `${t.confirmAdmit} · ${admitSeqs.size}/${remainingToAdmit}`}
            </button>
          )}
        </div>
      </div>

      {showPicker ? (
        <PlacePicker
          bookingId={booking.id}
          onComplete={(status) => setPlacement(status)}
          onClose={() => setShowPicker(false)}
        />
      ) : null}

      {zoomDoc ? (
        <ImageLightbox src={zoomDoc.src} alt={zoomDoc.caption} caption={zoomDoc.caption} onClose={() => setZoomDoc(null)} />
      ) : null}
    </Shell>
  );
}

// ── Per-guest card (memoized so one upload doesn't re-render the others) ──
interface CardProps {
  slot: Slot;
  t: Copy;
  onFile: (seq: number, file: File) => void;
  onRemove: (seq: number) => void;
  onNameChange: (seq: number, name: string) => void;
  onNameCommit: (seq: number) => void;
}

const GuestCard = memo(function GuestCard({ slot, t, onFile, onRemove, onNameChange, onNameCommit }: CardProps) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const pick = (file?: File | null) => {
    if (file) onFile(slot.seq, file);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    pick(e.dataTransfer.files?.[0]);
  };

  const stateColor = slot.state === 'uploaded' ? ok : slot.state === 'error' ? bad : slot.state === 'uploading' ? gold : faint;
  const stateLabel =
    slot.state === 'uploaded' ? t.uploaded : slot.state === 'error' ? t.failed : slot.state === 'uploading' ? t.uploading : t.pending;
  const preview = slot.url ?? slot.previewUrl;

  return (
    <div
      style={{
        borderRadius: 18, background: panel, border: `1px solid ${dragOver ? gold : line}`,
        boxShadow: dragOver ? `0 0 0 3px rgba(194,161,78,0.20)` : 'none',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
        transition: 'border-color 0.2s, box-shadow 0.2s',
      }}
    >
      {/* card header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: `1px solid ${line}` }}>
        <span style={{ fontFamily: serif, fontSize: 16, color: cream }}>
          {t.guest} {slot.seq}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: stateColor }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: stateColor, boxShadow: `0 0 8px ${stateColor}` }} />
          {stateLabel}
        </span>
      </div>

      {/* body */}
      <div style={{ padding: 14, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <input
          value={slot.name ?? ''}
          onChange={(e) => onNameChange(slot.seq, e.target.value)}
          onBlur={() => onNameCommit(slot.seq)}
          placeholder={`${t.guest} ${slot.seq} — ${t.idNumber}`}
          maxLength={80}
          aria-label={`${t.guest} ${slot.seq} ${t.idNumber}`}
          style={{
            width: '100%', height: 40, borderRadius: 10, background: 'rgba(28,43,64,0.04)',
            border: `1px solid ${line}`, color: cream, padding: '0 12px', fontSize: 14,
            fontFamily: sans, outline: 'none', marginBottom: 12,
          }}
        />
        {preview ? (
          <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', aspectRatio: '4 / 3', background: '#e3e8ec' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt={`${t.guest} ${slot.seq} ID`}
              loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: slot.state === 'uploading' ? 0.55 : 1 }}
            />
            {slot.state === 'uploading' && (
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
                <div style={{ width: '72%' }}>
                  <div style={{ height: 6, borderRadius: 99, background: 'rgba(0,0,0,0.5)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${slot.progress}%`, background: gold, transition: 'width 0.2s' }} />
                  </div>
                  <p style={{ textAlign: 'center', color: '#ffffff', fontSize: 12, marginTop: 8 }}>{slot.progress}%</p>
                </div>
              </div>
            )}
            {slot.state === 'uploaded' && (
              <span style={{ position: 'absolute', top: 8, insetInlineEnd: 8, width: 26, height: 26, borderRadius: '50%', background: ok, display: 'grid', placeItems: 'center' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              </span>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => galleryRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            style={{
              flex: 1, minHeight: 150, width: '100%', cursor: 'pointer',
              borderRadius: 12, border: `1.5px dashed ${dragOver ? gold : 'rgba(28,43,64,0.22)'}`,
              background: dragOver ? 'rgba(194,161,78,0.08)' : 'rgba(28,43,64,0.02)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
              color: dim, fontFamily: sans, transition: 'all 0.2s',
            }}
          >
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={gold} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M17 8l-5-5-5 5" /><path d="M12 3v13" />
            </svg>
            <span style={{ fontSize: 13, color: cream }}>{t.dropHere}</span>
            <span style={{ fontSize: 11, color: faint }}>{t.accepted}</span>
          </button>
        )}

        {slot.error && <p style={{ color: bad, fontSize: 12, margin: '10px 0 0' }}>{slot.error}</p>}

        {/* actions */}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {slot.state === 'uploaded' || slot.state === 'error' ? (
            <>
              <button type="button" onClick={() => galleryRef.current?.click()} style={cardBtn}>
                {slot.state === 'error' ? t.retry : t.replace}
              </button>
              {slot.state === 'uploaded' && (
                <button type="button" onClick={() => onRemove(slot.seq)} style={{ ...cardBtn, color: bad, borderColor: 'rgba(192,57,43,0.4)' }}>
                  {t.remove}
                </button>
              )}
            </>
          ) : slot.state !== 'uploading' ? (
            <>
              <button type="button" onClick={() => galleryRef.current?.click()} style={cardBtn}>{t.browse}</button>
              <button type="button" onClick={() => cameraRef.current?.click()} style={cardBtn}>{t.camera}</button>
            </>
          ) : null}
        </div>
      </div>

      {/* hidden inputs: gallery + mobile camera */}
      <input
        ref={galleryRef} type="file" accept={ACCEPT} hidden
        onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }}
      />
      <input
        ref={cameraRef} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }}
      />
    </div>
  );
});

/** Child icon (no ID photo) — used for child guest cards. */
function ChildGlyph() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={gold} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="6" r="3" />
      <path d="M12 9v6" /><path d="M8 12h8" /><path d="M9 21l3-6 3 6" />
    </svg>
  );
}

/** Display-only child guest card (step 2): child icon + label, never an ID upload. */
function ChildIdCard({ seq, t }: { seq: number; t: Copy }) {
  return (
    <div style={{ borderRadius: 18, background: panel, border: `1px solid ${line}`, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: `1px solid ${line}` }}>
        <span style={{ fontFamily: serif, fontSize: 16, color: cream }}>{t.child} {seq}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: gold }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: gold }} />
          {t.child}
        </span>
      </div>
      <div style={{ padding: 14, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 180, textAlign: 'center' }}>
        <span aria-hidden style={{ width: 56, height: 56, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'rgba(194,161,78,0.12)', border: `1px solid ${gold}55` }}>
          <ChildGlyph />
        </span>
        <span style={{ fontFamily: serif, fontSize: 17, color: cream }}>{t.child} {seq}</span>
        <span style={{ fontFamily: sans, fontSize: 11.5, color: faint }}>{t.childNoId}</span>
      </div>
    </div>
  );
}

// ── Small presentational helpers ──
function Shell({ children, dir, top }: { children: React.ReactNode; dir: 'rtl' | 'ltr'; top?: React.ReactNode }) {
  return (
    <main
      dir={dir}
      style={{ position: 'relative', minHeight: '100dvh', background: bg, color: cream, fontFamily: sans, overflow: 'hidden' }}
    >
      {/* Atmosphere — twin gold auroras + a faint grain, anchored to the corners. */}
      <div
        aria-hidden
        style={{
          position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
          background:
            'radial-gradient(60% 50% at 78% -8%, rgba(194,161,78,0.08), transparent 60%),' +
            'radial-gradient(46% 40% at 0% 100%, rgba(42,157,168,0.06), transparent 60%)',
        }}
      />
      <style>{`@keyframes ci-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div style={{ position: 'relative', zIndex: 1, padding: '0 18px 40px', animation: 'ci-rise 0.5s ease both' }}>
        {top}
        <div style={{ paddingTop: top ? 18 : 28 }}>{children}</div>
      </div>
    </main>
  );
}

/** Sticky top bar: brand + booking reference + invoice/tickets print actions. */
function TopBar({
  t,
  reference,
  invoiceHref,
  passesHref,
}: {
  t: Copy;
  reference: string;
  invoiceHref: string;
  passesHref: string;
}) {
  return (
    <div
      style={{
        position: 'sticky', top: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: 16,
        padding: '16px 4px', marginBottom: 4,
        background: `linear-gradient(180deg, ${bg} 72%, transparent)`,
        borderBottom: `1px solid ${line}`, flexWrap: 'wrap',
      }}
    >
      <Link
        href="/gate/reception"
        aria-label={t.backToDesk}
        title={t.backToDesk}
        style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
      >
        <CrownLogo size="sm" />
      </Link>
      <div style={{ flex: 1 }} />
      <span
        style={{
          fontFamily: serif, fontSize: 14, color: gold, letterSpacing: '0.05em',
          padding: '6px 12px', borderRadius: 999, border: `1px solid ${gold}55`, background: 'rgba(194,161,78,0.12)',
          whiteSpace: 'nowrap',
        }}
      >
        {reference}
      </span>
      <a href={invoiceHref} target="_blank" rel="noreferrer" style={printPill}>
        <PrinterIcon /> {t.invoice}
      </a>
      <a href={passesHref} target="_blank" rel="noreferrer" style={printPill}>
        <PrinterIcon /> {t.tickets}
      </a>
    </div>
  );
}

function PrinterIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M6 14h12v7H6z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const printPill: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 7, height: 38, padding: '0 16px', borderRadius: 999,
  border: `1px solid ${gold}55`, background: 'rgba(194,161,78,0.12)', color: gold,
  fontFamily: sans, fontSize: 13, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap',
};

/** Horizontal step indicator (Data · Identity · Placement · Confirm). */
function StepBar({ steps, active }: { steps: string[]; active: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < active;
        const current = n === active;
        const c = done ? ok : current ? gold : faint;
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
            <span
              style={{
                width: 30, height: 30, flexShrink: 0, borderRadius: '50%', display: 'grid', placeItems: 'center',
                fontSize: 12.5, fontWeight: 800, color: current ? '#ffffff' : c,
                background: current ? gold : done ? 'rgba(31,157,99,0.12)' : 'transparent',
                border: `1.5px solid ${c}`,
                boxShadow: current ? '0 0 16px rgba(194,161,78,0.35)' : 'none',
                transition: 'all 0.3s ease',
              }}
            >
              {done ? '✓' : n}
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: c, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {label}
            </span>
            {n < steps.length && (
              <span style={{ flex: 1, height: 1.5, background: done ? `${ok}66` : line, borderRadius: 2, minWidth: 8 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A titled content panel used to host each step's body. */
function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        position: 'relative', borderRadius: 18, background: panel, border: `1px solid ${line}`,
        padding: '24px 24px 26px', overflow: 'hidden',
        boxShadow: '0 18px 50px -28px rgba(28,43,64,0.18)',
      }}
    >
      {/* hairline gold accent along the top edge */}
      <span aria-hidden style={{ position: 'absolute', insetInlineStart: 24, insetInlineEnd: 24, top: 0, height: 1.5, background: `linear-gradient(90deg, transparent, ${gold}66, transparent)` }} />
      <h2 style={{ fontFamily: serif, fontSize: 23, color: cream, margin: '0 0 2px' }}>{title}</h2>
      {subtitle ? <p style={{ color: dim, fontSize: 13, margin: '0 0 18px' }}>{subtitle}</p> : <div style={{ height: 16 }} />}
      {children}
    </section>
  );
}

/** Headcount stepper — choose how many guests enter on this admit. */
/** Small pill button for the "entering now" All / None quick-selectors. */
const miniBtn: CSSProperties = {
  height: 28, padding: '0 12px', borderRadius: 8, cursor: 'pointer',
  background: 'rgba(28,43,64,0.04)', border: `1px solid ${line}`, color: gold,
  fontSize: 12, fontWeight: 700, fontFamily: sans,
};

/** Label + value pair for the review / confirm steps. */
function Field({ label, value, mono, good }: { label: string; value: string; mono?: boolean; good?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <p style={{ color: faint, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', margin: '0 0 4px' }}>{label}</p>
      <p
        style={{
          color: good ? ok : cream, fontSize: 15, margin: 0,
          fontFamily: mono ? serif : sans, letterSpacing: mono ? '0.04em' : undefined,
        }}
      >
        {value}
      </p>
    </div>
  );
}

const primaryBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 50, padding: '0 26px',
  borderRadius: 12, border: 'none', fontFamily: sans, fontWeight: 700, fontSize: 15,
  color: '#1a1206', background: 'linear-gradient(135deg, #f7e4a8, #d4a557 60%, #b88a3a)',
  boxShadow: '0 6px 20px -4px rgba(212,165,87,0.45)', textDecoration: 'none',
};
const ghostBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 50, padding: '0 22px',
  borderRadius: 12, border: `1px solid ${line}`, background: 'transparent', color: cream,
  fontFamily: sans, fontWeight: 600, fontSize: 14, textDecoration: 'none',
};
const cardBtn: CSSProperties = {
  flex: 1, height: 38, borderRadius: 10, border: `1px solid rgba(28,43,64,0.18)`,
  background: 'rgba(28,43,64,0.03)', color: cream, fontFamily: sans, fontSize: 13, fontWeight: 600,
  cursor: 'pointer',
};
