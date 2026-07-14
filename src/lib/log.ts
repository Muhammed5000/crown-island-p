/**
 * Minimal structured, redacting logger (OBS-001).
 *
 * The codebase logs with bare `console.*`, which gives production no structure to
 * query and risks leaking secrets/PII into logs. This emits ONE JSON object per
 * line ({ ts, level, msg, ...fields }) that a log pipeline can parse, and scrubs
 * obviously-sensitive fields before they are written.
 *
 * It is intentionally dependency-free and console-backed so it can be adopted
 * incrementally (replace a `console.error(...)` with `log.error(...)`). The
 * external sink — Sentry / OpenTelemetry / a hosted log service — plugs in at the
 * single `emit` seam below; see docs/OBSERVABILITY.md for the rollout + the alert
 * conditions (payment/refund age, sync dead-letters, scheduler freshness).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

/** Field names whose VALUES are always masked, matched case-insensitively as a substring. */
const SENSITIVE_KEY = /pass|secret|token|authorization|cookie|pin|otp|card|cvv|ssn|nationalid|passport/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): LogLevel {
  const env = process.env.LOG_LEVEL as LogLevel | undefined;
  if (env && env in LEVEL_RANK) return env;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

function emit(level: LogLevel, msg: string, fields?: LogFields): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel()]) return;
  // Date.now() only — no `new Date()` string formatting here so this stays cheap.
  const record = { ts: new Date(Date.now()).toISOString(), level, msg, ...(fields ? (redact(fields) as LogFields) : {}) };
  const line = safeStringify(record);
  // Single sink seam: swap/extend this to also forward to Sentry/OTel/a log drain.
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function safeStringify(record: unknown): string {
  try {
    return JSON.stringify(record);
  } catch {
    return JSON.stringify({ ts: new Date(Date.now()).toISOString(), level: 'error', msg: 'log_serialize_failed' });
  }
}

/** Normalize a thrown value into loggable, non-leaky fields. */
export function errFields(err: unknown): LogFields {
  if (err instanceof Error) return { err: err.message, name: err.name };
  return { err: String(err) };
}

export const log = {
  debug: (msg: string, fields?: LogFields) => emit('debug', msg, fields),
  info: (msg: string, fields?: LogFields) => emit('info', msg, fields),
  warn: (msg: string, fields?: LogFields) => emit('warn', msg, fields),
  error: (msg: string, fields?: LogFields) => emit('error', msg, fields),
};
