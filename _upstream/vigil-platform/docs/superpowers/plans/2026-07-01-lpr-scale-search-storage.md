# LPR Scale — Search + File Storage (before full deploy)

> Status: **PLANNED 2026-07-01** · Trigger: owner projects **~10M vehicle records/month**
> at full deploy (~120M/year). Current tables are unpartitioned and search uses
> OFFSET + exact COUNT — both degrade with N. Images (scene JPGs) dominate disk.
> Do NOT implement yet at 86k rows; land before the row count crosses ~1–2M.

---

## Measured baseline (2026-07-01, verified)

| Thing | Value |
|---|---|
| events rows now | 116,954 · license_plates 86,351 |
| Partitioning | **none** (both `relkind='r'`) |
| Scene JPG avg | **317 KB** (after resizeScene 1080p/q80) |
| Plate crop avg | 1.5 KB |
| Files per event | 2 (scene + plate) |
| Dir sharding | `snapshots/lpr/{date}/{cam}/{4h-slot}/` (`snapshot-path.js`) |
| Image retention | `lpr_image_retention_days`=7 · rows `lpr_retention_days`=30 |
| Retention prune | per-file `mtime` stat + `unlink`, rmdir-empty (`lpr-retention.js`) |
| Existing indexes | `(camera_id, event_time DESC)`, `event_time DESC`, `plate_number`, `event_id` |
| Search query | JOIN + `ORDER BY event_time DESC` + **`OFFSET n LIMIT 50`** + separate **`COUNT(*)`** |

## Projection at 10M events/month

- **Disk (images):** live set = 10M × (7/30) ≈ 2.33M events × ~318 KB ≈ **~740 GB** at 7-day
  retention (≈ **3.2 TB** if images kept 30d). ~4.7M files live.
- **DB:** ~10M rows/month; **rawXml 2000-char slice ≈ 20 GB/month** of mostly-unused XML text.
- **Ingest rate:** ~3.85/s avg, peaks 20–50/s → each = 2 file writes + a `sharp` resize (CPU).

---

## Part A — Search / query (what stays fast as N grows)

The three things that scale with N today, and the fix for each:

### A1. Keyset (cursor) pagination — replaces OFFSET  ← core
`OFFSET 86200` makes Postgres scan+discard 86,200 rows. Keyset seeks the index:
```sql
-- cursor = the last row shown
WHERE (e.event_time, e.id) < ($lastTime, $lastId)
ORDER BY e.event_time DESC, e.id DESC
LIMIT 50
```
Constant time at any depth. **Trade-off:** no random "jump to page 1725" — UX becomes
**"Load more / Next"** + rely on date filters. (This is why we did NOT add a last-page
button — deep OFFSET is exactly the anti-pattern.) Needs index `(event_time DESC, id DESC)`.

### A2. Drop exact COUNT(*)
The "86,220 รายการ · 1725 หน้า" forces a full scan of all matching rows every search.
Replace with one of:
- **Estimate** from `EXPLAIN (FORMAT JSON)` plan rows or `pg_class.reltuples` → "≈ 86,000+".
- **Cap**: ">1,000 — narrow your filter."
- Or just range ("showing 1–50") with Load-more, no total.

### A3. Time partitioning (monthly RANGE on `event_time`)
At 120M/year one flat table hurts range scans, VACUUM, and retention DELETEs.
- Partition prune: date-filtered searches touch only relevant month(s).
- Retention = **`DROP PARTITION`** (instant) instead of slow `DELETE ... WHERE id = ANY(...)`.
- Smaller per-partition indexes.
- `license_plates` partitions alongside (by a copied `event_time`, or keep it joined and
  partition only `events` if the join stays selective — decide during impl).

