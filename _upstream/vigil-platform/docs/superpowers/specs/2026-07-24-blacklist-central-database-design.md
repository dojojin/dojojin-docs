# Multi-Source Blacklist Database — Design Spec

> Role: `GUIDE_` design spec · Created 2026-07-24 · Owner: Prakasit (Dojo-mAn)
> Status: **B0 + B1 + B2 SHIPPED to prod 2026-07-26** (migration 093/094 applied;
> GuruSquare 1,080 LPR + DSS Pro 957 face / 516 LPR imported; two dashboard pages live;
> overrides + discovery + double-gated push-back done). **B3 (LPR bridge) planned, not
> started** — แผนเต็ม + ข้อเท็จจริงที่ตรวจแล้ว: `docs/superpowers/plans/2026-07-26-b3-lpr-watchlist-bridge.md`
> (แก้ข้อกังวล "LINE จะท่วม" ใน §4.4 — ตรวจแล้วไม่จริง ยังไม่มี sender ต่อกับ watchlist).
> Face-matching, export/expose-own-API, and Edge relay remain gated/deferred (§6).
> Sibling doc: `docs/superpowers/specs/2026-06-23-hcp-pull-integration-design.md` — this spec
> picks up its deferred "roster mirror" item and generalizes it to multiple sources.

---

## 1. Goal & Principle

Import blacklist rosters (face + LPR) from multiple external systems — **GuruSquare**,
**HikCentral Professional (HCP) — Site Phuket**, future HCP sites — into a **central,
deduplicated master reservoir**. Each source's data is kept in its own bucket as-imported
(no data loss, no cross-source overwrite); a separate **master** layer merges records that
are the same real person (matched on national ID / passport) while preserving each
source's own case association.

**This is a data reservoir, not an alert engine.** `blacklist.*` does not fire alerts by
itself. LPR alerting continues to run through the existing `lpr_watchlist` table
(§4.4, F3 LINE path) via a one-way bridge. Face alerting is gated entirely (§6.2) —
the platform has no way to make a camera *match* a face today.

**Ponytail guardrails:**
- Central-only PII. No blacklist data — raw bucket or master — is replicated to Edge.
  Edge involvement, if it happens later, is scoped to non-PII match-sets or a stateless
  export proxy (§6.3/§6.4) — separate, deferred capability, not part of this build.
- Same Postgres instance/database as everything else (`vigil_platform`) — dedicated
  `blacklist` schema + locked-down role, not a second DB instance (§3, rationale below).
- One import pipeline per source, reusing the poller-process convention from the HCP
  spec (separate PM2 process, crash isolation) — no generic "connector framework" until
  a 3rd source proves the shape repeats.
- One export implementation (when built), N ingress points (direct + optional Edge
  relay) — never duplicate export/authorization logic.

---

## 2. Current-state facts (verified against code, 2026-07-24)

- **No person/identity table exists anywhere in the schema.** `events`/`appearances`
  store per-event detections, not identities. `license_plates` is per-event too.
- **`lpr_watchlist`** (migration 050/051) is **plate-keyed only** (`plate_number` PK,
  `label`, `group_id`, `notify_line`) — no national-ID concept, no `origin`/source
  marker column. It already drives the F3 LINE-alert path (`src/api-server.js:889-899`,
  5-min in-memory cache `_lprWatchSet`, matched against the `new_event` broadcast).
- **Watchlist matching today is 100% central.** Edge (`lpr-receiver.js`) has zero
  matching logic — it only forwards raw events. Any "Edge does matching" capability
  would be new, not a data-copy of existing logic.
- **Face-match "hit" happens on-camera (Hikvision FDLib), not on the platform.**
  Grepped every `FDLib`/`enroll` reference in `src/` — all of them **read** a match
  result already decided by the camera (`fdLibName`, `personName`, `similarity` off
  the incoming alarm JSON). There is **no code that writes/enrolls a face into a
  camera's FDLib**. Confirms the standing memory note (Face redesign: "watchlist tab
  dropped — face read-only platform-side").
- **Prior art for scoped external access already exists and works**:
  `docs/REF_third-party-integration.md` — dedicated Postgres role + `v_*_public` views
  + `pg_hba` restriction, same server, same database. This is the template §3 follows.
