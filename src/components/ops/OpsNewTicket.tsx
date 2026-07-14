'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  createOpsTicketAction,
  listOpsCatalogAction,
  listOpsServicePlacesAction,
} from '@/features/ops/actions';
import type { OpsCatalogCategory, OpsPlaceOption, OpsStaffOption } from '@/server/services/ops-tickets';
import { OPS, TYPE_META, PRIORITY_META, btn, inputStyle, selectStyle, labelStyle } from './ops-ui';

/**
 * "Report an issue / new ticket" form, rendered in a modal on the ops desk.
 *
 * The cell is picked through a cascade — Category → Service → Cell — and once
 * a cell is chosen, ops staff / managers can additionally take it OUT OF
 * SERVICE until a chosen time: the server creates a real `PlaceOutage` in the
 * same transaction, so the cell immediately stops being bookable, exactly like
 * downtime scheduled from the admin panel.
 *
 * Everyone ops-authorised can report; only managers see the assignee select
 * (`staff` arrives empty for everyone else); only ops staff / managers see the
 * out-of-service section (`canTakeOutOfService`).
 */

/** Server error codes → the message key under `ops.newTicket.errors.*`. */
const ERROR_KEYS: Record<string, string> = {
  invalid_input: 'invalid_input',
  forbidden: 'forbidden',
  place_not_found: 'place_not_found',
  invalid_assignee: 'invalid_assignee',
  invalid_range: 'invalid_range',
  no_place: 'no_place',
};

/** Format a Date as a local `datetime-local` input value (YYYY-MM-DDTHH:mm). */
function toLocalInput(d: Date): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

const OOS_PRESETS: { id: string; until: () => Date }[] = [
  { id: 'plus1h', until: () => new Date(Date.now() + 3_600_000) },
  { id: 'plus4h', until: () => new Date(Date.now() + 4 * 3_600_000) },
  {
    id: 'endOfDay',
    until: () => {
      const d = new Date();
      d.setHours(23, 59, 0, 0);
      return d;
    },
  },
  { id: 'plus24h', until: () => new Date(Date.now() + 24 * 3_600_000) },
];

