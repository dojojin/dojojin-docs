# CLAUDE.md — dojojin-docs

VitePress 1.6.4 docs site สำหรับ docs.dojojin.tech (English + Thai)

## Commands

```bash
npm run docs:dev      # dev server → http://localhost:5173
npm run docs:build    # build → docs/.vitepress/dist/
npm run docs:preview  # preview built output → http://localhost:4173
bash deploy.sh        # build + rsync → /var/www/dojojin-docs/ (ต้องใช้ sudo)
bash update-upstream.sh              # pull latest upstream subtrees (ทั้งคู่)
bash update-upstream.sh vigil-platform  # pull เฉพาะ vigil-platform
bash update-upstream.sh vigil-mobile    # pull เฉพาะ vigil-mobile
```

## โครงสร้างไฟล์

| Path | หน้าที่ |
|---|---|
| `docs/projects/` | Public docs ภาษาอังกฤษ |
| `docs/th/projects/` | Thai translations — ต้อง sync กับ EN เสมอ |
| `docs/.vitepress/config.js` | VitePress config (locales, nav, sidebar) |
| `_upstream/vigil-platform/` | Internal source จาก vigil-platform (git subtree, read-only) |
| `_upstream/vigil-mobile/` | Internal source จาก vigil-mobile (git subtree, read-only) |
| `UPSTREAM-WORKFLOW.md` | Checklist เมื่อมี upstream sync PR |
| `SYNC-PLAN.md` | แผน implementation ทั้ง 3 Phase |
| `deploy.sh` | Deploy script |

## Content Rules — STRICT

**ห้ามลงใน public docs เด็ดขาด:**
- ชื่อ client, site, deployment location จริง
- ราคา, ค่าใช้จ่าย, รายละเอียด license หรือ procurement
- SQL queries, API endpoints, raw code snippet
- Security audit findings หรือ vulnerability description
- ชื่อพนักงาน, ข้อมูลติดต่อภายใน
- Roadmap ที่ยังไม่ประกาศสาธารณะ (marked "internal")

**ไฟล์ upstream ที่ห้าม expose เนื้อหา:**
`EULA*`, `cost/*`, `audit/*`, `REF_security-*`, `REF_operator-sql*`,
`REF_database-schema*`, `LOGIC_license.md`, `LOGIC_auth-security.md`,
`LOGIC_infra-ops.md`, `LOGIC_nlq-search.md`, `DECISIONS.md`, `GOTCHAS.md`,
`CODEX_*.md`, `CLAUDE_Audit.MD`

**ไฟล์ upstream ที่ใช้เป็น source ได้ (ต้อง abstract ก่อน):**
`INTEGRATION.md`, `LOGIC_camera-ingesters.md`, `LOGIC_face-capture.md`,
`LOGIC_line-notifications.md`, `LOGIC_map-features.md`, `LOGIC_stats-reports.md`,
`REF_face-recognition.md`, `REF_third-party-integration_EN.md`,
`REF_troubleshooting.md`, `REF_vms-playback.md`

## Upstream Sync Workflow

เมื่อ checkout branch `upstream-sync/*` ให้อ่าน `UPSTREAM-WORKFLOW.md` ก่อนทำอะไร

ลำดับ: Triage → Claude session → แก้ EN → แก้ TH → pre-deploy checklist → deploy
