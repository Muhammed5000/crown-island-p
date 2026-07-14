'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  loadOpsBoardAction,
  listOpsNotificationsAction,
  markOpsNotificationsReadAction,
} from '@/features/ops/actions';
import type {
  OpsSummary,
  OpsTicketRow,
  OpsStaffOption,
  StaffNotificationRow,
} from '@/server/services/ops-tickets';
import { CrownLogo } from '@/components/brand/CrownLogo';
import {
  OPS, STATUS_META, PRIORITY_META, TYPE_META,
  StatusPill, PriorityPill, btn, inputStyle, selectStyle, Note, fmtDateTime, useTimeAgo,
} from './ops-ui';
import { OpsNewTicket } from './OpsNewTicket';
import { OpsTicketDetailView, type OpsViewerInfo } from './OpsTicketDetail';
import { GateReceptionSwitch } from '@/components/gate/GateReceptionSwitch';

/**
 * Housekeeping & Maintenance desk (`/gate/ops`).
 *
 * One screen for the whole operational workflow: live summary cards, a
 * filterable/searchable ticket board, a notification bell (polled — places
 * going out of service, assignments, status changes, overdue alerts), a
 * "report issue / new ticket" modal and a full ticket-detail drawer.
 */

type ViewKey = 'open' | 'mine' | 'unassigned' | 'out' | 'overdue' | 'done' | 'all';

const VIEWS: { key: ViewKey }[] = [
  { key: 'open' },
  { key: 'mine' },
  { key: 'unassigned' },
  { key: 'out' },
  { key: 'overdue' },
  { key: 'done' },
  { key: 'all' },
];

const POLL_MS = 60_000;

interface Props {
  viewer: OpsViewerInfo & { name: string };
  staff: OpsStaffOption[];
  initialRows: OpsTicketRow[];
  initialSummary: OpsSummary;
  initialNotifications: StaffNotificationRow[];
  initialUnread: number;
}

