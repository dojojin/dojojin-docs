# AGENTS.md — Vigil Platform

> **Codex / AI agent operating guide**
> Last updated: 2026-06-08
>
> This file is a **Codex-specific overlay**. Do **not** edit `CLAUDE.md` for Codex behavior because this repository is shared with Claude Code.

---

## 0. Purpose of this file

`CLAUDE.md` remains the shared project handoff and the source of project context.
`AGENTS.md` controls how **Codex** should behave in this repository.

Use this file to prevent context loss when Codex takes over work that was originally done with Claude Code.

---

## 1. Required reading order

Before meaningful work, read in this order:

1. `AGENTS.md` — Codex behavior and conflict rules
2. `CODEX_SESSION_START.md` — session startup checklist and handoff prompt
3. `CLAUDE.md` — shared AI handoff / project overview
4. `ARCHITECTURE.md` — current system shape, stack, schema, data flow
5. `DECISIONS.md` — numbered decisions; do not casually reverse them
6. `GOTCHAS.md` — real incidents and footguns; do not rediscover old bugs
7. `ROADMAP.md` — pending work and strategic direction
8. `SKILL.md` — operator playbook, troubleshooting, SQL snippets
9. `service_start.md` — daily start / stop / recovery commands, if present

When a task mentions Dahua, Dahua CGI, Dahua snapshots, Dahua timing, `DAHUA_CAM01`, or `BMA-EAST_DAHUA_CAM01`, also read:

```text
DahuaProblem.MD
```

Treat `DahuaProblem.MD` as the live incident/problem log for Dahua snapshot timing and recovery work.

When a task touches UI, CSS, layout, a new page, icons, status badges, or report styling, also read:

```text
DESIGN.md
```

Treat `DESIGN.md` as the canonical design system (tokens, SVG icon system, no-emoji rule, component patterns).

If time or context is limited, read at minimum:

```text
AGENTS.md → CODEX_SESSION_START.md → CLAUDE.md → DECISIONS.md → GOTCHAS.md
```

---

## 2. Conflict rules

When documents disagree:

1. The user’s explicit instruction in the current session wins.
2. `AGENTS.md` wins for Codex behavior.
3. `CLAUDE.md` wins for shared project context and owner preferences.
4. `DECISIONS.md` wins over generic best practices or refactor preferences.
5. `GOTCHAS.md` wins when it documents a real project incident.
6. `ARCHITECTURE.md` wins for current system shape.
7. `ROADMAP.md` wins for planned work, not shipped behavior.

Codex must not edit `CLAUDE.md` unless the owner explicitly asks.

---

## 3. Core working agreement

Always follow **investigate-first**.

Before editing code:

1. Inspect real files, schema, logs, git status, and relevant docs.
2. Separate verified facts from assumptions.
3. Report findings as:
   - **Fact** — verified from files, schema, git, logs, or decision numbers.
   - **Opinion** — recommendation, trade-off, and proposed plan.
4. Wait for owner approval before making changes.

Exception: if the user already says `ทำเลย`, `จัดการเลย`, `ต่อเลย`, `ลุยเลย`, or clearly approves the plan, proceed without asking again.

