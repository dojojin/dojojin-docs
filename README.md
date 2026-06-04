# dojojin-docs

Source สำหรับ [docs.dojojin.tech](https://docs.dojojin.tech) — เอกสารวิศวกรรมของ DOJOJIN.TECH  
สร้างด้วย [VitePress](https://vitepress.dev/) รองรับ 2 ภาษา: English (`/`) และ ภาษาไทย (`/th/`)

---

## การพัฒนา

```bash
npm install
npm run docs:dev      # dev server → http://localhost:5173
npm run docs:build    # build → docs/.vitepress/dist/
npm run docs:preview  # preview ไฟล์ที่ build แล้ว
```

## Deploy ขึ้น docs.dojojin.tech

```bash
bash deploy.sh
```

script จะ build แล้ว rsync ไปที่ `/var/www/dojojin-docs/` บน server (ต้องการ sudo)

---

## โครงสร้างเนื้อหา

```
docs/
├── index.md                    ← หน้าแรก (EN)
├── projects/
│   ├── vigil-platform.md       ← Vigil Platform (EN)
│   ├── vigil-mobile.md         ← Vigil Mobile (EN)
│   └── ai-ocr-pipeline.md
├── guides/
└── th/                         ← ภาษาไทย (mirror structure)
    ├── index.md
    ├── projects/
    │   ├── vigil-platform.md
    │   └── vigil-mobile.md
    └── guides/
```

เนื้อหาภาษาไทยต้อง sync กับ EN เสมอ

---

## Upstream Sync (vigil-platform / vigil-mobile)

เนื้อหา public docs มาจาก internal docs ใน 2 repo:
- `github.com/dojojin/vigil-platform` → `_upstream/vigil-platform/`
- `github.com/dojojin/vigil-mobile` → `_upstream/vigil-mobile/`

ดึงเข้ามาด้วย git subtree (read-only) เพื่อใช้เป็น source material

### ตรวจสอบว่า upstream มีการเปลี่ยนแปลงไหม

**ทาง GitHub UI** (ทำจากมือถือได้):
1. ไปที่ `github.com/dojojin/dojojin-docs` → **Actions** → **"Upstream Sync Check"**
2. คลิก **"Run workflow"** → เลือก `dry_run = true` → **"Run workflow"**
3. ดู log — ถ้ามี drift จะแสดง SHA ของ commit ที่เปลี่ยน

**ทาง Terminal:**
```bash
# dry run — ดูว่ามี drift ไหม ไม่เปิด PR
gh workflow run upstream-sync-check.yml \
  --repo dojojin/dojojin-docs \
  --field dry_run=true

# ดู log แบบ real-time
gh run watch --repo dojojin/dojojin-docs
```

**บนเครื่อง local (ไม่ผ่าน Actions):**
```bash
bash update-upstream.sh        # pull upstream + แสดง diff hint
git diff HEAD~4 HEAD -- _upstream/
```

### ระบบแจ้งเตือนอัตโนมัติ

GitHub Actions รันทุก **วันจันทร์ 15:00 น.** (Bangkok time)  
ถ้า upstream เปลี่ยน → เปิด **draft PR** พร้อม diff summary → GitHub แจ้งเตือนทาง email / mobile app

### ถ้ามี diff ต้องทำอะไร

ดู **[UPSTREAM-WORKFLOW.md](./UPSTREAM-WORKFLOW.md)** — มี checklist ครบ 6 ขั้นตอน  
สรุปสั้น: triage → Claude session (แก้ EN + TH) → pre-deploy check → `bash deploy.sh`

---

## ไฟล์อ้างอิง

| ไฟล์ | หน้าที่ |
|---|---|
| `UPSTREAM-WORKFLOW.md` | Checklist ทำตามเมื่อมี upstream diff |
| `SYNC-PLAN.md` | แผน implementation ระบบ upstream sync (3 Phase) |
| `CLAUDE.md` | Context สำหรับ Claude Code session |
| `update-upstream.sh` | Script pull upstream subtrees แบบ manual |
| `deploy.sh` | Script build + deploy ขึ้น server |
