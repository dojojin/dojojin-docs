# Upstream Sync Plan — dojojin-docs

แผนทำให้ docs.dojojin.tech อัปเดทอัตโนมัติเมื่อ vigil-platform หรือ vigil-mobile มีการเปลี่ยนแปลง

**Strategy:** B (Git Subtree) + C (GitHub Actions) + E (Claude-assisted rewrite)  
**เหตุผล:** เนื้อหา public doc เป็น curated subset — ต้องผ่าน human review ก่อน deploy เสมอ ห้าม auto-deploy

---

## Process Overview (หลัง implement ครบ 3 Phase)

```
upstream repo มีการ push ใหม่
        ↓
วันจันทร์ 15:00 น. — GitHub Actions ตรวจ drift
        ↓ (ถ้าเปลี่ยน)
Actions ดึง _upstream/ มาอัปเดท → เปิด draft PR + แจ้งเตือน
        ↓
ผมอ่าน PR → Claude session → แก้ EN + TH → review → deploy เอง
```

| ขั้นตอน | ใครทำ | เวลา |
|---|---|---|
| ตรวจและแจ้งเตือน | อัตโนมัติ | — |
| อ่าน diff + ตัดสินใจ | ผม | 5 นาที |
| แก้เนื้อหา (EN + TH) | Claude + ผม review | 20–30 นาที |
| Deploy | ผม (manual เสมอ) | 2 นาที |

---

## Phase 1 — Git Subtree

**เป้าหมาย:** pull source จาก upstream เข้า `_upstream/` ใน dojojin-docs เพื่อ reference ได้เสมอ  
**ประโยชน์ทันที:** `git diff HEAD~1 HEAD -- _upstream/` ดูได้ว่าอะไรเปลี่ยนไป  
**เวลา:** 20–30 นาที

### 1.1 ตรวจ working tree ก่อน

```bash
cd ~/dojojin-docs
git status    # ต้อง clean ก่อน
```

### 1.2 Add vigil-platform subtree

```bash
git subtree add \
  --prefix _upstream/vigil-platform \
  git@github.com:dojojin/vigil-platform.git \
  main \
  --squash
```

### 1.3 Add vigil-mobile subtree

```bash
git subtree add \
  --prefix _upstream/vigil-mobile \
  git@github.com:dojojin/vigil-mobile.git \
  main \
  --squash
```

> ถ้า vigil-mobile ใช้ branch `master` ให้เปลี่ยน `main` เป็น `master`  
> เช็คด้วย: `git ls-remote git@github.com:dojojin/vigil-mobile.git HEAD`

### 1.4 อัปเดท .gitignore

เพิ่มท้าย `.gitignore`:

```gitignore
# upstream subtree build artifacts
_upstream/vigil-platform/node_modules/
_upstream/vigil-platform/dist/
_upstream/vigil-mobile/node_modules/
_upstream/vigil-mobile/dist/
_upstream/vigil-mobile/.expo/
_upstream/vigil-mobile/android/
_upstream/vigil-mobile/ios/
```

```bash
git add .gitignore
git commit -m "chore: update .gitignore for upstream subtree artifacts"
```

### 1.5 สร้าง update-upstream.sh

สร้างไฟล์ `~/dojojin-docs/update-upstream.sh`:

```bash
#!/usr/bin/env bash
# update-upstream.sh — pull latest from vigil-platform and vigil-mobile subtrees
# Usage: bash update-upstream.sh [vigil-platform|vigil-mobile|all]
# Default (no arg): updates both

set -euo pipefail

TARGET="${1:-all}"
PLATFORM_REMOTE="git@github.com:dojojin/vigil-platform.git"
MOBILE_REMOTE="git@github.com:dojojin/vigil-mobile.git"
PLATFORM_BRANCH="main"
MOBILE_BRANCH="main"

cd "$(git rev-parse --show-toplevel)"

if ! git diff --quiet || ! git diff --staged --quiet; then
  echo "ERROR: working tree is not clean. Commit or stash changes first." >&2
  exit 1
fi

update_platform() {
  echo "==> Pulling vigil-platform (squash)..."
  git subtree pull \
    --prefix _upstream/vigil-platform \
    "$PLATFORM_REMOTE" \
    "$PLATFORM_BRANCH" \
    --squash \
    -m "chore(upstream): pull vigil-platform $(date +%Y-%m-%d)"
  echo "    Done."
}

update_mobile() {
  echo "==> Pulling vigil-mobile (squash)..."
  git subtree pull \
    --prefix _upstream/vigil-mobile \
    "$MOBILE_REMOTE" \
    "$MOBILE_BRANCH" \
    --squash \
    -m "chore(upstream): pull vigil-mobile $(date +%Y-%m-%d)"
  echo "    Done."
}

case "$TARGET" in
  vigil-platform) update_platform ;;
  vigil-mobile)   update_mobile ;;
  all)
    update_platform
    update_mobile
    ;;
  *)
    echo "Usage: $0 [vigil-platform|vigil-mobile|all]" >&2
    exit 1
    ;;
esac

echo ""
echo "Upstream sync complete. Review the diff:"
echo "  git diff HEAD~1 HEAD -- _upstream/"
echo ""
echo "Then start a Claude session with the docs rewrite workflow."
```