**Reproduce-before-fix (bug / unexpected-behavior tasks only — mirrors CLAUDE.md Working Agreement #3, decisions #146–#147):**

- Before proposing a fix, reproduce the bug at runtime: run the real SQL against the real schema, hit the real endpoint and inspect the real response shape, read real logs / Network / DevTools. Do not guess payload shapes.
- If you cannot reproduce it, say so plainly — the proposed fix is then an **Opinion (hypothesis)**, not a **Fact**.
- Fix root cause, not symptom.
- **Verify-after:** re-run the original repro until green + check nearby regressions. "Code written" is not "done" until verified.
- **Capture (hybrid guard tier):** log / warn / metric / non-throwing assert → add as part of the fix; throw / reject / behavior-changing validation (esp. MQTT ingest, WS `verifyClient`, migrations) → propose and wait for approval. If it's a real footgun, propose a `GOTCHAS.md` entry.

After editing code or docs:

- Summarize what changed.
- List files changed.
- List validation performed.
- State honestly what was not validated.
- Provide git commands if the user asks for commit guidance.

---

## 4. Codex behavior rules

Codex must behave like a careful production engineer, not a speculative code generator.

Required behavior:

- Read before writing.
- Prefer small, reviewable patches.
- Preserve existing architecture and conventions.
- Do not rewrite large files just to make style changes.
- Do not invent missing APIs, table columns, routes, or config fields.
- Do not expose secrets from `.env`, camera credentials, LINE tokens, imgbb keys, license keys, or customer data.
- Do not push commits unless explicitly asked.
- Do not add `Co-Authored-By` trailers.
- When unsure, ask one specific question only.
- If the user already gave enough context, make the safest reasonable assumption and state it.

---

## 5. Non-negotiable project rules

Do not propose or implement these unless the owner explicitly reopens the decision:

- Do not rewrite the frontend to React, Vue, Svelte, Next.js, or another framework.
- Do not add an ORM such as Prisma, Drizzle, Sequelize, or TypeORM.
- Do not simplify authentication back to cookie-only. Safari ITP requires the existing multi-layer auth approach.
- Do not make `/snapshots/*`, `/media/*`, dashboard assets, or private static files public.
- Do not bypass license or EULA gates.
- Do not replace raw SQL patterns without a concrete project reason.
- Do not edit `init.sql` as the only way to evolve an existing database schema.
- Do not break Thai/English i18n parity.
- Do not remove Cloudflare cache-busting behavior for frontend assets.
- Do not pull in a UI framework / component library (incl. Material Web Components). "Material Design" here = principles + tokens only. Decision #142.
- Do not use an icon webfont or CDN icon asset — icons are self-hosted inline SVG sprites (`currentColor`). Decision #143.
- Do not put emoji in a server-side SVG report template — the `sharp`/librsvg/Pango Health Report PNG path aborts on missing emoji fallback fonts. Decision #144, GOTCHAS #25a (`_svgSafeText()`).
- Do not hardcode colors per surface — UI colors come from the tri-layer design token single source. Decision #145.
- Do not revert process management from PM2 back to `concurrently`. PM2 is the production daemon manager (`ecosystem.config.js`); `concurrently` is a dev tool and is no longer the process supervisor. Do not run `npm run start:all` — it redirects to an error message. Use `scripts/services.sh` or `pm2` directly. Decision #199.

---

## 6. UI / responsive / i18n rules

Mobile is first-class.

**Design system (canonical: `DESIGN.md`):**

- New UI follows the design system — colors/spacing/sizes from design tokens (CSS custom properties), never hardcoded; white-label must re-theme at `:root` only.
- Use inline SVG sprite icons (`currentColor`), not emoji and not an icon webfont.
- Do not add emoji as UI (icon / button / status / heading) in new code. Existing dashboard emoji (sidebar/sub-tabs/buttons) are grandfathered — replace with SVG opportunistically when you touch them, never in a sweep.
- Text/status colors must pass WCAG AA on the current surface.
- Charts (Chart.js) and maps (OpenLayers) must read the same tokens — no library default palettes.

For any UI, CSS, layout, modal, table, report preview, or new page:

- Check responsive behavior at `≤768px`.
- Avoid horizontal page scroll on mobile.
- For CSS Grid/Flex children with wide content, remember `min-width: 0`.
- Prefer page-scoped selectors for mobile overrides to avoid source-order conflicts.
- Keep Thai UI as the source language.
- Add every user-visible UI string to both `th` and `en` blocks in `dashboard/i18n.js`.
- For static markup, use `data-i18n`, `data-i18n-html`, `data-i18n-ph`, `data-i18n-title`, or `data-i18n-value` as appropriate.
- For dynamic JS strings, use `I18N.t('key', fallback)`.
- If adding date/time inputs, register them in the relevant `_DT_*_IDS` list in `dashboard.js`.
- Server-side rendered reports must have their own per-language label dictionary, following the existing `HR_LABELS.{th,en}` style where relevant.

Suggested i18n check:

```bash
grep -rn '[ก-๙]' dashboard/index.html dashboard/dashboard.js | grep -v 'data-i18n'
```

Review any result carefully; some Thai comments or the language switch label may be intentional.

---

## 7. Database and migration rules

For schema changes:

- Create a new migration file: `db/db_migration_<NNN>_<topic>.sql`.
- Use explicit numeric prefixes for new migrations.
- Make migrations idempotent where possible:
  - `CREATE TABLE IF NOT EXISTS`
  - `ADD COLUMN IF NOT EXISTS`
  - `CREATE INDEX IF NOT EXISTS`
  - `ON CONFLICT DO NOTHING`
  - defensive `DO $$ ... information_schema ... $$` blocks
- Do not delete, rename, or comment out a failing migration to “fix” startup.
- Migrations must be safe for existing volumes.
- Run or instruct the owner to run a backup before data-touching migrations.

Useful commands:

```bash
./scripts/backup.sh
cd src && npm run migrate
cd .. && ./scripts/services.sh start
```

Migration inspection:

```bash
docker exec -it vigil-postgres psql -U vigil_sql -d vigil_platform -c "
  SELECT filename, applied_at, duration_ms
  FROM schema_migrations
  ORDER BY filename;
"
```

---

## 8. JavaScript and backend conventions

- Preserve copyright headers in all `.js` files.
- Keep existing helper-first style.
- Use defensive DOM access in frontend code.
- Follow existing Express route and auth middleware patterns.
- Use raw SQL through `pg`.
- Keep auth-gated media and snapshot serving patterns.
- For monitoring additions, prefer extending existing health/report patterns unless there is a strong reason for a separate endpoint.
- For report rendering, avoid creating parallel templates unless explicitly approved; respect existing shared report template patterns.
- For camera data, respect the project’s source-of-truth split: config JSON for configured cameras and DB tables for runtime state/history.

Before claiming a JS change is safe, run relevant syntax checks where possible:

```bash
node --check src/api-server.js
node --check src/mqtt-subscriber.js
node --check src/report-renderer.js
node --check dashboard/dashboard.js
```

Run only checks relevant to changed files.

---

## 9. Security and confidentiality

This is proprietary CCTV / security operations software.

Never expose or casually print:

- `.env` contents
- camera credentials
- LINE channel tokens
- imgbb API keys
- license private keys
- customer data
- raw biometric/person-identifying data unless required for the task

When sharing logs, diffs, screenshots, or reports, mask sensitive values.

For route changes:

- Decide whether the route is public, authenticated, admin, auditor, or internal-token only.
- Keep write operations admin-gated unless an existing decision says otherwise.
- Do not leak DB dumps, media, snapshots, secrets, or personally identifiable data.

---

## 10. Validation checklist by change type

Frontend / UI:

- Check desktop layout.
- Check mobile `≤768px` layout.
- Verify i18n key parity for `th` and `en`.
- Hard refresh or inspect cache headers if Cloudflare/static cache is suspected.
- New icons/status use SVG (`currentColor`), not emoji; colors come from tokens, not hardcoded; status/text passes WCAG AA contrast.

Backend route:

- Verify auth level.
- Verify request validation.
- Verify error responses do not leak secrets.
- Verify path traversal protections for file-serving routes.

Database:

- Backup before destructive or data-touching changes.
- Run migration.
- Verify `schema_migrations` entry.
- Test against existing data shape, not only fresh schema.

Reports / Puppeteer:

- Check preview path.
- Check PDF path.
- Check PNG / LINE image path when relevant.
- Ensure image assets load before render-ready signal.
- Health Report PNG renders via SVG + `sharp` (not Puppeteer) — ensure NO emoji in that SVG template (librsvg/Pango aborts on missing emoji fallback fonts; GOTCHAS #25a, `_svgSafeText()` strips them). Analytics report = Puppeteer via `report-template.js`.

LINE / alerts:

- Respect cooldown.
- Respect quiet hours.
- Respect recipient filtering.
- Log report/history attempts where existing patterns require it.
- Remember LINE push quota and imgbb image hosting behavior.

---

## 11. Common commands

```bash
# Process management — use PM2 (not npm run start:all which is disabled)
./scripts/services.sh start        # start all 5 processes via PM2
./scripts/services.sh restart      # rolling restart all
./scripts/services.sh stop         # stop all (keep in PM2 list)
./scripts/services.sh status       # pm2 status table
./scripts/services.sh logs         # tail all logs

# Per-process PM2 commands
pm2 restart api-server             # restart one process
pm2 logs api-server --lines 30 --nostream   # last 30 lines then exit
pm2 jlist                          # JSON status (used by /api/health/details)

# Run migrations only
cd src && npm run migrate

# Manual backup
./scripts/backup.sh

# Restore backup
./scripts/restore.sh backups/<file>.dump

# PostgreSQL shell
docker exec -it vigil-postgres psql -U vigil_sql -d vigil_platform

# Check cloudflared root service on macOS host
ps aux | grep cloudflared | grep -v grep
sudo launchctl kickstart -k system/com.cloudflare.cloudflared
```

---

## 12. Git behavior

Default behavior:

- Show `git status` and relevant `git diff` summary before finalizing if code was changed.
- Do not commit unless asked.
- Do not push unless asked.
- Do not add `Co-Authored-By` trailers.

Suggested commit style:

```text
feat(reports): add health report history export
fix(auth): preserve internal-token bypass for auditor routes
docs(codex): add Codex operating guide
```

For this Codex handoff document set, use:

```text
docs(codex): add Codex handoff instructions
```

---

## 13. Communication style

The owner prefers Thai-first communication with English technical terms.

Use:

- Thai explanations.
- English commands, filenames, code symbols, and API names.
- Tables or structured bullets for decisions.
- Concrete commands over abstract advice.
- Clear separation of Fact / Opinion when investigating.

Avoid:

- Over-explaining basic Linux/Git concepts unless asked.
- Recommending architectural rewrites.
- Hiding uncertainty.
- Making broad changes without a focused reason.

---

## 14. Session start behavior

At the start of a new Codex session, Codex should do this:

1. Read `AGENTS.md`.
2. Read `CODEX_SESSION_START.md`.
3. Read the relevant parts of `CLAUDE.md`, `ARCHITECTURE.md`, `DECISIONS.md`, and `GOTCHAS.md`.
4. Run `git status --short`.
5. Identify which files are likely relevant before editing.
6. Report a short Fact / Opinion summary.
7. Only then patch.

Use `CODEX_SESSION_START.md` as the copy-paste prompt when opening Codex.

---

## 15. Codex-specific summary

Codex should treat this repo as production software.

Default stance:

1. Read first.
2. Confirm facts.
3. Respect decisions and gotchas.
4. Patch narrowly.
5. Validate honestly.
6. Report clearly in Thai.
