# Driver Face Capture (Hik Face Picture Matting) — DEFERRED

> Status: **DEFERRED 2026-07-01** · Owner decision: feature worth having, but
> defer until (a) weather clears and (b) we find/aim a camera whose view of the
> driver is usable. Capability is proven; image quality is the blocker.
> Camera probed: **HKT-ANPR-02** (Hik ANPR, ท่าฉัตรไชย, road overview, oncoming lane).

---

## TL;DR (🔵 Fact, verified live 2026-07-01)

- The Hik ANPR camera **does upload a driver-face close-up** as an extra multipart
  image part named **`pilotPicture.jpg`** (passenger would be a separate part —
  not observed yet even with Passenger Matting on).
- **Our ingest drops it.** `src/lpr-core.js` → `classifyImage()` only recognises
  `detectionPicture`/`pedestrianDetectionPicture` → scene and `licensePlatePicture`
  → plate. Anything else → `'unknown'`, and the save block writes **only**
  `images.scene` + `images.plate`. So `pilotPicture` is received in-memory and
  discarded — **never written to disk, never in the DB.** (PDPA-safe by default.)
- Camera-side tuning **works but isn't enough in rain**: after Cutting Ratio
  `Medium` + Face Close-up Ratio `3` + Matting Contrast Enhancement Level `50` +
  checked "Face Close up Picture" upload, the crop grew 1.3–2.3 KB → **4.5–10.8 KB**
  (3–7×), correctly framed on the windshield, much sharper — **but the driver's
  face is still not visible.** Root cause is optical: **wet windshield reflecting
  the sky** (rainy day) + high mount angle. No matting setting fixes that.

## Why deferred

1. **Weather** — all probes were on a rainy day; wet glass = mirror. Need a
   dry/sunny retest to see the true ceiling of this camera+angle.
2. **Camera fit** — HKT-ANPR-02 is a road-overview ANPR cam, not a face cam.
   May need Exposure/WDR/HLC tuning or a polarizing filter, or a different
   camera aimed to see through the windshield.
3. **PDPA** — a driver face is sensitive biometric data. Not worth storing while
   the image is unusable; build only once quality justifies the exposure.

---

## How to re-probe (repeatable recipe)

The camera sends `pilotPicture` but we discard it, so there is **nothing stored to
inspect** — you must capture it live with a temporary dump. Steps:

1. **Log part filenames** — in `src/lpr-core.js`, right after
   `const parts = parseMultipart(rawBody, bMatch[1]);`, add a non-throwing block
   that logs image-part filenames per push. Confirms whether a face part arrives:
   ```js
   const _imgs = parts.filter(p => /jpeg|image/.test(p.contentType||''))
     .map(p => `${p.filename||p.name||'?'}(${(p.body||'').length}b)`);
   if (_imgs.length) console.log(`[lpr-probe] img parts x${_imgs.length}: ${_imgs.join(', ')}`);
   ```
2. **Dump N face crops** — same spot, self-limiting to 5 files, into the session
   scratchpad (NOT prod snapshots — keeps biometric out of the platform):
   ```js
   global.__fpN = global.__fpN || 0;
   if (global.__fpN < 5) {
     const dir = '<scratchpad>/faceprobe';
     for (const p of parts) {
       if (global.__fpN >= 5) break;
       if (/pilot|passenger|vice/i.test(p.filename||'') && p.body?.length) {
         try { fs.mkdirSync(dir, { recursive: true }); } catch {}
         fs.writeFileSync(`${dir}/${p.filename.replace(/\.[^.]+$/,'')}_${Date.now()}.jpg`, p.body);
         console.log(`[lpr-probe] saved face #${++global.__fpN}`);
       }
     }
   }
   ```
3. `node -c src/lpr-core.js` → owner restarts **`lpr-receiver`** via
   `open -a Terminal scripts/pm2-lan-safe-restart.command` (never restart PM2 from
   the Claude/ssh/tmux shell — GOTCHAS #84 / LNP).
4. Read logs: `pm2 logs lpr-receiver --nostream --lines 300 | grep lpr-probe`.
   Traffic is frequent (~every few sec), 5 files land in <1 min.
5. **Remove the probe block** and re-run `node -c`. Confirm `git diff` is empty.

## If/when we build it (not now)

- `classifyImage()`: add `if (stem.startsWith('pilotpicture')) return 'face';`
  (+ passenger variant once its filename is observed).
- Save `images.face` → `lpr_face_<ts>.jpg`; add a `face_image` path column
  (migration, idempotent). **Shorter retention than scene** (biometric).
- Modal: add a face box; consider access-control (not every role should see it).
- PDPA: legal basis, retention, who-can-view — decide BEFORE storing.

## Camera settings that produced the best (still-insufficient) crop

Face Picture Matting: Enable ✓ · Driver ✓ · Passenger ✓ · **Face Close up
Picture ✓** (upload) · Cutting Ratio **Medium** · Face Close-up Ratio **3** ·
Matting Contrast Enhancement ✓ Level **50** · Output Mode **Upload Arm**.
Next levers if retest still poor: camera **Image/Exposure → WDR/HLC**, slower
face-capture shutter, or a polarizing filter.