### A4. Filters live on indexed columns, not rawXml
The seatbelt filter I shipped uses `LIKE '%<pilotsafebelt>no%'` on `rawXml` = seq scan.
Fine now (occasional, 86k) — **at scale, parse the few fields we actually filter on
(`pilotsafebelt`, `plateType`, `plateCharBelieve`?) into top-level columns at ingest**
(matches the `helmet`/`uphone` pattern) and index them. Ties into Part B (rawXml trim).

### A5. Default to bounded windows
UI defaults to today/7-day (newest-first) → index range scan, fast. "All 86k" should be
opt-in, not the landing view.

---

## Part B — File storage (bytes AND file-count both bind)

Two independent walls, not one. **Bytes:** scene images are ~99.5% of image bytes
(317 KB vs 1.5 KB plate). **File count:** 2 files/event (×3 if driver-face lands) →
**20M files/month**, live set @7d ≈ **4.67M files**.

**Measured 2026-07-01:** host = owner's Mac, APFS. Disk **already 87% full, ~127 GB free**.
Inodes dynamic on APFS (iused 2.2M / ifree 633M) → **inode exhaustion is NOT a risk** (that
concern is eliminated). Retention `enforceLprRetention` runs boot+120s then **every 24h**,
doing a **recursive `readdir` + per-file `stat`** walk of the whole tree.

### B0. Disk capacity = a SIZING decision on Linux prod, not a wall
The "127 GB free" is the **owner's Mac (dev/current)** — prod is **Linux**. 740 GB@7d fits any
properly provisioned server disk (TBs). So capacity is a **provisioning/sizing line item**
(size the volume to retention × daily-bytes), NOT an architecture blocker. It was only a wall
because I anchored to the Mac. On Linux with a sized disk, local storage is viable.

### B0b. Directory sharding is already adequate (verified)
Path = `lpr/{date}/{cam}/{4h-slot}/` (`snapshot-path.js`). Worst dir TODAY = **10,502 files**
in one 4h slot. Projected busy-lane slots ~5k–33k files. **ext4 (dir_index) / XFS handle
tens-of-thousands per dir via B-tree — no linear scan, no bloat problem.** The existing
sharding is fine for Linux; **finer sharding is NOT needed** unless a single lane goes extreme.
(XFS is the better choice for many-small-files + large volumes; ext4 fine too.)

Levers, cheapest first:

### B1. Retention window is the main knob
7-day scene retention = ~740 GB live; every extra week ≈ +185 GB. Keep the plate crop
(1.5 KB) longer than the scene if evidence needs the plate but not the full frame.

### B2. Prune by DIRECTORY age, not per-file stat
Current retention stats + unlinks each file. At millions of files that walk is slow + I/O
heavy. Dirs are already time-bucketed (`{date}/{cam}/{4h-slot}`) → **drop whole expired
date/slot dirs** (`rm -rf`) = O(dirs) not O(files). Keep the per-file path as fallback for
the current partial-day slot only.

### B3. Object storage — OPTIONAL scaling choice (corrected from "prerequisite")
I flip-flopped this; being explicit. On a sized Linux disk with adequate sharding (B0/B0b),
local storage handles 10M/month — object storage is **not a hard prerequisite**. Its real
wins are **operational**: retention becomes a bucket lifecycle policy (no daily file walk),
backup/replication of millions of objects is native, and it scales past a single node. Adopt
when those ops concerns matter (multi-node, or backup of millions of files gets painful) —
not required for cutover on a single well-sized Linux box.
- Lighter interim: **thumbnail + original tier** — small browse thumb (~640px, ~40 KB) lives
  longer, full scene shorter. Modal already shows `?w=960`; full scene only for view/download.

### B4. Finer sharding if a single lane is hot
4-hour slots are fine now. If one busy lane exceeds ~10k files/slot, go hourly to keep
directory listing / retention scans cheap.