```bash
chmod +x ~/dojojin-docs/update-upstream.sh
git add update-upstream.sh
git commit -m "chore: add update-upstream.sh for git subtree pulls"
git push
```

### 1.6 ตรวจสอบ

```bash
ls _upstream/vigil-platform/
ls _upstream/vigil-mobile/
git ls-files _upstream/ | wc -l    # ต้อง > 0
git log --oneline -6
```

---

## Phase 2 — GitHub Actions: Weekly Drift Detection + Draft PR

**เป้าหมาย:** แจ้งเตือนอัตโนมัติเมื่อ upstream เปลี่ยน ไม่ต้องคอยเช็คเอง  
**เวลา:** 45–60 นาที (ส่วนใหญ่เป็น GitHub UI)

### 2.1 สร้าง Deploy Keys (ทำบน local machine)

```bash
# Key สำหรับ vigil-platform
ssh-keygen -t ed25519 -C "dojojin-docs-actions-vigil-platform" \
  -f ~/.ssh/dojojin_docs_ci_platform -N ""

# Key สำหรับ vigil-mobile
ssh-keygen -t ed25519 -C "dojojin-docs-actions-vigil-mobile" \
  -f ~/.ssh/dojojin_docs_ci_mobile -N ""
```

### 2.2 ลง Deploy Keys ใน GitHub (GitHub UI)

**vigil-platform:**
- ไปที่ `github.com/dojojin/vigil-platform` → Settings → Deploy keys → Add deploy key
- Title: `dojojin-docs CI read`
- Key: วาง contents ของ `~/.ssh/dojojin_docs_ci_platform.pub`
- Allow write access: **ปิด**

**vigil-mobile:**
- ไปที่ `github.com/dojojin/vigil-mobile` → Settings → Deploy keys → Add deploy key
- Title: `dojojin-docs CI read`
- Key: วาง contents ของ `~/.ssh/dojojin_docs_ci_mobile.pub`
- Allow write access: **ปิด**

### 2.3 เพิ่ม Secrets ใน dojojin-docs (GitHub UI)

ไปที่ `github.com/dojojin/dojojin-docs` → Settings → Secrets and variables → Actions

| Secret name | Value |
|---|---|
| `VIGIL_PLATFORM_DEPLOY_KEY` | contents ของ `~/.ssh/dojojin_docs_ci_platform` (private key) |
| `VIGIL_MOBILE_DEPLOY_KEY` | contents ของ `~/.ssh/dojojin_docs_ci_mobile` (private key) |

### 2.4 ตั้ง Workflow permissions (GitHub UI)

`github.com/dojojin/dojojin-docs` → Settings → Actions → General → Workflow permissions  
→ เลือก **"Read and write permissions"** → Save

### 2.5 สร้าง label (terminal)

```bash
cd ~/dojojin-docs
gh label create "upstream-sync" \
  --description "Automated upstream content sync — requires human review" \
  --color "0075ca"
```

### 2.6 สร้าง workflow file

สร้างไฟล์ `~/dojojin-docs/.github/workflows/upstream-sync-check.yml`:

