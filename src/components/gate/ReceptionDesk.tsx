'use client';

import { useEffect, useMemo, useRef, useState, useTransition, type ChangeEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { formatMoney } from '@/lib/money';
import { toIsoDate, rangeDays } from '@/lib/date';
import { humanizeLine } from '@/lib/string-format';
import { quotePrice, type QuoteResult } from '@/features/booking/actions';
import {
  createReceptionBookingAction,
  checkGuestSanctionsAction,
  checkPromoAction,
  getReceptionPrefillAction,
  type GuestSanctionsResult,
} from '@/features/reception/actions';
import type { CustomerCandidate, ReceptionPrefill } from '@/server/services/customer-360';
import { CustomerPicker } from './CustomerPicker';
import { DiscountSection, type DiscountValue } from './DiscountSection';
import { ImageLightbox, EyeGlyph } from '@/components/ui/ImageLightbox';
import { completeCheckInAction, checkGuestDocumentBlockedAction } from '@/features/reception/guest-id-actions';
import { COUNTRY_OPTIONS } from '@/lib/countries';
import { isValidPhoneNumber, type CountryCode } from 'libphonenumber-js';
import { GuestUploadGrid, type GuestDoc, type GuestUploadCopy } from './GuestUploadGrid';
import { ReceptionSearch } from './ReceptionSearch';
import { useSyncStatus } from '@/components/providers/SyncStatusProvider';
import { ReceptionToday } from './ReceptionToday';
import { SuccessTicket, CopyReferenceButton, EntryTracker, PrinterGlyph, successGhostBtn } from './SuccessPass';
import { CrownLogo } from '@/components/brand/CrownLogo';
import { SanctionsModal, CapacityPreviewModal, CustomerLookupModal, StatusBar, CommandPalette, type Command } from './ReceptionTools';
import { CROWN, type AvailablePlace } from './tokens';

export interface ReceptionService {
  id: string;
  name: string;
  priceCents: number;
  kind?: 'DAY_USE' | 'CABANA' | 'EVENT' | 'OTHER';
  maxPeople: number | null;
  maxCars: number | null;
  /** Beach (DAY_USE) umbrella capacity — people one umbrella covers; overflow
   * opens another umbrella (the engine recomputes the count). */
  includedPersonsPerUnit?: number;
  /** Service requires a physical place to be assigned before entry. */
  requiresPlacement?: boolean;
  allowChildren?: boolean;
  maxChildAge?: number;
  allowMultiDay?: boolean;
  maxBookingDays?: number | null;
  /** Paid "Extra Person" add-on (beyond the included capacity). */
  allowExtraPeople?: boolean;
  extraPersonPriceCents?: number;
  /** Per-unit cap on extra persons (× the adults-driven unit count); null = no limit. */
  maxExtraPersonsPerUnit?: number | null;
}
export interface ReceptionCategory {
  id: string;
  name: string;
  isActivity: boolean;
  services: ReceptionService[];
}

interface Props {
  locale: 'ar' | 'en';
  staffName: string;
  categories: ReceptionCategory[];
}

type PaymentMethod = 'CASH' | 'INSTAPAY';
type QuoteOk = Extract<QuoteResult, { ok: true }>;

// ── CROWN tokens — single source of truth in ./tokens ──
const { cream, dim, faint, gold, bg, panel, panel2, line, serif, sans } = CROWN;

export function ReceptionDesk({ locale, staffName, categories }: Props) {
  const t = useTranslations('reception.desk');
  const router = useRouter();
  // Offline lock: on the on-prem LOCAL node, a NEW booking can't be created while
  // offline (online is the sole booking writer). Everything else — check-in,
  // lookups — keeps working. false only on a local node that is offline.
  const { bookingWritesEnabled } = useSyncStatus();
  const offlineLocked = !bookingWritesEnabled;
  const todayIso = useMemo(() => toIsoDate(new Date()), []);

  /** Copy for the shared guest-ID upload grid (localized via this copy prop). */
  const guestCopy: GuestUploadCopy = useMemo(
    () => ({
      guest: t('guestCopy.guest'),
      browse: t('guestCopy.browse'),
      camera: t('guestCopy.camera'),
      replace: t('guestCopy.replace'),
      remove: t('guestCopy.remove'),
      retry: t('guestCopy.retry'),
      uploaded: t('guestCopy.uploaded'),
      uploading: t('guestCopy.uploading'),
      pending: t('guestCopy.pending'),
      failed: t('guestCopy.failed'),
      dropHere: t('guestCopy.dropHere'),
      accepted: t('guestCopy.accepted'),
      child: t('guestCopy.child'),
      childNoId: t('guestCopy.childNoId'),
      reused: t('guestCopy.reused'),
      nameLabel: t('guestCopy.nameLabel'),
      errors: {
        unsupported_type: t('guestCopy.errors.unsupported_type'),
        too_large: t('guestCopy.errors.too_large'),
        empty_file: t('guestCopy.errors.empty_file'),
        network: t('guestCopy.errors.network'),
        upload_failed: t('guestCopy.errors.upload_failed'),
        blocked: t('guestCopy.errors.blocked'),
        unknown: t('guestCopy.errors.unknown'),
      },
    }),
    [t],
  );

  const firstBookable = useMemo(
    () => categories.find((c) => c.services.length > 0) ?? categories[0] ?? null,
    [categories],
  );
  const [categoryId, setCategoryId] = useState(firstBookable?.id ?? '');
  const category = categories.find((c) => c.id === categoryId) ?? null;
  const [serviceId, setServiceId] = useState(firstBookable?.services[0]?.id ?? '');
  const service = category?.services.find((s) => s.id === serviceId) ?? null;

  const [date, setDate] = useState(todayIso);
  const [endDate, setEndDate] = useState('');
  const [people, setPeople] = useState(1);
  const [children, setChildren] = useState(0);
  const [cars, setCars] = useState(0);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [countryCode, setCountryCode] = useState('EG');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [discount, setDiscount] = useState<DiscountValue>({ promoCode: null, manualDiscount: null });
  const [discountResetSignal, setDiscountResetSignal] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [extraPersons, setExtraPersons] = useState(0);
  // Validation gates that must clear on the IDENTITY step, BEFORE payment: any
  // blocked guest ID, or an invalid/already-used voucher, stops the flow so no
  // one ever pays first and gets rejected at commit.
  const [blockedSeqs, setBlockedSeqs] = useState<Set<number>>(new Set());
  const [voucher, setVoucher] = useState<{ status: 'idle' | 'checking' | 'valid' | 'invalid'; reason?: string }>({ status: 'idle' });

  const [quote, setQuote] = useState<QuoteOk | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, startQuote] = useTransition();
  // Unpaid sanctions on the customer account matching the guest's phone.
  // Display only — the booking transaction recomputes and settles them.
  const [guestSanctions, setGuestSanctions] = useState<
    Extract<GuestSanctionsResult, { ok: true }>['sanctions']
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, startCreate] = useTransition();
  const [result, setResult] = useState<
    {
      bookingId: string;
      reference: string;
      totalCents: number;
      entered: number;
      remaining: number;
      total: number;
      /** Set when the operator chose guests to enter now but the admit couldn't
       * be recorded (e.g. a future-dated booking). Shown so the desk never
       * silently reports "nobody admitted" after a real selection. */
      admitWarning?: string | null;
      /** Inline SVG of the daily visit-pass QR (null → reference fallback). */
      qrSvg: string | null;
    } | null
  >(null);
  // Partial check-in at the desk: WHICH guests enter right now, chosen by their
  // uploaded ID photo (empty = none, admit the rest later at the gate).
  const [admitSeqs, setAdmitSeqs] = useState<Set<number>>(new Set());
  const toggleAdmit = (seq: number) =>
    setAdmitSeqs((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  // Enlarge an ID photo in a lightbox (without toggling the guest's selection).
  const [zoomDoc, setZoomDoc] = useState<{ src: string; caption: string } | null>(null);

  // Desk mode: create a new walk-in booking, find one to check a guest in when
  // they arrive without their QR pass, or browse the whole day's bookings.
  const [mode, setMode] = useState<'new' | 'find' | 'today'>('new');

  // ── Wizard: Data → IDs → Places → Confirm (deferred commit). ──
  const [step, setStep] = useState(1);
  const [guestDocs, setGuestDocs] = useState<GuestDoc[]>([]);
  const [placeSel, setPlaceSel] = useState<string[]>([]);
  const [places, setPlaces] = useState<AvailablePlace[]>([]);
  const [placesLoading, setPlacesLoading] = useState(false);
  const [placesError, setPlacesError] = useState<string | null>(null);

  // ── Returning-guest prefill. `prefill` is the applied customer (provenance +
  // their known-guest documents); `gridSeed` is what the ID grid remounts with
  // (reused docs are seeded per-seq; the grid takes slots 1…adults from it), and
  // `gridEpoch` forces a remount whenever the seed is swapped. ──
  const [prefill, setPrefill] = useState<ReceptionPrefill | null>(null);
  const [gridSeed, setGridSeed] = useState<GuestDoc[] | undefined>(undefined);
  const [gridEpoch, setGridEpoch] = useState(0);

  const totalGuests = people + children;
  const unitsPerDay = quote?.unitsPerDay ?? 1;
  const requiresPlacement = !!service?.requiresPlacement;
  // ID images are required for ADULTS only (`people` here is the adult count;
  // `children` carry no ID). Complete once every adult has an uploaded photo AND a
  // non-blank ID number — the number is mandatory server-side (it binds the booking
  // to a real identity), so requiring it here avoids a confusing late rejection. A
  // reused prior-visit doc gets its number from the server, so it's exempt.
  const idsComplete =
    guestDocs.length >= people &&
    guestDocs.every((d) => !!d.sourceDocumentId || !!d.name?.trim());
  const placesComplete = !requiresPlacement || placeSel.length === unitsPerDay;
  const allowExtra = !!service?.allowExtraPeople;
  // Primary guest's ID number — keys the voucher's per-person "already used" check.
  const primaryId = guestDocs.find((d) => d.seq === 1)?.name?.trim() || guestDocs[0]?.name?.trim() || null;

  function pickCategory(id: string) {
    setCategoryId(id);
    const first = categories.find((c) => c.id === id)?.services[0]?.id ?? '';
    setServiceId(first);
    setQuote(null);
    setQuoteError(null);
  }

  // Live, server-authoritative quote.
  useEffect(() => {
    if (!serviceId || !date) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      startQuote(async () => {
        const res = await quotePrice({
          serviceId,
          date,
          endDate: service?.allowMultiDay && endDate ? endDate : undefined,
          adults: people,
          children,
          extraPersons: allowExtra ? extraPersons : 0,
          cars,
        });
        if (cancelled) return;
        if (res.ok) {
          setQuote(res);
          setQuoteError(null);
        } else {
          setQuote(null);
          setQuoteError(errorLabel(res.code, t));
        }
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [serviceId, date, endDate, people, children, extraPersons, allowExtra, cars, service?.allowMultiDay, t]);

  // Sanctions check — debounced on the guest phone. Surfaces the warning the
  // moment the desk types a phone that belongs to a sanctioned customer.
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      const phone = guestPhone.trim();
      let valid = false;
      try {
        valid = phone.length >= 4 && isValidPhoneNumber(phone, countryCode as CountryCode);
      } catch {
        valid = false;
      }
      if (!valid) {
        if (!cancelled) setGuestSanctions(null);
        return;
      }
      const res = await checkGuestSanctionsAction({ phone, countryCode });
      if (!cancelled) setGuestSanctions(res.ok ? res.sanctions : null);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [guestPhone, countryCode]);

  const sanctionsCents = guestSanctions?.totalCents ?? 0;

  // Validate an entered voucher BEFORE payment — keyed on the primary guest's ID
  // number (falling back to phone), matching the redemption guard. Debounced on
  // the code + ID + phone; an invalid/used code blocks leaving the identity step.
  useEffect(() => {
    const code = discount.promoCode?.trim();
    let cancelled = false;
    // All setState inside the debounce (mirrors the sanctions check) so the effect
    // body never sets state synchronously.
    const handle = setTimeout(async () => {
      if (!code) {
        if (!cancelled) setVoucher({ status: 'idle' });
        return;
      }
      if (!cancelled) setVoucher({ status: 'checking' });
      const res = await checkPromoAction({ code, guestIdNumber: primaryId, phone: guestPhone.trim() });
      if (cancelled) return;
      if (res.ok && res.valid) setVoucher({ status: 'valid' });
      else if (res.ok && !res.valid) setVoucher({ status: 'invalid', reason: res.reason });
      else setVoucher({ status: 'idle' });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [discount.promoCode, primaryId, guestPhone]);

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const headers: HeadersInit = {};
      if (window.location.hostname.includes('ngrok')) headers['ngrok-skip-browser-warning'] = 'true';
      const res = await fetch('/api/reception/upload', { method: 'POST', body: fd, headers });
      const body = (await res.json()) as { ok?: boolean; url?: string; detail?: string };
      if (!res.ok || !body.url) setUploadError(body.detail ?? t('uploadFailed'));
      else setProofUrl(body.url);
    } catch {
      setUploadError(t('uploadFailedConnection'));
    } finally {
      setUploading(false);
    }
  }

  // Step 1 (guest data) is ready WITHOUT payment — payment now comes last, after
  // the identity + voucher + blocklist checks, so a blocked guest never pays first.
  const dataReady =
    !!serviceId &&
    guestName.trim().length >= 2 &&
    guestPhone.trim().length >= 4 &&
    (isValidPhoneNumber(guestPhone, countryCode as CountryCode) || false) &&
    quote != null &&
    !creating;
  // Payment readiness — enforced on the final (Payment & confirm) step.
  const payReady = method === 'CASH' || (method === 'INSTAPAY' && proofUrl != null);

  // Changing the party / service invalidates already-collected IDs + picks.
  // Called from the input handlers (not an effect) so there are no cascading
  // renders — the GuestUploadGrid is keyed by party size and remounts cleanly.
  const resetWizardData = () => {
    setGuestDocs([]);
    setPlaceSel([]);
    setPlaces([]);
    setAdmitSeqs(new Set());
    setBlockedSeqs(new Set());
    setExtraPersons(0);
    // Drop any returning-guest ID seed and force the grid to remount fresh, so a
    // party/service/date change can never resurrect a reused card the staff
    // removed or replaced (the grid seeds `initial` only at mount). `applyPrefill`
    // re-sets the seed AFTER calling this, so a fresh prefill still seeds.
    setGridSeed(undefined);
    setGridEpoch((n) => n + 1);
  };

  // ── Returning-guest prefill machinery ──────────────────────────────────────

  /** Apply a fetched prefill: identity + last-booking suggestion + ID seeds. */
  function applyPrefill(p: ReceptionPrefill) {
    setResult(null);
    setMode('new');
    setStep(1);
    setError(null);
    resetWizardData();
    // Start from a clean draft — clear anything a prior abandoned booking left
    // behind that resetWizardData doesn't touch, so it can't bleed into this
    // customer's booking (a stale multi-day range, discount, or payment proof).
    setEndDate('');
    setDiscount({ promoCode: null, manualDiscount: null });
    setDiscountResetSignal((n) => n + 1);
    setMethod('CASH');
    setProofUrl(null);
    setVoucher({ status: 'idle' });

    // Identity → step 1. The stored phone is E.164 (self-contained), so it
    // validates against any dial-code; still set the matching country.
    setGuestName(p.identity.name ?? '');
    setGuestPhone(p.identity.phone ?? '');
    if (COUNTRY_OPTIONS.some((c) => c.code === p.identity.countryCode)) {
      setCountryCode(p.identity.countryCode);
    }

    // Last-booking suggestion — only when that service is still in the desk
    // catalog (an archived service would leave the selects dangling).
    const lb = p.lastBooking;
    const lbCategory = lb ? categories.find((c) => c.id === lb.categoryId) : null;
    const lbService = lb ? lbCategory?.services.find((s) => s.id === lb.serviceId) : null;
    if (lb && lbCategory && lbService) {
      setCategoryId(lbCategory.id);
      setServiceId(lbService.id);
      setQuote(null);
      setQuoteError(null);
      setPeople(Math.min(Math.max(1, lb.adults), lbService.maxPeople ?? 999));
      setChildren(lbService.allowChildren ? Math.max(0, lb.children) : 0);
      setCars(Math.min(Math.max(0, lb.cars), lbService.maxCars ?? 999));
      if (lbService.allowExtraPeople) setExtraPersons(Math.max(0, lb.extraPersons));
    }

    // Seed the ID grid with the customer's known guests (photo + ID number,
    // newest first). The grid takes slots 1…adults; extra seeds stay dormant
    // until the party grows, and any slot can still be replaced or removed.
    setGridSeed(
      p.knownGuests.map((g, i) => ({
        seq: i + 1,
        url: g.imageUrl,
        fileName: g.fileName,
        name: g.idNumber,
        sourceDocumentId: g.sourceDocumentId,
      })),
    );
    setGridEpoch((n) => n + 1);
    setPrefill(p);
  }

  /** Fetch + apply the prefill for a picked candidate (used by both entries). */
  async function startBookingForCustomer(ref: { userId: string | null; phone: string | null }) {
    const res = await getReceptionPrefillAction({ userId: ref.userId, phone: ref.phone });
    if (!res.ok) return false;
    applyPrefill(res.prefill);
    return true;
  }

  /** Lookup-modal entry: fire-and-report (the modal has already closed). */
  const startFromLookup = (ref: { userId: string | null; phone: string | null }) => {
    void (async () => {
      const ok = await startBookingForCustomer(ref);
      if (!ok) setError(errorLabel('unknown', t));
    })();
  };

  /**
   * Drop the applied customer. Reused prior-visit documents go with them (the
   * photos belong to that customer); fresh uploads made in this session are
   * kept when `keepFresh` (the identity merely changed, the new photos are
   * this party's).
   */
  function clearPrefill(opts?: { keepFresh?: boolean; keepIdentity?: boolean }) {
    const fresh = opts?.keepFresh ? guestDocs.filter((d) => !d.sourceDocumentId) : [];
    setGridSeed(fresh.length ? fresh : undefined);
    setGridEpoch((n) => n + 1);
    setPrefill(null);
    setGuestDocs(fresh);
    setAdmitSeqs(new Set());
    setBlockedSeqs((prev) => new Set([...prev].filter((seq) => fresh.some((d) => d.seq === seq))));
    if (!opts?.keepIdentity) {
      setGuestName('');
      setGuestPhone('');
      setGuestSanctions(null);
    }
  }

  /**
   * Editing the phone after a prefill changes WHO is being booked — the reused
   * documents no longer belong to the typed identity (the server would refuse
   * them), so drop the prefill while keeping fresh uploads and the typed data.
   */
  function onGuestPhoneChange(v: string) {
    setGuestPhone(v);
    if (prefill && v.trim() !== (prefill.identity.phone ?? '')) {
      clearPrefill({ keepFresh: true, keepIdentity: true });
    }
  }

  // Reused documents skip the upload flow, so their ID numbers are re-checked
  // against the blocklist here (fresh uploads use the grid's onNameCommit).
  // Cached per number — re-seeding/remounting never refires a settled check.
  const checkedNumbersRef = useRef(new Map<string, boolean>());
  // Idempotency key for the CURRENT booking attempt: generated on first submit,
  // REUSED on a retry (so a lost-response retry returns the already-committed
  // booking instead of duplicating it + double-charging), cleared once it commits.
  const clientRequestIdRef = useRef<string | null>(null);
  useEffect(() => {
    // Prune stale blocks for slots that no longer hold a document (a blocked
    // card that was removed/replaced-away must not deadlock step 2 — fresh
    // uploads re-arm their own block via the grid's onNameCommit).
    const presentSeqs = new Set(guestDocs.map((d) => d.seq));
    queueMicrotask(() => {
      setBlockedSeqs((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const s of prev) {
          if (!presentSeqs.has(s)) {
            next.delete(s);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });

    const reused = guestDocs.filter((d) => d.sourceDocumentId && d.name?.trim());
    if (reused.length === 0) return;
    let cancelled = false;
    void (async () => {
      const updates: { seq: number; blocked: boolean }[] = [];
      for (const d of reused) {
        const number = d.name!.trim();
        const key = number.toUpperCase();
        let blocked = checkedNumbersRef.current.get(key);
        if (blocked === undefined) {
          const res = await checkGuestDocumentBlockedAction({ number });
          if (!res.ok) continue; // transient — the server re-enforces at commit
          blocked = res.blocked;
          checkedNumbersRef.current.set(key, blocked);
        }
        updates.push({ seq: d.seq, blocked });
      }
      if (cancelled || updates.length === 0) return;
      setBlockedSeqs((prev) => {
        const next = new Set(prev);
        for (const u of updates) {
          if (u.blocked) next.add(u.seq);
          else next.delete(u.seq);
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [guestDocs]);

  // Load the live place map (called when advancing into the placement step).
  const loadPlaces = () => {
    if (!serviceId) return;
    setPlacesLoading(true);
    setPlacesError(null);
    const dates = endDate && service?.allowMultiDay ? rangeDays(date, endDate) : [date];
    const headers: HeadersInit = {};
    if (typeof window !== 'undefined' && window.location.hostname.includes('ngrok')) {
      headers['ngrok-skip-browser-warning'] = 'true';
    }
    fetch(`/api/gate/places-available?serviceId=${encodeURIComponent(serviceId)}&dates=${dates.join(',')}`, { headers })
      .then((r) => r.json())
      .then((data: { available?: AvailablePlace[] }) => {
        if (data.available) setPlaces(data.available);
        else setPlacesError(t('placement.loadError'));
      })
      .catch(() => setPlacesError(t('placement.loadError')))
      .finally(() => setPlacesLoading(false));
  };

  const stepValid = (s: number): boolean => {
    if (s === 1) return dataReady;
    // Identity gate: every adult ID uploaded, NONE blocked, and any entered
    // voucher valid — all checked BEFORE the guest reaches the payment step.
    if (s === 2) return idsComplete && blockedSeqs.size === 0 && voucher.status !== 'invalid';
    if (s === 3) return placesComplete;
    return true;
  };
  const goNext = () => {
    if (!stepValid(step)) return;
    setError(null);
    const target = Math.min(4, step + 1);
    if (target === 3 && requiresPlacement) loadPlaces();
    setStep(target);
  };
  const goPrev = () => {
    setError(null);
    setStep((s) => Math.max(1, s - 1));
  };
  const togglePlace = (id: string) => {
    setPlaceSel((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= unitsPerDay) return cur;
      return [...cur, id];
    });
  };

  function finalize() {
    if (!dataReady || !idsComplete || !placesComplete || !payReady) return;
    // Belt-and-suspenders: the server (assertBookingWritesEnabled) is the
    // authoritative lock; this just avoids a doomed round-trip while offline.
    if (offlineLocked) return;
    setError(null);
    // Generate the attempt key once; a retry after a failure reuses it.
    if (!clientRequestIdRef.current) {
      const rand =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2);
      clientRequestIdRef.current = `rcpt-${rand}`;
    }
    startCreate(async () => {
      const res = await createReceptionBookingAction({
        clientRequestId: clientRequestIdRef.current!,
        serviceId,
        date,
        endDate: service?.allowMultiDay && endDate ? endDate : undefined,
        adults: people,
        people,
        children,
        extraPersons: allowExtra ? extraPersons : 0,
        cars,
        guestName: guestName.trim(),
        guestPhone: guestPhone.trim(),
        countryCode: countryCode,
        paymentMethod: method,
        proofUrl: method === 'INSTAPAY' ? proofUrl : null,
        promoCode: discount.promoCode,
        manualDiscount: discount.manualDiscount,
        locale,
        guestIds: guestDocs.map((d) => ({
          guestSeq: d.seq,
          imageUrl: d.url,
          fileName: d.fileName,
          guestName: d.name ?? null,
          // Prior-visit reuse: the server clones ITS copy of this document and
          // verifies it belongs to this booking's guest phone.
          sourceDocumentId: d.sourceDocumentId ?? null,
        })),
        placements: requiresPlacement ? placeSel.map((placeId, i) => ({ unitIndex: i, placeId })) : undefined,
      });
      if (!res.ok) {
        setError(errorLabel(res.code, t));
        return;
      }
      // Booking committed — the next booking starts a fresh idempotency key.
      clientRequestIdRef.current = null;
      // Optionally admit the guests entering now (partial check-in). The booking
      // already has its IDs + places, so the gate's check-in gate passes.
      let entered = 0;
      let remaining = totalGuests;
      let admitWarning: string | null = null;
      if (admitSeqs.size > 0) {
        const adm = await completeCheckInAction({ bookingId: res.bookingId, locale, admitGuestSeqs: [...admitSeqs] });
        if (adm.ok) {
          entered = adm.entered;
          remaining = adm.remaining;
        } else {
          // The booking IS committed — only the immediate admission failed (most
          // often the booking is dated for a FUTURE day, so guests can't enter
          // today). Surface the reason on the success screen instead of silently
          // showing "nobody admitted" as if the selection was ignored.
          admitWarning = admitErrorLabel(adm.code, t);
        }
      }
      setResult({
        bookingId: res.bookingId,
        reference: res.reference,
        totalCents: res.totalCents,
        entered,
        remaining,
        total: totalGuests,
        admitWarning,
        qrSvg: res.qrSvg,
      });
    });
  }

  function reset() {
    setResult(null);
    setStep(1);
    setGuestDocs([]);
    setPlaceSel([]);
    setAdmitSeqs(new Set());
    setPrefill(null);
    setGridSeed(undefined);
    setGridEpoch((n) => n + 1);
    setGuestName('');
    setGuestPhone('');
    setDiscount({ promoCode: null, manualDiscount: null });
    setDiscountResetSignal((n) => n + 1);
    setEndDate('');
    setPeople(1);
    setChildren(0);
    setExtraPersons(0);
    setCars(0);
    setMethod('CASH');
    setProofUrl(null);
    setBlockedSeqs(new Set());
    setVoucher({ status: 'idle' });
    setError(null);
  }

  // Payment card — rendered on the FINAL step so no one pays before their IDs +
  // voucher are cleared. Same controls as before, just relocated after validation.
  const paymentCard = (
    <div style={cardStyle}>
      <Label>{t('labels.paymentMethod')}</Label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {(
          [
            { id: 'CASH' as const, label: t('payment.cash'), icon: <CashIcon /> },
            { id: 'INSTAPAY' as const, label: 'InstaPay', icon: <InstaIcon /> },
          ]
        ).map((m) => {
          const on = method === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setMethod(m.id)}
              style={{
                height: 56, borderRadius: 13, cursor: 'pointer',
                background: on ? gold : panel2, border: `1px solid ${on ? gold : line}`,
                color: on ? panel : cream, fontFamily: sans, fontSize: 14.5, fontWeight: 700,
                letterSpacing: '0.3px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 10, transition: 'all 0.18s',
              }}
            >
              <span style={{ color: on ? panel : gold, display: 'inline-flex' }}>{m.icon}</span>
              {m.label}
            </button>
          );
        })}
      </div>
      {method === 'INSTAPAY' && (
        <div style={{ marginTop: 16 }}>
          <Label>{t('labels.instapayProof')}</Label>
          {proofUrl ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={proofUrl} alt={t('proofAlt')} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 12, border: `1px solid ${line}` }} />
              <button type="button" onClick={() => setProofUrl(null)} style={btnGhost}>{t('replace')}</button>
            </div>
          ) : (
            <label
              style={{ ...fieldBox, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: dim, borderStyle: 'dashed' }}
            >
              {uploading ? t('uploading') : t('uploadImage')}
              <input type="file" accept="image/*" onChange={onUpload} style={{ display: 'none' }} disabled={uploading} />
            </label>
          )}
          {uploadError ? <p style={{ color: '#c0392b', fontSize: 12, marginTop: 6, fontFamily: sans }}>{uploadError}</p> : null}
          <p style={{ color: gold, fontSize: 11, marginTop: 6, fontFamily: sans, fontWeight: 500 }}>{t('instapayProofRequired')}</p>
        </div>
      )}
    </div>
  );

  const invoiceHref = result
    ? `/${locale === 'en' ? 'en/' : ''}gate/reception/invoice/${result.bookingId}`
    : '#';

  const fmtDate = useMemo(() => {
    try {
      return new Date(date).toLocaleDateString('en-GB', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return date;
    }
  }, [date]);

  // ── Success — two-column "Booking created" layout (Claude Design handoff:
  //    Crown Booking Created Desktop). Left: boarding-pass entry ticket with
  //    the real daily visit QR + copy-reference. Right: booking summary with
  //    gold total, the gate entry-status tracker, and the action row. ──
  if (result) {
    const fmtEnd = service?.allowMultiDay && endDate
      ? (() => {
          try {
            return new Date(endDate).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
          } catch {
            return endDate;
          }
        })()
      : null;
    return (
      <Shell
        staffName={staffName}
        onGate={() => router.push('/gate/scan')}
        categories={categories}
        locale={locale}
        onSetMode={(m) => { setResult(null); setMode(m); }}
        onStartBookingForCustomer={startFromLookup}
      >
        <div style={{ maxWidth: 1040, margin: '0 auto', padding: '6px 0 40px' }}>
          {/* success banner */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 32 }}>
            <div
              style={{
                width: 64, height: 64, borderRadius: 999, flexShrink: 0,
                background: 'radial-gradient(circle, rgba(31,157,99,0.35), transparent 72%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <div style={{ width: 46, height: 46, borderRadius: 999, background: '#1f9d63', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 700 }}>
                ✓
              </div>
            </div>
            <div>
              <div style={{ fontFamily: sans, fontSize: 11, letterSpacing: 2.4, fontWeight: 700, color: '#1f9d63', marginBottom: 6 }}>
                {t('success.paymentReceived', { method: method === 'CASH' ? t('success.methodCashUpper') : t('success.methodInstapayUpper') })}
              </div>
              <h1 style={{ margin: 0, fontFamily: serif, fontSize: 44, fontWeight: 600, color: cream, lineHeight: 1, letterSpacing: -0.3 }}>
                {t('success.title')}
              </h1>
              <p style={{ margin: '10px 0 0', fontFamily: sans, fontSize: 14, color: dim }}>
                {requiresPlacement ? t('success.subtitleWithPlaces') : t('success.subtitle')}
              </p>
            </div>
          </div>

          {/* two columns */}
          <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 32, alignItems: 'start' }}>
            {/* LEFT — entry-pass ticket + copy reference */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <SuccessTicket reference={result.reference} serviceName={service?.name ?? t('success.bookingFallback')} qrSvg={result.qrSvg} />
              <CopyReferenceButton reference={result.reference} />
            </div>

            {/* RIGHT — summary + entry tracker + actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ borderRadius: 20, background: panel, border: `1px solid ${line}`, overflow: 'hidden' }}>
                <div style={{ padding: '22px 26px' }}>
                  <h2 style={{ margin: '0 0 18px', fontFamily: serif, fontSize: 22, fontWeight: 600, color: cream }}>{t('success.summaryTitle')}</h2>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 20, columnGap: 24 }}>
                    {(
                      [
                        [t('summary.category'), category?.name ?? '—'],
                        [t('summary.service'), service?.name ?? '—'],
                        [t('summary.dateOfVisit'), fmtEnd ? `${fmtDate} → ${fmtEnd}` : fmtDate],
                        [t('summary.paymentMethod'), method === 'CASH' ? t('payment.cash') : t('payment.instapay')],
                        [t('summary.guests'), t('summary.guestsValue', { count: result.total })],
                        [t('summary.vehicles'), t('summary.vehiclesValue', { count: cars })],
                      ] as [string, string][]
                    ).map(([k, v]) => (
                      <div key={k}>
                        <div style={{ fontFamily: sans, fontSize: 11, letterSpacing: 1.2, fontWeight: 600, color: faint }}>{k.toUpperCase()}</div>
                        <div style={{ fontFamily: sans, fontSize: 15.5, fontWeight: 600, color: cream, marginTop: 5 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 26px',
                    background: 'linear-gradient(135deg, rgba(194,161,78,0.12), rgba(194,161,78,0.04))',
                    borderTop: `1px solid ${gold}55`,
                  }}
                >
                  <span style={{ fontFamily: sans, fontSize: 13, letterSpacing: 0.4, color: dim, fontWeight: 600 }}>{t('success.totalPaid')}</span>
                  <span style={{ fontFamily: serif, fontSize: 30, fontWeight: 600, color: gold, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {formatMoney(result.totalCents, { locale, currency: 'EGP' })}
                  </span>
                </div>
              </div>

              <EntryTracker entered={result.entered} guests={result.total} />

              {result.admitWarning ? (
                <div
                  role="alert"
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 16px', borderRadius: 12,
                    background: 'rgba(183,121,31,0.10)', border: '1px solid rgba(183,121,31,0.35)',
                  }}
                >
                  <span aria-hidden style={{ color: '#b7791f', fontSize: 16, lineHeight: 1.2 }}>⚠</span>
                  <span style={{ fontFamily: sans, fontSize: 13, color: cream, lineHeight: 1.5 }}>{result.admitWarning}</span>
                </div>
              ) : null}

              {/* actions */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <a href={invoiceHref} target="_blank" rel="noreferrer" style={successGhostBtn}>
                    <PrinterGlyph />
                    {t('success.printInvoice')}
                  </a>
                  <a
                    href={`/${locale === 'en' ? 'en/' : ''}gate/reception/passes/${result.bookingId}`}
                    target="_blank"
                    rel="noreferrer"
                    style={successGhostBtn}
                  >
                    <PrinterGlyph />
                    {t('success.printPasses')}
                  </a>
                </div>
                <button
                  type="button"
                  onClick={reset}
                  style={{
                    width: '100%', height: 58, borderRadius: 15, border: 'none', cursor: 'pointer',
                    background: 'linear-gradient(180deg, #c2a14e, #9c7d34)', color: '#ffffff',
                    fontFamily: sans, fontSize: 15, fontWeight: 700, letterSpacing: 0.4,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                    boxShadow: '0 12px 30px rgba(194,161,78,0.30)',
                  }}
                >
                  <span style={{ fontSize: 19, lineHeight: 0 }}>+</span> {t('success.newBooking')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  // ── Form ──
  const noServices = !!category && category.services.length === 0;

  return (
    <Shell
      staffName={staffName}
      onGate={() => router.push('/gate/scan')}
      categories={categories}
      locale={locale}
      onSetMode={(m) => { setResult(null); setMode(m); }}
      onStartBookingForCustomer={startFromLookup}
    >
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <ModeTabs mode={mode} onChange={setMode} />
        {mode === 'find' ? (
          <ReceptionSearch locale={locale} />
        ) : mode === 'today' ? (
          <ReceptionToday locale={locale} />
        ) : (
        <>
        {/* header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: sans, fontSize: 11, letterSpacing: '2.6px', fontWeight: 700, color: gold, marginBottom: 8 }}>
            {t('header.eyebrow')}
          </div>
          <h1 style={{ margin: 0, fontFamily: serif, fontSize: 40, fontWeight: 600, color: cream, lineHeight: 1, letterSpacing: '-0.4px' }}>
            {t('header.title')}
          </h1>
        </div>

        <div style={{ marginBottom: 24 }}>
          <StepBar steps={[t('steps.guestData'), t('steps.identity'), t('steps.placement'), t('steps.confirm')]} active={step} />
        </div>

        {/* STEP 1 — guest data (kept mounted to preserve form state) */}
        <div style={{ display: step === 1 ? 'grid' : 'none', gridTemplateColumns: '1fr 360px', gap: 28, alignItems: 'start' }}>
          {/* LEFT form */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* returning guest — pick an existing customer to prefill everything */}
            <div style={cardStyle}>
              <CustomerPicker
                locale={locale}
                selected={
                  prefill
                    ? {
                        name: prefill.identity.name,
                        phone: prefill.identity.phone,
                        sanctionCents: prefill.sanctionCents,
                      }
                    : null
                }
                onPick={(c: CustomerCandidate) => startBookingForCustomer({ userId: c.userId, phone: c.phone })}
                onClear={() => clearPrefill()}
              />
            </div>

            {/* service */}
            <div style={cardStyle}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div>
                  <Label>{t('labels.category')}</Label>
                  <Select value={categoryId} onChange={(v) => { pickCategory(v); resetWizardData(); }} options={categories.map((c) => ({ value: c.id, label: c.name }))} />
                </div>
                <div>
                  <Label>{t('labels.service')}</Label>
                  {noServices ? (
                    <div style={{ ...fieldBox, color: faint, fontSize: 13.5 }}>{t('noServicesYet')}</div>
                  ) : (
                    <Select
                      value={serviceId}
                      onChange={(v) => { setServiceId(v); setQuote(null); setQuoteError(null); resetWizardData(); }}
                      options={(category?.services ?? []).map((s) => ({
                        value: s.id,
                        label: `${s.name} — ${formatMoney(s.priceCents, { locale, currency: 'EGP' })}`,
                      }))}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* date / counts */}
            <div style={cardStyle}>
              <div style={{ marginBottom: 22 }}>
                <Label>{service?.allowMultiDay ? t('labels.startDate') : t('labels.dateOfVisit')}</Label>
                <input
                  type="date"
                  value={date}
                  min={todayIso}
                  onChange={(e) => {
                    setDate(e.target.value);
                    if (endDate && endDate < e.target.value) setEndDate('');
                    resetWizardData();
                  }}
                  style={{ ...fieldBox, colorScheme: 'light', cursor: 'pointer' }}
                />
                {service?.allowMultiDay ? (
                  <div style={{ marginTop: 14 }}>
                    <Label>{t('labels.endDateOptional')}</Label>
                    <input
                      type="date"
                      value={endDate}
                      min={date}
                      onChange={(e) => { setEndDate(e.target.value); resetWizardData(); }}
                      style={{ ...fieldBox, colorScheme: 'light', cursor: 'pointer' }}
                    />
                  </div>
                ) : null}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div>
                  <Label>{service?.kind === 'DAY_USE' ? t('labels.adults') : t('labels.people')}</Label>
                  {/* Beach overflows into more umbrellas, so no per-ticket adult
                      cap — only the per-booking total cap (server re-validates). */}
                  <Stepper
                    value={people}
                    min={1}
                    max={service?.maxPeople ?? 999}
                    onChange={(v) => { setPeople(v); resetWizardData(); }}
                  />
                </div>
                {service?.allowChildren ? (
                  <div>
                    <Label>{t('labels.children')}</Label>
                    {/* Children are NOT bounded by maxPeople (that's the ADULTS cap);
                        the engine enforces any real per-booking children cap. */}
                    <Stepper value={children} min={0} max={999} onChange={(v) => { setChildren(v); resetWizardData(); }} />
                    <div style={{ fontSize: 11, color: faint, marginTop: 6, fontFamily: sans }}>
                      {t('ageNote', { age: service.maxChildAge ?? 8 })}
                    </div>
                  </div>
                ) : null}
                {allowExtra ? (
                  <div>
                    <Label>{t('labels.extraPersons')}</Label>
                    {/* Extra persons are billed separately (add-on); they never open
                        a unit/umbrella. Each still needs an ID + counts at the gate. */}
                    <Stepper
                      value={extraPersons}
                      min={0}
                      max={service?.maxExtraPersonsPerUnit != null ? service.maxExtraPersonsPerUnit * unitsPerDay : 999}
                      onChange={setExtraPersons}
                    />
                    <div style={{ fontSize: 11, color: faint, marginTop: 6, fontFamily: sans }}>
                      {t('extraPersonNote', { price: formatMoney(service?.extraPersonPriceCents ?? 0, { locale, currency: 'EGP' }) })}
                    </div>
                  </div>
                ) : null}
                <div>
                  <Label>{t('labels.cars')}</Label>
                  <Stepper value={cars} min={0} max={service?.maxCars ?? 999} onChange={setCars} />
                </div>
              </div>
            </div>

            {/* customer */}
            <div style={cardStyle}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div>
                  <Label>{t('labels.customerName')}</Label>
                  <TextInput value={guestName} onChange={setGuestName} placeholder={t('placeholders.fullName')} />
                </div>
                <div>
                  <Label>{t('labels.customerPhone')}</Label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ position: 'relative' }}>
                      <select
                        value={countryCode}
                        onChange={(e) => setCountryCode(e.target.value)}
                        style={{
                          width: 104,
                          height: 52,
                          borderRadius: 13,
                          cursor: 'pointer',
                          background: panel2,
                          border: `1px solid ${line}`,
                          color: cream,
                          fontFamily: sans,
                          fontSize: 14,
                          padding: '0 24px 0 10px',
                          appearance: 'none',
                          WebkitAppearance: 'none',
                          outline: 'none',
                        }}
                      >
                        {COUNTRY_OPTIONS.map((c) => (
                          <option key={c.code} value={c.code} style={{ background: panel }}>
                            {c.flag} +{c.callingCode}
                          </option>
                        ))}
                      </select>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                        <path d="M6 9l6 6 6-6" stroke={gold} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div style={{ flex: 1 }}>
                      <TextInput value={guestPhone} onChange={onGuestPhoneChange} placeholder={t('placeholders.phone')} inputMode="tel" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Discount / voucher — entered HERE so the code is validated on the
                identity step, BEFORE the guest reaches payment. */}
            <div style={cardStyle}>
              <DiscountSection
                totalCents={quote?.totalCents ?? 0}
                locale={locale}
                resetSignal={discountResetSignal}
                onChange={setDiscount}
              />
              {voucher.status === 'valid' ? (
                <p style={{ color: '#1f9d63', fontSize: 12.5, marginTop: 8, fontFamily: sans }}>{t('voucher.valid')}</p>
              ) : voucher.status === 'checking' ? (
                <p style={{ color: dim, fontSize: 12.5, marginTop: 8, fontFamily: sans }}>{t('voucher.checking')}</p>
              ) : voucher.status === 'invalid' ? (
                <p style={{ color: '#c0392b', fontSize: 12.5, marginTop: 8, fontFamily: sans }}>
                  {voucher.reason === 'promo_already_used' ? t('voucher.alreadyUsed') : t('voucher.invalid')}
                </p>
              ) : null}
            </div>
          </div>

          {/* RIGHT sticky summary */}
          <div style={{ position: 'sticky', top: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ borderRadius: 20, overflow: 'hidden', background: panel, border: `1px solid ${gold}55` }}>
              <div style={{ padding: '20px 24px', borderBottom: `1px solid ${line}`, background: 'linear-gradient(180deg, rgba(194,161,78,0.10), transparent)' }}>
                <div style={{ fontFamily: sans, fontSize: 10.5, letterSpacing: '2px', fontWeight: 600, color: faint, marginBottom: 6 }}>{t('orderSummary')}</div>
                <div style={{ fontFamily: serif, fontSize: 24, fontWeight: 600, color: cream, lineHeight: 1 }}>{category?.name ?? '—'}</div>
                <div style={{ fontFamily: sans, fontSize: 12.5, color: dim, marginTop: 6 }}>{fmtDate}</div>
              </div>
              <div style={{ padding: '8px 24px 18px' }}>
                {quote ? (
                  quote.lines.map((l, i) => (
                    <SumLine
                      key={i}
                      label={`${humanizeLine(l.labelKey)}${l.quantity > 1 ? ` × ${l.quantity}` : ''}`}
                      value={formatMoney(l.totalCents, { locale, currency: 'EGP' })}
                    />
                  ))
                ) : (
                  <SumLine label={service ? service.name : t('serviceFallback')} value={quoting ? '…' : '—'} faint />
                )}
                {discount.manualDiscount && quote ? (
                  <SumLine
                    label={t('customDiscount', { percent: discount.manualDiscount.percent })}
                    value={`− ${formatMoney(Math.round((quote.totalCents * discount.manualDiscount.percent) / 100), { locale, currency: 'EGP' })}`}
                  />
                ) : null}
                {guestSanctions ? (
                  <SumLine
                    label={t('unpaidSanctionsCount', { count: guestSanctions.items.length })}
                    value={`+ ${formatMoney(guestSanctions.totalCents, { locale, currency: 'EGP' })}`}
                  />
                ) : null}
                {/* Insurance deposit — the SERVER's amount (never recomputed here);
                    un-discountable, added after the discount clamp (docs/INSURANCE.md). */}
                {quote && quote.insuranceCents > 0 ? (
                  <SumLine
                    label={t('summary.insuranceDeposit')}
                    value={`+ ${formatMoney(quote.insuranceCents, { locale, currency: 'EGP' })}`}
                  />
                ) : null}
                <SumLine label={t('summary.payment')} value={method === 'CASH' ? t('payment.cash') : t('payment.instapay')} last />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingTop: 16, borderTop: `1px solid ${gold}55` }}>
                  <span style={{ fontFamily: sans, fontSize: 13, fontWeight: 600, letterSpacing: '0.4px', color: dim }}>{t('total')}</span>
                  <span style={{ fontFamily: serif, fontSize: 34, fontWeight: 600, color: gold, lineHeight: 1, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {quote
                      ? formatMoney(
                          // final collectable = max(0, service − discount) + penalties + deposit
                          Math.max(0, quote.totalCents - (discount.manualDiscount ? Math.round((quote.totalCents * discount.manualDiscount.percent) / 100) : 0)) + sanctionsCents + quote.insuranceCents,
                          { locale, currency: 'EGP' },
                        )
                      : quoting ? '…' : '—'}
                  </span>
                </div>
              </div>
            </div>

            {guestSanctions ? (
              <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(192,57,43,0.08)', border: '1px solid rgba(192,57,43,0.3)', fontFamily: sans, lineHeight: 1.45 }}>
                <strong style={{ display: 'block', marginBottom: 4, color: '#c0392b', fontSize: 13 }}>
                  {t('sanctions.heading')}
                </strong>
                <p style={{ color: '#c0392b', fontSize: 12.5, margin: 0 }}>
                  {guestSanctions.userName ? `${guestSanctions.userName} — ` : ''}{t.rich('sanctions.body', {
                    amount: formatMoney(guestSanctions.totalCents, { locale, currency: 'EGP' }),
                    b: (chunks) => <strong>{chunks}</strong>,
                  })}
                </p>
                <ul style={{ margin: '6px 0 0', paddingInlineStart: 16, color: 'rgba(192,57,43,0.85)', fontSize: 12 }}>
                  {guestSanctions.items.map((s, i) => (
                    <li key={i}>
                      {formatMoney(s.amountCents, { locale, currency: 'EGP' })} — {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {quoteError ? (
              <div style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(192,57,43,0.08)', border: '1px solid rgba(192,57,43,0.3)', color: '#c0392b', fontSize: 13, textAlign: 'center', fontFamily: sans, lineHeight: 1.4 }}>
                <strong style={{ display: 'block', marginBottom: 4 }}>{t('unavailable')}</strong>
                {quoteError}
              </div>
            ) : !dataReady ? (
              <div style={{ fontFamily: sans, fontSize: 12, color: faint, textAlign: 'center', lineHeight: 1.5 }}>
                {noServices
                  ? t('hints.noServices')
                  : t('hints.addCustomer')}
              </div>
            ) : null}
            {error && step === 1 ? (
              <p role="alert" style={{ color: '#c0392b', fontSize: 13, textAlign: 'center', fontFamily: sans }}>{error}</p>
            ) : null}
          </div>
        </div>

        {/* STEP 2 — guest identity */}
        {step === 2 && (
          <WizPanel
            title={t('identity.title')}
            subtitle={`${t('identity.subtitle', { people, done: guestDocs.length })}${children ? ` ${t('identity.childrenNote', { children })}` : ''}`}
          >
            <GuestUploadGrid
              key={`${serviceId}-${people}-${children}-${gridEpoch}`}
              count={people}
              childrenCount={children}
              t={guestCopy}
              initial={gridSeed}
              onChange={setGuestDocs}
              onNameCommit={async (seq, name) => {
                if (!name) {
                  setBlockedSeqs((prev) => { const n = new Set(prev); n.delete(seq); return n; });
                  return { blocked: false };
                }
                const res = await checkGuestDocumentBlockedAction({ number: name });
                const blocked = res.ok ? res.blocked : false;
                setBlockedSeqs((prev) => {
                  const n = new Set(prev);
                  if (blocked) n.add(seq);
                  else n.delete(seq);
                  return n;
                });
                return { blocked };
              }}
            />
            {blockedSeqs.size > 0 ? (
              <p role="alert" style={{ color: '#c0392b', fontSize: 13, marginTop: 14, fontFamily: sans, fontWeight: 600 }}>
                {t('identity.blockedWarning')}
              </p>
            ) : null}
          </WizPanel>
        )}

        {/* STEP 3 — 2D capacity placement */}
        {step === 3 && (
          <WizPanel
            title={t('placement.title')}
            subtitle={requiresPlacement ? t('placement.subtitle', { units: unitsPerDay, selected: placeSel.length }) : t('placement.notNeeded')}
          >
            {!requiresPlacement ? (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderRadius: 14, background: 'rgba(31,157,99,0.10)', border: '1px solid rgba(31,157,99,0.4)', color: '#1f9d63', fontSize: 14, fontWeight: 600 }}>
                {t('placement.notRequiredContinue')}
              </div>
            ) : placesLoading ? (
              <div style={{ color: dim, fontSize: 14 }}>{t('placement.loading')}</div>
            ) : placesError ? (
              <div style={{ color: '#c0392b', fontSize: 14 }}>{placesError}</div>

            ) : (
              <PlaceBoard places={places} selected={placeSel} needed={unitsPerDay} onToggle={togglePlace} />
            )}
          </WizPanel>
        )}

        {/* STEP 4 — confirm */}
        {step === 4 && (
          <WizPanel title={t('confirm.title')} subtitle={t('confirm.subtitle')}>
            {/* Payment — collected LAST, only after IDs + voucher + blocklist passed. */}
            <div style={{ marginBottom: 20 }}>{paymentCard}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px 28px' }}>
              <ConfirmField label={t('confirm.customer')} value={guestName || '—'} />
              <ConfirmField label={t('confirm.phone')} value={guestPhone || '—'} />
              <ConfirmField label={t('confirm.service')} value={`${category?.name ?? ''} · ${service?.name ?? ''}`} />
              <ConfirmField label={t('confirm.date')} value={fmtDate} />
              <ConfirmField label={t('confirm.party')} value={`${t('confirm.partyValue', { people })}${children ? ` ${t('confirm.partyChildren', { children })}` : ''}`} />
              <ConfirmField label={t('confirm.payment')} value={method === 'CASH' ? t('payment.cash') : t('payment.instapay')} />
              <ConfirmField label={t('confirm.adultIds')} value={t('confirm.adultIdsValue', { done: guestDocs.length, people })} good />
              <ConfirmField label={t('confirm.places')} value={requiresPlacement ? t('confirm.placesValue', { selected: placeSel.length, units: unitsPerDay }) : t('confirm.notRequired')} good />
              {guestSanctions ? (
                <ConfirmField
                  label={t('confirm.sanctions')}
                  value={t('confirm.sanctionsValue', { amount: formatMoney(guestSanctions.totalCents, { locale, currency: 'EGP' }) })}
                />
              ) : null}
              {quote && quote.insuranceCents > 0 ? (
                <ConfirmField
                  label={t('confirm.insuranceDeposit')}
                  value={`+ ${formatMoney(quote.insuranceCents, { locale, currency: 'EGP' })}`}
                />
              ) : null}
              <ConfirmField label={t('confirm.total')} value={quote ? formatMoney(quote.totalCents + sanctionsCents + quote.insuranceCents, { locale, currency: 'EGP' }) : '—'} gold />
            </div>

            {/* Entering now — pick exactly who walks in now by their ID photo;
                the rest can scan their QR at the gate later. */}
            <div style={{ marginTop: 22, paddingTop: 20, borderTop: `1px solid ${line}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 4px' }}>
                <p style={{ color: faint, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', margin: 0, fontFamily: sans }}>
                  {t('entering.title')}
                </p>
                {guestDocs.length > 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: gold, fontSize: 13, fontWeight: 700, fontFamily: sans }}>{admitSeqs.size} / {totalGuests}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setAdmitSeqs(
                          new Set([
                            ...guestDocs.map((d) => d.seq),
                            ...Array.from({ length: children }, (_, i) => people + i + 1),
                          ]),
                        )
                      }
                      style={miniBtn}
                    >
                      {t('entering.all')}
                    </button>
                    <button type="button" onClick={() => setAdmitSeqs(new Set())} style={miniBtn}>{t('entering.none')}</button>
                  </div>
                ) : null}
              </div>
              <p style={{ color: dim, fontSize: 12.5, margin: '0 0 12px', fontFamily: sans }}>
                {t('entering.help')}
              </p>
              {guestDocs.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 10 }}>
                  {[...guestDocs].sort((a, b) => a.seq - b.seq).map((d) => {
                    const sel = admitSeqs.has(d.seq);
                    const name = d.name?.trim() || t('entering.guestN', { seq: d.seq });
                    return (
                      <button
                        key={d.seq}
                        type="button"
                        onClick={() => toggleAdmit(d.seq)}
                        aria-pressed={sel}
                        title={name}
                        style={{
                          position: 'relative', padding: 0, borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
                          border: sel ? `2px solid ${gold}` : `1px solid ${line}`, background: panel, textAlign: 'start',
                          transition: 'border 0.15s',
                        }}
                      >
                        <div style={{ position: 'relative', aspectRatio: '3 / 4', background: '#e3e8ec' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={d.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: sel ? 1 : 0.82 }} />
                          <span
                            role="button"
                            tabIndex={0}
                            aria-label={t('entering.enlargeId', { name })}
                            onClick={(e) => { e.stopPropagation(); setZoomDoc({ src: d.url, caption: name }); }}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); setZoomDoc({ src: d.url, caption: name }); } }}
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
                              background: sel ? gold : 'rgba(0,0,0,0.45)', color: sel ? '#ffffff' : 'rgba(255,255,255,0.55)',
                              border: sel ? 'none' : '1px solid rgba(255,255,255,0.3)',
                            }}
                          >
                            {sel ? '✓' : ''}
                          </div>
                        </div>
                        <div style={{ padding: '6px 8px', fontFamily: sans, fontSize: 11.5, fontWeight: 600, color: cream, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {name}
                        </div>
                      </button>
                    );
                  })}
                  {/* Children — selectable icon cards (no ID photo). Admitted as
                      headcount alongside the adults. */}
                  {Array.from({ length: children }, (_, i) => {
                    const seq = people + i + 1;
                    const sel = admitSeqs.has(seq);
                    return (
                      <button
                        key={`child-${seq}`}
                        type="button"
                        onClick={() => toggleAdmit(seq)}
                        aria-pressed={sel}
                        title={t('entering.childN', { seq })}
                        style={{
                          position: 'relative', padding: 0, borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
                          border: sel ? `2px solid ${gold}` : `1px solid ${line}`, background: panel, textAlign: 'start',
                          transition: 'border 0.15s',
                        }}
                      >
                        <div style={{ position: 'relative', aspectRatio: '3 / 4', background: 'rgba(194,161,78,0.06)', display: 'grid', placeItems: 'center' }}>
                          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={gold} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <circle cx="12" cy="6" r="3" /><path d="M12 9v6" /><path d="M8 12h8" /><path d="M9 21l3-6 3 6" />
                          </svg>
                          <div style={{ position: 'absolute', top: 6, insetInlineEnd: 6, width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800, background: sel ? gold : 'rgba(0,0,0,0.45)', color: sel ? '#ffffff' : 'rgba(255,255,255,0.55)', border: sel ? 'none' : '1px solid rgba(255,255,255,0.3)' }}>
                            {sel ? '✓' : ''}
                          </div>
                        </div>
                        <div style={{ padding: '6px 8px', fontFamily: sans, fontSize: 11.5, fontWeight: 600, color: cream, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {t('entering.childN', { seq })}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p style={{ color: faint, fontSize: 12, margin: 0, fontFamily: sans }}>{t('entering.uploadFirst')}</p>
              )}
            </div>
          </WizPanel>
        )}

        {/* Wizard nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 24, flexWrap: 'wrap' }}>
          <button type="button" onClick={goPrev} disabled={step === 1} style={{ ...btnGhost, opacity: step === 1 ? 0.4 : 1, cursor: step === 1 ? 'not-allowed' : 'pointer' }}>
            {t('nav.back')}
          </button>
          <div style={{ flex: 1, minWidth: 120 }}>
            {offlineLocked ? (
              <p role="alert" style={{ color: '#c0392b', fontSize: 12.5, margin: 0, fontFamily: sans }}>
                {locale === 'ar'
                  ? 'غير متصل — لا يمكن إنشاء حجز جديد. باقي المهام تعمل.'
                  : 'Offline — new bookings unavailable. Everything else still works.'}
              </p>
            ) : error && step === 4 ? (
              <p role="alert" style={{ color: '#c0392b', fontSize: 13, margin: 0, fontFamily: sans }}>{error}</p>
            ) : step === 2 && !idsComplete ? (
              <p style={{ color: faint, fontSize: 12.5, margin: 0, fontFamily: sans }}>{t('nav.idsRequired')}</p>
            ) : step === 3 && !placesComplete ? (
              <p style={{ color: faint, fontSize: 12.5, margin: 0, fontFamily: sans }}>{t('nav.selectPlaces')}</p>
            ) : null}
          </div>
          {step < 4 ? (
            <button
              type="button"
              onClick={goNext}
              disabled={!stepValid(step)}
              style={{ ...btnGold(stepValid(step)), width: 'auto', minWidth: 200, height: 50 }}
            >
              {t('nav.next')}
            </button>
          ) : (
            <button
              type="button"
              onClick={finalize}
              disabled={creating || !dataReady || !idsComplete || !placesComplete || !payReady || offlineLocked}
              style={{ ...btnGold(!creating && dataReady && idsComplete && placesComplete && payReady && !offlineLocked), width: 'auto', minWidth: 220, height: 50 }}
            >
              {creating
                ? t('nav.creating')
                : admitSeqs.size > 0
                  ? t('nav.createAndAdmit', { count: admitSeqs.size, total: totalGuests })
                  : t('nav.confirmCreate')}
            </button>
          )}
        </div>
        </>
        )}
      </div>

      {zoomDoc ? (
        <ImageLightbox src={zoomDoc.src} alt={zoomDoc.caption} caption={zoomDoc.caption} onClose={() => setZoomDoc(null)} />
      ) : null}
    </Shell>
  );
}

// ── Wizard helpers (CROWN-styled, shared look with the gate scan) ──

/** Segmented switch between creating a walk-in booking and finding an existing one. */
function ModeTabs({ mode, onChange }: { mode: 'new' | 'find' | 'today'; onChange: (m: 'new' | 'find' | 'today') => void }) {
  const t = useTranslations('reception.desk');
  const tabs: { id: 'new' | 'find' | 'today'; label: string }[] = [
    { id: 'new', label: t('tabs.new') },
    { id: 'find', label: t('tabs.find') },
    { id: 'today', label: t('tabs.today') },
  ];
  return (
    <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 14, background: panel2, border: `1px solid ${line}`, marginBottom: 24 }}>
      {tabs.map((t) => {
        const on = mode === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            aria-pressed={on}
            style={{
              height: 40, padding: '0 22px', borderRadius: 10, cursor: 'pointer', border: 'none',
              background: on ? gold : 'transparent', color: on ? panel : dim,
              fontFamily: sans, fontSize: 14, fontWeight: 700, letterSpacing: '0.2px', transition: 'all 0.15s',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function StepBar({ steps, active }: { steps: string[]; active: number }) {
  const ok = '#1f9d63';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < active;
        const current = n === active;
        const c = done ? ok : current ? gold : faint;
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <span style={{ width: 28, height: 28, flexShrink: 0, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800, color: current ? '#ffffff' : c, background: current ? gold : 'transparent', border: `1.5px solid ${c}` }}>
              {done ? '✓' : n}
            </span>
            <span style={{ fontFamily: sans, fontSize: 12.5, fontWeight: 600, color: c, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
            {n < steps.length && <span style={{ flex: 1, height: 1.5, background: done ? `${ok}66` : line, borderRadius: 2, minWidth: 8 }} />}
          </div>
        );
      })}
    </div>
  );
}

/** Small pill button for the "entering now" All / None quick-selectors. */
const miniBtn: React.CSSProperties = {
  height: 28, padding: '0 12px', borderRadius: 8, cursor: 'pointer',
  background: panel2, border: `1px solid ${line}`, color: gold,
  fontSize: 12, fontWeight: 700, fontFamily: sans,
};

function WizPanel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ ...cardStyle, padding: '24px 26px 28px' }}>
      <h2 style={{ fontFamily: serif, fontSize: 24, fontWeight: 600, color: cream, margin: '0 0 4px' }}>{title}</h2>
      {subtitle ? <p style={{ color: dim, fontSize: 13, margin: '0 0 20px', fontFamily: sans }}>{subtitle}</p> : <div style={{ height: 16 }} />}
      {children}
    </div>
  );
}

function ConfirmField({ label, value, good, gold: isGold }: { label: string; value: string; good?: boolean; gold?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <p style={{ color: faint, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', margin: '0 0 4px', fontFamily: sans }}>{label}</p>
      <p style={{ color: isGold ? gold : good ? '#1f9d63' : cream, fontSize: 15, margin: 0, fontFamily: isGold ? serif : sans, fontWeight: isGold ? 600 : 500 }}>{value}</p>
    </div>
  );
}

/** Cinema-style place board (selection only — used pre-commit at reception). */
function PlaceBoard({ places, selected, needed, onToggle }: { places: AvailablePlace[]; selected: string[]; needed: number; onToggle: (id: string) => void }) {
  const t = useTranslations('reception.desk');
  const PCELL = 52;
  const cols = Math.max(1, ...places.map((p) => p.gridX + 1));
  const rows = Math.max(1, ...places.map((p) => p.gridY + 1));
  // The reason banner shown when staff tap an out-of-service (amber) place.
  const [outageInfo, setOutageInfo] = useState<string | null>(null);
  // Tick the clock so out-of-service tiles free up LIVE when their window ends.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(h);
  }, []);
  const isOutNow = (p: AvailablePlace) => !!p.outOfService && (!p.outageUntil || Date.parse(p.outageUntil) > now);
  const outageMsg = (p: AvailablePlace) => {
    const parts = [t('placeBoard.outOfService', { label: p.label })];
    if (p.outageReason) parts.push(`— ${p.outageReason}`);
    if (p.outageUntil) {
      parts.push(t('placeBoard.backAt', { when: new Date(p.outageUntil).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }));
    }
    return parts.join(' ');
  };
  const hasOutages = places.some(isOutNow);
  if (places.length === 0) {
    return <div style={{ color: '#b7791f', fontSize: 14 }}>{t('placeBoard.noPlaces')}</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {outageInfo ? (
        <div role="status" className="mb-3 flex w-full max-w-md items-start gap-2 rounded-xl border border-amber-500/35 bg-amber-400/15 px-3 py-2 text-[12.5px] text-amber-800">
          <span className="mt-1 size-2 shrink-0 rounded-full bg-amber-500" />
          <span className="flex-1">{outageInfo}</span>
          <button type="button" aria-label={t('placeBoard.dismiss')} onClick={() => setOutageInfo(null)} className="shrink-0 text-amber-700/70 hover:text-amber-800">✕</button>
        </div>
      ) : hasOutages ? (
        <p className="mb-3 w-full max-w-md text-center text-[11px] text-amber-700/80">{t('placeBoard.tapAmber')}</p>
      ) : null}
      <div className="w-full max-w-md h-1.5 bg-gradient-to-r from-transparent via-gold-400/50 to-transparent rounded-full mb-8 shadow-[0_8px_20px_-4px_rgba(212,165,87,0.3)]" />
      <div className="w-full overflow-auto">
        <div className="relative mx-auto" style={{ width: cols * PCELL, height: rows * PCELL, minWidth: 'min-content' }}>
          {places.map((p) => {
            const isSel = selected.includes(p.id);
            const isOut = isOutNow(p);
            const isTaken = !p.isAvailable && !p.outOfService;
            // Accessibility (handicap) cell — blue + ♿ so the desk steers a guest
            // who needs it to the right place.
            const isHandi = !!p.isHandicap;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  if (isOut) { setOutageInfo(outageMsg(p)); return; }
                  if (!isTaken) onToggle(p.id);
                }}
                disabled={isTaken}
                aria-pressed={isSel}
                title={isOut ? outageMsg(p) : isTaken ? t('placeBoard.alreadyBooked') : isHandi ? t('placeBoard.accessibleTitle', { label: p.label }) : p.label}
                style={{ position: 'absolute', left: p.gridX * PCELL, top: p.gridY * PCELL }}
                className={`flex size-11 items-center justify-center rounded-lg text-[10px] font-bold transition-all duration-200 ${
                  isOut
                    ? 'cursor-pointer border border-amber-500/45 bg-amber-400/20 text-amber-700 hover:bg-amber-400/30'
                    : isTaken
                      ? 'cursor-not-allowed border border-red-500/25 bg-red-500/10 text-red-600/50'
                      : isSel
                        ? 'scale-105 cursor-pointer bg-gold-500 text-white shadow-[0_4px_12px_rgba(194,161,78,0.4)]'
                        : isHandi
                          ? 'cursor-pointer border border-sky-500/50 bg-sky-400/15 text-sky-700 hover:bg-sky-400/25'
                          : 'cursor-pointer border border-navy-900/15 bg-navy-900/[0.04] text-muted-foreground hover:border-gold-400/40 hover:text-gold-700'
                }`}
              >
                {isHandi ? (
                  <span className="pointer-events-none absolute right-0.5 top-0.5 text-[10px] leading-none" aria-hidden>♿</span>
                ) : null}
                {p.label.length > 3 ? p.label.slice(0, 3) : p.label}
              </button>
            );
          })}
        </div>
      </div>
      <p style={{ marginTop: 18, color: dim, fontSize: 12.5, fontFamily: sans }}>{t('placeBoard.selectedCount', { selected: selected.length, needed })}</p>
      {places.some((p) => p.isHandicap) ? (
        <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-sky-700/90">
          <span className="inline-block size-2.5 rounded-sm border border-sky-500/50 bg-sky-400/15" aria-hidden />
          {t('placeBoard.accessibleLegend')}
        </p>
      ) : null}
    </div>
  );
}

// ── Shell: top bar + scroll body ──
function Shell({
  staffName,
  onGate,
  categories,
  locale,
  onSetMode,
  onStartBookingForCustomer,
  children,
}: {
  staffName: string;
  onGate: () => void;
  categories: ReceptionCategory[];
  locale: 'ar' | 'en';
  /** Switch the desk's primary mode (also dismisses a success screen). */
  onSetMode: (mode: 'new' | 'find' | 'today') => void;
  /** Start a prefilled new booking for a customer picked in the lookup modal. */
  onStartBookingForCustomer?: (ref: { userId: string | null; phone: string | null }) => void;
  children: React.ReactNode;
}) {
  const t = useTranslations('reception.desk');
  // Read-only quick-views reachable from any desk state (booking, success, find).
  const [tool, setTool] = useState<null | 'customer' | 'sanctions' | 'capacity'>(null);
  const [palette, setPalette] = useState(false);
  // Which service the Capacity modal should open on (null = its default first
  // service). Set when a status-bar chip is clicked so it lands on that service.
  const [capacityService, setCapacityService] = useState<string | null>(null);
  const openCapacity = (serviceId: string | null) => {
    setCapacityService(serviceId);
    setTool('capacity');
  };

  // Global ⌘K / Ctrl+K toggles the command palette from anywhere on the desk.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const commands: Command[] = [
    { id: 'new', label: t('palette.newBooking'), run: () => onSetMode('new') },
    { id: 'find', label: t('palette.findBooking'), run: () => onSetMode('find') },
    { id: 'today', label: t('palette.todayBookings'), run: () => onSetMode('today') },
    { id: 'customer', label: t('palette.customer'), run: () => setTool('customer') },
    { id: 'sanctions', label: t('palette.sanctions'), run: () => setTool('sanctions') },
    { id: 'capacity', label: t('palette.capacity'), run: () => openCapacity(null) },
    { id: 'gate', label: t('palette.gate'), run: onGate },
  ];

  return (
    <div dir="ltr" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: bg, color: cream, position: 'relative', fontFamily: sans }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse 55% 45% at 60% 0%, rgba(194,161,78,0.06), transparent 60%)' }} />

      {/* top bar */}
      <div style={{ height: 64, flexShrink: 0, borderBottom: `1px solid ${line}`, display: 'flex', alignItems: 'center', padding: '0 28px', gap: 14, position: 'relative', zIndex: 2 }}>
        <CrownLogo size="sm" />
        <button
          type="button"
          onClick={() => setPalette(true)}
          aria-label={t('palette.open')}
          title={t('palette.open')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, height: 34, padding: '0 12px', borderRadius: 999,
            cursor: 'pointer', background: panel2, border: `1px solid ${line}`, color: faint,
            fontFamily: sans, fontSize: 12, fontWeight: 600,
          }}
        >
          <SearchGlyph />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, fontWeight: 700, color: dim, border: `1px solid ${line}`, borderRadius: 6, padding: '1px 6px' }}>⌘K</span>
        </button>
        <div style={{ flex: 1 }} />
        <ToolButton onClick={() => setTool('customer')} label={t('shell.customer')} icon={<UserGlyph />} />
        <ToolButton onClick={() => setTool('sanctions')} label={t('shell.sanctions')} icon={<GavelGlyph />} />
        <ToolButton onClick={() => openCapacity(null)} label={t('shell.capacity')} icon={<GridGlyph />} />
        <div style={{ width: 1, height: 30, background: line }} />
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: sans, fontSize: 13, fontWeight: 600, color: cream }}>{staffName}</div>
          <div style={{ fontFamily: sans, fontSize: 11, color: faint, marginTop: 2 }}>{t('shell.receptionDesk')}</div>
        </div>
        <div style={{ width: 1, height: 30, background: line }} />
        <button
          type="button"
          onClick={onGate}
          aria-label={t('shell.switchToGate')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            height: 40,
            padding: '0 18px',
            borderRadius: 999,
            cursor: 'pointer',
            background: 'rgba(194,161,78,0.12)',
            border: `1px solid ${gold}55`,
            color: gold,
            fontFamily: sans,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.3px',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M3 12h12M11 8l4 4-4 4M21 4v16" stroke={gold} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t('shell.gate')}
        </button>
      </div>

      <StatusBar locale={locale} onOpenCapacity={openCapacity} />

      <div className="rc-scroll" style={{ flex: 1, overflowY: 'auto', padding: '32px 36px 40px', position: 'relative', zIndex: 1 }}>
        {children}
      </div>

      {tool === 'customer' ? (
        <CustomerLookupModal
          locale={locale}
          onClose={() => setTool(null)}
          onStartBooking={
            onStartBookingForCustomer
              ? (ref) => {
                  setTool(null);
                  onStartBookingForCustomer(ref);
                }
              : undefined
          }
        />
      ) : null}
      {tool === 'sanctions' ? <SanctionsModal locale={locale} onClose={() => setTool(null)} /> : null}
      {tool === 'capacity' ? <CapacityPreviewModal locale={locale} categories={categories} initialServiceId={capacityService} onClose={() => setTool(null)} /> : null}
      {palette ? <CommandPalette commands={commands} onClose={() => setPalette(false)} /> : null}
    </div>
  );
}

/** Compact ghost button in the top bar that opens a quick-view modal. */
function ToolButton({ onClick, label, icon }: { onClick: () => void; label: string; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        height: 38,
        padding: '0 14px',
        borderRadius: 999,
        cursor: 'pointer',
        background: panel2,
        border: `1px solid ${line}`,
        color: cream,
        fontFamily: sans,
        fontSize: 12.5,
        fontWeight: 600,
        letterSpacing: '0.2px',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: gold, display: 'inline-flex' }}>{icon}</span>
      {label}
    </button>
  );
}

function UserGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function GavelGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M14 4l6 6-3 3-6-6 3-3zM10.5 7.5L4 14l3 3 6.5-6.5M14 17h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GridGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.7" />
      <path d="M20 20l-3.2-3.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontFamily: sans, fontSize: 11, letterSpacing: '1.6px', fontWeight: 600, color: faint, marginBottom: 10 }}>{children}</div>;
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div style={{ position: 'relative' }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          height: 52,
          borderRadius: 13,
          cursor: 'pointer',
          background: panel2,
          border: `1px solid ${line}`,
          color: cream,
          fontFamily: sans,
          fontSize: 15,
          fontWeight: 500,
          padding: '0 44px 0 16px',
          appearance: 'none',
          WebkitAppearance: 'none',
          outline: 'none',
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ background: panel }}>{o.label}</option>
        ))}
      </select>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
        <path d="M6 9l6 6 6-6" stroke={gold} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function TextInput({ value, onChange, placeholder, prefix, inputMode }: { value: string; onChange: (v: string) => void; placeholder?: string; prefix?: string; inputMode?: 'tel' | 'text' }) {
  const [focus, setFocus] = useState(false);
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: 52, borderRadius: 13, overflow: 'hidden', background: panel2, border: `1px solid ${focus ? gold : line}`, transition: 'border-color 0.18s' }}>
      {prefix ? (
        <div style={{ padding: '0 14px', height: '100%', display: 'flex', alignItems: 'center', gap: 7, borderRight: `1px solid ${line}`, fontFamily: sans, fontSize: 14, color: cream, fontWeight: 600, whiteSpace: 'nowrap' }}>{prefix}</div>
      ) : null}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{ flex: 1, height: '100%', border: 'none', outline: 'none', background: 'none', padding: '0 16px', color: cream, fontFamily: sans, fontSize: 15, letterSpacing: '0.2px' }}
      />
    </div>
  );
}

function Stepper({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min: number; max: number }) {
  const btn = (label: string, fn: () => void, disabled: boolean) => (
    <button
      type="button"
      onClick={fn}
      disabled={disabled}
      style={{
        width: 46,
        height: 46,
        borderRadius: 12,
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: panel2,
        border: `1px solid ${line}`,
        color: disabled ? faint : gold,
        fontSize: 20,
        fontWeight: 500,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {label}
    </button>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {btn('−', () => onChange(Math.max(min, value - 1)), value <= min)}
      <span style={{ fontFamily: serif, fontSize: 26, fontWeight: 600, color: cream, minWidth: 28, textAlign: 'center' }}>{value}</span>
      {btn('+', () => onChange(Math.min(max, value + 1)), value >= max)}
    </div>
  );
}

function SumLine({ label, value, faint: isFaint, last }: { label: string; value: string; faint?: boolean; last?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: last ? 'none' : `1px solid ${line}` }}>
      <span style={{ fontFamily: sans, fontSize: 13.5, color: isFaint ? faint : dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      <span style={{ fontFamily: sans, fontSize: 14, fontWeight: 600, color: isFaint ? faint : cream, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', flexShrink: 0 }}>{value}</span>
    </div>
  );
}

function CashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.7" /><circle cx="12" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.7" /></svg>
  );
}
function InstaIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" /><path d="M4 9.5h16M8 14.5h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
  );
}

function errorLabel(code: string, t: ReturnType<typeof useTranslations<'reception.desk'>>): string {
  switch (code) {
    case 'forbidden': return t('errors.forbidden');
    case 'invalid_input': return t('errors.invalid_input');
    case 'service_inactive': return t('errors.service_inactive');
    case 'bookings_disabled': return t('errors.bookings_disabled');
    case 'past_date': return t('errors.past_date');
    case 'working_hours_ended': return t('errors.working_hours_ended');
    case 'promo_not_found': return t('errors.promo_not_found');
    case 'promo_inactive': return t('errors.promo_inactive');
    case 'promo_not_started': return t('errors.promo_not_started');
    case 'promo_expired': return t('errors.promo_expired');
    case 'promo_cap_reached': return t('errors.promo_cap_reached');
    case 'promo_already_used': return t('errors.promo_already_used');
    case 'promo_invalid': return t('errors.promo_invalid');
    case 'one_discount_only': return t('errors.one_discount_only');
    case 'over_role_cap': return t('errors.over_role_cap');
    case 'pin_not_found': return t('errors.pin_not_found');
    case 'not_authorized': return t('errors.not_authorized');
    case 'invalid_pin': return t('errors.invalid_pin');
    case 'blocked': return t('errors.blocked');
    case 'guest_id_required': return t('errors.guest_id_required');
    case 'guest_id_number_required': return t('errors.guest_id_number_required');
    case 'guest_id_source_invalid': return t('errors.guest_id_source_invalid');
    case 'guest_id_source_forbidden': return t('errors.guest_id_source_forbidden');
    case 'offline': return t('errors.offline');
    case 'sync_not_deployed': return t('errors.sync_not_deployed');
    case 'sync_auth': return t('errors.sync_auth');
    case 'sync_misconfig': return t('errors.sync_misconfig');
    default:
      if (code.startsWith('capacity')) return t('errors.capacity');
      return t('errors.unknown');
  }
}

/**
 * Friendly reason shown when the booking was created but the immediate
 * "admit now" couldn't be recorded (the codes come from `checkInBooking`). The
 * common case is a future-dated booking — guests can only enter on the visit
 * date. Never silently hide this: the operator explicitly chose who enters.
 */
function admitErrorLabel(code: string, t: ReturnType<typeof useTranslations<'reception.desk'>>): string {
  switch (code) {
    case 'not_admissible':
      return t('admitErrors.not_admissible');
    case 'placement_required':
      return t('admitErrors.placement_required');
    case 'guest_id_required':
      return t('admitErrors.guest_id_required');
    case 'blocked':
      return t('admitErrors.blocked');
    case 'no_guest_selected':
      return t('admitErrors.no_guest_selected');
    case 'forbidden':
      return t('admitErrors.forbidden');
    case 'not_found':
      // Booking committed on online but not yet mirrored to this local device.
      return t('admitErrors.not_found');
    default:
      return t('admitErrors.unknown');
  }
}

const cardStyle: React.CSSProperties = {
  borderRadius: 20,
  background: panel,
  border: `1px solid ${line}`,
  padding: '24px 26px',
};
const fieldBox: React.CSSProperties = {
  width: '100%',
  height: 52,
  borderRadius: 13,
  background: panel2,
  border: `1px solid ${line}`,
  color: cream,
  fontFamily: sans,
  fontSize: 15,
  padding: '0 16px',
  boxSizing: 'border-box',
  outline: 'none',
};
function btnGold(active: boolean): React.CSSProperties {
  return {
    width: '100%',
    height: 56,
    borderRadius: 15,
    border: 'none',
    cursor: active ? 'pointer' : 'not-allowed',
    background: active ? 'linear-gradient(180deg, #c2a14e, #9c7d34)' : panel2,
    color: active ? '#ffffff' : faint,
    fontFamily: sans,
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: '0.4px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    textDecoration: 'none',
    boxShadow: active ? '0 12px 30px rgba(194,161,78,0.30)' : 'none',
  };
}
const btnGhost: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 44,
  padding: '0 18px',
  borderRadius: 12,
  background: 'transparent',
  color: cream,
  border: `1px solid ${line}`,
  fontFamily: sans,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};
