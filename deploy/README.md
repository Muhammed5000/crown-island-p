# Deploying Crown Island on a bare VPS (no Docker)

How the two background jobs — **scheduled-notification dispatch** and **MPGS
(Crédit Agricole) payment reconciliation** — run in production, and what (if
anything) you must set up.

## TL;DR — single app process (PM2 / `node server.js` on one VPS)

**Nothing to install.** Both jobs run *in-process* the moment the app boots
(`src/instrumentation.ts`):

| Job | Cadence | Disable with |
|---|---|---|
| Scheduled notifications | every 60s | `NOTIF_SCHEDULER=off` |
| MPGS payment reconciler | every 2m | `PAYMENT_RECONCILER=off` |

The reconciler is a **money-safety net**: it re-checks Crédit Agricole payments
stuck `PENDING`/`FAILED` (customer paid but the browser never returned — tab
closed mid-redirect, network drop) against the gateway's authoritative
`RETRIEVE_ORDER`, then confirms the booking — or auto-refunds a capture that can
never confirm. Without it, such payments would orphan: money taken, no booking.
It is **always on** (unless disabled) and **self-heals** — each tick re-checks
MPGS config, so enabling MPGS after boot needs no restart.

Look for this line in the app log after boot:

```
[notifications] in-process scheduler started (every 60s)
[payments] in-process MPGS reconciler started (every 2m; no-op while MPGS is unconfigured)
```

## Required for card payments — MPGS webhook

**Any production deployment taking real cards MUST configure this.** In the
gateway's Merchant Administration (Webhook Notifications), set the URL to
`https://<domain>/api/credit-agricole/webhook` and copy the generated
notification secret into `MPGS_WEBHOOK_SECRET`. This is the **primary**
confirmation path — it confirms a captured payment within **seconds**,
independent of the browser. The in-process reconciler above is the **backstop**
(minutes-scale) for anything the webhook misses. Ensure inbound HTTPS POST to
that path reaches the app. If MPGS is configured but the secret is unset, the
app logs an `[env] WARNING` at boot that the instant confirm is OFF, and the
webhook endpoint answers 503.

## Recommended extras (defense-in-depth)

1. **External cron pinger** — required only when running **multiple app
   instances** with the in-process schedulers disabled; otherwise optional
   redundancy. Both endpoints are idempotent, so overlap with the in-process
   schedulers is harmless.

### Option A: systemd timer (survives reboots, logged in journald)

```sh
sudo mkdir -p /etc/crown-island
sudo cp deploy/cron.env.example /etc/crown-island/cron.env
sudo nano /etc/crown-island/cron.env          # set APP_URL + CRON_SECRET
sudo chmod 600 /etc/crown-island/cron.env
sudo cp deploy/crown-cron.service deploy/crown-cron.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now crown-cron.timer
```

Verify: `systemctl list-timers crown-cron.timer` and
`journalctl -u crown-cron.service -n 20`.

### Option B: plain crontab

```cron
* * * * * curl -fsS -m 30 -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" https://your-domain.com/api/cron/notifications >/dev/null 2>&1
* * * * * curl -fsS -m 60 -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" https://your-domain.com/api/cron/reconcile-payments >/dev/null 2>&1
```

Either way, `CRON_SECRET` must be set to the **same value** in the app's
environment and in the caller — the endpoints refuse to run (401) otherwise, and
refuse entirely (401 with no secret configured) while `CRON_SECRET` is unset.

## Health check

`POST /api/cron/reconcile-payments` (with the bearer secret) returns
`{ ok, scanned, confirmed, failed, refunded, stillPending }` — a quick way to
confirm the sweep runs and to see whether it is rescuing anything. The
in-process reconciler logs the same summary line whenever a sweep finds work:

```
[payments] reconcile sweep: scanned=2 confirmed=1 refunded=1 failed=0 stillPending=0
```