```yaml
name: Upstream Sync Check

on:
  schedule:
    - cron: '0 8 * * 1'  # ทุกวันจันทร์ 08:00 UTC (15:00 Bangkok)
  workflow_dispatch:
    inputs:
      dry_run:
        description: 'Dry run — report drift but do not open a PR'
        type: boolean
        default: false

permissions:
  contents: write
  pull-requests: write

jobs:
  check-upstream:
    runs-on: ubuntu-latest
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

    steps:
      - name: Configure SSH agent
        uses: webfactory/ssh-agent@v0.9.0
        with:
          ssh-private-key: |
            ${{ secrets.VIGIL_PLATFORM_DEPLOY_KEY }}
            ${{ secrets.VIGIL_MOBILE_DEPLOY_KEY }}

      - name: Add GitHub to known_hosts
        run: |
          mkdir -p ~/.ssh
          ssh-keyscan github.com >> ~/.ssh/known_hosts

      - name: Checkout dojojin-docs
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Configure git identity
        run: |
          git config user.email "actions@github.com"
          git config user.name "GitHub Actions"

      - name: Detect vigil-platform drift
        id: platform_drift
        run: |
          REMOTE_SHA=$(git ls-remote git@github.com:dojojin/vigil-platform.git HEAD | awk '{print $1}')
          echo "Remote vigil-platform HEAD: $REMOTE_SHA"

          LOCAL_SHA=$(git log --oneline --grep="Squashed '_upstream/vigil-platform/'" \
            | head -1 | awk '{print $1}')

          if [ -z "$LOCAL_SHA" ]; then
            echo "drifted=true" >> "$GITHUB_OUTPUT"
            echo "remote_sha=$REMOTE_SHA" >> "$GITHUB_OUTPUT"
            echo "local_sha=none" >> "$GITHUB_OUTPUT"
          else
            EMBEDDED_SHA=$(git show "$LOCAL_SHA" --format="%B" -s \
              | grep "git-subtree-split:" | awk '{print $2}')
            if [ "$REMOTE_SHA" != "$EMBEDDED_SHA" ]; then
              echo "drifted=true" >> "$GITHUB_OUTPUT"
            else
              echo "drifted=false" >> "$GITHUB_OUTPUT"
            fi
            echo "remote_sha=$REMOTE_SHA" >> "$GITHUB_OUTPUT"
            echo "local_sha=$EMBEDDED_SHA" >> "$GITHUB_OUTPUT"
          fi

      - name: Detect vigil-mobile drift
        id: mobile_drift
        run: |
          REMOTE_SHA=$(git ls-remote git@github.com:dojojin/vigil-mobile.git HEAD | awk '{print $1}')
          echo "Remote vigil-mobile HEAD: $REMOTE_SHA"

          LOCAL_SHA=$(git log --oneline --grep="Squashed '_upstream/vigil-mobile/'" \
            | head -1 | awk '{print $1}')

          if [ -z "$LOCAL_SHA" ]; then
            echo "drifted=true" >> "$GITHUB_OUTPUT"
            echo "remote_sha=$REMOTE_SHA" >> "$GITHUB_OUTPUT"
            echo "local_sha=none" >> "$GITHUB_OUTPUT"
          else
            EMBEDDED_SHA=$(git show "$LOCAL_SHA" --format="%B" -s \
              | grep "git-subtree-split:" | awk '{print $2}')
            if [ "$REMOTE_SHA" != "$EMBEDDED_SHA" ]; then
              echo "drifted=true" >> "$GITHUB_OUTPUT"
            else
              echo "drifted=false" >> "$GITHUB_OUTPUT"
            fi
            echo "remote_sha=$REMOTE_SHA" >> "$GITHUB_OUTPUT"
            echo "local_sha=$EMBEDDED_SHA" >> "$GITHUB_OUTPUT"
          fi

      - name: Exit if no drift
        if: |
          steps.platform_drift.outputs.drifted == 'false' &&
          steps.mobile_drift.outputs.drifted == 'false'
        run: |
          echo "No upstream changes detected. Nothing to do."
          exit 0

      - name: Create sync branch
        if: |
          (steps.platform_drift.outputs.drifted == 'true' ||
           steps.mobile_drift.outputs.drifted == 'true') &&
          inputs.dry_run != true
        run: |
          BRANCH="upstream-sync/$(date +%Y-%m-%d)"
          git checkout -b "$BRANCH"
          echo "SYNC_BRANCH=$BRANCH" >> "$GITHUB_ENV"

      - name: Pull vigil-platform subtree
        if: |
          steps.platform_drift.outputs.drifted == 'true' &&
          inputs.dry_run != true
        run: |
          git subtree pull \
            --prefix _upstream/vigil-platform \
            git@github.com:dojojin/vigil-platform.git \
            main \
            --squash \
            -m "chore(upstream): pull vigil-platform $(date +%Y-%m-%d) [CI]"

      - name: Pull vigil-mobile subtree
        if: |
          steps.mobile_drift.outputs.drifted == 'true' &&
          inputs.dry_run != true
        run: |
          git subtree pull \
            --prefix _upstream/vigil-mobile \
            git@github.com:dojojin/vigil-mobile.git \
            main \
            --squash \
            -m "chore(upstream): pull vigil-mobile $(date +%Y-%m-%d) [CI]"

      - name: Generate diff summary
        if: inputs.dry_run != true
        id: diff_summary
        run: |
          {
            echo 'body<<HEREDOC'
            echo '## Upstream Sync — '"$(date +%Y-%m-%d)"
            echo ''
            echo 'This draft PR was opened automatically. **Do not merge without reviewing.**'
            echo ''
            echo '---'
            echo ''
            if [ "${{ steps.platform_drift.outputs.drifted }}" = "true" ]; then
              echo '### vigil-platform changes'
              echo ''
              echo "Previously synced: \`${{ steps.platform_drift.outputs.local_sha }}\`"
              echo "Current remote HEAD: \`${{ steps.platform_drift.outputs.remote_sha }}\`"
              echo ''
              echo '**Files changed:**'
              echo '```'
              git diff HEAD~1 HEAD -- _upstream/vigil-platform/ --stat 2>/dev/null | head -40 || true
              echo '```'
              echo ''
            fi
            if [ "${{ steps.mobile_drift.outputs.drifted }}" = "true" ]; then
              echo '### vigil-mobile changes'
              echo ''
              echo "Previously synced: \`${{ steps.mobile_drift.outputs.local_sha }}\`"
              echo "Current remote HEAD: \`${{ steps.mobile_drift.outputs.remote_sha }}\`"
              echo ''
              echo '**Files changed:**'
              echo '```'
              git diff HEAD~1 HEAD -- _upstream/vigil-mobile/ --stat 2>/dev/null | head -40 || true
              echo '```'
              echo ''
            fi
            echo '---'
            echo ''
            echo '## Next steps'
            echo ''
            echo '1. Pull branch locally: `git fetch origin && git checkout '"$SYNC_BRANCH"'`'
            echo '2. Review diff: `git diff main -- _upstream/`'
            echo '3. Follow `UPSTREAM-WORKFLOW.md`'
            echo '4. Update public docs, remove draft status, merge'
            echo '5. Run `bash deploy.sh` on the server'
            echo ''
            echo '**Never auto-merge. Deploy is always manual.**'
            echo 'HEREDOC'
          } >> "$GITHUB_OUTPUT"

      - name: Push sync branch
        if: inputs.dry_run != true
        run: git push origin "$SYNC_BRANCH"

      - name: Open draft PR
        if: inputs.dry_run != true
        run: |
          gh pr create \
            --title "upstream sync $(date +%Y-%m-%d) — review required" \
            --body "${{ steps.diff_summary.outputs.body }}" \
            --draft \
            --base main \
            --head "$SYNC_BRANCH" \
            --label "upstream-sync"

      - name: Dry run summary
        if: inputs.dry_run == true
        run: |
          echo "=== DRY RUN — no PR opened ==="
          echo "vigil-platform drifted: ${{ steps.platform_drift.outputs.drifted }}"
          echo "vigil-mobile drifted: ${{ steps.mobile_drift.outputs.drifted }}"