### B5. rawXml — parse used fields to columns (additive); DO NOT trim yet
The 2000-char rawXml ≈ 20 GB/month, mostly fields that are 100% `unknown` today. Tempting
to drop it — **but that trim is irreversible and the keep-set is NOT proven stable.** Direct
evidence from this session: `pilotsafebelt` and `pilotPicture` went from absent/unknown →
populated the moment the camera was reconfigured (Face Matting). Trim rawXml now on today's
probe and a future analytic toggle is silently lost on every row written until noticed.
- **DO (additive, safe):** parse the fields we actually filter/use into indexed columns at
  ingest (Part A4).
- **HOLD (destructive):** shrinking/dropping rawXml — only after the keep-set is proven
  stable over time (months, across camera-config changes). The 20 GB/month is cheaper than
  re-deriving lost signal. Revisit, don't pre-commit.

---

## Phasing — sorted by REVERSIBILITY, not just cost (revised 2026-07-01 after Advisor)

The right axis is "how brutal is this to change later," not "how much data is there now."

**DO NOW (cheap now, brutal or impossible later — the user's "why wait" is correct here):**
- **A3 Partitioning** — converting a flat 86k-row table to monthly RANGE partitions is
  trivial + fully testable today; at 100M rows it's a downtime-heavy project. Establish the
  structure now so all future data lands partitioned. ⚠️ schema migration touching existing
  data → **opus + Advisor-led cycle + idempotent + VERIFIED ROLLBACK, tested on a copy first**
  (STUBBORN_FACT #81: a failing migration aborts api-server startup). Decide the
  **`license_plates` partition key BEFORE writing the migration** — if `events` partitions on
  `event_time` but `license_plates` stays flat, the join still scans it. (Partition `lp` on a
  copied `event_time`, or keep flat-but-selective — decide first.)
- **A1 keyset pagination + A2 drop-exact-count** — size-independent code, no data risk,
  battle-tested before scale. ⚠️ keyset removes jump-to-arbitrary-page → **UX becomes
  Load-more/Next, NOT "page 1725"** (conflicts with the first/last-page ask — get owner's
  call before building). A5 bounded default rides along.

**HOLD — later is NOT worse; doing it now is the trap:**
- **B5 rawXml trim** — irreversible data loss on an unproven keep-set (see B5). Parse used
  fields to columns now (additive), but keep full rawXml until the keep-set is stable.

**FULL-DEPLOY PROVISIONING (a sizing line item, not a code task):**
- **B0 disk sizing** — prod is Linux; size the volume to retention × daily-bytes (e.g. 7d ×
  10M/mo ≈ ~740 GB + headroom). Prefer **XFS** for many-small-files; ext4 fine. The current
  sharding (B0b, verified) already keeps dirs to tens-of-thousands — no dir-bloat problem.

**DEFER — genuine YAGNI:**
- **B3 object storage** — optional ops win (bucket-lifecycle retention, native backup, multi-
  node). Not required on a single sized Linux box. Adopt when backup/scale ops actually hurt.
- Sub-day sharding / per-slot packing — only if one hot lane's dirs go extreme.

**Host note:** PostgreSQL declarative partitioning (A3) is a DB feature — **host-independent,
runs identically on Linux** (Postgres is the same Docker image). Linux is the standard prod
target for it; no compatibility concern. XFS/ext4 both handle the file volume.

**Do-now, low-risk housekeeping:** B1 retention tune + B2 dir-age prune (replaces the
per-file stat walk) + A4 ingest-time columns for used fields.

## Notes / constraints
- Vanilla JS + raw SQL — **no ORM** (all above fits raw SQL). Migrations idempotent per
  CLAUDE.md; partitioning migration must handle the existing flat table (create partitioned
  table + move data, or `pg_partman`/attach — decide at impl, do behind Advisor-led cycle).
- PM2 restart only via `open -a Terminal scripts/pm2-lan-safe-restart.command` (GOTCHAS #84).
- Related: [`2026-06-18-lpr-receiver.md`] (RF/retention), RF-IMG resizeScene (commit a96ee28).
