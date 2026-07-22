# Retention Architecture — Prod (data classes + edge/central domains)

> Status: **PLANNED 2026-07-01** · Driver: full deploy ~10M records/month. One
> retention number cannot govern everything — split by **data class** (each with a
> different dominant concern) AND by **location** (edge vs central disk).
> Edge pruner + inventory already shipped (commit `d87649c`); the rest is planned.

---

## Principle: decouple retention by class × location

Retention is driven by four different concerns depending on the data:
- **Disk** (bytes) — images ≫ clips ≫ metadata
- **PDPA** (sensitivity) — biometric > plate (personal data) > anonymous counts
- **Forensic** (operational value) — plate history valuable long; raw frames short
- **Debug** — raw payload useful only briefly

Measured 2026-07-01 (dev Mac, mixed): scene JPG 317 KB · plate crop 1.5 KB · clip
0.8 MB · events row 1617 B (**90 % is rawXml**) · license_plates 295 B. In **prod**
the heavy rock (Bosch scene) lives on **edge** disks; central holds LPR/face images
+ metadata + slim path refs.

## Retention classes

| # | Class | Retention | Driver | Where | Mechanism |
|---|-------|-----------|--------|-------|-----------|
| **A-edge** | Bosch/IVA scene JPG | **3–7 d** | disk (edge box small) | EDGE | dir-age drop ✅ `d87649c` |
| **A-central** | LPR scene/plate JPG | **3–7 d** | disk | CENTRAL | `lpr_image_retention_days` (7) |
| **A′** | thumbnail (~40 KB) *opt* | 30–90 d | browse convenience | either | YAGNI until asked |
| **B** | clips (mp4) | 30 d | disk + evidence | central | `clip_retention_days` (30) |
| **C** | biometric (face embed, appearance, face crop) | **30–90 d** | **PDPA** (sensitive) | central | `appearances_retention_days` (40); verify face tables |
| **D** | rawXml (raw payload) | **30–90 d** | debug / re-parse | central | time-based expiry (safer than trim) |
| **E** | plate event log (slim: plate·time·cam·dir·parsed attrs) | **1–3 yr** | forensic · tiny | central | partition DROP; **decouple from image/rawXml expiry** |
| **F** | aggregate/stats (counts, no PII) | years / indefinite | trend · anonymous | central | rollup tables, never delete |

**Legal-hold = a MECHANISM, not a class.** A flag on rows that hit a watchlist / are
part of a case → exempt from auto-expiry across ALL classes until the hold clears.

## Two retention domains

- **Edge (per node, small disk):** A-edge (Bosch scene) + any edge-site LPR. Tightest
  windows. **No api-server on edge → the edge-bridge is the only pruner** (shipped).
  PDPA win: Bosch frames never centralise — central stores only the path (proxied).
- **Central (server, large disk):** A-central, B, C, D, E, F. Sized volume; XFS.

## Status / gaps

| Item | State |
|------|-------|
| **A-edge pruner + inventory** | ✅ DONE `d87649c` + Health surfacing `d4e2ba5` (dir-age drop `events/`, guards, oldest+count → `edge_status`) |
| A-central / B / C | ✅ exists (lpr_image / clip / appearances retention) |
| **P2/2A — parse used fields → column** | ✅ DONE `b2741cc` (seatbelt → `no_seatbelt` + partial index; the only rawXml-LIKE filter). Other used fields (plateType/region/plateColor/…) were already top-level raw_json keys / columns at ingest. |
| **D — rawXml separate retention** | ✅ DONE `d5fc975` (`enforceRawXmlRetention`, strip `raw_json - 'rawXml'` > `rawxml_retention_days`=90, batched daily). Verified: keeps top-level fields, drops only the blob; lost-on-expiry = only unused plateCharBelieve/licenseBright. |
| **E — decouple plate-log** | ✅ DONE `39552ee` (MECHANISM only — exclude anprAlarm from general retention → LPR governed solely by `lpr_retention_days`). ⚠️ number stays 30; **raising it to years is GATED on P2/2B partitioning** (240M rows on a flat table + batched DELETE = the retrofit P2 exists to avoid). |
| **F — aggregate rollup** | ⏸️ **DEFERRED 2026-07-01 (YAGNI)** — no consumer: nothing reads long-term aggregates yet. **Add when** a long-term-trend report/dashboard actually needs pre-purge rollups. |
| **Legal-hold flag** | ⏸️ **DEFERRED 2026-07-01 (YAGNI)** — no trigger: `lpr_watchlist active`=0, `lpr_alert_acks`=0, no case/hold flow sets it, so the flag would protect nothing today. **Add when** a case-management / watchlist-hold flow exists to set it (then: `events.legal_hold` + `AND NOT legal_hold` in every row-retention job; note image prune is file-based and needs separate handling). |

## Do-NOT (decided this session)
- **Don't split-and-drop "unknown" fields at ingest** — "unknown" is per-camera/per-time
  (seatbelt/pilotPicture went unknown→real on reconfigure), not a fixed schema property.
  Split by **time** (D), not by field.
- **Don't prune edge `lpr/`** with the Bosch window — edge LPR may be primary evidence.
- **Don't over-invest in metadata/rawXml for disk** — it's a rounding error vs images;
  do P2/2A for *filter speed*, and D for *decoupling long-term log*, not for bytes.

## Sequencing
1. ✅ **A-edge pruner** (`d87649c`/`d4e2ba5`) — closed the disk-fills-forever gap.
2. ✅ **P2/2A** (`b2741cc`) — seatbelt → column; unblocked D + sped the filter.
3. ✅ **D** rawXml time-retention (`d5fc975`) · ✅ **E** decouple mechanism (`39552ee`).
4. **NEXT — P2/2B partitioning** (draft `MANUAL_partition_events_option_a.sql`, Advisor-led + rehearse on a copy). This is the gate that lets the E number-flip (long `lpr_retention_days`) actually happen — the real value unlock.
5. ⏸️ **F** (rollup) · **Legal-hold flag** · **A′** thumbnail — DEFERRED (YAGNI); add when a consumer/trigger exists.

Numbers above are **starting policy** — confirm windows with whoever owns PDPA/compliance.