```

```bash
mkdir -p ~/dojojin-docs/.github/workflows
# (วางไฟล์ด้านบน)
git add .github/workflows/upstream-sync-check.yml
git commit -m "ci: add upstream sync check workflow (weekly, draft PR)"
git push
```

### 2.7 ทดสอบ

ไปที่ `github.com/dojojin/dojojin-docs` → Actions → "Upstream Sync Check"  
→ Run workflow → เลือก **dry_run = true** → Run  
ตรวจ log ว่า SSH ต่อ private repo ได้ และ drift detection ทำงานถูกต้อง

---

## Phase 3 — Claude-Assisted Workflow (Documented Process)

**เป้าหมาย:** process มาตรฐานที่ทำซ้ำได้ ไม่ต้องจำทุกครั้งว่าต้องเช็คอะไร  
**เวลา:** 30 นาที (สร้างไฟล์ + ทดลอง run ครั้งแรก)

### 3.1 สร้าง UPSTREAM-WORKFLOW.md

สร้างไฟล์ `~/dojojin-docs/UPSTREAM-WORKFLOW.md`:

```markdown
# Upstream Sync — Repeatable Workflow

เปิดไฟล์นี้ทุกครั้งที่มี `upstream-sync/*` PR เข้ามา
เวลาต่อ update cycle: ~30 นาที