export function OpsNewTicket({
  staff,
  canTakeOutOfService,
  onCreated,
  onClose,
}: {
  staff: OpsStaffOption[];
  canTakeOutOfService: boolean;
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('ops.newTicket');
  const tm = useTranslations('ops');
  const [type, setType] = useState('CLEANING');
  const [priority, setPriority] = useState('MEDIUM');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedToId, setAssignedToId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // ── Cell cascade: Category → Service → Cell ──
  const [categories, setCategories] = useState<OpsCatalogCategory[]>([]);
  const [catalogState, setCatalogState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [categoryId, setCategoryId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [places, setPlaces] = useState<OpsPlaceOption[]>([]);
  const [placesLoading, setPlacesLoading] = useState(false);
  const [placeId, setPlaceId] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listOpsCatalogAction();
      if (cancelled) return;
      if (res.ok) {
        setCategories(res.categories);
        setCatalogState('ready');
      } else {
        setCatalogState('failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const services = useMemo(
    () => categories.find((c) => c.id === categoryId)?.services ?? [],
    [categories, categoryId],
  );
  const selectedPlace = useMemo(() => places.find((p) => p.id === placeId) ?? null, [places, placeId]);

  // Load the cells whenever a service is chosen. Clearing on DE-selection
  // happens in the select handlers (events), not here, to avoid a cascading
  // re-render — the effect owns only the fetch.
  useEffect(() => {
    if (!serviceId) return;
    let cancelled = false;
    (async () => {
      const res = await listOpsServicePlacesAction(serviceId);
      if (cancelled) return;
      setPlaces(res.ok ? res.places : []);
      setPlacesLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId]);

  // ── Out-of-service window ──
  const [takeOut, setTakeOut] = useState(false);
  const [outUntil, setOutUntil] = useState('');
  const outActive = canTakeOutOfService && takeOut && !!placeId;

  const submit = () => {
    setError(null);
    start(async () => {
      const res = await createOpsTicketAction({
        type,
        priority,
        title,
        description: description || null,
        placeId: placeId || null,
        assignedToId: assignedToId || null,
        dueAt: dueAt || null,
        outOfServiceUntil: outActive && outUntil ? outUntil : null,
      });
      if (res.ok) onCreated(res.id);
      else setError(ERROR_KEYS[res.code] ? t(`errors.${ERROR_KEYS[res.code]}`) : t('errors.generic'));
    });
  };

  const submitDisabled =
    pending || title.trim().length < 3 || (outActive && !outUntil);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={labelStyle} htmlFor="ops-type">{t('fields.type')}</label>
          <select id="ops-type" value={type} onChange={(e) => setType(e.target.value)} style={selectStyle}>
            {Object.entries(TYPE_META)
              .filter(([k]) => k !== 'OUT_OF_SERVICE')
              .map(([k, m]) => (
                <option key={k} value={k}>
                  {m.icon} {tm(`type.${k}`)}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label style={labelStyle} htmlFor="ops-priority">{t('fields.priority')}</label>
          <select id="ops-priority" value={priority} onChange={(e) => setPriority(e.target.value)} style={selectStyle}>
            {Object.entries(PRIORITY_META).map(([k]) => (
              <option key={k} value={k}>
                {tm(`priority.${k}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label style={labelStyle} htmlFor="ops-title">{t('fields.title')}</label>
        <input
          id="ops-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('placeholders.title')}
          maxLength={160}
          style={inputStyle}
        />
      </div>

      <div>
        <label style={labelStyle} htmlFor="ops-desc">{t('fields.description')}</label>
        <textarea
          id="ops-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('placeholders.description')}
          rows={3}
          maxLength={4000}
          style={{ ...inputStyle, height: 'auto', padding: '10px 12px', resize: 'vertical' }}
        />
      </div>

      {/* Cell cascade */}
      <div>
        <div style={labelStyle}>{t('cell.label')}</div>
        {catalogState === 'failed' ? (
          <p style={{ margin: 0, color: OPS.bad, fontFamily: OPS.sans, fontSize: 12.5 }}>
            {t('cell.loadFailed')}
          </p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <select
              aria-label={t('cell.categoryAria')}
              value={categoryId}
              disabled={catalogState === 'loading'}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setServiceId('');
                setPlaceId('');
                setPlaces([]);
              }}
              style={selectStyle}
            >
              <option value="">{catalogState === 'loading' ? t('cell.loading') : t('cell.categoryPlaceholder')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select
              aria-label={t('cell.serviceAria')}
              value={serviceId}
              disabled={!categoryId}
              onChange={(e) => {
                setServiceId(e.target.value);
                setPlaceId('');
                // Loading flag flips here (an event) — the effect only fetches.
                if (e.target.value) setPlacesLoading(true);
                else setPlaces([]);
              }}
              style={selectStyle}
            >
              <option value="">{t('cell.servicePlaceholder')}</option>
              {services.map((s) => (
                <option key={s.id} value={s.id} disabled={s.placeCount === 0}>
                  {s.name}{s.placeCount === 0 ? t('cell.noCellsSuffix') : ''}
                </option>
              ))}
            </select>
            <select
              aria-label={t('cell.cellAria')}
              value={placeId}
              disabled={!serviceId || placesLoading}
              onChange={(e) => setPlaceId(e.target.value)}
              style={selectStyle}
            >
              <option value="">
                {placesLoading ? t('cell.loading') : !serviceId ? t('cell.cellPlaceholder') : places.length === 0 ? t('cell.noCellsDefined') : t('cell.cellPlaceholder')}
              </option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.zone ? ` · ${p.zone}` : ''}
                  {!p.isActive ? t('cell.offlineSuffix') : p.outNow ? t('cell.outOfServiceSuffix') : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        {selectedPlace && (selectedPlace.outNow || !selectedPlace.isActive) ? (
          <p style={{ margin: '8px 0 0', color: OPS.warn, fontFamily: OPS.sans, fontSize: 12.5 }}>
            {selectedPlace.isActive
              ? t('cell.alreadyOutOfService', { place: selectedPlace.label })
              : t('cell.alreadyOffline', { place: selectedPlace.label })}
          </p>
        ) : null}
      </div>

      {/* Out-of-service window */}
      {canTakeOutOfService ? (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 12,
            border: `1px solid ${takeOut && placeId ? 'rgba(176,121,14,0.45)' : OPS.line}`,
            background: takeOut && placeId ? 'rgba(176,121,14,0.08)' : OPS.panel2,
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontFamily: OPS.sans, fontSize: 13.5, color: OPS.cream, fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={takeOut}
              onChange={(e) => setTakeOut(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: OPS.warn }}
            />
            {t('oos.toggle')}
          </label>
          {takeOut ? (
            !placeId ? (
              <p style={{ margin: '8px 0 0', color: OPS.warn, fontFamily: OPS.sans, fontSize: 12.5 }}>
                {t('oos.pickCellFirst')}
              </p>
            ) : (
              <div style={{ marginTop: 10 }}>
                <label style={labelStyle} htmlFor="ops-out-until">{t('oos.untilLabel')}</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input
                    id="ops-out-until"
                    type="datetime-local"
                    value={outUntil}
                    min={toLocalInput(new Date())}
                    onChange={(e) => setOutUntil(e.target.value)}
                    style={{ ...inputStyle, width: 220, colorScheme: 'light' }}
                  />
                  {OOS_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setOutUntil(toLocalInput(p.until()))}
                      style={{
                        height: 30, padding: '0 12px', borderRadius: 9, cursor: 'pointer',
                        background: OPS.panel2, border: `1px solid ${OPS.line}`, color: OPS.dim,
                        fontFamily: OPS.sans, fontSize: 12,
                      }}
                    >
                      {t(`oos.presets.${p.id}`)}
                    </button>
                  ))}
                </div>
                <p style={{ margin: '8px 0 0', color: OPS.dim, fontFamily: OPS.sans, fontSize: 12, lineHeight: 1.5 }}>
                  {t('oos.explainer', { place: selectedPlace?.label ?? t('oos.theCell') })}
                </p>
              </div>
            )
          ) : null}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: staff.length > 0 ? '1fr 1fr' : '1fr', gap: 12 }}>
        {staff.length > 0 ? (
          <div>
            <label style={labelStyle} htmlFor="ops-assignee">{t('fields.assignTo')}</label>
            <select id="ops-assignee" value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)} style={selectStyle}>
              <option value="">{t('fields.unassigned')}</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.role.toLowerCase().replace(/_/g, ' ')})
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div>
          <label style={labelStyle} htmlFor="ops-due">{t('fields.due')}</label>
          <input
            id="ops-due"
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            style={{ ...inputStyle, colorScheme: 'light' }}
          />
        </div>
      </div>

      {error ? (
        <div role="alert" style={{ color: OPS.bad, fontFamily: OPS.sans, fontSize: 13 }}>{error}</div>
      ) : null}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onClose} style={btn('ghost')}>{t('buttons.cancel')}</button>
        <button
          type="button"
          onClick={submit}
          disabled={submitDisabled}
          style={btn('gold', submitDisabled)}
        >
          {pending ? t('buttons.creating') : outActive ? t('buttons.createAndOutOfService') : t('buttons.create')}
        </button>
      </div>
    </div>
  );
}
