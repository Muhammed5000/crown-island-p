# Crown Island — Offline Sync (online‑master model)

Two deployments of the same codebase, told apart by **`APP_MODE`** (`online` | `local`;
unset ⇒ sync inert). Authenticated node‑to‑node with a sync secret (`x-sync-secret` header);
the local node reaches online via **`ONLINE_API_URL`**.

### Sync credentials — least privilege (SYNC-001)

The channel has two scopes. Set **distinct** secrets so a leaked read/pull credential
(which carries `passwordHash`/`pinHash` + PII) cannot authorize writes, and each rotates
independently:

- **`SYNC_READ_SECRET`** → online→local reads: `/api/sync/changes`, `/file`, `/file-stat`.
- **`SYNC_WRITE_SECRET`** → local→online writes: `/api/sync/apply`, `/upload-file`, `/reception-booking`.
- **`SYNC_DATA_SECRET`** → AES-256-GCM application-layer encryption for the `/changes` bundle.

Set the **same value on both nodes** per scope, but use a different value for READ and WRITE.
Production rejects the legacy shared **`SYNC_SECRET`** and fails closed if either scoped secret
is missing. Non-production keeps the shared value only as a short rollout aid. Rotate one scope
at a time by updating that scope on online and local together.

`SYNC_DATA_SECRET` must also match on both nodes, contain at least 32 characters, and differ from
the request-authentication secrets. A stolen read bearer token alone cannot decode the pull bundle.

## The model

**ONLINE is the single master** of all site data. **LOCAL is a full mirror** that pulls
everything down — rows **and image/file bytes** — and pushes back **only venue operations**.

```
 ONLINE  ──(pull: config, catalog, accounts, bookings, media rows + FILE BYTES)──▶  LOCAL
 ONLINE  ◀──(push: gate ops, reception bookings via commit-proxy, venue file uploads)──  LOCAL
```

- Catalog / services / settings / staff accounts are **edited on ONLINE**; the local shows them
  read‑only. The pull is a **hard mirror** — a catalog row online no longer has is deleted on local.
- **Staff log in on the local node**, so staff/gate roles sync the credential verifiers required
  for local authentication. Customer/partner password and PIN hashes are nulled before transfer.
  The entire bundle is additionally encrypted with `SYNC_DATA_SECRET`.
- **Reception bookings** are committed on ONLINE (the sole writer of bookings + capacity) via a
  proxy, then pulled back to local. **Gate operations** are pushed up via the outbox.

## What syncs, and which direction

| Entity / data | Direction | Mechanism |
|---|---|---|
| Settings, Category, Service, PriceRule, ServicePlace, PromoCode, RoleDiscountLimit | online → local | pull bundle (catalog is a hard‑mirror, incl. deletes) |
| User (staff + customers, **with credentials**), CustomerProfile, CategoryTermsAcceptance | online → local | pull bundle |
| Booking + BookingUnit, Invoice, InvoiceLine, RefundLine, Payment, Review, CancellationRequest, Sanction, VisitCode | online → local | pull bundle (booking‑centric subtree) |
| BookingSlot (per‑day confirmed‑capacity counters) | online → local | pull bundle (full recent+future set, upserted by the `(serviceId, date)` natural key) — the local reads the SAME counters online enforces so the reception/admin capacity views aren't empty |
| Media (file manifest) | online → local | pull bundle |
| **Uploaded FILE BYTES** (catalog images `/uploads/…`, guest‑ID photos + proofs `/api/secure-media/…`) | online → local | `file-sync.ts` downloads any file missing on local from `GET /api/sync/file` |
| `BookingLocalState`, `UnitPlacement` (gate/ZK/placement state) | local → online | outbox → `POST /api/sync/apply` |
| `GateScanEvent`, `WorkSession`, `OpsTicket`, `OpsTicketEvent`, `StaffNotification`, `GuestIdDocument`, `PlaceOutage`, `PlaceOutageLog`, `ZkCard` | local → online | outbox → `POST /api/sync/apply` |
| Reception booking (a new walk‑in) | local → online → local | desk proxies to `POST /api/sync/reception-booking` (commits on online), then pulled back |
| Guest‑ID / proof file uploaded at the venue | local → online → local | `pushFileToOnline` → `POST /api/sync/upload-file`, then mirrored back by file‑sync |

Everything **not** in the local→online rows is **online‑owned** and must never be pushed (the
outbox `PUSHABLE` allow‑list enforces this; `apply-core` rejects the rest).