- **Encryption precedent**: `src/crypto-creds.js` — AES-256-GCM, format
  `enc:v1:<base64(iv||tag||ciphertext)>`, key from a single env var
  (`CAMERA_SECRET_KEY`). The *algorithm/format* is reused here; the *key* is not
  (§4.2) — a camera-key leak must not double as a blacklist-PII leak.
- **`audit_log`** (`src/api-server.js` / `db/init.sql:381`) already has a free-text
  `action VARCHAR(50)` + `details JSONB` — no schema change needed to route blacklist
  events through it, just new `action` values.
- Next free migration number: **093**.

---

## 3. Database placement — same instance, dedicated schema (not a separate DB)

**Decision: `blacklist` schema inside the existing `vigil_platform` database**, not a
second database instance.

Reasoning (this is the part worth restating precisely, since it's easy to conflate):
logical separation (schema vs. flat tables) by itself provides close to **zero** runtime
security — if the app connects with one broadly-granted role, a schema boundary isolates
nothing. The actual security comes from three things, all achievable within the existing
DB:
1. A **dedicated Postgres role** (`blacklist_svc` or similar) with GRANTs scoped only to
   `blacklist.*` — mirrors the `v_*_public` / third-party-integration pattern already in
   production.
2. **Column-level encryption** for PII (§4.2).
3. **Audit logging** on every read/write that touches `blacklist.*`.

A fully separate database instance would add exactly one guarantee beyond the above: the
main application's own role becomes *physically incapable* of reaching the PII even under
a GRANT misconfiguration. That's a real, stronger guarantee — but it's only worth the
added ops burden (second connection pool, independent backup/retention schedule, its own
migration path) if there's a **specific compliance driver**: data-residency requirement,
an independently-audited backup/retention SLA, or a mandate for separate hardware.

**This spec proceeds on the assumption no such regulatory driver exists today.** If one
surfaces later, the schema-first design doesn't block a later split — a schema can be
migrated to its own database without changing any table shape, only the connection
target. Revisit if a driver appears; don't build against it speculatively.

---

## 4. Data model (migration 093)

### 4.1 Three-layer shape

```
blacklist.sources          -- registry: gurusquare / hcp_phuket / hcp_<future-site>
blacklist.source_records   -- per-source raw mirror, 1:1 with what the source reports
blacklist.master           -- our canonical identity (the "reservoir")
blacklist.master_links     -- join: which source_records compose one master identity
```

> **2026-07-25 update:** the settings live demo (`/others/demo/blacklist/settings/`) now
> realizes `blacklist.sources` as an instance-based add/edit list (camera-settings
> pattern) rather than one card per source *type* — same type can have N instances
> (e.g. `dss_pro` at Site HDY and Site Pattani are two separate `sources` rows), each
> instance independently toggles which `types` it actually feeds (Face/LPR) within its
> type's capability ceiling. Also live-verified: Dahua NVR's LPR side
> (`recordFinder.cgi?action=find&name=TrafficBlackList`) requires the
> `condition.StartTime`/`condition.EndTime` param prefix (bare names → HTTP 400) —
> confirmed against 20 real ANPR cameras, all return `found=0` (table exists, never
> provisioned fleet-wide). Added `hikvision_nvr` as an 8th source type (Face+LPR via
> ISAPI) — design-only placeholder, not wired.

### 4.2 DDL sketch

```sql
CREATE SCHEMA IF NOT EXISTS blacklist;

CREATE TABLE IF NOT EXISTS blacklist.sources (
  id          TEXT PRIMARY KEY,            -- 'gurusquare' | 'hcp_phuket' | ...
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,                -- 'openapi_pull' | 'manual_upload' (future)
  config      JSONB DEFAULT '{}'::jsonb,     -- endpoint/cursor; secrets via enc:v1:
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blacklist.source_records (
  id            BIGSERIAL PRIMARY KEY,
  source_id     TEXT NOT NULL REFERENCES blacklist.sources(id),
  external_id   TEXT NOT NULL,               -- the source's own record id (idempotency key)
  id_type       TEXT,                        -- 'national_id' | 'passport' | NULL
  id_country    TEXT,                        -- required when id_type = 'passport'
  id_number_enc TEXT,                        -- enc:v1: encrypted display value
  id_hash       TEXT,                        -- HMAC-SHA256(normalized id) — match key
  name          TEXT,
  case_ref      TEXT,                        -- this source's case/file reference
  case_note     TEXT,
  photo_path    TEXT,
  plate_numbers TEXT[],                      -- raw plates as reported by this source
  raw_json      JSONB,
  imported_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_bl_source_records_hash ON blacklist.source_records(id_hash);

CREATE TABLE IF NOT EXISTS blacklist.master (
  id            BIGSERIAL PRIMARY KEY,
  id_hash       TEXT,                        -- HMAC match key; NULL allowed (no-ID identities)
  id_type       TEXT,
  id_country    TEXT,
  id_number_enc TEXT,
  display_name  TEXT,
  photo_path    TEXT,                        -- source-precedence pick (§5.2)
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Multiple NULLs coexist under a UNIQUE index in Postgres — exactly what "several
-- no-ID identities, each their own master, none auto-deduped" needs.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bl_master_hash ON blacklist.master(id_hash) WHERE id_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS blacklist.master_links (
  id                BIGSERIAL PRIMARY KEY,
  master_id         BIGINT NOT NULL REFERENCES blacklist.master(id) ON DELETE CASCADE,
  source_record_id  BIGINT NOT NULL REFERENCES blacklist.source_records(id) ON DELETE CASCADE,
  linked_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (master_id, source_record_id)
);
```

`case_ref` lives on `source_records`, not on `master_links` — each source record already
*is* one person↔case association from one source. The "same person, two different cases"
scenario (GuruSquare case #1 + HCP case #2 for the same national ID) resolves as: **one
master row, two source_records, two links** — both cases visible under the one identity,
nothing concatenated or overwritten. The link table is only the join; it carries no case
data of its own.

Singular-attribute conflicts (name spelling, DOB, photo — things that should have exactly
one true value) resolve via **source precedence order** (configured per deployment, e.g.
"HCP wins over GuruSquare on name spelling") while every raw value stays intact in
`source_records`. Manual override UI is Phase 2, not this build.

### 4.3 Key management

- **New env var `BLACKLIST_SECRET_KEY`**, separate from `CAMERA_SECRET_KEY`. Reuse the
  `enc:v1:` algorithm/format from `crypto-creds.js` (extract the AES-256-GCM helpers into
  a shared function taking the key as a parameter, or a thin sibling module) — but never
  the same key. A leaked camera key must not double as a blacklist-PII leak, and vice versa.
- Match key = `HMAC-SHA256(BLACKLIST_SECRET_KEY, normalize(id_number))`, stored as
  `id_hash`. Normalization: strip whitespace/dashes, uppercase. Passport keys as
  `(country, passport_no)` — a passport number alone is not globally unique.
- No-ID identities (name + face, no clean national ID/passport) get `id_hash = NULL` and
  become their own `master` row — no auto-dedup for these in v1. Fuzzy/typo matching is a
  known ceiling, logged here, not solved.

### 4.4 Bridge: `blacklist.master` → `lpr_watchlist` (the only thing that alerts)

`lpr_watchlist` needs one new column to make this safe:

```sql
ALTER TABLE lpr_watchlist
  ADD COLUMN IF NOT EXISTS origin             TEXT NOT NULL DEFAULT 'manual', -- 'manual' | 'blacklist_bridge'
  ADD COLUMN IF NOT EXISTS blacklist_master_id BIGINT;                        -- set when origin='blacklist_bridge'
```

Periodic sync job (own PM2 process or a scheduled task alongside existing retention jobs):
- For every active `blacklist.master` row with ≥1 linked `source_records.plate_numbers`,
  upsert into `lpr_watchlist` with `origin='blacklist_bridge'`, `blacklist_master_id` set,
  `label` composed from source name(s) + case_ref(s).
- **Must also remove**: any `lpr_watchlist` row with `origin='blacklist_bridge'` whose
  `blacklist_master_id` no longer has an active master/plate — else a person removed
  upstream leaves a stale alert forever. The `origin` column is what makes this safe:
  the bridge only ever touches rows it created, never a row an operator added by hand.
- Not an FK-backed relationship (person-keyed master vs. plate-keyed watchlist can't be
  one) — this is a periodic idempotent sync regardless of DB placement (§3).

### 4.5 Audit

Every import, link creation, and bridge sync writes an `audit_log` row: new `action`
values (`blacklist_import`, `blacklist_link_create`, `blacklist_bridge_sync`), `details`
JSONB carrying `source_id` / `master_id` / row counts. No schema change to `audit_log`
needed.

---

## 5. Import pipeline (per source)

Matches the HCP-spec convention (`src/hcp-client.js` / `src/hcp-poller.js` pattern):
one process per source (or one process, multiple source loops — decide at implementation
time based on how many sources are actually live), each normalizing that source's API
response into a `source_records` row, then running the dedup/link step against `master`.

- **GuruSquare**: API shape unknown — needs its own investigation pass (auth scheme,
  endpoints, pagination) before H0-equivalent work starts, same as HCP was gated on
  AppKey/gateway details.
- **HCP (Phuket, future sites)**: reuses `src/helpers/hcp-sign.js` / `src/hcp-client.js`
  from the sibling spec once built — this spec's roster pull is the same "H2 roster
  mirror" item that spec deferred, just generalized to more than one source from the start.

Both are **import-only or client-side** work — buildable without new legal/authorization
gates, unlike export (§6.1).

---

## 6. Explicitly gated / deferred (not this build)

### 6.1 Export / push-back to sources ("diff to GuruSquare/HCP")
Blocked on two things, independent of any technical readiness:
- **Legal authorization** — moving one organization's case data into another's system of
  record is a legal question (does authority exist for this redistribution?), not an
  engineering one. Needs explicit owner confirmation before any push-back code is written.
- **Write API availability per source** — HCP has a write API (`person/single/add`, etc.)
  gated on a write-scoped AppKey (already noted in the sibling spec); GuruSquare's write
  capability is entirely unknown.

### 6.2 Face blacklist matching
The reservoir can hold face-blacklist identities (photo + case) same as LPR, but nothing
will *match* against a live camera feed until the platform can enroll a face into a
camera's FDLib — a capability that does not exist today (§2) and is a materially bigger
gate than the LPR bridge (new ISAPI/RCP+ write path, per-vendor). Treat as a separate,
later proposal — don't budget it as equal effort to the LPR half in Phase 1.

### 6.3 Own OpenAPI surface (exposing our data to external pullers)
"รับเข้าและส่งออก" implies we may also be a *server*, not just a client. This is the
highest-risk surface in the whole design — exposing case-level PII via our own API to
external consumers. Same legal-authorization gate as §6.1, plus its own auth/PII-exposure
design pass (per-consumer API key, scoped views, audit — likely another `v_*_public`-style
layer, this time write-protected). Not started until §6.1's gate clears.

### 6.4 Edge as an export relay for local government agencies
Exporting a diff is PII leaving the system **regardless of the network path** — a direct
Central→agency export and a Central→Edge→agency relay carry identical risk. So this is a
**networking-convenience** question, not a security one, and doesn't need solving now
(the owner's own framing was "maybe," i.e. speculative). If a concrete local-agency
requirement appears later: build it as a **stateless proxy** on Edge (no local blacklist
copy — consistent with §1/§3) forwarding to the single Central export endpoint from §6.1/
§6.3 — one implementation, this becomes a second ingress point, not a second
implementation. When built, an Edge endpoint accepting *inbound* queries from an external
network is a new attack surface — per-agency auth token + audit becomes the load-bearing
control (security checklist, `docs/REF_security-checklist.md`).

---

## 7. Phases

| Phase | Scope | Gate |
|---|---|---|
| **B0** foundation | `blacklist` schema + role + migration 093 · `BLACKLIST_SECRET_KEY` + HMAC/enc helpers (+ self-test, security path) · `blacklist.sources` seeded (gurusquare, hcp_phuket) | none — buildable now |
| **B1** GuruSquare import | API investigation (auth/endpoints/pagination — unknown today) · importer process · `source_records` populate · dedup into `master` | GuruSquare API access/docs |
| **B2** HCP roster import | Reuse `hcp-client.js`/`hcp-sign.js` from sibling spec · roster pull → `source_records` → `master` | sibling spec's H0/H1 done + AppKey with roster-read scope |
| **B3** LPR bridge | `lpr_watchlist.origin`/`blacklist_master_id` columns · sync job (add + remove) · audit wiring | B1 or B2 done (whichever source has plates) |
| ~~Face matching~~ | **DEFERRED** — camera FDLib enroll capability (§6.2) | new capability, separate proposal |
| ~~Export/push-back~~ | **DEFERRED** — legal authorization (§6.1) | owner confirmation |
| ~~Own OpenAPI surface~~ | **DEFERRED** — same legal gate + new auth/PII design (§6.3) | owner confirmation |
| ~~Edge export relay~~ | **DEFERRED** — build only if a concrete local-agency need appears (§6.4) | concrete requirement |

---

## 7b. What actually shipped (2026-07-25)

**B0 — foundation.** `db/db_migration_093_blacklist_schema.sql` applied to prod. Deviation
from §4.2: `blacklist.sources.id` is `BIGSERIAL`, not `TEXT` — required by the instance-based
redesign (one row per *connection*, so `dss_pro` can exist twice for two sites). Added
`data_type` to `source_records` so the two dashboard pages filter cheaply, and a
`UNIQUE(source_record_id)` index on `master_links` so a re-import re-uses the existing master
instead of minting a duplicate. `src/helpers/blacklist-crypto.js` carries the enc/HMAC helpers
under `BLACKLIST_SECRET_KEY` + a `node`-runnable self-check (round-trip, ID normalization,
passport country scoping, tamper detection, wrong-key rejection, missing-key refusal).
Unlike `crypto-creds.js` it **throws** rather than degrading to plaintext — silently writing an
unencrypted national ID is the exact failure this module exists to prevent.

**B1 — GuruSquare import (real data).** 1,080 records imported live, 0 errors, ~62 s.
Two things the spec could not have known, both found by measuring rather than assuming:
- The whole roster in one response is **376 MB** (~349 KB/record — every record carries a
  full-res car photo). Import therefore walks **calendar-month windows**, and the edge
  **downscales each photo to 800px/q75 before it crosses the tunnel** (same trick as
  `lpr-core.resizeScene`). On-disk result: 1,060 photos / 67 MB.
- The 30-day probe window used during design showed only 55 records and read as "the whole
  list". It was not — it was one month of a 34-month range.

Dedup outcome, as designed: GuruSquare carries **no national ID**, so every record gets
`id_hash = NULL` and becomes its own master (1,080 records → 1,080 masters, 1:1). No
name-based fuzzy merging — merging different people who share a name is worse than leaving
two rows a human can merge later. Cross-source dedup only starts paying off when a
source that *does* carry IDs (DSS Pro) is imported.

**Pages.** `ฐานข้อมูลใบหน้า` + `ฐานข้อมูลป้ายทะเบียน` in the sidebar directly after
`ป้ายทะเบียน`; one renderer (`dashboard/page-blacklist.js`) serves both, differing only by
`data_type`. Settings › `นำเข้าข้อมูล Blacklist` is the instance-based connection CRUD.

**Access posture as shipped** — `requireAdminForWrites('/api/blacklist')` gates every write
(create/edit/delete/import/test → 403 for non-admin, verified). **Reads are open to any
authenticated user**, matching how the existing LPR/Face pages already expose PII. Given this
roster includes police wanted-persons records, whether read should be narrowed to admin is a
**policy decision left open for the owner** — see §8.4.

## 8. Open items to confirm before B0 starts

1. Confirm no regulatory driver requires a physically separate database instance (§3) —
   proceeding on "no" by default.
2. GuruSquare API access — docs/credentials not yet in hand (mirrors the HCP gate pattern).
3. Source-precedence order for conflicting singular attributes (§4.2) — needs an actual
   ranking once ≥2 sources are live to conflict.
4. **Read access to the reservoir (raised by the shipped build, 2026-07-25).** Writes are
   admin-only; reads currently follow the existing dashboard posture (any authenticated
   user). Narrowing reads to admin is a one-line change (`admin-only` class on the two nav
   items + a read gate on `/api/blacklist`). Needs an owner decision, not an engineering one.
5. ~~**Import scheduling.**~~ **ปิดแล้ว 2026-07-31 (migration 107).** ตั้งรอบต่อแหล่งได้เอง
   (`pull_interval_hours` — ปิด / 6 / 12 / 24 / 48 ชม.) default = 0 คือปิด ไม่มีอะไรเริ่มรันเอง
   เพราะ migration รัน. scheduler เป็น `setInterval` 5 นาทีใน api-server (pm2 fork เดียว →
   ไม่ต้องมี leader election) และใช้ starter ตัวเดียวกับปุ่ม "นำเข้าเลย" เพื่อให้ interlock
   `_importRunning` เป็นชุดเดียว.

---

## 9. Auto-sync — pull และ push (2026-07-31, migration 107)

### 9.1 Pull (นำเข้าอัตโนมัติ)

| คอลัมน์ | ความหมาย |
|---|---|
| `pull_interval_hours` | รอบการนำเข้า · 0 = ปิด (default) |
| `last_auto_pull_at` | ประทับตอน **เริ่ม** ไม่ใช่ตอนจบ — import ที่ใช้เวลานานกว่ารอบตัวเองจะได้ไม่ trigger ตัวเองซ้ำ (GuruSquare วัดได้ 75-190 วิ) |

**Interlock:** `_importRunning` เป็น `Set` ในหน่วยความจำชุดเดียวที่ทั้ง scheduler และปุ่มใช้ร่วมกัน
การ claim ต้องเกิด **ก่อน `await` แรก** — ตอนแรกเขียนเป็น SELECT ก่อนแล้วค่อย `add()` ทำให้คำขอ
สองอันที่มาพร้อมกันเห็น Set ว่างทั้งคู่แล้วสตาร์ตซ้อนกันได้ (ยิงพร้อมกัน 4 ครั้ง → 202 หนึ่ง, 409 สาม
หลังแก้).

### 9.2 Push (ส่งกลับต้นทาง)

| คอลัมน์ | ความหมาย |
|---|---|
| `push_types` | ชนิดข้อมูลที่ยอมให้ส่ง (face / lpr) · ว่าง = ไม่ส่ง · **เป็นส่วนหนึ่งของ checksum** |
| `push_mode` | `merge` = เพิ่ม/แก้ที่ต้นทาง · `replace` = ทำให้ต้นทางเหมือนเรา (ลบของต้นทาง) |
| `push_auto_enabled` + `push_interval_hours` | ส่งอัตโนมัติตามรอบ — opt-in แยกจาก `push_enabled` |

**การยินยอมผูกกับโหมด** — trigger `trg_revoke_push_consent` ล้าง `push_enabled` /
`push_auto_enabled` / `push_confirmed_*` ทันทีที่ `push_mode` เปลี่ยน. อยู่ที่ฐานข้อมูลไม่ใช่ที่ route
เพราะการยินยอมกับ merge ไม่ใช่การยินยอมกับ replace และ UPDATE ตรงจาก psql ต้องแปลงกันไม่ได้ด้วย.

**`replace` ยังไม่ส่งจริง** — คอลัมน์ / gate / UI / คำเตือน / CONFIRM ครบแล้ว แต่ `pushToSource()`
ปฏิเสธด้วย `code=replace_not_live` และฝั่ง edge **ไม่มี op สำหรับลบเลย**. เหตุผล: server ปลอมพิสูจน์ได้
แค่ว่า request ถูกรูปแบบ พิสูจน์ไม่ได้ว่า DSS Pro ของตำรวจลบแถวไหนจริง — ต้องทดสอบกับตัวจริงใน
ช่วงเวลาที่นัดหมายก่อน.

**เส้นทางส่ง:** central → `/blacklist-source-push` ที่ edge → DSS Pro. ใช้ **named operation**
(`person-update` = `PUT /obms/api/v1.1/acs/person/{id}` · `vehicle-save` =
`POST /ipms/api/v1.1/vehicle/save/batch`) ไม่ใช่ generic "PUT URL นี้" — ถ้า central ถูกยึด สิ่งที่
สั่งได้มากที่สุดยังเป็นชุด write ที่จำกัดและตรวจสอบได้.

**Gate ทั้งหมดที่ต้องผ่านก่อนข้อมูลออกจากระบบ:** เลือกชนิดข้อมูล → ติ๊กยอมรับ → confirm →
(replace: พิมพ์ CONFIRM) → checksum ตรง → `BLACKLIST_PUSH_LIVE=1` → มี transmitter ของ
source type นั้น. ทุกครั้งที่พยายามส่ง (สำเร็จหรือถูกปฏิเสธ) ลง `audit_log` เสมอ.