export function OpsDesk({ viewer, staff, initialRows, initialSummary, initialNotifications, initialUnread }: Props) {
  const t = useTranslations('ops.desk');
  const tm = useTranslations('ops');
  const [rows, setRows] = useState<OpsTicketRow[]>(initialRows);
  const [summary, setSummary] = useState<OpsSummary>(initialSummary);
  const [view, setView] = useState<ViewKey>('open');
  const [statusF, setStatusF] = useState('');
  const [priorityF, setPriorityF] = useState('');
  const [typeF, setTypeF] = useState('');
  const [assigneeF, setAssigneeF] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('newest');
  const [error, setError] = useState<string | null>(null);
  const [pending, startLoad] = useTransition();

  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Stable "now" ticking every 30s for relative timestamps / overdue highlighting.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(h);
  }, []);

  const load = useCallback(() => {
    startLoad(async () => {
      const res = await loadOpsBoardAction({
        status: statusF || (view === 'open' || view === 'mine' || view === 'unassigned' || view === 'overdue' || view === 'out' ? 'OPEN_ALL' : view === 'done' ? 'COMPLETED' : undefined),
        priority: priorityF || undefined,
        type: typeF || undefined,
        assignee: view === 'mine' ? 'me' : view === 'unassigned' ? 'unassigned' : assigneeF || undefined,
        q: q.trim() || undefined,
        overdueOnly: view === 'overdue' || undefined,
        outOnly: view === 'out' || undefined,
        sort: sort as 'newest',
      });
      if (res.ok) {
        setRows(res.rows);
        setSummary(res.summary);
        setError(null);
      } else {
        setError(res.code === 'forbidden' ? t('error.forbidden') : t('error.loadFailed'));
      }
    });
  }, [view, statusF, priorityF, typeF, assigneeF, q, sort, t]);

  // Re-query when any filter changes (debounced for the search box).
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const h = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(h);
  }, [view, statusF, priorityF, typeF, assigneeF, q, sort, load]);

  // Background refresh keeps the board + bell live without realtime infra.
  // The interval calls the latest `load` through a ref so a filter change
  // doesn't tear the timer down and restart the cadence from zero.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  useEffect(() => {
    const h = setInterval(() => loadRef.current(), POLL_MS);
    return () => clearInterval(h);
  }, []);

  const cards = useMemo(
    () => [
      { label: t('cards.openTickets'), value: summary.open, c: OPS.gold },
      { label: t('cards.urgent'), value: summary.urgent, c: OPS.bad },
      { label: t('cards.outOfServiceUnits'), value: summary.outOfServiceUnits, c: OPS.warn },
      { label: t('cards.overdue'), value: summary.overdue, c: OPS.bad },
      { label: t('cards.assignedToMe'), value: summary.assignedToMe, c: OPS.sky },
      { label: t('cards.completedToday'), value: summary.completedToday, c: OPS.ok },
      { label: t('cards.housekeepingOpen'), value: summary.housekeepingOpen, c: OPS.violet },
      { label: t('cards.maintenanceOpen'), value: summary.maintenanceOpen, c: OPS.cream },
    ],
    [summary, t],
  );

  return (
    <div dir="ltr" style={{ minHeight: '100dvh', background: OPS.bg, color: OPS.cream, fontFamily: OPS.sans, position: 'relative' }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse 55% 45% at 60% 0%, rgba(156,125,52,0.08), transparent 60%)' }} />

      {/* top bar */}
      <div style={{ height: 64, borderBottom: `1px solid ${OPS.line}`, display: 'flex', alignItems: 'center', padding: '0 28px', gap: 18, position: 'relative', zIndex: 2 }}>
        <CrownLogo size="sm" />
        <div style={{ flex: 1 }} />
        {/* Centered surface switch — in flow, never overlapping. */}
        <GateReceptionSwitch role={viewer.role} />
        <div style={{ flex: 1 }} />
        <OpsBell initialRows={initialNotifications} initialUnread={initialUnread} onOpenTicket={(id) => setOpenTicketId(id)} />
        <span style={{ color: OPS.faint, fontSize: 12.5, whiteSpace: 'nowrap' }}>{viewer.name}</span>
      </div>

      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '26px 24px 60px', position: 'relative', zIndex: 1 }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: '2.6px', fontWeight: 700, color: OPS.gold, marginBottom: 8 }}>{t('eyebrow')}</div>
            <h1 style={{ margin: 0, fontFamily: OPS.serif, fontSize: 38, fontWeight: 600, lineHeight: 1, letterSpacing: '-0.4px' }}>{t('title')}</h1>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={load} disabled={pending} style={btn('ghost', pending)}>
              {pending ? t('refreshing') : t('refresh')}
            </button>
            <button type="button" onClick={() => setCreating(true)} style={btn('gold')}>
              {t('newTicket')}
            </button>
          </div>
        </div>

        {/* summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginBottom: 20 }}>
          {cards.map((c) => (
            <div key={c.label} style={{ padding: '13px 15px', borderRadius: 14, background: OPS.panel2, border: `1px solid ${OPS.line}` }}>
              <div style={{ fontFamily: OPS.serif, fontSize: 28, fontWeight: 600, color: c.c, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{c.value}</div>
              <div style={{ marginTop: 6, color: OPS.faint, fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{c.label}</div>
            </div>
          ))}
        </div>

        {/* view chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {VIEWS.map((v) => {
            const on = view === v.key;
            return (
              <button
                key={v.key}
                type="button"
                onClick={() => setView(v.key)}
                aria-pressed={on}
                style={{
                  height: 34, padding: '0 16px', borderRadius: 999, cursor: 'pointer',
                  border: on ? 'none' : `1px solid ${OPS.line}`,
                  background: on ? OPS.gold : OPS.panel2,
                  color: on ? OPS.panel : OPS.dim,
                  fontFamily: OPS.sans, fontSize: 12.5, fontWeight: 700,
                }}
              >
                {t(`views.${v.key}`)}
              </button>
            );
          })}
        </div>

        {/* filter bar */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search.placeholder')} aria-label={t('search.ariaLabel')} style={inputStyle} />
          <select value={statusF} onChange={(e) => setStatusF(e.target.value)} aria-label={t('filters.statusAria')} style={selectStyle}>
            <option value="">{t('filters.statusAny')}</option>
            {Object.keys(STATUS_META).map((k) => (
              <option key={k} value={k}>{tm(`status.${k}`)}</option>
            ))}
          </select>
          <select value={priorityF} onChange={(e) => setPriorityF(e.target.value)} aria-label={t('filters.priorityAria')} style={selectStyle}>
            <option value="">{t('filters.priorityAny')}</option>
            {Object.keys(PRIORITY_META).map((k) => (
              <option key={k} value={k}>{tm(`priority.${k}`)}</option>
            ))}
          </select>
          <select value={typeF} onChange={(e) => setTypeF(e.target.value)} aria-label={t('filters.typeAria')} style={selectStyle}>
            <option value="">{t('filters.typeAny')}</option>
            {Object.keys(TYPE_META).map((k) => (
              <option key={k} value={k}>{tm(`type.${k}`)}</option>
            ))}
          </select>
          {viewer.isManager && staff.length > 0 ? (
            <select value={assigneeF} onChange={(e) => setAssigneeF(e.target.value)} aria-label={t('filters.assigneeAria')} style={selectStyle} disabled={view === 'mine' || view === 'unassigned'}>
              <option value="">{t('filters.assigneeAny')}</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          ) : (
            <span />
          )}
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t('filters.sortAria')} style={selectStyle}>
            <option value="newest">{t('sort.newest')}</option>
            <option value="oldest">{t('sort.oldest')}</option>
            <option value="priority">{t('sort.priority')}</option>
            <option value="due">{t('sort.due')}</option>
            <option value="updated">{t('sort.updated')}</option>
            <option value="status">{t('sort.status')}</option>
          </select>
        </div>

        {/* board */}
        {error ? (
          <Note tone="error">{error}</Note>
        ) : rows.length === 0 ? (
          <Note>{pending ? t('board.loading') : t('board.empty')}</Note>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ color: OPS.faint, fontSize: 11.5, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              {t('board.count', { count: rows.length })}
            </div>
            {rows.map((r) => (
              <TicketCard key={r.id} row={r} now={now} onOpen={() => setOpenTicketId(r.id)} />
            ))}
          </div>
        )}
      </div>

      {/* new ticket modal */}
      {creating ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('modal.ariaLabel')}
          style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'grid', placeItems: 'center', background: 'rgba(20,33,50,0.4)', backdropFilter: 'blur(3px)', padding: 16 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setCreating(false);
          }}
        >
          <div style={{ width: 'min(620px, 100%)', maxHeight: '90dvh', overflowY: 'auto', borderRadius: 18, background: OPS.panel, border: `1px solid ${OPS.line}`, padding: '22px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontFamily: OPS.serif, fontSize: 24, fontWeight: 600, color: OPS.cream }}>{t('modal.title')}</h2>
              <button type="button" onClick={() => setCreating(false)} aria-label={t('modal.close')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: OPS.faint, fontSize: 20, padding: 6 }}>✕</button>
            </div>
            <OpsNewTicket
              staff={staff}
              canTakeOutOfService={viewer.isOperator}
              onClose={() => setCreating(false)}
              onCreated={(id) => {
                setCreating(false);
                setOpenTicketId(id);
                load();
              }}
            />
          </div>
        </div>
      ) : null}

      {/* detail drawer */}
      {openTicketId ? (
        <OpsTicketDetailView
          ticketId={openTicketId}
          viewer={viewer}
          staff={staff}
          onChanged={load}
          onClose={() => setOpenTicketId(null)}
        />
      ) : null}
    </div>
  );
}