---

## Step 0 — Triage (5 นาที)

```bash
git fetch origin
git checkout upstream-sync/YYYY-MM-DD
git diff main -- _upstream/vigil-platform/ | head -80
git diff main -- _upstream/vigil-mobile/ | head -80
```

ถามตัวเองว่าสิ่งที่เปลี่ยนกระทบ public docs ไหม:
- [ ] เป็นฟีเจอร์ใหม่ หรือเปลี่ยน capability ที่อธิบายไว้อยู่แล้ว?
- [ ] หรือเป็น internal เท่านั้น (SQL, bug fix, code)?

ถ้า internal เท่านั้น → ปิด PR, comment "internal-only — no public doc update needed", เสร็จ

---

## Step 1 — เปิด Claude Code session

```bash
cd ~/dojojin-docs
claude
```

---

## Step 2 — Prompt Template

```
I'm updating public engineering documentation after an upstream product change.

Context:
- docs.dojojin.tech — public portfolio/engineering docs, VitePress
- Audience: potential clients, technical evaluators, engineers
- Public docs are a CURATED SUBSET of internal docs — NOT 1:1

Upstream change summary:
[สรุปสิ่งที่เปลี่ยน เช่น "vigil-platform เพิ่ม ONVIF generic event ingestion และเปลี่ยน heartbeat 90s → 60s"]

Files to read first:
1. docs/projects/vigil-platform.md  (current public EN)
2. docs/th/projects/vigil-platform.md  (current public TH)
3. _upstream/vigil-platform/[RELEVANT FILE]

Then:
1. Show me what the public doc currently says vs what needs updating
2. Propose specific edits — do not rewrite sections that are still accurate
3. Apply nothing until I confirm each change

STRICT CONTENT RULES — never include:
- Client names, site names, deployment locations
- Pricing, licensing cost details
- SQL queries, API endpoints, raw code
- Security audit findings / vulnerability details
- Files: EULA*, cost/*, audit/*, REF_security-*, REF_operator-*
- Staff names, contact info
- Roadmap items marked "internal" or "not announced"
```

---

## Step 3 — Thai version sync

หลัง EN เสร็จแล้ว:

```
Apply equivalent changes to docs/th/projects/vigil-platform.md
(and vigil-mobile.md if applicable).
Match structure exactly. Keep Thai language — only update factual content
that changed (versions, capabilities, timings).
```

---

## Step 4 — Pre-deploy checklist

```bash
# Build ต้องผ่าน
npm run docs:build

# เช็คข้อมูลที่ไม่ควรหลุด
grep -r "client\|customer\|ลูกค้า\|ราคา" docs/projects/ | grep -v ".vitepress"

# ดูใน browser
npm run docs:preview
```

---

## Step 5 — Commit + Deploy

```bash
git add docs/projects/vigil-platform.md
git add docs/th/projects/vigil-platform.md
# เพิ่ม vigil-mobile.md ถ้าแก้ด้วย

git commit -m "docs: update vigil-platform public docs after upstream sync YYYY-MM-DD"
git checkout main
git merge upstream-sync/YYYY-MM-DD --no-ff \
  -m "merge: upstream sync YYYY-MM-DD — docs updated"
git push

bash deploy.sh
```

---

## ไฟล์ที่ห้ามนำเนื้อหาขึ้น public docs

| ไฟล์ | เหตุผล |
|---|---|
| `EULA-th.md` | Legal / licensing — internal |
| `cost/*` | ข้อมูลราคา |
| `audit/*` | Security audit findings |
| `REF_security-checklist.md` | Attack surface details |
| `REF_operator-sql.md` | Raw SQL |
| `REF_database-schema*.md` | Full schema |
| `LOGIC_license.md` | License enforcement internals |
| `CLAUDE_Audit.MD`, `CODEX_*.md` | AI session transcripts |
| `DECISIONS.md`, `GOTCHAS.md` | Internal technical debt |

