# CODEX_SESSION_START.md — Codex Startup Prompt

> Copy/paste this into Codex at the beginning of a new session in this repository.
> This file exists because the project was originally maintained with Claude Code, while Codex should be controlled by `AGENTS.md`.

---

## Prompt to Codex

You are working on the **Vigil Platform** repository.

This is production CCTV / security operations software. Work carefully.

Before editing anything, do the following:

1. Read `AGENTS.md` completely.
2. Read `CLAUDE.md` for shared project context. Treat Claude-specific model commands as informational only.
3. Read `ARCHITECTURE.md` for current system shape.
4. Read `DECISIONS.md` before questioning existing design.
5. Read `GOTCHAS.md` before debugging or changing behavior.
6. Read `DESIGN.md` if the task touches UI, CSS, layout, a new page, icons, status badges, or report styling.
7. Read `ROADMAP.md` if the task is a new feature or planning work.
8. Read `SKILL.md` if the task is operations, troubleshooting, SQL, reports, LINE, cameras, or i18n.
9. Read `DahuaProblem.MD` if the task mentions Dahua, Dahua CGI, Dahua snapshots, Dahua timing, `DAHUA_CAM01`, or `BMA-EAST_DAHUA_CAM01`.
10. Run:

```bash
git status --short
```

Then respond in Thai with:

```text
🔵 Fact
- What you verified from files/docs/git.

🟡 Opinion
- What you recommend doing next.
- Which files you expect to touch.
- Which validation you will run.
```

Do not edit code until the owner approves, unless the owner’s message already says `ทำเลย`, `จัดการเลย`, `ต่อเลย`, `ลุยเลย`, or otherwise clearly approves the plan.

For bug / unexpected-behavior tasks, reproduce at runtime before proposing a fix (real SQL on real schema, real endpoint/response shape, real logs) — an unreproduced fix is an Opinion, not a Fact. Verify with the same repro after fixing. See `AGENTS.md` §3.

---

## Rules to keep in mind

- `AGENTS.md` controls Codex behavior.
- `CLAUDE.md` remains shared project context and must not be edited unless explicitly requested.
- Do not rewrite the frontend to a framework.
- Do not add ORM.
- Do not simplify auth to cookie-only.
- Do not expose secrets.
- Do not change public/private route behavior casually.
- New UI text must be added to both `th` and `en` in `dashboard/i18n.js`.
- UI/CSS/layout work must be checked at mobile breakpoint `≤768px`.
- UI follows the design system in `DESIGN.md`: colors/spacing from design tokens (not hardcoded), SVG icons (not emoji, not icon webfonts). Existing dashboard emoji are grandfathered — replace opportunistically, never sweep.
- Never put emoji in a server-side SVG report template (Health Report PNG via `sharp` aborts — GOTCHAS #25a).
- Schema changes require a new `db/db_migration_<NNN>_<topic>.sql` migration.
- Backup before destructive or data-touching migrations.
- Preserve copyright headers in `.js` files.
- Do not add `Co-Authored-By` trailers.

---

## Quick task classification

Use this to decide what to read next:

| Task type | Read these first |
|---|---|
| Debugging | `GOTCHAS.md`, `DECISIONS.md`, relevant source files, logs |
| UI / CSS / mobile | `DESIGN.md`, `CLAUDE.md`, `GOTCHAS.md`, `dashboard/index.html`, `dashboard/dashboard.js`, `dashboard/i18n.js` |
| i18n | `SKILL.md` section Language/i18n, `DECISIONS.md` #128, `GOTCHAS.md` #42 |
| Database / schema | `ARCHITECTURE.md`, `DECISIONS.md`, `GOTCHAS.md`, `db/`, `src/migrate.js` |
| LINE / alerts | `docs/LOGIC_line-notifications.md`, `SKILL.md`, `src/alert-engine.js`, `src/line-sender.js`, `api-server.js` routes |
| Reports | `DESIGN.md` (§6 render paths), `ROADMAP.md`, `CHANGELOG.md`, `dashboard/report-template.js`, `src/report-renderer.js` (Health PNG = SVG+`sharp`, no emoji; analytics = Puppeteer) |
| Cameras / ingesters | `ARCHITECTURE.md`, `SKILL.md`, `src/ingesters/`, `cameras-config.json` |
| Dahua / Dahua snapshots | `DahuaProblem.MD`, `GOTCHAS.md` #39, `DECISIONS.md` #123, `docs/LOGIC_camera-ingesters.md`, `src/ingesters/dahua-cgi.js` |
| Security / auth | `DECISIONS.md`, `GOTCHAS.md`, `src/auth.js`, `src/api-server.js` |

---

## Minimum validation expectations

After changes, report exactly what was run and what was not run.

Common checks:

```bash
# Syntax checks for changed JS files
node --check src/api-server.js
node --check src/mqtt-subscriber.js
node --check src/report-renderer.js
node --check dashboard/dashboard.js

# Migrations
cd src && npm run migrate

# Process management — stack runs under PM2 (not npm run start:all)
./scripts/services.sh status       # check all 5 processes
./scripts/services.sh restart      # restart all
pm2 restart api-server             # restart one process

# Git review
git status --short
git diff --stat
git diff -- <changed-file>
```

Run only checks that make sense for the actual change.
