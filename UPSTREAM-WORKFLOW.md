# Upstream Sync — Repeatable Workflow

เปิดไฟล์นี้ทุกครั้งที่มี `upstream-sync/*` PR เข้ามาใน GitHub notifications
เวลาต่อ update cycle: ~30 นาที

---

## วิธีสั่ง check เอง (manual trigger)

ระบบรันอัตโนมัติทุกวันจันทร์ 15:00 น. แต่ถ้าต้องการเช็คทันที:

**ทาง GitHub UI** (ทำจากมือถือได้):
1. ไปที่ `github.com/dojojin/dojojin-docs` → Actions → **"Upstream Sync Check"**
2. คลิก **"Run workflow"** (มุมขวา)
3. `dry_run = true` → ดูว่ามี drift ไหม **ไม่เปิด PR**
4. `dry_run = false` → เปิด draft PR ถ้ามี drift
5. คลิก **"Run workflow"** สีเขียว

**ทาง Terminal:**
```bash
# dry run — เช็คว่ามี drift ไหม
gh workflow run upstream-sync-check.yml \
  --repo dojojin/dojojin-docs \
  --field dry_run=true

# trigger จริง — เปิด draft PR ถ้ามี drift
gh workflow run upstream-sync-check.yml \
  --repo dojojin/dojojin-docs \
  --field dry_run=false

# ดู log real-time
gh run watch --repo dojojin/dojojin-docs
```

**บน local (ไม่ผ่าน Actions):**
```bash
bash update-upstream.sh          # pull + แสดง diff hint
git diff HEAD~4 HEAD -- _upstream/
```

---

## Step 0 — Triage (5 นาที) ก่อนเปิด Claude

Pull branch และประเมินว่าอะไรเปลี่ยนจริง

```bash
git fetch origin
git checkout upstream-sync/YYYY-MM-DD-XXXXXXXX   # branch name จาก PR
git diff main -- _upstream/vigil-platform/ | head -80
git diff main -- _upstream/vigil-mobile/ | head -80
```

ถามตัวเองว่า:
- [ ] เป็นฟีเจอร์ใหม่หรือเปลี่ยน capability ที่อธิบายไว้ใน public docs อยู่แล้ว?
- [ ] หรือเป็น internal เท่านั้น (SQL, bug fix, schema, code)?

**ถ้า internal เท่านั้น** → ปิด PR, comment "internal-only — no public doc update needed", เสร็จ  
**ถ้ากระทบ public docs** → ไปต่อ Step 1

---

## Step 1 — เปิด Claude Code session

```bash
cd ~/dojojin-docs
claude
```

---

## Step 2 — Prompt Template

คัดลอก prompt นี้ปรับ `[สรุปสิ่งที่เปลี่ยน]` ตาม diff ที่ triage ไว้:

```
I'm updating public engineering documentation after an upstream product change.

Context:
- docs.dojojin.tech — public portfolio/engineering docs, built with VitePress
- Audience: potential clients, technical evaluators, engineers. No internal team.
- Public docs are a CURATED SUBSET of internal docs — NOT 1:1.

Upstream change summary:
[สรุปสิ่งที่เปลี่ยน เช่น "vigil-platform เพิ่ม ONVIF generic event ingestion
และเปลี่ยน heartbeat cycle จาก 90s เป็น 60s"]

Files to read first:
1. docs/projects/vigil-platform.md       ← current public EN
2. docs/th/projects/vigil-platform.md    ← current public TH
3. _upstream/vigil-platform/[RELEVANT FILE]  ← source material
# ถ้า update vigil-mobile ให้เปลี่ยน vigil-platform → vigil-mobile ในทุกบรรทัดข้างต้น

Then:
1. Show me what the public doc currently says vs what needs updating
2. Propose specific edits — do NOT rewrite sections that are still accurate
3. Apply nothing until I confirm each change

STRICT CONTENT RULES — never include in public docs:
- Client names, site names, deployment locations
- Pricing, licensing cost, or procurement details
- SQL queries, API endpoints, or raw code snippets
- Security audit findings or vulnerability descriptions
- Files: EULA*, cost/*, audit/*, REF_security-*, REF_operator-*
- Staff names or contact information
- Roadmap items marked "internal" or "not publicly announced"
```

