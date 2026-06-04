# CLAUDE.md — DojoJin Tech Dashboard

> **Project context handoff document for AI assistants (Claude Code, future chat sessions, etc.)**
> Last updated: 2026-06-03 · Owner: Prakasit Rochanavipart (Dojo-mAn)
> Current version: **v1.5.1** · live at `https://dashboard.dojojin.tech`
>
> **What changed:** this file used to hold everything (~1,750 lines).
> It was slimmed on 2026-05-23 to 4 top blocks + pointers — detail
> moved to companion files. See [Documentation Map](#-documentation-map)
> below.
> · 2026-05-27 — Working Agreement #2 ขยายเป็น **UI-design-first**
> (Responsive เป็น subset) + เพิ่ม #3 **Reproduce-before-fix**;
> เพิ่มไฟล์ `DESIGN.md` (role `GUIDE_`); log เหตุผลใน `DECISIONS.md` #142–147.
> · 2026-05-27 — owner's machine เปิด `.claude/settings.local.json` = `{"model":"opus"}`
> (effective default = opus เฉพาะเครื่องนี้; ดู Enforcement).

---

## 🧭 Working Agreement (ข้อตกลงการทำงาน — บังคับทุกครั้ง)

> เพิ่ม 2026-05-22 ตามคำสั่งเจ้าของโปรเจกต์. กฎเหล่านี้ใช้กับ **ทุกคำสั่ง**
> ไม่ใช่เฉพาะงานใหญ่ — และ override พฤติกรรม default.

### 1. Investigate-first — แยก Fact ออกจาก Opinion ให้ชัด

เมื่อได้รับคำสั่ง ทำตามลำดับนี้ทุกครั้งก่อนลงมือแก้โค้ด:

1. **ตรวจสอบ** — อ่านไฟล์ / โครงสร้าง / git ที่เกี่ยวข้องจริง
2. **หาความจริง** — ยืนยันข้อเท็จจริงจาก source (โค้ด / schema / git log). อย่าเดา
3. **ประมวลผล + วิเคราะห์ผล**
4. **นำเสนอ โดยแบ่ง 2 ส่วนแยกกันชัดเจน:**
   - **🔵 Fact** — สิ่งที่ตรวจสอบแล้วเป็นจริง อ้างอิงได้ (ไฟล์ / บรรทัด / decision #)
   - **🟡 Opinion** — ข้อดี / ข้อเสีย + แผนการแก้ที่เสนอ + ความเห็นเพิ่มเติม
5. **รอเจ้าของตัดสินใจ** — ไม่ลงมือจนกว่าจะได้ไฟเขียว

**ข้อยกเว้น:** ถ้าคำสั่งเป็นไฟเขียวในตัว ("ทำเลย" / "จัดการเลย" / "ต่อเลย" /
อนุมัติแผนใน plan mode) = ตัดสินใจแล้ว → ลงมือได้ทันที ไม่ต้องวนถามซ้ำ. แต่
ผลลัพธ์ยังต้องรายงานแบบแยก Fact / Opinion เสมอ.

### 2. UI-design-first (Responsive เป็น subset)

ก่อนลงมือทำ **อะไรก็ตามที่แตะ UI / CSS / layout / หน้าใหม่** ต้องเคารพ design
system ทุกครั้ง — spec เต็มอยู่ใน [DESIGN.md](DESIGN.md) (เหตุผล: decision #142–145).
3 เสาหลัก:

**A. Design language — clean, Material-inspired (หลักการ ไม่ใช่ framework)**
- เรียบ เข้าใจง่าย hierarchy ชัด · ยึด restraint (น้อยแต่ชัด ไม่ตกแต่งเกิน)
- "Material" = เอา *โครงสร้าง* (elevation, spacing grid, type scale, token-based)
  มาใช้ — **ไม่ใช่** ลาก Material Web Components / framework เข้ามา (ชน Notes #1,
  STUBBORN_FACT Frontend) — decision #142
- ทุกสี / ระยะ / ขนาด มาจาก **token** (CSS custom properties) เสมอ — ห้าม hardcode
  (white-label ต้อง re-theme ได้ต่อลูกค้า — Notes #10) — decision #145
- **new code (2026-05-29+) ใช้ semantic token เท่านั้น** (decision #173) — ห้ามแตะ legacy names ตรงๆ:

  | ต้องการ | ใช้ | ห้ามใช้ |
  |---|---|---|
  | พื้นหลังหลัก | `--surface-base` | `--bg` |
  | card / panel | `--surface-elevated` | `--panel` |
  | modal / dropdown | `--surface-overlay` | `--panel2` |
  | ตัวอักษรหลัก | `--text-primary` | `--text` |
  | label / caption | `--text-secondary` | `--dim` |
  | hover ของ accent | `--accent-muted` | `--accent2` |
  | amber / warning | `--warn` | `--amber` |
  | online / healthy | `--status-ok` | `--green` |
  | offline / error | `--status-bad` | `--red` |
  | เส้นแบ่ง | `--border-hairline` | `--border` |
  | accent | `--accent` | (ชื่อตรงกันอยู่แล้ว ใช้ได้) |

  legacy `--bg/--panel` ฯลฯ ยังอยู่เป็น alias ของเดิมยังทำงานได้ แต่ new code ห้ามใช้
- dashboard = งานวิเคราะห์ → ให้ legibility / data density มาก่อนการตกแต่ง
- status color ต้องผ่าน contrast WCAG AA บน surface ปัจจุบัน (decision #145)

**B. Responsive (subset ของ A)**
- breakpoint `≤768px` (มือถือ) first-class เสมอ — decision #42, gotchas #29-31
- ถ้าคำสั่งของเจ้าของมีจุดที่จะ **กระทบ responsive ในทางลบ** → แจ้งทันทีตามรูปแบบ
  ข้อ 1 (แยก Fact / Opinion) ก่อนทำ — ห้ามเงียบแล้วทำตามจนพังบนมือถือ
- **ก่อน commit UI ทุกครั้ง** → ตรวจ responsive ≤768px ด้วยตัวเองและรายงานผลใน
  summary (ผ่าน / แก้แล้ว / จุดที่อาจเป็นปัญหา) — ไม่รอให้ถูกถาม

**C. No-emoji-as-UI** (decision #144) — มี 2 ระดับความเข้ม
- **Dashboard DOM** = preference: emoji พัง visual consistency ข้าม OS/เบราว์เซอร์ +
  ไม่ themeable + ไม่เข้า i18n → ใช้ inline **SVG sprite** (`currentColor`, decision #143).
  เบราว์เซอร์ render emoji ได้ ไม่ crash — เป็นเรื่องคุณภาพ ไม่ใช่ความปลอดภัย
- **Server-side render (Health Report PNG = SVG + `sharp`)** = **HARD constraint** —
  `librsvg/Pango` abort เมื่อไม่มี emoji fallback font → renderer **strip emoji เสมอ**
  ผ่าน `report-renderer._svgSafeText()` (incident จริง 2026-05-26, **GOTCHAS #25a / #25**;
  architecture = decision **#148** Health Report PNG ใช้ SVG+sharp ไม่ใช่ Puppeteer).
  **ห้ามใส่ emoji ใน SVG report template เด็ดขาด** (analytics report = Puppeteer/
  report-template.js คนละ path)
- **ยกเว้น:** LINE alert (norm ของ LINE ไทย) · docs/commit/CLAUDE.md (🔵🟡 ใช้ scan ได้)
- **Legacy reality (สำคัญ):** dashboard เดิมใช้ emoji เป็น UI **แพร่หลาย** — sidebar/
  sub-tab/ปุ่ม (👁 📄 📥 📤 📜 🔌 📷 📋 🔍 🔕 ฯลฯ). ทั้งหมด grandfathered → แทนด้วย
  SVG แบบ **opportunistic** เมื่อแตะจุดนั้น **ห้าม sweep**. ห้ามแตะ semantics label `🔕` (#90)
- **Retrofit stance:** new code + ส่วนที่แตะ → token/SVG; **ห้าม big-bang refactor**;
  opportunistic เท่านั้น. hardcode/emoji วงกว้างที่ควรรื้อ → เสนอ ROADMAP ไม่ทำเงียบ

### 3. Reproduce-before-fix → Verify-after → Capture (เฉพาะงาน bug / behavior แปลก)

ใช้กับงาน "แก้บั๊ก / พฤติกรรมไม่ตรงคาด" เท่านั้น — **ไม่ใช่** feature ใหม่,
**ไม่ใช่** typo/rename. เป็นส่วนขยายของข้อ 1: เพิ่มขา **runtime** เข้าไปใน
"หาความจริง" (ข้อ 1 เป็น static investigation — อ่านไฟล์/schema/git; ข้อนี้บังคับ
ให้เห็นของรันจริง). เหตุผล: decision #146–147.

1. **Reproduce ก่อนเสมอ** — สร้าง repro ที่สังเกตได้จริงก่อนเสนอวิธีแก้:
   รัน SQL จริงกับ schema จริง · ยิง endpoint จริงดู response shape จริง (อย่าเดา
   รูป payload) · ดู log / Network / DevTools ของจริง.
   **ถ้า reproduce ไม่ได้** → บอกตรง ๆ ว่าทำซ้ำไม่ได้ และวิธีแก้ที่เสนอนับเป็น
   🟡 Opinion (สมมติฐาน) ไม่ใช่ 🔵 Fact.

2. **Root cause ไม่ใช่ symptom** — heisenbug (EMQX broker swap #112/#33, Safari ITP,
   Cloudflare cache stale JS, license fingerprint #108/#26) ห้ามเดา —
   ต้องเห็นของจริงว่าอะไรทำให้ repro เกิด ก่อนแตะโค้ด.

3. **Verify-after** — หลังแก้ ต้องรัน repro เดิมซ้ำให้กลายเป็น "เขียว" + เช็ค
   regression ที่ใกล้เคียง. ยังไม่ verify = งานยังไม่เสร็จ (ไม่ใช่แค่ "เขียนโค้ดเสร็จ").

4. **Capture — ปิด loop preventive** แบ่ง 2 ชั้นตาม blast radius (hybrid, decision #147):
   - **Log / warn / metric / non-throwing assert** (ไม่แตะ control flow) →
     **ทำได้เลย** นับเป็นส่วนหนึ่งของ fix แล้วรายงานใน diff.
   - **Throw / reject / validation ที่บล็อกของเดิม** (เปลี่ยน behavior) →
     **เสนอ รอไฟเขียว** เสมอ — โดยเฉพาะใน MQTT ingest / WS `verifyClient` /
     migration (กัน failure mode ใหม่หลุดเข้า prod โดยไม่ผ่านตา; cf. STUBBORN_FACT
     #81 — failing migration aborts startup โดยตั้งใจ).
   - ถ้าเป็น footgun จริง → เสนอบรรทัด `GOTCHAS.md` ใหม่ตาม convention
     incident-based เดิม (root cause / fix / lesson).

> Repro template ละเอียดต่อชนิดบั๊ก (MQTT / WS / cache / ITP) อยู่ใน
> `docs/REF_troubleshooting.md` / `GOTCHAS.md` — ไฟล์นี้เก็บแค่กฎ.

---

## 🤖 Model Assignment Rules

> *Guidance* — CLAUDE.md เลือก model จริงไม่ได้. การบังคับใช้อยู่ที่
> `.claude/settings.json` (committed) + `/model` picker + subagent frontmatter.
> ใช้ตารางนี้ตัดสินใจว่าจะ `/model` สลับเมื่อไหร่.

### Default
- **`opusplan`** — Opus วางแผนใน plan mode → สลับ Sonnet ตอน execute อัตโนมัติ
- ⚠️ plan-mode ของ opusplan อาจได้ context window เล็กกว่า `opus` ตรง ๆ —
  งานวิเคราะห์ทั้ง `dashboard.js` / `api-server.js` พร้อมกันทั้งก้อน ให้สลับเป็น
  `opus` (เช็คขนาด context จริงได้ใน `/model` picker)
- **นิสัยที่สำคัญกว่าค่า default:** debug ข้ามเลเยอร์ + งาน security ทำใน
  *execute mode* ซึ่ง opusplan ช่วยไม่ถึง → พิมพ์ `/model opus` เองทุกครั้งที่
  เริ่มงานสองกลุ่มนี้

### Task → Model
| งาน | Model | ตัวอย่างจริงในโปรเจกต์ |
|---|---|---|
| Architecture / data-flow design | `opus` | ออกแบบ ingester เวนเดอร์ใหม่, plugin-loader refactor, endpoint รวบยอด, WS channel ใหม่ |
| Complex SQL / query performance | `opus` | stats aggregation, `analyticsEventClause()`, `date_bin()` density, EXPLAIN tuning, partition plan |
| Cross-cutting / heisenbug debug | `opus` | broker swap (#112), license fingerprint (#108), Cloudflare cache stale JS, Safari ITP |
| Security & auth | `opus` | auth middleware, WS `verifyClient`, RBAC, license Ed25519 JWT, CORS allowlist |
| Schema migration ที่แตะ data เดิม | `opus` | type change, retroactive column convert |
| Design-system architecture | `opus` | วาง token tri-layer (#145), icon-system, theming Chart/OpenLayers/Puppeteer ให้ตรง token |
| Feature ตาม pattern เดิม | `sonnet` | ingester ตามแม่แบบ hikvision/dahua, หน้า dashboard ใหม่ (Vanilla JS), widget Chart.js/OpenLayers |
| Apply component / design pattern | `sonnet` | สร้าง card/table/badge ตาม DESIGN.md, แทน emoji เป็น SVG sprite ตาม spec |
| Refactor ในกรอบ convention เดิม | `sonnet` | แยก helper, ปรับ endpoint, migration file ใหม่ (idempotent), i18n string extraction |
| Docs / commit msg / session summary | `haiku` | README / CLAUDE.md / SKILL.md, commit message, push summary |
| Search / grep / read (รันเป็น subagent) | `haiku` | cost lever — ตั้งใน `settings.json` ให้แล้ว |
| Boilerplate / format / find-replace กลไกล้วน | `haiku` | rename, จัด format, แทนที่ string ที่ pattern ชัด |

### Cheat sheet
```
/model opusplan   # default
/model opus       # architecture / SQL / debug ข้ามไฟล์ / security / design-system
/model sonnet     # implement ตาม pattern / component / i18n
/model haiku      # docs / search / cleanup
```

### Enforcement
- **`.claude/settings.json`** (committed) — `model: opusplan` + `CLAUDE_CODE_SUBAGENT_MODEL: haiku`
- **`.claude/settings.local.json`** (gitignored) — override เฉพาะเครื่อง เช่น `{"model":"opus"}`
  - **ACTIVE (2026-05-27):** เครื่องหลักของ owner เปิด override นี้แล้ว → effective default = **`opus`**
    (subagent ยังเป็น `haiku` จาก settings.json). เหตุผล: งานช่วงนี้เอียงไป architecture/SQL/
    heisenbug/security (กลุ่ม opus) จนต้อง `/model opus` เองบ่อย → ทำให้อัตโนมัติ.
    ไฟล์ gitignored → ไม่กระทบ Codex/เครื่องอื่น (ยังได้ opusplan). ปิด override = `rm` ไฟล์นี้
- subagent ตั้ง `model:` ใน frontmatter ของตัวเองได้ → override ค่า subagent default
- ล็อกเวอร์ชันแบบ reproducible: ใช้ full ID เช่น `claude-opus-4-7` แทน alias

---

## 🎯 Project Purpose

A **production-grade CCTV analytics platform** that ingests events from Bosch BVMS / FlexiDome IP cameras via MQTT (ONVIF Profile M), provides real-time monitoring, intelligent LINE alerts, branded reports, and operational dashboards for security operations teams.

**Why it exists:**
- Bosch IVA Pro detects events but vendor cloud is expensive + locks data in
- Customers want LINE notifications (Thailand market) — Bosch doesn't support this natively
- Need self-hosted, customizable, PDPA-compliant solution
- Source code ownership for customers (no vendor lock-in)
- White-label support so single codebase can be resold to multiple customers

**Target customers:** Industrial / Office Buildings / Retail / Schools (Thailand market, 100-3,000 cameras range)

**Status:** Production v1.5.0 — deployed live at `https://dashboard.dojojin.tech` (Cloudflare Tunnel, root cloudflared launchd service auto-starts on boot). Multi-vendor (Bosch / Hikvision / Dahua / ONVIF) + bilingual Thai/English + license + EULA. See [CHANGELOG.md](CHANGELOG.md).

---

## 📚 Documentation Map

Detailed reference content has been split into companion files. Read what's
relevant to your current task. **For doc management tasks or when scope is
unclear → open `docs/ARCH_documentation-governance.md` first.**

> Living Docs system active (adapted from github.com/Diew/living-docs, 2026-05-24).
> `docs/ARCH_documentation-governance.md` is the formal registry for all files below.

| File | Role (Living Docs) | What's inside |
|------|--------------------|----|
| [ARCHITECTURE.md](ARCHITECTURE.md) | `ARCH_` | Owner context · architecture · tech stack · project structure · DB schema · code patterns · critical ops · commercial info |
| [DESIGN.md](DESIGN.md) | `GUIDE_` | Design system — tokens (tri-layer) · type scale · spacing · elevation · icon/SVG system · Chart/Map/Report theming · component patterns · no-emoji rule |
| [DECISIONS.md](DECISIONS.md) | `LOGIC_` | Decision index #1–#199 (one-line + link to LOGIC/canonical file) — don't second-guess |
| [GOTCHAS.md](GOTCHAS.md) | `INCIDENT_` | Known issues / quirks / footguns (#1–#78) — each from a real incident |
| [docs/LOGIC_map-features.md](docs/LOGIC_map-features.md) | `LOGIC_` | Map page — what exists, improvement backlog, Option B (multi-group overlay), Live Pulse Toast-on-map T2, bug history |
| [CHANGELOG.md](CHANGELOG.md) | Completed work log | Completed features by version (v1.2 → v1.5) + recent updates timeline |
| [ROADMAP.md](ROADMAP.md) | `REFACTOR_TODO` | Pending work · operational roadmap Ph.1–Ph.6 · strategic direction |
| [SKILL.md](SKILL.md) | `REF_` | Operator's playbook — category mappings, troubleshooting, SQL snippets |
| [service_start.md](service_start.md) | `REF_` | Daily start / stop / health check / troubleshoot manual |
| [docs/REF_database-schema.md](docs/REF_database-schema.md) | `REF_` | Full DB schema (all tables/columns/indexes) · PostgreSQL user/credentials · security/impact analysis · example queries |
| [docs/REF_third-party-integration.md](docs/REF_third-party-integration.md) | `REF_` | Third-party DB integration — `v_*_public` view catalog · ops setup (CREATE USER + GRANT role + pg_hba + docker bind + SSL) · query do/don't · PDPA · change policy · decommissioning |
| [docs/REF_face-recognition.md](docs/REF_face-recognition.md) | `REF_` | **PLANNED** Face Recognition — options A/B/C · InsightFace server-side · DB schema (pgvector) · Python service · hardware sizing · Mac dev → GPU migration · PDPA · phases FR.1–FR.4 |
| [HARDWARE_SIZING_GUIDE.md](HARDWARE_SIZING_GUIDE.md) | `REF_` | Hardware sizing per camera count (G1–G5) + software scale-up plan |
| [README.md](README.md) | Public overview | User-facing project intro (v1.5.0) |
| [LICENSE](LICENSE) + [docs/EULA-th.md](docs/EULA-th.md) | Legal | Proprietary license + Thai EULA |
| **[docs/ARCH_documentation-governance.md](docs/ARCH_documentation-governance.md)** | **Registry** | **File registry · task→load mapping · STUBBORN_FACT index · maintenance rules** |

### Task → Load Mapping (quick reference)

| Task | Load |
|---|---|
| General technical work | `CLAUDE.md` only |
| Architecture / DB schema | + `ARCHITECTURE.md` |
| Feature implementation | + `DECISIONS.md` (relevant #s) + `GOTCHAS.md` (related #s) |
| Debugging | + `GOTCHAS.md` + `docs/REF_troubleshooting.md` (+ Working Agreement #3) |
| Security / auth | + `docs/LOGIC_auth-security.md` + `GOTCHAS.md` (#36–#38) |
| UI / design / responsive / i18n | + `DESIGN.md` + `DECISIONS.md` (#1, #42, #128, #142–145) + `GOTCHAS.md` (#29–#31, #35, #42) |
| Multi-vendor cameras | + `docs/LOGIC_camera-ingesters.md` + `GOTCHAS.md` (#32–#33, #39–#41) |
| Face Recognition (planned) | + `docs/REF_face-recognition.md` + `docs/LOGIC_face-capture.md` |
| Map page / OpenLayers / camera grouping / Live Pulse | + `docs/LOGIC_map-features.md` + `GOTCHAS.md` (#53) |
| Reports / Puppeteer / LINE | + `DESIGN.md` (Report PNG section) + `docs/LOGIC_stats-reports.md` + `docs/LOGIC_line-notifications.md` |
| License / EULA | + `docs/LOGIC_license.md` + `GOTCHAS.md` (#26–#28) |
| 3rd party DB integration / setup new partner / rollout views | + `docs/REF_third-party-integration.md` (+ `docs/REF_database-schema.md` สำหรับ column ละเอียด) |
| Schema lookup / DBA reference | + `docs/REF_database-schema.md` |
| Hardware sizing | + `HARDWARE_SIZING_GUIDE.md` |
| Service ops | + `service_start.md` |
| Planning | + `ROADMAP.md` |
| Doc management / scope unclear | `docs/ARCH_documentation-governance.md` |

**Memory pointer:** `~/.claude/projects/-Users-dojojin-vigil-platform/memory/MEMORY.md`
carries feedback/preference memories across sessions.

---

## 🤖 Notes for AI Assistants

When working on this project:

1. **Don't suggest rewriting in React/Vue/Svelte** — Vanilla JS is a deliberate choice. Discussed and decided.

2. **Don't simplify the auth back to cookie-only** — Safari ITP requires triple-layer.

3. **Don't add ORM (Prisma/Drizzle/etc.)** — Raw SQL is fine for this scale.

4. **Respect Thai-language UI** — Many UI strings are Thai. Don't translate unless asked. All new UI strings MUST be added to both `th` AND `en` blocks in `dashboard/i18n.js` — see gotcha #42. Server-side rendered reports (e.g. Health Report PNG via Puppeteer) also need their own per-language label dict — `HR_LABELS.{th,en}` pattern in `src/report-renderer.js`.

5. **`init.sql` is idempotent — but DO NOT edit it to evolve schema.** It only runs on a fresh volume. New schema → write `db/db_migration_<NNN>_<topic>.sql` (idempotent: `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, `ADD COLUMN IF NOT EXISTS`, or a defensive `DO $$ ... information_schema ...` block). The runner in `src/migrate.js` will pick it up on next api-server boot. Updating `init.sql` is fine when you want the new column to also be present on truly fresh installs — but the migration is what reaches existing volumes.

6. **All `.js` files have copyright headers** — Preserve when editing. Format:
   ```javascript
   // ============================================================
   // DojoJin Tech Dashboard — [Module Name]
   // @author Prakasit Rochanavipart (Dojo-mAn)
   // @copyright (c) 2025-2026 ... All Rights Reserved.
   // @license Proprietary
   // ============================================================
   ```

7. **Owner is technical and pragmatic** — Show working code first, explain after. Use tables/structured output. Don't over-explain basics.

8. **Communication preference:**
   - Owner writes in Thai, technical terms in English
   - Respond in Thai with English code/keywords
   - Show concrete examples + commands to run, not abstract advice
   - When unsure, ask one specific question — don't ask multiple at once

9. **Owner has wide-ranging interests** — Bosch BVMS work is the core, but conversations may detour into smartphones, audio gear, Thai politics, music (Shibuya Kei, action movies), Liverpool FC, 3D printing.

10. **Branding is white-label-aware** — when adding any user-facing text, prefer pulling brand name from `_brand.name` (frontend) or `system_settings` (backend) instead of hardcoding "DojoJin Tech".

11. **Mobile considered first-class** — when adding UI, always test ≤768px breakpoint in DevTools. See gotchas #29–#31 for grid/CSS reflexes. (Now formalized under Working Agreement #2-B.)

12. **Health endpoint exists** — for any new monitoring need, extend `/api/health/details` rather than creating a new endpoint.

13. **Commits:** no `Co-Authored-By Claude` trailers — user wants sole authorship. Don't push without explicit instruction.

14. **Reference docs (start here for context):**
    - This file (slim entry point)
    - [ARCHITECTURE.md](ARCHITECTURE.md) — what's where + how it's wired
    - [DESIGN.md](DESIGN.md) — design system (tokens, icons, component patterns)
    - [DECISIONS.md](DECISIONS.md) — why things are the way they are
    - [GOTCHAS.md](GOTCHAS.md) — known pitfalls
    - [CHANGELOG.md](CHANGELOG.md) — what shipped when
    - [ROADMAP.md](ROADMAP.md) — what's next
    - `db/init.sql` — canonical schema
    - [SKILL.md](SKILL.md) — operator's playbook
    - [service_start.md](service_start.md) — daily ops

15. **Unreproduced fix = hypothesis** — ถ้ายัง reproduce บั๊กไม่ได้ วิธีแก้ที่เสนอเป็น 🟡 Opinion เสมอ ห้ามนำเสนอเป็น 🔵 Fact. หลังแก้ต้อง verify ด้วย repro เดิมก่อนถือว่าเสร็จ (ดู Working Agreement #3, decision #146).

16. **No emoji as UI** — ใช้ inline SVG sprite (`currentColor`) ไม่ใช่ emoji/webfont. **Server-side SVG render (Health Report PNG via `sharp`) ต้อง strip emoji เสมอ** — librsvg/Pango abort (GOTCHAS #25a, `_svgSafeText()`). ยกเว้น LINE alert + docs + legacy emoji ใน dashboard เดิม (แพร่หลาย — แทน opportunistic ห้าม sweep). ทุกสี/ระยะดึงจาก token ใน `DESIGN.md` (Working Agreement #2-C, decision #143–144).

17. **Security checklist:** เมื่อแตะโค้ดกลุ่ม auth / file upload / cookie / credential / docker port → โหลด [`docs/REF_security-checklist.md`](docs/REF_security-checklist.md) + review GOTCHAS #50–#57 ก่อนเขียนโค้ด เหตุผล: audit SEC-001–011 (2026-05-28) พบ 4 class ของ bug ที่เกิดซ้ำได้ในจุดเหล่านี้ (magic bytes, flag drift, middleware bypass, port wildcard)

---

<sub>End of CLAUDE.md (slim) · DojoJin Tech Dashboard v1.5.1 · Updated 2026-06-03</sub>
