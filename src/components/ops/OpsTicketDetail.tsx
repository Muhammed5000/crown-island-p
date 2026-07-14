'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  addOpsNoteAction,
  assignOpsTicketAction,
  escalateOpsTicketAction,
  getOpsTicketAction,
  returnToServiceAction,
  setOpsDueDateAction,
  setOpsPriorityAction,
  setOpsStatusAction,
} from '@/features/ops/actions';
import type { OpsTicketDetail, OpsStaffOption } from '@/server/services/ops-tickets';
import {
  OPS, STATUS_META, PRIORITY_META, TYPE_META,
  StatusPill, PriorityPill, btn, inputStyle, selectStyle, labelStyle, fmtDateTime,
} from './ops-ui';

/**
 * Ticket detail drawer: full info, the status workflow (claim / start / wait /
 * complete with resolution notes + proof photo / reopen / cancel), manager
 * controls (assign, priority, due date), housekeeping → maintenance
 * escalation, return-to-service for the linked place, progress notes with
 * quick presets, and the full activity timeline.
 */

export interface OpsViewerInfo {
  id: string;
  role: string;
  isManager: boolean;
  /** Any ops-desk role except SECURITY — can route work + take cells down. */
  isOperator: boolean;
  isOpsStaff: boolean;
  canReturnToService: boolean;
}

const ERRORS: Record<string, string> = {
  forbidden: 'You are not allowed to do that.',
  invalid_transition: 'That status change is not allowed from the current state.',
  resolution_required: 'Completion requires resolution notes — describe what was done.',
  proof_required: 'Attach a completion photo before marking your task as done.',
  ticket_closed: 'This ticket is closed — reopen it first.',
  no_place: 'This ticket has no linked place.',
  already_maintenance: 'This is already a maintenance ticket.',
  invalid_assignee: 'That staff member cannot take tickets.',
  invalid_input: 'Please check the fields and try again.',
};

const HK_PRESETS = ['Cleaning in progress', 'Cleaning completed — ready', 'Inspection passed', 'Inspection failed', 'Restock required', 'Damage noticed'];
const MNT_PRESETS = ['Diagnosis done', 'Repair in progress', 'Waiting for parts', 'Waiting for approval', 'Fixed — testing', 'Could not be fixed — needs review'];

const EVENT_LABEL: Record<string, string> = {
  CREATED: 'created the ticket',
  ASSIGNED: 'assigned',
  UNASSIGNED: 'unassigned',
  STATUS: 'changed status',
  PRIORITY: 'changed priority',
  DUE_DATE: 'changed due date',
  NOTE: 'added a note',
  ESCALATED: 'escalated to maintenance',
  RETURNED_TO_SERVICE: 'returned the place to service',
};