## ไฟล์ที่ใช้เป็น source ได้ (abstracted)

`INTEGRATION.md`, `LOGIC_camera-ingesters.md`, `LOGIC_line-notifications.md`,
`LOGIC_map-features.md`, `LOGIC_stats-reports.md`, `REF_face-recognition.md`,
`REF_third-party-integration_EN.md`
```

### 3.2 สร้าง CLAUDE.md ใน dojojin-docs

สร้างไฟล์ `~/dojojin-docs/CLAUDE.md`:

```markdown
# CLAUDE.md — dojojin-docs

VitePress 1.6.4 docs site สำหรับ docs.dojojin.tech

## Commands
```bash
npm run docs:dev      # dev server → http://localhost:5173
npm run docs:build    # build → docs/.vitepress/dist/
npm run docs:preview  # preview built output
bash deploy.sh        # build + rsync → /var/www/dojojin-docs/ (ต้องใช้ sudo)
bash update-upstream.sh  # pull latest upstream subtrees
```

## โครงสร้างไฟล์
- `docs/projects/` — public docs ภาษาอังกฤษ
- `docs/th/projects/` — Thai translations (sync กับ EN เสมอ)
- `_upstream/vigil-platform/` — internal source (git subtree, อ่านอย่างเดียว)
- `_upstream/vigil-mobile/` — internal source (git subtree, อ่านอย่างเดียว)

## Content Rules — STRICT

**ห้ามลงใน public docs:**
- ชื่อ client, site, deployment location
- ราคา, ค่าใช้จ่าย, รายละเอียด license
- SQL queries, API endpoints, code snippet
- Security audit findings
- ชื่อพนักงาน, ข้อมูลติดต่อ
- Roadmap ที่ยังไม่ประกาศสาธารณะ

**ไฟล์ภายในที่ห้าม expose:** EULA*, cost/*, audit/*, REF_security-*, REF_operator-sql*, REF_database-schema*, DECISIONS.md, GOTCHAS.md, CODEX_*, CLAUDE_Audit*

## Upstream sync workflow
เมื่อ checkout branch `upstream-sync/*` ให้อ่าน `UPSTREAM-WORKFLOW.md`
```

### 3.3 Commit และ push

```bash
cd ~/dojojin-docs
git add UPSTREAM-WORKFLOW.md CLAUDE.md
git commit -m "docs: add upstream sync workflow guide and CLAUDE.md"
git push
```

---

## สรุปไฟล์ที่จะมีในระบบหลังทำครบ 3 Phase

| ไฟล์ | Phase | หน้าที่ |
|---|---|---|
| `_upstream/vigil-platform/` | 1 | Git subtree snapshot |
| `_upstream/vigil-mobile/` | 1 | Git subtree snapshot |
| `.gitignore` (updated) | 1 | ไม่ commit build artifacts ของ upstream |
| `update-upstream.sh` | 1 | Manual pull script |
| `.github/workflows/upstream-sync-check.yml` | 2 | Weekly drift + draft PR |
| `UPSTREAM-WORKFLOW.md` | 3 | Human review + deploy checklist |
| `CLAUDE.md` | 3 | Context สำหรับ Claude Code session |

---

## Gotchas

- **`git subtree` กับ commit message** — workflow หา squash commit ด้วย string `"Squashed '_upstream/vigil-platform/'"` ห้ามเปลี่ยน `-m` ใน `update-upstream.sh` หรือจะ grep ไม่เจอและ workflow จะแจ้งว่า drift ตลอด
- **Branch ซ้ำวันเดียวกัน** — ถ้า trigger Actions 2 ครั้งใน Monday เดียวกัน ครั้งที่ 2 จะ fail เพราะ branch ชื่อซ้ำ แก้โดยลบ branch เก่าก่อน
- **vigil-mobile branch name** — ถ้าใช้ `master` ให้แก้ `MOBILE_BRANCH` ใน `update-upstream.sh` และ workflow
- **ห้าม auto-deploy** — `rsync` ไป production ต้องเป็น manual command เสมอ ไม่ว่ากรณีใด