## File storage & transport

- **Public** catalog media: `public/uploads/YYYY/MM/<hex>.<ext>` (served statically, URL `/uploads/…`).
- **Private** sensitive media: `private-uploads/YYYY/MM/<hex>.<ext>` (outside `public/`, served only by
  the auth‑gated `GET /api/secure-media/[...]`, URL `/api/secure-media/…`).
- Paths are stable and filenames content‑random. `resolveSensitiveUpload` maps either URL form to a
  disk path (with a strict‑shape traversal guard) and is reused by every file endpoint.
- The `Media` table is the manifest of every uploaded file (now with `sha256` + `sizeBytes`); the
  local sweep walks it and reconciles each file. External `https://` image URLs aren't files — they
  resolve from their own host on both.

### File integrity (verified transport + self‑healing repair)

Files no longer travel "fire‑and‑forget, existence‑addressed" — a present file is no longer *assumed*
correct. Invariants:

- **Verified transport.** Every byte transfer carries `sha256` + size and is verified before it is
  used: the push receiver (`POST /api/sync/upload-file`) checks `x-sync-size`/`x-sync-sha256` + image
  signature and returns **`400 integrity_mismatch`** (writing nothing) on any mismatch; the download
  path (`GET /api/sync/file` → local sweep) verifies the response headers + signature before promoting.
  Header‑less pushes from an OLD sender still get the image‑signature screen.
- **Atomic writes.** Both the receiver and the sweep write to a temp file then `rename` (see
  `atomic-write.ts`), so a reader never sees a half‑written file and a truncated transfer can't
  overwrite a good one.
- **Durable push, not fire‑and‑forget.** Venue uploads enqueue a `MediaFile` row on the SAME
  `SyncQueue` as the JSON lane, inheriting its retry / skip‑and‑continue / quarantine / recovery. The
  upload route also does one immediate verified push (fast path) so online holds the bytes before the
  reception commit references the URL.
- **Authority‑by‑prefix repair.** The sweep verifies BOTH directions: **public** `/uploads/**` files
  are online‑authored → local only *downloads* (missing / size‑drift); **secure**
  `/api/secure-media/**` files are venue‑authored → local probes online (`POST /api/sync/file-stat`)
  and *re‑pushes* when online is missing / a different size / signature‑broken. A corrupt LOCAL secure
  copy is re‑downloaded from online (whose copy may be intact). Counters land in `SyncState 'file:stats'`.
- **v1 detection scope:** missing, truncated (size drift), and mangled‑from‑byte‑0 (broken signature).
  A full‑content hash compare of every at‑rest file is deliberately omitted (cost) — so silent mid‑file
  bitrot with an intact head and unchanged length is out of scope for the sweep.

## Key files

```
src/server/sync/config.ts          appMode()/isLocal()/isOnline(), onlineApiUrl(), syncSecretOk()
src/server/sync/changes-core.ts    ONLINE: full changes bundle + authoritative catalog id-sets
src/server/sync/pull.ts            LOCAL: pullAll() upsert-in-FK-order + hard-mirror catalog deletes
src/server/sync/file-sync.ts       LOCAL: verify+repair sweep (download / re-push) off the Media manifest
src/server/sync/file-integrity-core.ts  PURE: sha256Hex, verifyFileIntegrity, planFileAction (unit-tested)
src/server/sync/atomic-write.ts    shared atomic temp+rename (receiver + sweep)
src/server/sync/push.ts            LOCAL: drainOutbox() FIFO → JSON /apply OR MediaFile → /upload-file
src/server/sync/push-file.ts       LOCAL: pushFileToOnline() — octet-stream + size/sha headers, verified
src/server/sync/outbox.ts          PUSHABLE (JSON lane) + MediaFile (file-bytes lane, NOT in PUSHABLE)
src/server/sync/apply-core.ts      ONLINE: idempotent upsert-by-id of pushed ops (rejects MediaFile)
src/server/sync/worker.ts          LOCAL tick: ping → pull → file-sweep → push; writes `sync:activity`, `file:stats`
src/app/api/sync/{changes,apply,status,reception-booking,file,upload-file,file-stat}/route.ts
src/components/providers/SyncStatusProvider.tsx + components/sync/SyncIndicator.tsx  visible status
```

## Rollout