function TicketCard({ row, now, onOpen }: { row: OpsTicketRow; now: number; onOpen: () => void }) {
  const t = useTranslations('ops.desk');
  const tm = useTranslations('ops');
  const timeAgo = useTimeAgo();
  const typeMeta = TYPE_META[row.type] ?? { label: row.type, icon: '📋' };
  const typeLabel = TYPE_META[row.type] ? tm(`type.${row.type}`) : row.type;
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: 'block', width: '100%', textAlign: 'start', cursor: 'pointer',
        borderRadius: 16, background: OPS.panel, border: `1px solid ${row.overdue ? 'rgba(194,65,12,0.4)' : OPS.line}`,
        padding: '14px 18px', transition: 'border-color 0.15s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = `${OPS.gold}55`)}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = row.overdue ? 'rgba(194,65,12,0.4)' : OPS.line)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <span dir="ltr" style={{ fontFamily: OPS.sans, fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', color: OPS.gold }}>{row.reference}</span>
            <StatusPill status={row.status} />
            <PriorityPill priority={row.priority} />
            {row.overdue ? <span style={{ color: OPS.bad, fontSize: 11, fontWeight: 700 }}>{t('card.overdue')}</span> : null}
          </div>
          <div style={{ marginTop: 6, fontFamily: OPS.serif, fontSize: 18.5, fontWeight: 600, color: OPS.cream, lineHeight: 1.2 }}>
            {row.title}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px 14px', flexWrap: 'wrap', marginTop: 6, color: OPS.dim, fontSize: 12.5 }}>
            <span>{typeMeta.icon} {typeLabel}</span>
            {row.placeLabel ? (
              <span>
                📍 {row.placeLabel}
                {row.serviceName ? ` · ${row.serviceName}` : ''}
                {row.placeOnline === false ? (
                  <span style={{ color: OPS.warn }}>{t('card.offline')}</span>
                ) : row.placeOutNow ? (
                  <span style={{ color: OPS.warn }}>{t('card.outOfService')}</span>
                ) : null}
              </span>
            ) : null}
            <span style={{ color: OPS.faint }}>{t('card.by', { name: row.createdByName })}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0 }}>
          <span style={{ color: row.assignedToName ? OPS.sky : OPS.faint, fontSize: 12.5, fontWeight: 600 }}>
            {row.assignedToName ? t('card.assignedTo', { name: row.assignedToName }) : t('card.unassigned')}
          </span>
          {row.dueAt ? (
            <span style={{ color: row.overdue ? OPS.bad : OPS.dim, fontSize: 11.5 }}>{t('card.due', { date: fmtDateTime(row.dueAt) })}</span>
          ) : null}
          <span style={{ color: OPS.faint, fontSize: 11.5 }}>{t('card.updated', { time: timeAgo(row.updatedAt, now) })}</span>
        </div>
      </div>
    </button>
  );
}

