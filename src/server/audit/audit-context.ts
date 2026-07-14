import 'server-only';
import { prisma } from '@/server/db/prisma';

/**
 * Resolve audit rows to a human-readable business context — which CATEGORY and
 * which SERVICE (and a short entity label) each change touched — so the log
 * reads "Service · Freska Beach (Beaches)" instead of a bare `cuid`.
 *
 * Entity ids are opaque cuids; this batch-loads the friendly names for the entity
 * types where category/service is meaningful (Category, Service, PriceRule,
 * ServicePlace, PlaceOutage, Booking). One `findMany` per type keeps it O(types),
 * not O(rows) — safe for both the 20-row viewer and the capped export.
 *
 * For a DELETE (the row no longer exists) it falls back to the name/label/
 * reference captured in the audit's own before/after snapshot.
 */

export interface AuditContext {
  category: string | null;
  service: string | null;
  /** Short entity label: place label / booking reference / promo code / name. */
  label: string | null;
}

const EMPTY: AuditContext = { category: null, service: null, label: null };

interface AuditEntry {
  id: string;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pickString(obj: Record<string, unknown> | null, key: string): string | null {
  return obj && typeof obj[key] === 'string' ? (obj[key] as string) : null;
}

/** Best-effort entity name from the snapshot (used when the row was deleted). */
function labelFromSnapshot(before: unknown, after: unknown): string | null {
  const a = asObj(after);
  const b = asObj(before);
  for (const key of ['nameEn', 'name', 'label', 'reference', 'code']) {
    const v = pickString(a, key) ?? pickString(b, key);
    if (v) return v;
  }
  return null;
}

export async function resolveAuditContext(
  entries: AuditEntry[],
  locale: 'ar' | 'en',
): Promise<Map<string, AuditContext>> {
  const ar = locale === 'ar';
  const nm = (o: { nameEn: string; nameAr: string } | null | undefined): string | null =>
    o ? (ar ? o.nameAr : o.nameEn) : null;
  type SvcShape = { nameEn: string; nameAr: string; category: { nameEn: string; nameAr: string } } | null | undefined;
  const svcCtx = (s: SvcShape): AuditContext =>
    s ? { category: nm(s.category), service: nm(s), label: nm(s) } : { ...EMPTY };

  const idsByType = new Map<string, Set<string>>();
  for (const e of entries) {
    if (!e.entityId) continue;
    let set = idsByType.get(e.entityType);
    if (!set) {
      set = new Set();
      idsByType.set(e.entityType, set);
    }
    set.add(e.entityId);
  }
  const ids = (t: string): string[] => Array.from(idsByType.get(t) ?? []);

  const catSel = { nameEn: true, nameAr: true } as const;
  const svcSel = { nameEn: true, nameAr: true, category: { select: catSel } } as const;

  const [cats, svcs, rules, places, outages, bookings] = await Promise.all([
    ids('Category').length ? prisma.category.findMany({ where: { id: { in: ids('Category') } }, select: { id: true, ...catSel } }) : [],
    ids('Service').length ? prisma.service.findMany({ where: { id: { in: ids('Service') } }, select: { id: true, ...svcSel } }) : [],
    ids('PriceRule').length ? prisma.priceRule.findMany({ where: { id: { in: ids('PriceRule') } }, select: { id: true, service: { select: svcSel } } }) : [],
    ids('ServicePlace').length ? prisma.servicePlace.findMany({ where: { id: { in: ids('ServicePlace') } }, select: { id: true, label: true, service: { select: svcSel } } }) : [],
    ids('PlaceOutage').length ? prisma.placeOutage.findMany({ where: { id: { in: ids('PlaceOutage') } }, select: { id: true, place: { select: { label: true, service: { select: svcSel } } } } }) : [],
    ids('Booking').length ? prisma.booking.findMany({ where: { id: { in: ids('Booking') } }, select: { id: true, reference: true, service: { select: svcSel } } }) : [],
  ]);

  // key = `${entityType}:${entityId}` → context.
  const found = new Map<string, AuditContext>();
  for (const c of cats) found.set(`Category:${c.id}`, { category: nm(c), service: null, label: nm(c) });
  for (const s of svcs) found.set(`Service:${s.id}`, svcCtx(s));
  for (const r of rules) found.set(`PriceRule:${r.id}`, svcCtx(r.service));
  for (const p of places) found.set(`ServicePlace:${p.id}`, { ...svcCtx(p.service), label: p.label });
  for (const o of outages) found.set(`PlaceOutage:${o.id}`, { ...svcCtx(o.place?.service), label: o.place?.label ?? null });
  for (const b of bookings) found.set(`Booking:${b.id}`, { ...svcCtx(b.service), label: b.reference });

  const out = new Map<string, AuditContext>();
  for (const e of entries) {
    const hit = e.entityId ? found.get(`${e.entityType}:${e.entityId}`) : undefined;
    if (hit) {
      out.set(e.id, hit);
    } else {
      // Deleted / unmapped entity — surface whatever name the snapshot kept.
      out.set(e.id, { category: null, service: null, label: labelFromSnapshot(e.before, e.after) });
    }
  }
  return out;
}