---

## Step 3 — Thai version sync

หลัง EN เสร็จและ confirm แล้ว ต่อใน session เดิม:

```
Apply equivalent changes to docs/th/projects/vigil-platform.md
(and vigil-mobile.md if applicable).
Match the structure exactly. Keep all Thai language text —
only update factual content that changed (versions, capabilities, timings).
```

ตรวจ Thai output ให้ละเอียดกว่า EN — translation error ตรวจยากกว่า

---

## Step 4 — Pre-deploy checklist

```bash
# 1. Build ต้องผ่านสะอาด
npm run docs:build

# 2. เช็คข้อมูลที่ไม่ควรหลุด (ครอบคลุม EN + TH ทั้งหมด)
grep -r "client\|customer\|ลูกค้า\|ราคา" docs/ | grep -v ".vitepress"
# ตรวจ hit ทุกรายการ — false positive โอเค แต่ชื่อ client จริงไม่ได้

# 3. เช็คไฟล์ที่ห้ามลง (ครอบคลุม EN + TH ทั้งหมด)
grep -r "EULA\|REF_security\|REF_operator\|cost/" docs/ | grep -v ".vitepress"
# คาดหวัง: ไม่มีผล

# 4. ดูผลในใน browser
npm run docs:preview
# เปิด http://localhost:4173 คลิกดูหน้าที่แก้
```

---

## Step 5 — Commit + Merge + Deploy

```bash
# Stage เฉพาะไฟล์ docs/ ที่แก้ (ไม่ต้อง stage _upstream/ — commit แล้วตั้งแต่ CI pull)
git add docs/projects/vigil-platform.md
git add docs/th/projects/vigil-platform.md
# เพิ่ม vigil-mobile.md ถ้าแก้ด้วย

git commit -m "docs: update vigil-platform public docs after upstream sync YYYY-MM-DD"

# Merge บน GitHub: ไปที่ PR → Remove draft → Merge
# หรือ merge locally:
git checkout main
git merge upstream-sync/YYYY-MM-DD-XXXXXXXX --no-ff \
  -m "merge: upstream sync YYYY-MM-DD — docs updated"
git push

# Deploy ไปยัง docs.dojojin.tech
bash deploy.sh
```

---

## Step 6 — ตรวจสอบหลัง deploy

```bash
# เช็คว่าเว็บ live อัปเดทแล้ว
curl -s https://docs.dojojin.tech/projects/vigil-platform | grep -o '<title>[^<]*</title>'

# ถ้า browser cache ค้าง: Ctrl+Shift+R
```

---

## ไฟล์ที่ห้ามนำเนื้อหาขึ้น public docs

| ไฟล์ | เหตุผล |
|---|---|
| `EULA-th.md` | Legal / licensing — internal |
| `cost/*` | ข้อมูลราคา |
| `audit/*` | Security audit findings |
| `REF_security-checklist.md` | Attack surface details |
| `REF_operator-sql.md` | Raw SQL queries |
| `REF_database-schema*.md` | Full schema |
| `LOGIC_license.md` | License enforcement internals |
| `CLAUDE_Audit.MD`, `CODEX_*.md` | AI session transcripts |
| `DECISIONS.md`, `GOTCHAS.md` | Internal technical debt |

## ไฟล์ที่ใช้เป็น source ได้ (abstracted)

`INTEGRATION.md`, `LOGIC_camera-ingesters.md`, `LOGIC_line-notifications.md`,
`LOGIC_map-features.md`, `LOGIC_stats-reports.md`, `REF_face-recognition.md`,
`REF_third-party-integration_EN.md`