// ── Notification bell ──

function OpsBell({
  initialRows,
  initialUnread,
  onOpenTicket,
}: {
  initialRows: StaffNotificationRow[];
  initialUnread: number;
  onOpenTicket: (id: string) => void;
}) {
  const t = useTranslations('ops.desk');
  const timeAgo = useTimeAgo();
  const [rows, setRows] = useState(initialRows);
  const [unread, setUnread] = useState(initialUnread);
  const [open, setOpen] = useState(false);
  const [now] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    const res = await listOpsNotificationsAction();
    if (res.ok) {
      setRows(res.rows);
      setUnread(res.unread);
    }
  }, []);

  useEffect(() => {
    const h = setInterval(refresh, POLL_MS);
    return () => clearInterval(h);
  }, [refresh]);

  const markAll = async () => {
    await markOpsNotificationsReadAction('all');
    void refresh();
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void refresh();
        }}
        aria-label={t('bell.ariaLabel', { count: unread })}
        style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 12, cursor: 'pointer', background: OPS.panel2, border: `1px solid ${OPS.line}`, color: OPS.gold, fontSize: 16 }}
      >
        🔔
        {unread > 0 ? (
          <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 99, background: OPS.bad, color: '#fff', fontSize: 10.5, fontWeight: 800, display: 'grid', placeItems: 'center', fontFamily: OPS.sans }}>
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div style={{ position: 'absolute', top: 48, right: 0, width: 'min(380px, 90vw)', maxHeight: 460, overflowY: 'auto', borderRadius: 16, background: OPS.panel, border: `1px solid ${OPS.line}`, boxShadow: '0 16px 50px rgba(20,33,50,0.18)', zIndex: 80 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${OPS.line}` }}>
            <span style={{ fontFamily: OPS.sans, fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: OPS.gold }}>{t('bell.heading')}</span>
            {unread > 0 ? (
              <button type="button" onClick={markAll} style={{ background: 'none', border: 'none', cursor: 'pointer', color: OPS.dim, fontFamily: OPS.sans, fontSize: 12 }}>
                {t('bell.markAllRead')}
              </button>
            ) : null}
          </div>
          {rows.length === 0 ? (
            <p style={{ padding: '20px 16px', margin: 0, color: OPS.faint, fontFamily: OPS.sans, fontSize: 13, textAlign: 'center' }}>{t('bell.empty')}</p>
          ) : (
            rows.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (n.ticketId) onOpenTicket(n.ticketId);
                  if (!n.readAt) void markOpsNotificationsReadAction([n.id]).then(refresh);
                }}
                style={{
                  display: 'block', width: '100%', textAlign: 'start', padding: '11px 16px', cursor: 'pointer',
                  background: n.readAt ? 'none' : 'rgba(156,125,52,0.08)', border: 'none',
                  borderBottom: `1px solid ${OPS.line}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {!n.readAt ? <span style={{ width: 7, height: 7, borderRadius: 99, background: OPS.gold, flexShrink: 0 }} /> : null}
                  <span style={{ fontFamily: OPS.sans, fontSize: 13, fontWeight: 700, color: OPS.cream, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</span>
                </div>
                {n.body ? (
                  <div style={{ marginTop: 3, color: OPS.dim, fontFamily: OPS.sans, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.body}</div>
                ) : null}
                <div style={{ marginTop: 3, color: OPS.faint, fontFamily: OPS.sans, fontSize: 11 }}>{timeAgo(n.createdAt, now)}</div>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