export function OpsTicketDetailView({
  ticketId,
  viewer,
  staff,
  onChanged,
  onClose,
}: {
  ticketId: string;
  viewer: OpsViewerInfo;
  staff: OpsStaffOption[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const t_ = useTranslations('ops.detail');
  const tm = useTranslations('ops');

  // Timeline status/priority value around the "→": known status/priority get a
  // localized label; anything else falls back to the humanized raw value.
  const eventValueLabel = (value: string): string => {
    if (value in STATUS_META) return tm(`status.${value}`);
    if (value in PRIORITY_META) return tm(`priority.${value}`);
    return value.replace(/_/g, ' ').toLowerCase();
  };

  const [ticket, setTicket] = useState<OpsTicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const [note, setNote] = useState('');
  const [noteImage, setNoteImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [resolution, setResolution] = useState('');
  const [proofImage, setProofImage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'cancel' | 'return' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const proofRef = useRef<HTMLInputElement>(null);

  // Loading runs inside the transition so the effect never sets state
  // synchronously (and `pending` covers both loads and mutations).
  const load = useCallback(() => {
    start(async () => {
      const res = await getOpsTicketAction(ticketId);
      if (res.ok) {
        setTicket(res.ticket);
        setError(null);
      } else {
        setError(res.code === 'forbidden' ? t_('errors.viewForbidden') : t_('errors.loadFailed'));
      }
    });
  }, [ticketId, t_]);

  useEffect(() => {
    load();
  }, [load]);

  const act = (fn: () => Promise<{ ok: boolean; code?: string }>) => {
    setActionError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        const code = res.code ?? '';
        setActionError(code && code in ERRORS ? t_(`errors.${code}`) : t_('errors.generic'));
        return;
      }
      setCompleting(false);
      setConfirming(null);
      setNote('');
      setNoteImage(null);
      setProofImage(null);
      const reload = await getOpsTicketAction(ticketId);
      if (reload.ok) setTicket(reload.ticket);
      onChanged();
    });
  };

  // One uploader serves both the progress-note photo and the completion proof.
  const uploadPhoto = async (file: File, target: 'note' | 'proof') => {
    setUploading(true);
    setActionError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const headers: HeadersInit = {};
      if (window.location.hostname.includes('ngrok')) headers['ngrok-skip-browser-warning'] = 'true';
      const res = await fetch('/api/ops/upload', { method: 'POST', body: fd, headers });
      const body = (await res.json()) as { ok: boolean; url?: string; detail?: string };
      if (body.ok && body.url) {
        if (target === 'proof') setProofImage(body.url);
        else setNoteImage(body.url);
      } else setActionError(body.detail ?? t_('upload.failed'));
    } catch {
      setActionError(t_('upload.failedConnection'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
      if (proofRef.current) proofRef.current.value = '';
    }
  };

  if (error) {
    return (
      <Panel onClose={onClose} title={t_('ticket')}>
        <p style={{ color: OPS.bad, fontFamily: OPS.sans, fontSize: 13.5 }}>{error}</p>
      </Panel>
    );
  }
  if (!ticket) {
    return (
      <Panel onClose={onClose} title={t_('ticket')}>
        <p style={{ color: OPS.faint, fontFamily: OPS.sans, fontSize: 13.5 }}>{t_('loading')}</p>
      </Panel>
    );
  }

  const t = ticket;
  const open = !['COMPLETED', 'CANCELLED'].includes(t.status);
  const isAssignee = t.assignedToId === viewer.id;
  const canClaim = open && !t.assignedToId && viewer.isOperator;
  const canStart = open && isAssignee && ['ASSIGNED', 'WAITING', 'OPEN', 'REOPENED'].includes(t.status);
  const canWait = open && isAssignee && t.status === 'IN_PROGRESS';
  const canComplete = open && (isAssignee || viewer.isManager) && ['IN_PROGRESS', 'WAITING', 'REOPENED'].includes(t.status);
  const canReopen = !open && (viewer.isManager || isAssignee || t.createdById === viewer.id) && true;
  const canCancel =
    open &&
    (viewer.isManager ||
      (t.createdById === viewer.id && !t.assignedToId && (t.status === 'NEW' || t.status === 'OPEN')));
  const canEscalate =
    open && ['HOUSEKEEPING', 'CLEANING', 'INSPECTION', 'OTHER'].includes(t.type) &&
    (viewer.isManager || isAssignee || t.createdById === viewer.id);
  // Return-to-service: managers / MAINTENANCE, or the ticket's creator (whoever
  // took the cell down can bring it back) — mirrors the server-side rule.
  const canReturn =
    open && !!t.placeId &&
    (viewer.canReturnToService || (viewer.isOperator && t.createdById === viewer.id)) &&
    (t.placeOnline === false || t.placeOutNow || t.type === 'OUT_OF_SERVICE');
  const presetKind = ['MAINTENANCE', 'REPAIR', 'OUT_OF_SERVICE'].includes(t.type) ? 'mnt' : 'hk';
  const presets = (presetKind === 'mnt' ? MNT_PRESETS : HK_PRESETS).map((_, pi) =>
    presetKind === 'mnt' ? t_(`note.mntPresets.${pi}`) : t_(`note.hkPresets.${pi}`),
  );

  return (
    <Panel onClose={onClose} title={t.reference}>
      {/* header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: OPS.sans, fontSize: 12, color: OPS.faint }}>
          {TYPE_META[t.type]?.icon} {TYPE_META[t.type] ? tm(`type.${t.type}`) : t.type}
        </span>
        <StatusPill status={t.status} />
        <PriorityPill priority={t.priority} />
        {t.overdue ? <span style={{ color: OPS.bad, fontFamily: OPS.sans, fontSize: 11.5, fontWeight: 700 }}>{t_('overdue')}</span> : null}
      </div>
      <h2 style={{ margin: '10px 0 2px', fontFamily: OPS.serif, fontSize: 26, fontWeight: 600, color: OPS.cream, lineHeight: 1.15 }}>
        {t.title}
      </h2>
      {t.description ? (
        <p style={{ margin: '6px 0 0', color: OPS.dim, fontFamily: OPS.sans, fontSize: 13.5, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
          {t.description}
        </p>
      ) : null}

      {/* facts grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px', margin: '16px 0', padding: '14px 16px', borderRadius: 14, background: OPS.panel2, border: `1px solid ${OPS.line}` }}>
        <Fact
          k={t_('facts.place')}
          v={
            t.placeLabel
              ? `${t.placeLabel}${t.serviceName ? ` · ${t.serviceName}` : ''}${
                  t.placeOnline === false ? ` · ${t_('facts.offline')}` : t.placeOutNow ? ` · ${t_('facts.outOfService')}` : ''
                }`
              : '—'
          }
          warn={t.placeOnline === false || t.placeOutNow}
        />
        <Fact k={t_('facts.booking')} v={t.bookingReference ?? '—'} />
        <Fact k={t_('facts.reportedBy')} v={t.createdByName} />
        <Fact k={t_('facts.assignedTo')} v={t.assignedToName ?? t_('facts.unassigned')} />
        <Fact k={t_('facts.created')} v={fmtDateTime(t.createdAt)} />
        <Fact k={t_('facts.due')} v={fmtDateTime(t.dueAt)} warn={t.overdue} />
        <Fact k={t_('facts.started')} v={fmtDateTime(t.startedAt)} />
        <Fact k={t_('facts.completed')} v={fmtDateTime(t.completedAt)} />
      </div>
      {t.resolutionNotes ? (
        <div style={{ margin: '0 0 14px', padding: '12px 14px', borderRadius: 12, background: 'rgba(27,138,82,0.08)', border: '1px solid rgba(27,138,82,0.3)', color: OPS.ok, fontFamily: OPS.sans, fontSize: 13, lineHeight: 1.5 }}>
          <strong>{t_('resolution')}</strong> {t.resolutionNotes}
        </div>
      ) : null}

      {/* workflow actions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
        {canClaim ? (
          <button type="button" disabled={pending} style={btn('gold', pending)} onClick={() => act(() => assignOpsTicketAction({ ticketId: t.id, assigneeId: viewer.id }))}>
            {t_('actions.claim')}
          </button>
        ) : null}
        {canStart ? (
          <button type="button" disabled={pending} style={btn('gold', pending)} onClick={() => act(() => setOpsStatusAction({ ticketId: t.id, to: 'IN_PROGRESS' }))}>
            {t_('actions.start')}
          </button>
        ) : null}
        {canWait ? (
          <button type="button" disabled={pending} style={btn('ghost', pending)} onClick={() => act(() => setOpsStatusAction({ ticketId: t.id, to: 'WAITING', note: note.trim() || null }))}>
            {t_('actions.waiting')}
          </button>
        ) : null}
        {canComplete && !completing ? (
          <button type="button" disabled={pending} style={btn('ok', pending)} onClick={() => setCompleting(true)}>
            {t_('actions.complete')}
          </button>
        ) : null}
        {canReopen ? (
          <button type="button" disabled={pending} style={btn('ghost', pending)} onClick={() => act(() => setOpsStatusAction({ ticketId: t.id, to: 'REOPENED' }))}>
            {t_('actions.reopen')}
          </button>
        ) : null}
        {canEscalate ? (
          <button type="button" disabled={pending} style={btn('ghost', pending)} onClick={() => act(() => escalateOpsTicketAction({ ticketId: t.id, note: note.trim() || null }))}>
            {t_('actions.escalate')}
          </button>
        ) : null}
        {canReturn ? (
          confirming === 'return' ? (
            <span style={{ display: 'inline-flex', gap: 8 }}>
              <button type="button" disabled={pending} style={btn('ok', pending)} onClick={() => act(() => returnToServiceAction({ ticketId: t.id, note: note.trim() || null }))}>
                {t_('actions.confirmReturn')}
              </button>
              <button type="button" style={btn('ghost')} onClick={() => setConfirming(null)}>{t_('actions.keepDown')}</button>
            </span>
          ) : (
            <button type="button" disabled={pending} style={btn('ok', pending)} onClick={() => setConfirming('return')}>
              {t_('actions.returnToService')}
            </button>
          )
        ) : null}
        {canCancel ? (
          confirming === 'cancel' ? (
            <span style={{ display: 'inline-flex', gap: 8 }}>
              <button type="button" disabled={pending} style={btn('danger', pending)} onClick={() => act(() => setOpsStatusAction({ ticketId: t.id, to: 'CANCELLED', note: note.trim() || null }))}>
                {t_('actions.confirmCancel')}
              </button>
              <button type="button" style={btn('ghost')} onClick={() => setConfirming(null)}>{t_('actions.keepOpen')}</button>
            </span>
          ) : (
            <button type="button" disabled={pending} style={btn('danger', pending)} onClick={() => setConfirming('cancel')}>
              {t_('actions.cancel')}
            </button>
          )
        ) : null}
      </div>

      {/* completion form */}
      {completing ? (() => {
        const needsProof = isAssignee; // the worker ending THEIR task must attach proof
        const placeDown = !!t.placeId && (t.placeOnline === false || t.placeOutNow);
        const disabled = pending || uploading || resolution.trim().length < 3 || (needsProof && !proofImage);
        return (
          <div style={{ margin: '8px 0 12px', padding: 14, borderRadius: 12, border: '1px solid rgba(27,138,82,0.35)', background: 'rgba(27,138,82,0.06)' }}>
            <label style={labelStyle} htmlFor="ops-resolution">{t_('completion.resolutionLabel')}</label>
            <textarea
              id="ops-resolution"
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder={t_('completion.resolutionPlaceholder')}
              style={{ ...inputStyle, height: 'auto', padding: '10px 12px', resize: 'vertical' }}
            />

            {/* completion proof photo — required for the assigned worker */}
            <div style={{ marginTop: 10 }}>
              <span style={labelStyle}>
                {needsProof ? t_('completion.photoRequired') : t_('completion.photoOptional')}
              </span>
              <input
                ref={proofRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadPhoto(f, 'proof');
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" disabled={uploading} style={btn('ghost', uploading)} onClick={() => proofRef.current?.click()}>
                  {uploading ? t_('upload.uploading') : proofImage ? t_('upload.replacePhoto') : t_('upload.takeOrUpload')}
                </button>
                {proofImage ? (
                  <a href={proofImage} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={proofImage} alt={t_('completion.proofAlt')} style={{ maxWidth: 110, maxHeight: 74, borderRadius: 8, border: '1px solid rgba(27,138,82,0.4)', objectFit: 'cover', display: 'block' }} />
                  </a>
                ) : needsProof ? (
                  <span style={{ color: OPS.warn, fontFamily: OPS.sans, fontSize: 12 }}>
                    {t_('completion.photoRequiredHint')}
                  </span>
                ) : null}
              </div>
            </div>

            {placeDown ? (
              <p style={{ margin: '10px 0 0', color: OPS.ok, fontFamily: OPS.sans, fontSize: 12.5 }}>
                {t_('completion.willReturn', { place: t.placeLabel ?? t_('completion.theCell') })}
              </p>
            ) : null}

            <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={disabled}
                style={btn('ok', disabled)}
                onClick={() => act(() => setOpsStatusAction({ ticketId: t.id, to: 'COMPLETED', resolutionNotes: resolution, proofImageUrl: proofImage }))}
              >
                {pending ? t_('completion.completing') : t_('completion.markCompleted')}
              </button>
              <button type="button" style={btn('ghost')} onClick={() => setCompleting(false)}>{t_('completion.back')}</button>
            </div>
          </div>
        );
      })() : null}

      {/* routing + manager controls: any operator may (re)assign a ticket they
          can see; priority and due date remain manager-only. */}
      {open && viewer.isOperator && staff.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: viewer.isManager ? '1fr 1fr 1fr' : '1fr', gap: 10, margin: '10px 0 4px' }}>
          <div>
            <label style={labelStyle} htmlFor="ops-d-assign">{t_('controls.assignee')}</label>
            <select
              id="ops-d-assign"
              value={t.assignedToId ?? ''}
              disabled={pending}
              onChange={(e) => act(() => assignOpsTicketAction({ ticketId: t.id, assigneeId: e.target.value || null }))}
              style={selectStyle}
            >
              <option value="">{t_('controls.unassignedOption')}</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.role.toLowerCase().replace(/_/g, ' ')})
                </option>
              ))}
            </select>
          </div>
          {viewer.isManager ? (
            <>
              <div>
                <label style={labelStyle} htmlFor="ops-d-priority">{t_('controls.priority')}</label>
                <select
                  id="ops-d-priority"
                  value={t.priority}
                  disabled={pending}
                  onChange={(e) => act(() => setOpsPriorityAction({ ticketId: t.id, priority: e.target.value as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' }))}
                  style={selectStyle}
                >
                  {Object.entries(PRIORITY_META).map(([k]) => (
                    <option key={k} value={k}>{tm(`priority.${k}`)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle} htmlFor="ops-d-due">{t_('controls.due')}</label>
                <input
                  id="ops-d-due"
                  type="datetime-local"
                  defaultValue={t.dueAt ? t.dueAt.slice(0, 16) : ''}
                  disabled={pending}
                  onBlur={(e) => {
                    const v = e.target.value;
                    const prev = t.dueAt ? t.dueAt.slice(0, 16) : '';
                    if (v !== prev) act(() => setOpsDueDateAction({ ticketId: t.id, dueAt: v || null }));
                  }}
                  style={{ ...inputStyle, colorScheme: 'light' }}
                />
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {actionError ? (
        <div role="alert" style={{ margin: '8px 0', color: OPS.bad, fontFamily: OPS.sans, fontSize: 13 }}>{actionError}</div>
      ) : null}

      {/* add note */}
      <div style={{ marginTop: 14 }}>
        <label style={labelStyle} htmlFor="ops-note">{t_('note.label')}</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setNote((n) => (n ? `${n} ${p}` : p))}
              style={{
                height: 26, padding: '0 10px', borderRadius: 8, cursor: 'pointer',
                background: OPS.panel2, border: `1px solid ${OPS.line}`, color: OPS.dim,
                fontFamily: OPS.sans, fontSize: 11.5,
              }}
            >
              {p}
            </button>
          ))}
        </div>
        <textarea
          id="ops-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder={t_('note.placeholder')}
          style={{ ...inputStyle, height: 'auto', padding: '10px 12px', resize: 'vertical' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={pending || (!note.trim() && !noteImage)}
            style={btn('gold', pending || (!note.trim() && !noteImage))}
            onClick={() => act(() => addOpsNoteAction({ ticketId: t.id, note, imageUrl: noteImage }))}
          >
            {t_('note.addNote')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadPhoto(f, 'note');
            }}
          />
          <button type="button" disabled={uploading} style={btn('ghost', uploading)} onClick={() => fileRef.current?.click()}>
            {uploading ? t_('upload.uploading') : noteImage ? t_('upload.replacePhoto') : t_('note.attachPhoto')}
          </button>
          {noteImage ? (
            <a href={noteImage} target="_blank" rel="noreferrer" style={{ color: OPS.ok, fontFamily: OPS.sans, fontSize: 12 }}>
              {t_('note.photoAttached')}
            </a>
          ) : null}
        </div>
      </div>

      {/* timeline */}
      <div style={{ marginTop: 20 }}>
        <div style={{ ...labelStyle, marginBottom: 10 }}>{t_('timeline.activity')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {t.events.map((e, i) => (
            <div key={e.id} style={{ display: 'flex', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ width: 9, height: 9, marginTop: 5, borderRadius: 99, background: e.kind === 'STATUS' ? (STATUS_META[e.toValue ?? '']?.c ?? OPS.gold) : OPS.gold, flexShrink: 0 }} />
                {i < t.events.length - 1 ? <span style={{ width: 1, flex: 1, background: OPS.line }} /> : null}
              </div>
              <div style={{ paddingBottom: 14, minWidth: 0 }}>
                <div style={{ fontFamily: OPS.sans, fontSize: 12.5, color: OPS.dim }}>
                  <strong style={{ color: OPS.cream }}>{e.actorName ?? t_('timeline.system')}</strong>{' '}
                  {e.kind in EVENT_LABEL ? t_(`timeline.events.${e.kind}`) : e.kind.toLowerCase()}
                  {e.kind === 'STATUS' || e.kind === 'PRIORITY' ? (
                    <> : <span style={{ color: OPS.faint }}>{e.fromValue ? eventValueLabel(e.fromValue) : '—'}</span> → <span style={{ color: STATUS_META[e.toValue ?? '']?.c ?? PRIORITY_META[e.toValue ?? '']?.c ?? OPS.gold }}>{e.toValue ? eventValueLabel(e.toValue) : ''}</span></>
                  ) : e.kind === 'ASSIGNED' ? (
                    <> → <span style={{ color: OPS.sky }}>{e.toValue}</span></>
                  ) : e.kind === 'DUE_DATE' ? (
                    <> → <span style={{ color: OPS.gold }}>{e.toValue ? fmtDateTime(e.toValue) : t_('timeline.none')}</span></>
                  ) : null}
                  <span style={{ color: OPS.faint }}> · {fmtDateTime(e.createdAt)}</span>
                </div>
                {e.note && e.note !== 'overdue_notified' ? (
                  <div style={{ marginTop: 3, fontFamily: OPS.sans, fontSize: 13, color: OPS.cream, whiteSpace: 'pre-wrap' }}>{e.note}</div>
                ) : null}
                {e.imageUrl ? (
                  <a href={e.imageUrl} target="_blank" rel="noreferrer">
                    {/* Proof thumbnails are user uploads at unknown sizes — plain <img> matches the guest-ID pattern. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={e.imageUrl} alt={t_('timeline.attachmentAlt')} style={{ marginTop: 6, maxWidth: 180, maxHeight: 120, borderRadius: 8, border: `1px solid ${OPS.line}`, objectFit: 'cover' }} />
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function Fact({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: OPS.sans, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: OPS.faint }}>{k}</div>
      <div style={{ fontFamily: OPS.sans, fontSize: 13.5, color: warn ? OPS.bad : OPS.cream, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</div>
    </div>
  );
}

function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const t_ = useTranslations('ops.detail');
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', justifyContent: 'flex-end', background: 'rgba(20,33,50,0.4)', backdropFilter: 'blur(3px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 'min(560px, 100vw)', height: '100dvh', overflowY: 'auto', background: OPS.panel,
          borderLeft: `1px solid ${OPS.line}`, padding: '20px 24px 40px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span dir="ltr" style={{ fontFamily: OPS.sans, fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', color: OPS.gold }}>{title}</span>
          <button type="button" onClick={onClose} aria-label={t_('close')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: OPS.faint, fontSize: 20, lineHeight: 1, padding: 6 }}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
