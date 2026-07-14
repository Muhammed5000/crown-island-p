'use client';

import { useState, useTransition, type ChangeEvent } from 'react';
import { useTranslations } from 'next-intl';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/date';
import {
  decideInsuranceAction,
  executeDeskInsuranceRefundAction,
} from '@/features/reception/insurance-actions';
import type {
  InsuranceCheckoutView,
  InsuranceAttemptView,
} from '@/server/services/insurance-reads';
import { CROWN } from './tokens';

/**
 * Reception deposit-checkout window (`/gate/reception/checkout/[bookingId]`).
 *
 * Shows the booking + frozen deposit snapshot + the full refund-attempt
 * history, forces the REFUND / NO_REFUND decision while the deposit is
 * COLLECTED + UNDECIDED, and executes desk payouts (cash confirm / InstaPay
 * with mandatory proof). Card-collected deposits go to the admin queue — the
 * desk only sees the read-only status. All money is integer piastres via
 * `formatMoney`; every mutation returns the fresh server view, so the window
 * always renders online's truth (the actions proxy on the local node).
 */

const { cream, dim, faint, gold, bg, panel, panel2, line, serif, sans, ok, warn, bad } = CROWN;
const blue = '#2b6cb0';

const ACTIVE_STATUSES = ['AWAITING_ADMIN', 'PENDING_DESK', 'PROCESSING'] as const;

type Errors = ReturnType<typeof useTranslations<'reception.checkout'>>;

const KNOWN_ERROR_CODES = new Set([
    'forbidden',
    'invalid_input',
    'offline',
    'sync_not_deployed',
    'sync_auth',
    'sync_misconfig',
    'online_owned',
    'not_found',
    'insurance_not_found',
    'insurance_not_collected',
    'insurance_already_decided',
    'insurance_reason_required',
    'insurance_nothing_refundable',
    'insurance_proof_required',
    'insurance_refund_method_mismatch',
    'insurance_already_processed',
    'insurance_over_refund',
]);

function errorLabel(code: string, t: Errors): string {
  return KNOWN_ERROR_CODES.has(code) ? t(`errors.${code}`) : t('errors.unknown');
}

