# Crown Island — Observability (OBS-001)

Production currently emits ad-hoc `console.*` with no structure, no error
aggregation, and no alerting, so incidents and stuck money can go unnoticed. This
is the plan; the code seed is `src/lib/log.ts` (structured, redacting logger).

## 1. Structured logs (seed shipped)

`src/lib/log.ts` emits one JSON line per event and masks sensitive fields. Adopt
incrementally — replace `console.error('x', err)` with `log.error('x', errFields(err))`.
Start with the money/sync paths (payment reconciler, sync push/pull, refunds).

## 2. Error aggregation + tracing (to wire)

Add Sentry (or OpenTelemetry) and forward from the single `emit` seam in
`src/lib/log.ts`. Initialize in `src/instrumentation.ts` (already the boot hook).
Keep the redaction — never send raw PII/secrets to a third-party sink.

## 3. Business metrics + alerts (the point of all this)

Alert on the conditions that mean money or operations are silently broken:

| Alert | Signal (already in the code) |
|---|---|
| Captured-but-unconfirmed payments aging | `flagAgedOutPayments()` / `Payment` stuck `PENDING` past the reconcile window |
| Stuck refunds | `sweepStuckRefundPending()` leaving `REFUND_PENDING` rows |
| Sync dead-letters | `SyncQueue` rows with `status='dead'` |
| Scheduler freshness | `/api/health` `staleSchedulers` / `status: "degraded"` (REL-001 heartbeats) |
| Fatal process exit | `/api/health` `fatal: true` → 503 (REL-001) |

Point an uptime monitor at `/api/health` and alert on `status !== "ok"` — the probe
now surfaces a wedged reconciler instead of masking it.

## 4. Follow-up

Retrofit the remaining `console.*` call sites to `log.*`, add request/trace ids,
and dashboard the metrics above. Tracked under OBS-001.