1. Deploy this build to **both** nodes — **online FIRST** (the new receiver is lenient to old senders;
   a new local sender degrades safely against an old online: `file-stat` 404 → no re-push decisions,
   header‑less GET → signature‑only verify). Set `APP_MODE` (`online`/`local`), matching
   `SYNC_READ_SECRET`, `SYNC_WRITE_SECRET`, and `SYNC_DATA_SECRET` values on both nodes (all three
   secrets must differ),
   and `ONLINE_API_URL` (+ HTTPS) on local. **`APP_MODE=local` must be in the venue node's runtime
   env** — the indicator and the whole local role read it at request time.
   - **Reverse proxy:** allow a request body ≥ the 10 MB image cap — set nginx `client_max_body_size 12m`
     (its 1 MB default 413s every guest‑ID push). `maxDuration=30` on the sync routes is a
     serverless‑ism and inert on the Docker deployment.
2. Do all catalog / settings / staff / promo editing on the **online** admin.
3. On local, delete the `SyncState 'pull:bookings'` row once for a **full initial sync** (pulls all
   rows + downloads all files + hard‑mirrors the catalog).

## Verify (two‑node)

Edit a Service + upload a cover on online → row **and image** appear on local. Delete a Service on
online → it disappears on local. Create a staff account on online → it can log in on local. Make a
reception booking on local (incl. a manual‑discount PIN) → commits on online, pulls back, its
guest‑ID photo is on **both**. Watch the `SyncIndicator` cycle **pulling → pushing → synced**; cut
online → **offline** + reception blocked with a **distinct** message (not a fake "offline").

**File integrity:** after the guest‑ID photo is on both, `Get-FileHash` the file under each node's
`private-uploads/YYYY/MM/` — identical. Corrupt online's copy (overwrite the first bytes) → within a
walk cycle the local sweep re‑pushes it and the hashes match again (`file:stats.repushQueued` ticks,
`/api/sync/status.filePushPending` spikes → 0). Corrupt/delete local's copy → the sweep re‑downloads
it from online (`repaired`/`downloaded`).

## Limitations / notes

- **Credential sync**: `passwordHash`/`pinHash` travel online→local over the secret‑authed channel —
  use HTTPS; the local node is trusted on‑prem.
- **Catalog delete‑mirror** is FK‑safe/best‑effort: a Service/Category still tied to a local Booking
  is kept rather than force‑deleted. It (and the BookingSlot capacity mirror) rides the `sets`
  cadence — every `SYNC_SETS_INTERVAL_MS` (default 5 min) rather than every 20s tick, so those
  advisory views can be up to a few minutes stale on local (bookings still commit on online, where
  capacity is actually enforced).
- **First full sync** downloads every file — can be large; it runs in the background and is resumable
  (idempotent; each download is verified against the manifest's `sha256`/size before it's promoted).
- Local editing of online‑owned data is now **refused loudly** instead of silently reverting:
  mutations for catalog / places / settings / promos / tags / user‑blocking throw `online_owned` on
  the local node (`src/server/sync/node-guard.ts`) with a "manage it on the online master" message.
  **Known exception:** `adminSetPlaceActive` (place online/offline flip) stays allowed on local —
  the venue ops flow itself flips `ServicePlace.isActive` during outage handling — so that one field
  is mixed‑ownership: a local flip is overwritten by the next pull while the pushed
  `PlaceOutage`/`PlaceOutageLog` history stays truthful. Follow‑up: model place availability as
  local‑owned state if venue‑side flips need to survive the mirror.
- **Resurrection‑after‑delete (A‑09) is closed at the source**: enqueueing a `delete` marks that
  entity's queued (pending/failed) upserts `superseded`, so a re‑armed stale snapshot can no longer
  re‑create a row online after its delete applied. No tombstone table needed — the drain is
  sequential in one process and cuids are never re‑used.
- **Poison pushes dead‑letter**: a row that keeps failing is quarantined after 5 attempts, re‑armed
  by recovery up to 6 times (~35 sends over ~an hour), then buried as `status='dead'` — surfaced via
  `/api/sync/status` (`failedCount`/`deadCount`) for manual triage; finished rows are pruned after
  `SYNC_QUEUE_RETENTION_DAYS` (14d; dead rows 4×).
- **Sanction conflict rule** (the one bidirectional model): a settlement always beats an unsettled
  row on apply — never cross‑host clock LWW — and the pull parks an incoming ACTIVE copy while a
  local settlement push is still queued (`sanction-merge-core.ts`), so venue clock skew can't drop a
  settlement.