export function InsuranceCheckout({
  locale,
  initialView,
}: {
  locale: 'ar' | 'en';
  initialView: InsuranceCheckoutView;
}) {
  const t = useTranslations('reception.checkout');
  const [view, setView] = useState(initialView);
  const [error, setError] = useState<string | null>(null);
  const [pending, startAction] = useTransition();

  // Decision UI: which inline confirm is open.
  const [decisionMode, setDecisionMode] = useState<null | 'refund' | 'no-refund'>(null);
  const [reason, setReason] = useState('');

  // Desk payout UI.
  const [method, setMethod] = useState<'CASH' | 'INSTAPAY'>('CASH');
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [cashConfirm, setCashConfirm] = useState(false);

  const ins = view.insurance;
  const money = (cents: number) => formatMoney(cents, { locale, currency: 'EGP' });
  const ar = locale === 'ar';
  const serviceName = ar ? view.booking.serviceNameAr : view.booking.serviceNameEn;
  const categoryName = ar ? view.booking.categoryNameAr : view.booking.categoryNameEn;

  const pendingDesk = view.attempts.find((a) => a.status === 'PENDING_DESK');
  const activeAttempt = view.attempts.find((a) =>
    (ACTIVE_STATUSES as readonly string[]).includes(a.status),
  );
  const needsDecision = ins.collectionStatus === 'COLLECTED' && ins.decision === 'UNDECIDED';
  const cardPaid = ins.paidVia === 'CREDIT_AGRICOLE';
  const deskMethods = view.allowedMethods.filter((m): m is 'CASH' | 'INSTAPAY' => m !== 'PROVIDER');

  const applyResult = (res: Awaited<ReturnType<typeof decideInsuranceAction>>) => {
    if (res.ok) {
      setView(res.view);
      setError(null);
      setDecisionMode(null);
      setReason('');
      setCashConfirm(false);
      setProofUrl(null);
    } else {
      setError(errorLabel(res.code, t));
    }
  };

  const doDecide = (decision: 'REFUND' | 'NO_REFUND') => {
    setError(null);
    startAction(async () => {
      applyResult(
        await decideInsuranceAction({
          bookingId: view.booking.id,
          decision,
          reason: decision === 'NO_REFUND' ? reason.trim() : undefined,
        }),
      );
    });
  };

  const doExecuteDesk = () => {
    if (!pendingDesk) return;
    setError(null);
    startAction(async () => {
      applyResult(
        await executeDeskInsuranceRefundAction({
          insuranceRefundId: pendingDesk.id,
          method,
          proofUrl: method === 'INSTAPAY' ? proofUrl : undefined,
        }),
      );
    });
  };

  async function onUploadProof(e: ChangeEvent<HTMLInputElement>) {
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
      if (!res.ok || !body.url) setUploadError(body.detail ?? t('payout.uploadFailed'));
      else setProofUrl(body.url);
    } catch {
      setUploadError(t('payout.uploadFailed'));
    } finally {
      setUploading(false);
    }
  }

  const dateLabel = view.booking.endDate
    ? `${formatDate(view.booking.date, locale)} → ${formatDate(view.booking.endDate, locale)}`
    : formatDate(view.booking.date, locale);

  return (
    <main
      dir="ltr"
      style={{ minHeight: '100dvh', background: bg, color: cream, fontFamily: sans, padding: '32px 24px 56px' }}
    >
      <div style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* header */}
        <div>
          <div style={{ fontFamily: sans, fontSize: 11, letterSpacing: '2.6px', fontWeight: 700, color: gold, marginBottom: 8 }}>
            {t('eyebrow')}
          </div>
          <h1 style={{ margin: 0, fontFamily: serif, fontSize: 38, fontWeight: 600, color: cream, lineHeight: 1.05, letterSpacing: '-0.4px' }}>
            {t('title')}
          </h1>
          <p style={{ color: dim, fontSize: 13.5, margin: '10px 0 0', fontFamily: sans }}>
            {view.booking.guestName} · <span style={{ color: faint }}>#{view.booking.reference}</span>
          </p>
        </div>

        {/* booking summary */}
        <section style={cardStyle}>
          <SectionTitle>{t('booking.title')}</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px 24px' }}>
            <Field label={t('booking.guest')} value={view.booking.guestName} />
            <Field label={t('booking.phone')} value={view.booking.phone} ltr />
            <Field label={t('booking.service')} value={`${categoryName} · ${serviceName}`} />
            <Field label={t('booking.date')} value={dateLabel} />
            <Field
              label={t('booking.party')}
              value={t('booking.partyValue', { people: view.booking.people, children: view.booking.children })}
            />
            <Field label={t('booking.status')} value={view.booking.status} />
          </div>
        </section>

        {/* deposit snapshot */}
        <section style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <SectionTitle>{t('deposit.title')}</SectionTitle>
            <PaymentSourceBadge payment={view.payment} paidVia={ins.paidVia} t={t} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px 24px' }}>
            <Field
              label={t('deposit.type')}
              value={
                ins.type === 'PERCENT'
                  ? t('deposit.typePercent', { percent: ins.percent ?? 0 })
                  : t('deposit.typeFixed')
              }
            />
            <Field label={t('deposit.base')} value={money(ins.baseCents)} />
            <Field label={t('deposit.amount')} value={money(ins.amountCents)} gold />
            <Field
              label={t('deposit.collectedAt')}
              value={
                ins.collectionStatus === 'COLLECTED' && ins.collectedAt
                  ? new Date(ins.collectedAt).toLocaleString(ar ? 'ar-EG' : 'en-GB')
                  : ins.collectionStatus === 'VOIDED'
                    ? t('deposit.voided')
                    : t('deposit.notCollected')
              }
            />
            <Field label={t('deposit.refundable')} value={money(view.refundableCents)} gold />
          </div>
          {view.payment?.proofUrl ? (
            <a
              href={view.payment.proofUrl}
              target="_blank"
              rel="noreferrer"
              style={{ display: 'inline-block', marginTop: 12, color: gold, fontSize: 12.5, fontWeight: 600, fontFamily: sans }}
            >
              {t('deposit.viewPaymentProof')} ↗
            </a>
          ) : null}
        </section>

        {/* decision */}
        <section style={cardStyle}>
          <SectionTitle>{t('decision.title')}</SectionTitle>

          {ins.collectionStatus !== 'COLLECTED' ? (
            <Note>{ins.collectionStatus === 'VOIDED' ? t('deposit.voided') : t('deposit.notCollected')}</Note>
          ) : needsDecision ? (
            <>
              <p style={{ color: dim, fontSize: 13.5, margin: '0 0 16px', fontFamily: sans, lineHeight: 1.5 }}>
                {t('decision.prompt', { amount: money(view.refundableCents) })}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <button
                  type="button"
                  onClick={() => setDecisionMode(decisionMode === 'refund' ? null : 'refund')}
                  disabled={pending}
                  style={bigBtn(decisionMode === 'refund' ? ok : gold)}
                >
                  {t('decision.refundBtn')}
                </button>
                <button
                  type="button"
                  onClick={() => setDecisionMode(decisionMode === 'no-refund' ? null : 'no-refund')}
                  disabled={pending}
                  style={ghostBtnStyle}
                >
                  {t('decision.noRefundBtn')}
                </button>
              </div>

              {decisionMode === 'refund' ? (
                <InlineConfirm
                  text={t('decision.confirmRefund', { amount: money(view.refundableCents) })}
                  confirmLabel={pending ? t('working') : t('confirm')}
                  cancelLabel={t('cancel')}
                  disabled={pending}
                  onConfirm={() => doDecide('REFUND')}
                  onCancel={() => setDecisionMode(null)}
                  tone="ok"
                />
              ) : null}

              {decisionMode === 'no-refund' ? (
                <div style={{ marginTop: 16 }}>
                  <label style={{ display: 'block', fontFamily: sans, fontSize: 11, letterSpacing: '1.4px', fontWeight: 600, color: faint, marginBottom: 8 }}>
                    {t('decision.reasonLabel')}
                  </label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('decision.reasonPlaceholder')}
                    rows={3}
                    style={{
                      width: '100%', boxSizing: 'border-box', borderRadius: 13, background: panel2,
                      border: `1px solid ${line}`, color: cream, fontFamily: sans, fontSize: 14,
                      padding: '12px 14px', outline: 'none', resize: 'vertical',
                    }}
                  />
                  {!reason.trim() ? (
                    <p style={{ color: warn, fontSize: 12, margin: '6px 0 0', fontFamily: sans }}>
                      {t('decision.reasonRequired')}
                    </p>
                  ) : null}
                  <InlineConfirm
                    text={t('decision.confirmNoRefund', { amount: money(ins.amountCents) })}
                    confirmLabel={pending ? t('working') : t('confirm')}
                    cancelLabel={t('cancel')}
                    disabled={pending || !reason.trim()}
                    onConfirm={() => doDecide('NO_REFUND')}
                    onCancel={() => setDecisionMode(null)}
                    tone="bad"
                  />
                </div>
              ) : null}
            </>
          ) : (
            // Already decided — read-only summary. Completed refunds are immutable.
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Chip color={ins.decision === 'REFUND' ? ok : dim}>
                  {ins.decision === 'REFUND' ? t('decision.decidedRefund') : t('decision.decidedNoRefund')}
                </Chip>
                <span style={{ color: dim, fontSize: 12.5, fontFamily: sans }}>
                  {t('decision.decidedBy', { name: ins.decidedByName ?? '—' })}
                  {ins.decidedAt ? ` · ${new Date(ins.decidedAt).toLocaleString(ar ? 'ar-EG' : 'en-GB')}` : ''}
                </span>
              </div>
              {ins.noRefundReason ? (
                <p style={{ color: dim, fontSize: 13, margin: '10px 0 0', fontFamily: sans, lineHeight: 1.5 }}>
                  <strong style={{ color: cream }}>{t('decision.reasonLabel')}:</strong> {ins.noRefundReason}
                </p>
              ) : null}
            </div>
          )}
        </section>

        {/* desk payout */}
        {pendingDesk && deskMethods.length > 0 ? (
          <section style={{ ...cardStyle, border: `1px solid ${gold}55` }}>
            <SectionTitle>{t('payout.title')}</SectionTitle>
            <p style={{ color: dim, fontSize: 13.5, margin: '0 0 16px', fontFamily: sans }}>
              {t('payout.subtitle', { amount: money(pendingDesk.amountCents) })}
            </p>

            {/* method toggle */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
              {deskMethods.map((m) => {
                const on = method === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { setMethod(m); setCashConfirm(false); }}
                    style={{
                      height: 52, borderRadius: 13, cursor: 'pointer',
                      background: on ? gold : panel2, border: `1px solid ${on ? gold : line}`,
                      color: on ? '#ffffff' : cream, fontFamily: sans, fontSize: 14, fontWeight: 700,
                    }}
                  >
                    {m === 'CASH' ? t('payout.cash') : t('payout.instapay')}
                  </button>
                );
              })}
            </div>

            {method === 'CASH' ? (
              <>
                <button
                  type="button"
                  onClick={() => setCashConfirm(true)}
                  disabled={pending || cashConfirm}
                  style={bigBtn(ok)}
                >
                  {t('payout.cashConfirmBtn')}
                </button>
                {cashConfirm ? (
                  <InlineConfirm
                    text={t('payout.cashConfirmPrompt', { amount: money(pendingDesk.amountCents) })}
                    confirmLabel={pending ? t('working') : t('confirm')}
                    cancelLabel={t('cancel')}
                    disabled={pending}
                    onConfirm={doExecuteDesk}
                    onCancel={() => setCashConfirm(false)}
                    tone="ok"
                  />
                ) : null}
              </>
            ) : (
              <>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontFamily: sans, fontSize: 11, letterSpacing: '1.4px', fontWeight: 600, color: faint, marginBottom: 8 }}>
                    {t('payout.instapayProofLabel')}
                  </label>
                  {proofUrl ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={proofUrl} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 12, border: `1px solid ${line}` }} />
                      <button type="button" onClick={() => setProofUrl(null)} style={ghostBtnStyle}>
                        {t('payout.replace')}
                      </button>
                    </div>
                  ) : (
                    <label
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', height: 52,
                        borderRadius: 13, background: panel2, border: `1px dashed ${line}`,
                        color: dim, fontFamily: sans, fontSize: 13.5, cursor: 'pointer',
                      }}
                    >
                      {uploading ? t('payout.uploading') : t('payout.uploadImage')}
                      <input type="file" accept="image/*" onChange={onUploadProof} style={{ display: 'none' }} disabled={uploading} />
                    </label>
                  )}
                  {uploadError ? <p style={{ color: bad, fontSize: 12, margin: '6px 0 0', fontFamily: sans }}>{uploadError}</p> : null}
                  {!proofUrl ? (
                    <p style={{ color: gold, fontSize: 11.5, margin: '6px 0 0', fontFamily: sans, fontWeight: 500 }}>
                      {t('payout.proofRequiredNote')}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={doExecuteDesk}
                  disabled={pending || !proofUrl || uploading}
                  style={{ ...bigBtn(ok), opacity: pending || !proofUrl || uploading ? 0.5 : 1, cursor: pending || !proofUrl ? 'not-allowed' : 'pointer' }}
                >
                  {pending ? t('working') : t('payout.instapayConfirmBtn')}
                </button>
              </>
            )}
          </section>
        ) : null}

        {/* card refund — read-only admin-approval status */}
        {cardPaid && ins.decision === 'REFUND' && activeAttempt && activeAttempt.status !== 'PENDING_DESK' ? (
          <section style={{ ...cardStyle, border: `1px solid ${blue}55` }}>
            <SectionTitle>{t('admin.title')}</SectionTitle>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <StatusChip status={activeAttempt.status} t={t} />
              <span style={{ color: dim, fontSize: 13, fontFamily: sans }}>
                {t('admin.body', { amount: money(activeAttempt.amountCents) })}
              </span>
            </div>
          </section>
        ) : null}

        {error ? (
          <div
            role="alert"
            style={{
              padding: '14px 16px', borderRadius: 12, background: 'rgba(192,57,43,0.08)',
              border: '1px solid rgba(192,57,43,0.3)', color: bad, fontSize: 13.5, fontFamily: sans, lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        ) : null}

        {/* attempts timeline */}
        <section style={cardStyle}>
          <SectionTitle>{t('attempts.title')}</SectionTitle>
          {view.attempts.length === 0 ? (
            <Note>{t('attempts.empty')}</Note>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {view.attempts.map((a) => (
                <AttemptRow key={a.id} attempt={a} locale={locale} t={t} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function AttemptRow({
  attempt,
  locale,
  t,
}: {
  attempt: InsuranceAttemptView;
  locale: 'ar' | 'en';
  t: Errors;
}) {
  const ar = locale === 'ar';
  const fmt = (iso: string) => new Date(iso).toLocaleString(ar ? 'ar-EG' : 'en-GB');
  const methodLabel =
    attempt.method === 'PROVIDER'
      ? t('attempts.methodProvider')
      : attempt.method === 'CASH'
        ? t('attempts.methodCash')
        : t('attempts.methodInstapay');
  return (
    <div style={{ borderRadius: 14, background: panel2, border: `1px solid ${line}`, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <StatusChip status={attempt.status} t={t} />
        <span style={{ fontFamily: sans, fontSize: 13.5, fontWeight: 700, color: cream }}>{methodLabel}</span>
        <span style={{ fontFamily: sans, fontSize: 13.5, fontWeight: 600, color: gold, fontVariantNumeric: 'tabular-nums' }}>
          {formatMoney(attempt.amountCents, { locale, currency: 'EGP' })}
        </span>
        {attempt.proofUrl ? (
          <a href={attempt.proofUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={attempt.proofUrl} alt="" style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 6, border: `1px solid ${line}` }} />
            <span style={{ color: gold, fontSize: 12, fontWeight: 600, fontFamily: sans }}>{t('attempts.openProof')}</span>
          </a>
        ) : null}
      </div>
      <div style={{ marginTop: 8, color: dim, fontFamily: sans, fontSize: 12, lineHeight: 1.6 }}>
        <span>{t('attempts.requestedBy', { name: attempt.requestedByName ?? '—' })} · {fmt(attempt.createdAt)}</span>
        {attempt.approvedByName ? <span> · {t('attempts.approvedBy', { name: attempt.approvedByName })}</span> : null}
        {attempt.completedAt ? <span> · {t('attempts.completedAt', { when: fmt(attempt.completedAt) })}</span> : null}
      </div>
      {attempt.failureMessage ? (
        <p style={{ color: bad, fontSize: 12, margin: '8px 0 0', fontFamily: sans, lineHeight: 1.5 }}>
          {t('attempts.failure')}: {attempt.failureMessage}
        </p>
      ) : null}
    </div>
  );
}

function StatusChip({ status, t }: { status: InsuranceAttemptView['status']; t: Errors }) {
  const palette: Record<InsuranceAttemptView['status'], string> = {
    AWAITING_ADMIN: blue,
    PENDING_DESK: warn,
    PROCESSING: blue,
    COMPLETED: ok,
    FAILED: bad,
    REJECTED: bad,
    MANUAL_ATTENTION: bad,
  };
  return <Chip color={palette[status]}>{t(`attempts.status.${status}`)}</Chip>;
}

function Chip({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', height: 24, padding: '0 10px', borderRadius: 8,
        background: `${color}1a`, border: `1px solid ${color}55`, color,
        fontFamily: sans, fontSize: 11.5, fontWeight: 700, letterSpacing: '0.02em', whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function PaymentSourceBadge({
  payment,
  paidVia,
  t,
}: {
  payment: InsuranceCheckoutView['payment'];
  paidVia: string | null;
  t: Errors;
}) {
  const provider = paidVia ?? payment?.provider ?? null;
  if (!provider) return null;
  const label =
    provider === 'CREDIT_AGRICOLE'
      ? t('paymentSource.card')
      : provider === 'INSTAPAY'
        ? t('paymentSource.instapay')
        : t('paymentSource.cash');
  return <Chip color={provider === 'CREDIT_AGRICOLE' ? blue : gold}>{t('paymentSource.label', { method: label })}</Chip>;
}

function InlineConfirm({
  text,
  confirmLabel,
  cancelLabel,
  disabled,
  onConfirm,
  onCancel,
  tone,
}: {
  text: string;
  confirmLabel: string;
  cancelLabel: string;
  disabled: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  tone: 'ok' | 'bad';
}) {
  const c = tone === 'ok' ? ok : bad;
  return (
    <div
      role="alertdialog"
      style={{
        marginTop: 14, padding: '14px 16px', borderRadius: 13,
        background: `${c}12`, border: `1px solid ${c}45`,
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}
    >
      <span style={{ flex: 1, minWidth: 200, color: cream, fontFamily: sans, fontSize: 13.5, lineHeight: 1.5 }}>{text}</span>
      <button
        type="button"
        onClick={onConfirm}
        disabled={disabled}
        style={{
          height: 40, padding: '0 20px', borderRadius: 11, border: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer', background: c, color: '#ffffff',
          fontFamily: sans, fontSize: 13.5, fontWeight: 700, opacity: disabled ? 0.6 : 1,
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" onClick={onCancel} style={{ ...ghostBtnStyle, height: 40 }}>
        {cancelLabel}
      </button>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ margin: '0 0 16px', fontFamily: serif, fontSize: 21, fontWeight: 600, color: cream }}>
      {children}
    </h2>
  );
}

function Field({ label, value, gold: isGold, ltr }: { label: string; value: string; gold?: boolean; ltr?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <p style={{ color: faint, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', margin: '0 0 4px', fontFamily: sans }}>
        {label}
      </p>
      <p
        dir={ltr ? 'ltr' : undefined}
        style={{
          color: isGold ? gold : cream, fontSize: 15, margin: 0,
          fontFamily: isGold ? serif : sans, fontWeight: isGold ? 600 : 500,
          fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere',
        }}
      >
        {value}
      </p>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '16px 18px', borderRadius: 13, background: panel2, border: `1px solid ${line}`,
        color: faint, fontFamily: sans, fontSize: 13.5, lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  borderRadius: 20,
  background: panel,
  border: `1px solid ${line}`,
  padding: '22px 26px',
};

const ghostBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 52,
  padding: '0 18px',
  borderRadius: 13,
  background: 'transparent',
  color: cream,
  border: `1px solid ${line}`,
  fontFamily: sans,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

function bigBtn(color: string): React.CSSProperties {
  return {
    width: '100%',
    height: 52,
    borderRadius: 13,
    border: 'none',
    cursor: 'pointer',
    background: color,
    color: '#ffffff',
    fontFamily: sans,
    fontSize: 14.5,
    fontWeight: 700,
    letterSpacing: '0.3px',
  };
}
