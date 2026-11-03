// ============================================================
// Vigil Platform — Routes: Media & File Serving
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

// CSP ของไฟล์ HTML ที่ /pub/fil/ — แยกเป็นฟังก์ชันให้เทสต์ได้ (test/public-files-csp.test.js)
// ปกติ: ไม่มี allow-scripts (ไฟล์ถูกตัดสคริปต์ตอนอัปแล้ว นี่คือเกราะชั้นสอง)
// allowScripts (แอดมินติ๊กเอง, migration 265): รันสคริปต์ในไฟล์ได้ แต่ **ไม่มี allow-same-origin** = origin ลับ
// อ่าน cookie/storage ของโดเมนไหนไม่ได้ · connect-src 'none' = ส่งข้อมูลออกไม่ได้ · form-action 'none' · ห้ามฝังในเฟรม
function htmlFileCsp(allowScripts) {
  return (allowScripts
    ? "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; script-src 'unsafe-inline'; connect-src 'none'; "
    : 'sandbox allow-popups allow-popups-to-escape-sandbox; ') +
    "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
    "img-src https: data:; font-src https://fonts.gstatic.com data:; " +
    "frame-ancestors 'none'; form-action 'none'; base-uri 'none'";
}


const path = require('path');
const fs   = require('fs');
const { edgeSnapshotUrl } = require('../helpers/edgeProxyBaseUrl');

// Returns the symbols api-server.js still uses after this move:
// THUMBS_DIR / BBOX_CACHE_DIR (retention sweep), thumbWidth + jpegResizer
// (routes/cameras.js deps), MEDIA_DIR / REPORTS_DIR / FILES_DIR (health,
// reports, storage deps + retention sweep).
module.exports = function mediaFilesRoutes(app, pool, deps) {
  const {
    ROOT_DIR, SNAPSHOT_DIR, BLACKLIST_PHOTO_DIR,
    env, sharp, auth, getSessionToken, isValidInternalToken,
    mediaScope, signedImage, viewAllows, edgeProxyBaseUrl, getSystemSetting,
  } = deps;

  // ponytail: single SVG served instead of 404 when edge proxy is unreachable,
  // so <img> renders a camera-offline placeholder instead of a broken icon.
  // Cache-Control: no-store ensures next request retries the live fetch.
  const _EDGE_OFFLINE_SVG = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 225">' +
    '<rect width="400" height="225" fill="#1c2030"/>' +
    '<g transform="translate(170,68)" fill="none" stroke="#4a5568" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="0" y="22" width="60" height="42" rx="5"/>' +
    '<circle cx="30" cy="43" r="13"/>' +
    '<rect x="18" y="14" width="16" height="10" rx="2"/>' +
    '</g>' +
    '<text x="200" y="148" text-anchor="middle" fill="#4a5568" font-size="13" font-family="sans-serif">Edge offline</text>' +
    '</svg>'
  );
  function _serveEdgeOffline(res) {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(_EDGE_OFFLINE_SVG);
  }

  // 🔐 Auth-gated snapshot serving (PDPA — CCTV images must not be public).
  // Replaces the previous express.static('/snapshots') which exposed every file
  // to anyone who could guess a filename. Filename is regex-validated to block
  // path traversal attempts (../).
  // ── Thumbnail resize for snapshot serving (?w=N) ─────────────
  // The Camera Status grid + Events/Snapshot grids request a small
  // `?w=` thumbnail so the browser isn't pulling full 5MP frames ×N.
  // Stored-snapshot thumbnails are cached on disk (lazy — generated on
  // first view, pruned with the original by enforceSnapshotRetention);
  // live-snapshot thumbnails are resized in-flight (a sharp transform
  // stream, no cache — they're transient). Width is restricted to a
  // fixed set so the on-disk thumb cache stays bounded. The larger
  // widths (>=960) back the Phase 2 per-camera "view full" cap.
  // รายการเดียวกับที่ edge ใช้ย่อภาพ — อยู่ใน helper ตัวเดียวกันเพื่อไม่ให้ drift
  // (ถ้าสองฝั่งถือรายการคนละชุด central จะขอความกว้างที่ edge ไม่รู้จัก แล้วได้ภาพเต็ม
  //  กลับมาโดยไม่มีใครรู้ตัว — เงียบเหมือนเคส `?w=80` ของหมุดแผนที่)
  const { THUMB_WIDTHS, thumbWidth } = require('../helpers/thumbWidths');
  // Phase 2 — allowed per-camera "view full" width caps (a subset of
  // THUMB_WIDTHS; the camera-settings form offers exactly these). The
  // stored original is always kept native — this only caps the
  // on-demand "view full" request, non-destructively.
  const FULL_VIEW_WIDTHS = new Set([960, 1280, 1920, 2560]);
  const THUMBS_DIR = path.join(SNAPSHOT_DIR, '.thumbs');
  // migration 117 — disk cache for the bbox-burned "view full" variant, local
  // files only. Edge-proxied images reuse _edgeThumbCache below instead (same
  // PDPA reasoning as the ?w=N thumbnail cache two lines down: no persistent
  // central copy of edge-owned images).
  const BBOX_CACHE_DIR = path.join(SNAPSHOT_DIR, '.bboxcache');
  // OPT5-CEN-006 — edge-site thumbnails skip the disk cache below (PDPA: no
  // persistent central copy of edge-owned images), so every repeat view was
  // re-fetching the full image from the edge tunnel and re-running sharp.
  // In-memory-only cache (never touches disk — the PDPA guarantee holds):
  // 60s TTL (thumbnail content is immutable per source file, so this is a
  // memory pressure valve, not a staleness control) + hard 500-entry cap,
  // evicting the oldest entry on overflow (Map preserves insertion order).
  // Worst case ~500 × ~20KB ≈ 10MB resident.
  const _edgeThumbCache = new Map();
  const EDGE_THUMB_CACHE_TTL_MS = 60_000;
  const EDGE_THUMB_CACHE_MAX = 500;
  function _edgeThumbGet(key) {
    const hit = _edgeThumbCache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > EDGE_THUMB_CACHE_TTL_MS) { _edgeThumbCache.delete(key); return null; }
    return hit.buf;
  }
  function _edgeThumbSet(key, buf) {
    if (_edgeThumbCache.size >= EDGE_THUMB_CACHE_MAX) {
      _edgeThumbCache.delete(_edgeThumbCache.keys().next().value);
    }
    _edgeThumbCache.set(key, { buf, at: Date.now() });
  }
  function jpegResizer(w) {
    return sharp({ failOn: 'none' })
      .resize(w, null, { withoutEnlargement: true })
      .jpeg({ quality: 78 });
  }

  // migration 117 — burn the LPR bounding box(es) into the actual JPEG for
  // "view full" / "save image". The in-modal thumbnail draws the same box as
  // a live SVG overlay instead (page-lpr.js attachSnapOverlay) — this is only
  // for images that leave that page (new tab, download), where an SVG on top
  // of the DOM doesn't travel with the file. Colors are the dashboard's own
  // --accent / --warn hex values, hardcoded here on purpose: sharp composites
  // a static image server-side and has no access to the CSS token file.
  // Same 0-1000 normalized grid as the frontend overlay — verified live
  // 2026-08-06 against C28-KAT-SB-15 (model iDS-2CD9396-HIS).
  const _BBOX_ACCENT = '#5b8def'; // vehicle box — รถทั่วไป
  const _BBOX_WARN    = '#f59e0b'; // plate box
  // รถที่ตรงกับบัญชีเฝ้าระวัง = แดง (ค่าเดียวกับ --status-bad ของ dashboard) — ภาพที่
  // ฝังกรอบแล้วต้องสื่อความหมายเดียวกับที่เห็นบนหน้าจอ ไม่งั้นเปิดในแท็บใหม่/ในไลน์
  // แล้วได้กรอบน้ำเงินทั้งที่บนจอเป็นแดง
  const _BBOX_ALARM  = '#ef4444';

  function _bboxInRange117(x, y, w, h) {
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h)
      && w > 0 && h > 0 && x >= 0 && y >= 0 && (x + w) <= 1000 && (y + h) <= 1000;
  }

  async function _burnLprBbox(imgBuf, lp, opts = {}) {
    const vehicleColor = opts.alarm ? _BBOX_ALARM : _BBOX_ACCENT;
    const plateColor   = opts.alarm ? _BBOX_ALARM : _BBOX_WARN;
    const img = sharp(imgBuf, { failOn: 'none' });
    const meta = await img.metadata();
    const sx = meta.width / 1000, sy = meta.height / 1000;
    let svgParts = '';

    if (_bboxInRange117(lp.vehicle_bbox_x, lp.vehicle_bbox_y, lp.vehicle_bbox_width, lp.vehicle_bbox_height)) {
      const x1 = lp.vehicle_bbox_x * sx, y1 = lp.vehicle_bbox_y * sy;
      const x2 = (lp.vehicle_bbox_x + lp.vehicle_bbox_width) * sx, y2 = (lp.vehicle_bbox_y + lp.vehicle_bbox_height) * sy;
      const bl = Math.min(x2 - x1, y2 - y1) * 0.28;
      const corners = [
        [x1, y1,  bl, 0, 0,  bl], [x2, y1, -bl, 0, 0,  bl],
        [x1, y2,  bl, 0, 0, -bl], [x2, y2, -bl, 0, 0, -bl],
      ];
      svgParts += corners.map(([cx, cy, dx1, dy1, dx2, dy2]) =>
        `<path d="M${cx+dx1},${cy+dy1} L${cx},${cy} L${cx+dx2},${cy+dy2}" fill="none" stroke="${vehicleColor}" stroke-width="${Math.max(3, meta.width/500)}" stroke-linecap="round"/>`
      ).join('');
    }
    if (_bboxInRange117(lp.bbox_x, lp.bbox_y, lp.bbox_width, lp.bbox_height)) {
      const x = lp.bbox_x * sx, y = lp.bbox_y * sy, w = lp.bbox_width * sx, h = lp.bbox_height * sy;
      svgParts += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${plateColor}" stroke-width="${Math.max(2, meta.width/700)}"/>`;
    }
    // เส้นทางเดินของวัตถุ (migration 165) — LPR ไม่เคยตั้งฟิลด์นี้ ทางเดินเดิมจึงไม่กระทบ
    // วาดก่อนกรอบเสมอ เพื่อให้กรอบอยู่ทับเส้นไม่ใช่ถูกเส้นทับ
    // เรียวจากหางไปหัวเหมือนบนหน้าจอ: ท่อนเก่าบางและจาง ท่อนใหม่หนาและเข้ม
    if (Array.isArray(lp._trail) && lp._trail.length > 1) {
      const w0 = Math.max(2, meta.width / 640);
      let trail = '';
      for (let i = 1; i < lp._trail.length; i++) {
        const a2 = lp._trail[i - 1], b2 = lp._trail[i];
        const k = i / (lp._trail.length - 1);
        trail += `<line x1="${(a2[0] * meta.width).toFixed(1)}" y1="${(a2[1] * meta.height).toFixed(1)}"`
              + ` x2="${(b2[0] * meta.width).toFixed(1)}" y2="${(b2[1] * meta.height).toFixed(1)}"`
              + ` stroke="${vehicleColor}" stroke-width="${(w0 * (0.5 + k)).toFixed(2)}"`
              + ` stroke-linecap="round" opacity="${(0.14 + k * 0.66).toFixed(2)}"/>`;
      }
      svgParts = trail + svgParts;
    }

    if (!svgParts) return imgBuf; // nothing in range — hand back the original untouched

    const svg = Buffer.from(`<svg width="${meta.width}" height="${meta.height}">${svgParts}</svg>`);
    return img.composite([{ input: svg, top: 0, left: 0 }]).jpeg({ quality: 88 }).toBuffer();
  }

  // ตรวจสอบ setting + ดึง bbox data (ใช้ร่วมโดย /snapshots และ /pub/img)
  async function _prepareBboxBurn(pool, eid, filename) {
    if (!eid || !filename) return null;
    const eId = parseInt(eid, 10);
    if (!Number.isFinite(eId)) return null;

    if ((await getSystemSetting(pool, 'lpr_bbox_full_image_enabled')) === '1') {
      const lpRow = (await pool.query(
        `SELECT lp.bbox_x, lp.bbox_y, lp.bbox_width, lp.bbox_height,
                lp.vehicle_bbox_x, lp.vehicle_bbox_y, lp.vehicle_bbox_width, lp.vehicle_bbox_height
           FROM license_plates lp JOIN events e ON e.id = lp.event_id
          WHERE lp.event_id = $1 AND e.snapshot_filename = $2`,
        [eId, filename]
      ).catch(() => ({ rows: [] }))).rows[0];
      if (lpRow) return lpRow;
    }

    // Bosch has no license_plates row — its geometry comes from the ONVIF
    // metadata track and lives in raw_json._bbox (migration 164). Falls through
    // to here rather than sharing the LPR gate above, which is a setting about
    // ANPR and says nothing about this.
    return _boschBboxBurnRow(pool, eId, filename);
  }

  // Adapts raw_json._bbox (fractions of the frame) to the 0-1000 grid the LPR
  // cameras report, so _burnLprBbox draws it unchanged — one drawing routine,
  // one look, whichever vendor the event came from.
  //
  // Matched on _snapshot_full, NOT snapshot_filename: for a Bosch event the
  // latter is usually the metadata CROP, and a box describing a position in the
  // full scene must never be burned onto a picture that is already only that
  // object. The join makes that a structural guarantee rather than a caller's
  // responsibility.
  //
  // Gated per camera by overlay_show_bbox — the same switch the live overlay
  // reads, so a burned image and the screen cannot disagree.
  async function _boschBboxBurnRow(pool, eId, filename) {
    // Box and trail are separate switches, so the row is worth fetching when
    // EITHER is on, and each half is included only if its own flag allows it.
    // Asking for both here and filtering below keeps it to one query.
    const row = (await pool.query(
      `SELECT e.raw_json->'_bbox' AS b, e.raw_json->'_trail' AS t,
              c.overlay_show_bbox IS NOT FALSE AS want_box,
              c.overlay_show_trail = TRUE      AS want_trail
         FROM events e JOIN cameras c ON c.id = e.camera_id
        WHERE e.id = $1
          AND (e.raw_json->>'_snapshot_full') = $2
          AND (c.overlay_show_bbox IS NOT FALSE OR c.overlay_show_trail = TRUE)`,
      [eId, filename]
    ).catch(() => ({ rows: [] }))).rows[0];
    if (!row) return null;

    const b = row.want_box && row.b && row.b.w > 0 && row.b.h > 0 ? row.b : null;
    const t = row.want_trail && Array.isArray(row.t) && row.t.length > 1 ? row.t : null;
    if (!b && !t) return null;

    return {
      vehicle_bbox_x: b ? b.x * 1000 : null, vehicle_bbox_y: b ? b.y * 1000 : null,
      vehicle_bbox_width: b ? b.w * 1000 : null, vehicle_bbox_height: b ? b.h * 1000 : null,
      bbox_x: null, bbox_y: null, bbox_width: null, bbox_height: null,
      _trail: t,
    };
  }

  // 🔗 ภาพแนบการแจ้งเตือน LINE — ลิงก์เซ็นชื่อ มีวันหมดอายุ ไม่ต้องมี session
  // เหตุผลที่ต้องมี: เดิมต้องอัปทุกภาพขึ้น imgbb ก่อนส่ง ซึ่งกินเวลาจริง 1.4-10 วินาที
  // ต่อภาพ (แจ้งเตือน LPR เฉลี่ย 20-27 วิ) ทั้งที่การดึงภาพจาก edge ใช้แค่ 0.26 วิ
  // ให้ LINE มาดึงจากเราเองแทน → เวลาที่เพิ่มต่อการแจ้งเตือนเหลือ ~0
  //
  // ต้องอยู่ **ก่อน** `/snapshots/*path` ไม่ได้ — คนละ path กัน แต่ต้องอยู่ใน
  // PUBLIC_PREFIXES ไม่งั้น static-asset middleware จะเด้ง 401 ก่อนถึงตรงนี้
  // ── นโยบายแคชของภาพสาธารณะ ────────────────────────────────
  //
  // ไฟล์สองชนิดในเส้นทางนี้มีอายุการใช้งานคนละแบบ จึงควรได้นโยบายคนละอย่าง:
  //   ภาพจากกล้อง (events/, lpr/)                  เขียนครั้งเดียว ไม่มีวันเปลี่ยน — แคชได้
  //   ภาพอ้างอิง (lpr-watchlist/, face-blacklist/)  ต้นทางแก้เมื่อไหร่ เราเขียนทับชื่อเดิม
  //                                                ทันที จึงต้องถามทุกครั้งว่าเปลี่ยนหรือยัง
  //
  // เจ้าของสั่ง 2026-08-25: "เอารูปใหม่ไป replace รูปเดิมในระบบก็ได้" — คือไม่เอาข้อความ
  // แจ้งเตือนใบใหม่ (การเปลี่ยนรูปไม่ใช่เหตุการณ์ที่ต้องเตือนใคร) แต่ให้รูปในข้อความเดิม
  // เปลี่ยนตามไฟล์ที่ถูกแทนที่
  //
  // no-cache ไม่ได้แปลว่า "ห้ามแคช" (นั่นคือ no-store) แต่แปลว่า "แคชได้ ต้องถามก่อนใช้
  // ทุกครั้ง" — กับ ETag ที่ Express ใส่ให้อยู่แล้ว การถามที่ไม่มีอะไรเปลี่ยนจบด้วย 304
  // ไม่มีไบต์ภาพวิ่งเลย ราคาจึงเกือบเท่าเดิมแต่เห็นรูปใหม่ทันที
  const REPLACEABLE_IMAGE_DIRS = ['lpr-watchlist/', 'face-blacklist/'];
  function imageCachePolicy(rel) {
    const r = String(rel || '').replace(/^\/+/, '');
    return REPLACEABLE_IMAGE_DIRS.some((d) => r.startsWith(d))
      ? 'public, no-cache, must-revalidate'      // ถามทุกครั้ง · ไม่เปลี่ยนก็ 304
      : 'public, max-age=120, must-revalidate';  // ภาพเหตุการณ์ ไม่มีวันเปลี่ยน
  }

  app.get('/pub/img/*path', async (req, res) => {
    const filename = decodeURIComponent(req.path.slice('/pub/img/'.length));
    const v = signedImage.verifySignedRequest(filename, req.query.exp, req.query.sig, 'img');
    if (!v.ok) return res.status(v.status).end();

    // ตรวจรูป path เหมือน /snapshots ทุกประการ — ลายเซ็นถูกไม่ได้แปลว่า path ปลอดภัย
    const segments = filename.split('/');
    const validSegment = /^[A-Za-z0-9._-]+$/;
    if (!segments.length || !/\.(jpg|jpeg|png)$/i.test(filename) ||
        segments.some(s2 => !s2 || s2 === '..' || !validSegment.test(s2))) {
      return res.status(400).end();
    }

    const file = path.join(SNAPSHOT_DIR, ...segments);
    if (fs.existsSync(file)) {
      // ?bbox=1&eid=N → เช็คและ burn bbox ถ้า enabled
      if (req.query.bbox === '1' && req.query.eid) {
        try {
          const lpRow = await _prepareBboxBurn(pool, req.query.eid, filename);
          if (lpRow) {
            const imgBuf = await fs.promises.readFile(file);
            const burned = await _burnLprBbox(imgBuf, lpRow, { alarm: req.query.alarm === '1' });
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'private, max-age=300');
            return res.send(burned);
          }
        } catch (e) { console.warn(`[pub/img] bbox burn-in failed for ${filename}:`, e.message); /* fall through */ }
      }
      // cache ได้ยาว — URL ผูกกับวันหมดอายุอยู่แล้ว เนื้อไฟล์ไม่มีวันเปลี่ยน
      // รูปที่ถูกแทนที่ต้องไปถึงคนดูภายในไม่กี่นาที รวมถึง **ข้อความ LINE ที่ส่งไปแล้ว**
      // (เจ้าของยืนยัน 2026-08-25 ว่าเคยเห็นรูปในข้อความเก่าเปลี่ยนตามไฟล์ที่แทนที่)
      //
      // จึงห้ามใช้ immutable กับเส้นทางนี้เด็ดขาด แม้ URL จะพก v= (hash ของเนื้อไฟล์)
      // มาแล้วก็ตาม — immutable แปลว่า "URL นี้จะไม่มีวันเปลี่ยนเนื้อ" ซึ่งจริงสำหรับ
      // ลิงก์ที่เพิ่ง mint แต่ข้อความ LINE เก่าถือ URL เดิมค้างไว้ตลอดไป การประกาศ
      // immutable จึงเท่ากับสั่งให้ LINE ไม่ต้องกลับมาถามอีกเลย = รูปเก่าค้างถาวร
      //
      // v= ยังมีประโยชน์: หน้าจอของเราได้ URL ใหม่ทันทีที่เนื้อเปลี่ยน ไม่ต้องรอ revalidate
      // ส่วน ETag ทำให้การถามซ้ำถูก — ไม่เปลี่ยนก็ตอบ 304 ไม่ต้องส่งไบต์ใหม่
      res.setHeader('Cache-Control', imageCachePolicy(filename));
      return res.sendFile(file);
    }

    // ไม่มีบน central → ดึงจาก edge ที่เป็นเจ้าของกล้อง (ตรรกะเดียวกับ /snapshots)
    try {
      const camId = mediaScope.cameraIdFromSnapshotPath(segments, []);
      let code = null;
      if (typeof camId === 'string') {
        const { rows } = await pool.query(
          `SELECT s.code FROM cameras c JOIN sites s ON s.id = c.site_id WHERE c.id = $1`, [camId]);
        code = rows[0]?.code || null;
      }
      const base = code
        ? edgeProxyBaseUrl(code, env.str('SNAPSHOT_PROXY_DOMAIN'))
        : env.str('SNAPSHOT_PROXY_URL');
      const sec = env.str('SNAPSHOT_PROXY_SECRET');
      if (!base || !sec) return res.status(404).end();
      const up = await fetch(`${base}/snapshots/${encodeURIComponent(filename).replace(/%2F/g, '/')}`,
        { headers: { Authorization: `Bearer ${sec}` }, signal: AbortSignal.timeout(8000) });
      if (!up.ok) return res.status(up.status === 404 ? 404 : 502).end();
      const buf = Buffer.from(await up.arrayBuffer());

      // ?bbox=1&eid=N → เช็คและ burn bbox ถ้า enabled
      if (req.query.bbox === '1' && req.query.eid) {
        try {
          const lpRow = await _prepareBboxBurn(pool, req.query.eid, filename);
          if (lpRow) {
            const burned = await _burnLprBbox(buf, lpRow, { alarm: req.query.alarm === '1' });
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'private, max-age=300');
            return res.send(burned);
          }
        } catch (e) { console.warn(`[pub/img] bbox burn-in (edge) failed for ${filename}:`, e.message); /* fall through */ }
      }

      // รูปที่ถูกแทนที่ต้องไปถึงคนดูภายในไม่กี่นาที รวมถึง **ข้อความ LINE ที่ส่งไปแล้ว**
      // (เจ้าของยืนยัน 2026-08-25 ว่าเคยเห็นรูปในข้อความเก่าเปลี่ยนตามไฟล์ที่แทนที่)
      //
      // จึงห้ามใช้ immutable กับเส้นทางนี้เด็ดขาด แม้ URL จะพก v= (hash ของเนื้อไฟล์)
      // มาแล้วก็ตาม — immutable แปลว่า "URL นี้จะไม่มีวันเปลี่ยนเนื้อ" ซึ่งจริงสำหรับ
      // ลิงก์ที่เพิ่ง mint แต่ข้อความ LINE เก่าถือ URL เดิมค้างไว้ตลอดไป การประกาศ
      // immutable จึงเท่ากับสั่งให้ LINE ไม่ต้องกลับมาถามอีกเลย = รูปเก่าค้างถาวร
      //
      // v= ยังมีประโยชน์: หน้าจอของเราได้ URL ใหม่ทันทีที่เนื้อเปลี่ยน ไม่ต้องรอ revalidate
      // ส่วน ETag ทำให้การถามซ้ำถูก — ไม่เปลี่ยนก็ตอบ 304 ไม่ต้องส่งไบต์ใหม่
      res.setHeader('Cache-Control', imageCachePolicy(filename));
      res.type('jpeg').send(buf);
    } catch (e) {
      console.warn('[pub/img] ดึงจาก edge ไม่สำเร็จ:', e?.message || e);
      res.status(502).end();
    }
  });


  // ภาพอ้างอิงใบหน้าจากบัญชีดำ — อยู่ใน blacklist-photos/ ไม่ใช่ snapshots/ จึงต้องมี
  // เส้นทางของตัวเอง · ลายเซ็นผูกกับชนิด 'ref' เอาลิงก์สลับโฟลเดอร์กันไม่ได้
  app.get('/pub/ref/*path', (req, res) => {
    const rel = decodeURIComponent(req.path.slice('/pub/ref/'.length));
    const v = signedImage.verifySignedRequest(rel, req.query.exp, req.query.sig, 'ref');
    if (!v.ok) return res.status(v.status).end();
    // รูปแบบเดียวกับ /api/blacklist/photo/:sourceId/:file ที่มีอยู่แล้ว
    if (!/^\d+\/[0-9A-Za-z_-]+\.jpg$/.test(rel)) return res.status(400).end();
    const f = path.join(BLACKLIST_PHOTO_DIR, rel);
    if (!f.startsWith(BLACKLIST_PHOTO_DIR) || !fs.existsSync(f)) return res.status(404).end();
      // รูปที่ถูกแทนที่ต้องไปถึงคนดูภายในไม่กี่นาที รวมถึง **ข้อความ LINE ที่ส่งไปแล้ว**
      // (เจ้าของยืนยัน 2026-08-25 ว่าเคยเห็นรูปในข้อความเก่าเปลี่ยนตามไฟล์ที่แทนที่)
      //
      // จึงห้ามใช้ immutable กับเส้นทางนี้เด็ดขาด แม้ URL จะพก v= (hash ของเนื้อไฟล์)
      // มาแล้วก็ตาม — immutable แปลว่า "URL นี้จะไม่มีวันเปลี่ยนเนื้อ" ซึ่งจริงสำหรับ
      // ลิงก์ที่เพิ่ง mint แต่ข้อความ LINE เก่าถือ URL เดิมค้างไว้ตลอดไป การประกาศ
      // immutable จึงเท่ากับสั่งให้ LINE ไม่ต้องกลับมาถามอีกเลย = รูปเก่าค้างถาวร
      //
      // v= ยังมีประโยชน์: หน้าจอของเราได้ URL ใหม่ทันทีที่เนื้อเปลี่ยน ไม่ต้องรอ revalidate
      // ส่วน ETag ทำให้การถามซ้ำถูก — ไม่เปลี่ยนก็ตอบ 304 ไม่ต้องส่งไบต์ใหม่
      // ทั้งเส้นทางนี้เป็นภาพอ้างอิง (blacklist-photos) ซึ่งถูกแทนที่ได้เสมอ
      res.setHeader('Cache-Control', 'public, no-cache, must-revalidate');
    res.type('jpeg').send(fs.readFileSync(f));
  });

  app.get('/snapshots/*path', async (req, res) => {
    // unbounded: ค้นแถวเดียวตามชื่อไฟล์ภาพเพื่อเช็คสิทธิ์ ไม่ใช่การอ่าน event ตามช่วงเวลา
    try {
      // Normal access requires a logged-in user session (PDPA gate). The internal
      // renderer (Puppeteer) has no session — it carries X-Internal-Token (a
      // server-only secret, never exposed to the browser) to load snapshot
      // thumbnails for the report PDF/PNG. Same trust as /api/stats. GET only.
      let _scopeUser = null;
      if (!isValidInternalToken(req)) {
        const token = getSessionToken(req);
        const user = token ? await auth.getUserFromToken(token) : null;
        if (!user) return res.status(401).end();
        _scopeUser = user;
      }

      // Support subdirectory paths (e.g. lpr/2026-06-18/file.jpg)
      // Each path segment must be safe: alphanumeric, dot, dash, underscore only
      const filename = decodeURIComponent(req.path.slice('/snapshots/'.length));
      const segments = filename.split('/');
      const validSegment = /^[A-Za-z0-9._-]+$/;
      const validFile    = /\.(jpg|jpeg|png)$/i;
      if (!segments.length || !validFile.test(filename) ||
          segments.some(s => !s || s === '..' || !validSegment.test(s))) {
        return res.status(400).end();
      }

      // Site-RBAC — เพิ่ม 2026-08-12 (decision #248, GOTCHAS #163)
      // route นี้อยู่นอก `/api` จึงไม่เคยผ่าน global middleware ที่เติม
      // `allowedSites` ให้ → ต้องเรียก getAllowedSites() เองที่นี่ ห้ามอ่านจาก
      // user object (มันไม่มี — บทเรียนเดียวกับ GOTCHAS #162)
      // internal token (report renderer) ข้ามการเช็คนี้เหมือนที่ข้าม auth ด้านบน
      if (_scopeUser) {
        // แกนที่ 1 — เห็นหน้าไหน (decision #250) user ที่ถูกจำกัดหน้าไม่ควรดึงภาพได้
        // ถ้าไม่มีหน้าไหนที่ต้องใช้ภาพเลย · route นี้อยู่นอก `/api` เช็คเองที่นี่
        if (!viewAllows(_scopeUser, req.path)) return res.status(403).end();
        // แกนที่ 2 — ข้อมูลของ Site ไหน
        const allowedSites = await auth.getAllowedSites(_scopeUser, pool);
        if (!(await mediaScope.snapshotInScope(pool, allowedSites, segments))) {
          return res.status(403).end();
        }
      }
      const file = path.join(SNAPSHOT_DIR, ...segments);
      // T2-B: try local first; if missing, proxy-fetch from the OWNING SITE's
      // edge (no disk copy — PDPA). Per-site (2026-07-15 plan): the camera_id
      // is segments[2] per snapshot-path.js's layout
      // (category/date/camId/slot/file) — look up which site it belongs to
      // and derive that site's tunnel URL, instead of one global edge URL.
      // main-site (or unassigned) cameras never proxy — same as today.
      let proxyBuf = null;
      if (!fs.existsSync(file)) {
        // camId position depends on the path layout:
        //  - deep event/face/lpr: category/date/camId/slot/file → segments[2]
        //  - flat preview tile:    preview/<camId>.jpg           → segments[1] sans ext
        // Both must resolve to the owning camera so the per-site proxy target is
        // found. Regression from 27f10ea (per-site proxy) which only handled the
        // deep layout → preview tiles 404'd silently for every edge-site camera.
        const camId = (segments[0] === 'preview' && segments.length === 2)
          ? segments[1].replace(/\.(jpe?g|png)$/i, '')
          : (segments[2] || null);
        let proxyUrl = null;
        if (camId) {
          try {
            const { rows } = await pool.query(
              `SELECT (c.site_id IS NULL OR s.code = 'main') AS is_local_site, s.code
               FROM cameras c LEFT JOIN sites s ON s.id = c.site_id
               WHERE c.id = $1`,
              [camId]
            );
            const cam = rows[0];
            if (cam && !cam.is_local_site && cam.code) {
              proxyUrl = edgeProxyBaseUrl(cam.code, env.str('SNAPSHOT_PROXY_DOMAIN'));
            }
          } catch (e) { console.warn(`[api] site lookup for snapshot proxy [${camId}]:`, e.message); }
        }
        // Fallback: segments[2] isn't a camera ID for face/ref/<fdLibName>/<humanId> paths.
        // Find the owning edge site via any FaceRecognition event that stored this path.
        if (!proxyUrl) {
          try {
            const { rows: evRows } = await pool.query(
              `SELECT s.code FROM events e
               JOIN cameras c ON c.camera_id = e.camera_id
               JOIN sites s ON s.id = c.site_id
               WHERE e.event_type = 'FaceRecognition'
                 AND e.raw_json->>'_snapshot_ref' = $1
                 AND s.code IS NOT NULL AND s.code <> 'main'
               LIMIT 1`,
              [filename]
            );
            if (evRows[0]) {
              proxyUrl = edgeProxyBaseUrl(evRows[0].code, env.str('SNAPSHOT_PROXY_DOMAIN'));
            }
          } catch (e) { console.warn(`[api] face-ref fallback lookup for ${filename}:`, e.message); }
        }
        const proxySecret = env.str('SNAPSHOT_PROXY_SECRET');
        if (proxyUrl && proxySecret) {
          try {
            // ขอให้ **edge ย่อให้ก่อนส่ง** เมื่อคำขอนี้ต้องการภาพย่อ — ของจริงที่ vss
            // ใบละ ~703 KB × 20 การ์ดบนหน้า Events = 14 MB ต่อการเปิดหน้าหนึ่งครั้ง
            // จน fetch หมดเวลา 8 วิ แล้วขึ้น "Edge offline" ทั้งที่ไฟล์อยู่ครบ
            // edge รุ่นเก่าไม่รู้จัก `?w=` → ส่งไฟล์เต็มกลับมา แล้ว central ย่อเองตามเดิม
            // ⚠️ `bbox=1` ต้องได้ภาพเต็มเสมอ กรอบคำนวณบนขนาดจริงของภาพ
            const wantW = req.query.bbox === '1' ? null : thumbWidth(req.query.w);
            const up = await fetch(
              edgeSnapshotUrl(proxyUrl, filename, wantW),
              { headers: { Authorization: `Bearer ${proxySecret}` }, signal: AbortSignal.timeout(8000) }
            );
            if (!up.ok) {
              console.warn(`[api] edge proxy ${up.status} for ${filename}`);
              // 404 = file genuinely gone (retention-pruned on the edge too) → pass
              // the 404 through so the client-side RF4 fallback (plate plaque /
              // vehicle vector, data-err="hide") shows. The Edge-offline SVG is
              // only for connectivity failures where the file may still exist.
              // no-store: this 404 can flip to 200 after a deploy / when the tile
              // regenerates — a heuristically-cached 404 in the browser would keep
              // showing "no image" until a manual hard-refresh (real incident).
              if (up.status === 404) { res.setHeader('Cache-Control', 'no-store'); return res.status(404).end(); }
              return _serveEdgeOffline(res);
            }
            proxyBuf = Buffer.from(await up.arrayBuffer());
          } catch (e) { console.warn(`[api] edge proxy fetch error for ${filename}:`, e?.message || e); return _serveEdgeOffline(res); }
        } else {
          res.setHeader('Cache-Control', 'no-store');
          return res.status(404).end();
        }
      }

      // ?bbox=1&eid=N → "view full" / "save image" with the box burned in
      // (migration 117, opt-in — lpr_bbox_full_image_enabled). eid names the
      // event whose license_plates row supplies the box; re-verified against
      // that event's own snapshot_filename so a URL can't apply one event's
      // box to a different image. Re-checks the setting server-side too, so
      // turning it off is honored even for a URL built before the toggle
      // flipped (e.g. a bookmarked/shared link).
      if (req.query.bbox === '1' && req.query.eid) {
        const alarm = req.query.alarm === '1';   // รถเฝ้าระวัง = กรอบแดง
        const lpRow = await _prepareBboxBurn(pool, req.query.eid, filename);
        if (lpRow) {
          // alarm ต้องอยู่ใน cache key ด้วย ไม่งั้นภาพกรอบน้ำเงินกับกรอบแดงของไฟล์
          // เดียวกันจะทับกันใน cache แล้วคนหนึ่งได้สีของอีกคน
          const cacheKey = proxyBuf ? `${filename}|bbox|${req.query.eid}|${alarm ? 'a' : 'n'}` : null;
          try {
            let out;
            if (proxyBuf) {
              out = _edgeThumbGet(cacheKey);
              if (!out) { out = await _burnLprBbox(proxyBuf, lpRow, { alarm }); _edgeThumbSet(cacheKey, out); }
            } else {
              const bpath = path.join(BBOX_CACHE_DIR, (alarm ? 'a_' : '') + segments[segments.length - 1]);
              try { out = await fs.promises.readFile(bpath); }
              catch {
                out = await _burnLprBbox(await fs.promises.readFile(file), lpRow, { alarm });
                await fs.promises.mkdir(BBOX_CACHE_DIR, { recursive: true });
                await fs.promises.writeFile(bpath, out).catch(() => {});
              }
            }
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'private, max-age=300');
            return res.send(out);
          } catch (e) { console.warn(`[api] bbox burn-in failed for ${filename}:`, e.message); /* fall through to plain image */ }
        }
      }

      // ?w=N → serve a lazily-built, disk-cached thumbnail. The cache
      // file lives in .thumbs/<w>/ and is pruned with the original.
      const w = thumbWidth(req.query.w);
      if (w) {
        // Flatten subdirectory path for thumb cache: lpr/2026-06-18/file.jpg → file.jpg
        const thumbName = segments[segments.length - 1];
        const tdir  = path.join(THUMBS_DIR, String(w));
        const tpath = path.join(tdir, thumbName);
        const edgeThumbKey = proxyBuf ? `${filename}|${w}` : null;
        try {
          let thumb;
          try {
            if (proxyBuf) {
              thumb = _edgeThumbGet(edgeThumbKey);
              if (!thumb) throw new Error('proxy'); // no disk cache for edge images
            } else {
              thumb = await fs.promises.readFile(tpath);
            }
          } catch {
            // cache miss — build thumbnail from local file or proxy buffer
            const src = proxyBuf ?? await fs.promises.readFile(file);
            thumb = await sharp(src, { failOn: 'none' })
              .resize(w, null, { withoutEnlargement: true })
              .jpeg({ quality: 78 }).toBuffer();
            if (proxyBuf) {
              _edgeThumbSet(edgeThumbKey, thumb);
            } else {
              await fs.promises.mkdir(tdir, { recursive: true });
              await fs.promises.writeFile(tpath, thumb).catch(() => {});
            }
          }
          // res.send(Buffer) — not sendFile: the .thumbs dot-folder would
          // trip sendFile's default dotfiles:'ignore' and 404.
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Cache-Control', 'private, max-age=300');
          return res.send(thumb);
        } catch { /* fall through to the full image */ }
      }
      res.setHeader('Cache-Control', 'private, max-age=300');
      if (proxyBuf) {
        res.setHeader('Content-Type', 'image/jpeg');
        return res.send(proxyBuf);
      }
      res.sendFile(file);
    } catch (e) {
      res.status(500).end();
    }
  });

  // 🎬 Phase 6.1 — Pre-alarm video clip serving (auth-gated, same PDPA pattern as /snapshots)
  const MEDIA_DIR = path.join(ROOT_DIR, 'media');
  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

  // 📅 Phase 7.3 — generated report PDFs land here (email delivery: commit 3)
  const REPORTS_DIR = path.join(ROOT_DIR, 'reports');
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

  // P5 File Service — admin-uploadable file host
  const FILES_DIR = path.join(ROOT_DIR, 'files');
  if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });

  // ภาพรายงาน PNG ที่ส่งให้ LINE — ลิงก์เซ็นชื่อด้วยอายุหมดอายุ (ไม่ใช้ session)
  // อยู่คนละเส้นทางจาก /pub/img เพราะเก็บในโฟลเดอร์ต่างกัน และไม่มี edge-fetch fallback
  // (รายงานเรนเดอร์บน central เท่านั้น) ลายเซ็นผูกกับ kind='rpt' จึงเอาลิงก์สลับกันไม่ได้
  app.get('/pub/rpt/*path', (req, res) => {
    const rel = decodeURIComponent(req.path.slice('/pub/rpt/'.length));
    const v = signedImage.verifySignedRequest(rel, req.query.exp, req.query.sig, 'rpt');
    if (!v.ok) return res.status(v.status).end();
    // รูปแบบ: report_<family>_YYYY-MM-DD_<timestamp>.png
    // family = analytics|health|face|lpr
    if (!/^report_[a-z]+_\d{4}-\d{2}-\d{2}_\d+\.png$/.test(rel)) return res.status(400).end();
    const f = path.join(REPORTS_DIR, rel);
    if (!f.startsWith(REPORTS_DIR) || !fs.existsSync(f)) return res.status(404).end();
      // รูปที่ถูกแทนที่ต้องไปถึงคนดูภายในไม่กี่นาที รวมถึง **ข้อความ LINE ที่ส่งไปแล้ว**
      // (เจ้าของยืนยัน 2026-08-25 ว่าเคยเห็นรูปในข้อความเก่าเปลี่ยนตามไฟล์ที่แทนที่)
      //
      // จึงห้ามใช้ immutable กับเส้นทางนี้เด็ดขาด แม้ URL จะพก v= (hash ของเนื้อไฟล์)
      // มาแล้วก็ตาม — immutable แปลว่า "URL นี้จะไม่มีวันเปลี่ยนเนื้อ" ซึ่งจริงสำหรับ
      // ลิงก์ที่เพิ่ง mint แต่ข้อความ LINE เก่าถือ URL เดิมค้างไว้ตลอดไป การประกาศ
      // immutable จึงเท่ากับสั่งให้ LINE ไม่ต้องกลับมาถามอีกเลย = รูปเก่าค้างถาวร
      //
      // v= ยังมีประโยชน์: หน้าจอของเราได้ URL ใหม่ทันทีที่เนื้อเปลี่ยน ไม่ต้องรอ revalidate
      // ส่วน ETag ทำให้การถามซ้ำถูก — ไม่เปลี่ยนก็ตอบ 304 ไม่ต้องส่งไบต์ใหม่
      res.setHeader('Cache-Control', 'public, max-age=120, must-revalidate');
    res.type('png').send(fs.readFileSync(f));
  });

  // เอกสาร/ภาพอัปโหลดโดยแอดมิน — auth ด้วยลายเซ็น+วันหมดอายุใน URL
  // เหมือน /pub/rpt แต่อยู่คนละโฟลเดอร์ ลายเซ็นผูกกับ kind='fil'
  // ── ลิงก์สั้น + บันทึกการกด (migration 266) ──────────────────────────────
  // ลิงก์สั้น /pub/fil/<code> เสิร์ฟไฟล์ตรง ๆ (ไม่ redirect) · ลิงก์ยาวแบบลงลายเซ็นยังใช้ได้เหมือนเดิม
  // ทั้งสองแบบบันทึกการกดลง public_file_clicks (fire-and-forget — บันทึกล้มต้องไม่ทำให้ไฟล์เปิดไม่ได้)
  // ⚠️ SHORT_CODE_RE ต้องตรงกับ regex ใน api-server.js (FILES_HOST) — test/public-file-links.test.js ตรวจ
  const SHORT_CODE_RE = /^[a-z0-9]{8}$/;
  const OG_IMAGE_RE = /^([a-z0-9]{8})\.png$/;               // ภาพพรีวิวของลิงก์นั้น (Open Graph)
  const filePreview = require('../helpers/filePreview');
  const { uaInfo } = require('../helpers/uaInfo');
  const { normalizeTarget } = require('../helpers/externalLink');
  const filesBase = () => (env.str('FILES_PUBLIC_URL') || env.str('DASHBOARD_PUBLIC_URL') || '').replace(/\/+$/, '');
  // ข้อมูล Open Graph ของไฟล์ — ชื่อ/คำอธิบายตั้งได้ (og_*) ไม่ตั้ง = ชื่อไฟล์ / หมายเหตุ · ภาพมีเมื่อสร้าง/อัปแล้ว
  const ogOf = (row, code) => code && {
    title: row.og_title || row.original_name,
    description: row.og_description || row.note || '',
    image: row.og_image ? `${filesBase()}/pub/fil/${code}.png` : null,
    url: `${filesBase()}/pub/fil/${code}`,
  };
  // กันคนยิงซ้ำรัว ๆ จนตารางโต: IP+UA+ลิงก์เดิมภายใน 10 วินาทีนับครั้งเดียว · ponytail: Map ในหน่วยความจำ
  // ของ process เดียว (api-server ตัวเดียว) — ถ้าวันหนึ่งรันหลาย process ต้องย้ายไปที่ DB/Redis
  const _clickSeen = new Map();
  function logClick(req, { fileId, linkId = null, via, status }) {
    if (req.method !== 'GET') return;                     // express ตอบ HEAD ด้วย handler เดียวกัน
    const ip = (req.headers['cf-connecting-ip'] || '').trim() || req.ip || null;
    const key = `${ip}|${req.headers['user-agent'] || ''}|${linkId || 'f' + fileId}`;   // UA ต่าง = คน/แอปต่าง (NAT เดียวกัน)
    const now = Date.now();
    if (_clickSeen.get(key) > now - 10_000) return;
    _clickSeen.set(key, now);
    if (_clickSeen.size > 5000) for (const [k, t] of _clickSeen) if (t < now - 10_000) _clickSeen.delete(k);
    pool.query(
      `INSERT INTO public_file_clicks (file_id, link_id, via, status, ip, country, user_agent, referer)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [fileId, linkId, via, status, ip, (req.headers['cf-ipcountry'] || '').slice(0, 8) || null,
       String(req.headers['user-agent'] || '').slice(0, 600) || null,
       String(req.headers.referer || '').slice(0, 600) || null]
    ).catch((e) => console.warn('[pub/fil] click log:', e.message));
  }

  async function serveFileRow(req, res, row, rel, og = null) {
    // Read file from disk
    const f = path.join(FILES_DIR, rel);
    if (!f.startsWith(FILES_DIR) || !fs.existsSync(f)) return res.status(404).end();

    // ชื่อไฟล์ไทยอยู่นอกช่วง latin-1 → res.setHeader โยน ERR_INVALID_CHAR
    // และการดาวน์โหลดกลายเป็น 500 ทั้งที่ไฟล์ปกติดี (ทำซ้ำแล้ว 2026-08-24)
    // ซึ่งคือกรณีใช้งานหลักของฟีเจอร์นี้พอดี — ส่งเอกสารภาษาไทยให้ลูกค้า
    // RFC 5987: filename= เป็น ASCII ไว้ให้เบราว์เซอร์เก่า, filename*= เป็นตัวจริง
    const clean = row.original_name.replace(/[\r\n"\\]/g, '').slice(0, 200);
    const ascii = clean.replace(/[^\x20-\x7E]/g, '_') || 'download';

    res.setHeader('Content-Type', row.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // private = Cloudflare ห้ามเก็บ (ไม่งั้นการเปิดซ้ำไม่ถึง origin = ไม่มีบันทึกการกด) · no-cache = เบราว์เซอร์
    // ต้องถามกลับทุกครั้งที่เปิด จึงนับการเปิดซ้ำได้ (เดิม max-age=300 เปิดซ้ำใน 5 นาทีไม่ถึงเซิร์ฟเวอร์)
    res.setHeader('Cache-Control', 'private, no-cache');

    // 🔴 HTML เป็นชนิดเดียวในเส้นทางนี้ที่เจ้าของสั่งให้ "เปิดเป็นหน้าเว็บทันที"
    // (เหมือนเปิดลิงก์แชร์ Google Docs) — ชนิดอื่นทุกตัวยัง attachment เหมือนเดิม
    // ไม่แตะพฤติกรรมเดิม (RCA เมื่อวานเรื่อง backup สอนไว้แล้วว่า diff ที่แตะของ
    // เดิมกว้างเกินจำเป็นคือความเสี่ยงเปล่า ๆ)
    //
    // เนื้อไฟล์ผ่าน helpers/htmlSanitize.js มาแล้วตอนอัปโหลด (routes/files.js)
    // — ตัด script/event handler/iframe/object/form/style-tag/base/link/meta
    // ออกหมดตั้งแต่ตอนนั้น ชั้นนี้คือเกราะที่สอง เผื่อ sanitizer มีรูรั่วที่ไม่รู้:
    // CSP บล็อก JS/plugin/form ทั้งหมด ไม่ว่าจะหลุดมาได้อย่างไรก็รันไม่ได้อยู่ดี
    // (เกราะที่สามคือโดเมนแยก upl.dojojin.tech ไม่มี session cookี — ดูคอมเมนต์
    // บนสุดของไฟล์นี้ + signedImage.js — ผลเสียหายสูงสุดต่อให้สองชั้นแรกรั่วพร้อมกัน
    // คือคนร้ายควบคุมหน้านั้นหน้าเดียว ไม่ใช่ session ของแอดมิน)
    if (row.mime === 'text/html') {
      // charset ต้องประกาศที่ header: sanitizer ตัด <meta charset> ทิ้ง ถ้าไม่บอก
      // เบราว์เซอร์จะเดา encoding เอง และภาษาไทยอาจกลายเป็นตัวอ่านไม่ออก
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', 'inline');
      // `sandbox` (2026-09-24, ตอนเปิด SVG/<style>) = ชั้นที่กัน JS ได้จริงไม่ว่า
      // ไฟล์จะมีอะไรหลุดมา: ไม่มี allow-scripts จึงรันสคริปต์ไม่ได้เลย + origin
      // กลายเป็น unique · allow-popups* ต้องมีเพราะ sanitizer บังคับทุกลิงก์เป็น
      // target=_blank ถ้าไม่เปิด popup ลิงก์ในเอกสารจะกดไม่ไปไหน
      // ฟอนต์: จำกัดที่ Google Fonts ตัวเดียวกับที่ sanitizer ปล่อย <link> ผ่าน
      res.setHeader('Content-Security-Policy', htmlFileCsp(row.allow_scripts === true));
    } else {
      res.setHeader('Content-Disposition',
        `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`);
    }
    // HTML: ใส่แท็ก Open Graph ตอนเสิร์ฟ (ไม่แก้ไฟล์บนดิสก์ — sha256 ยังตรงกับไฟล์ที่เก็บ)
    if (row.mime === 'text/html' && og) return res.send(filePreview.injectOg(fs.readFileSync(f, 'utf8'), filePreview.ogTags(og)));
    res.send(fs.readFileSync(f));
  }

  app.get('/pub/fil/*path', async (req, res) => {
    const rel = decodeURIComponent(req.path.slice('/pub/fil/'.length));
    try {
      const ogm = OG_IMAGE_RE.exec(rel);
      if (ogm) {
        const { rows } = await pool.query(
          `SELECT f.og_image, f.revoked_at, f.expires_at, l.revoked_at AS link_revoked_at
             FROM public_file_links l JOIN public_files f ON f.id = l.file_id WHERE l.code = $1`, [ogm[1]]);
        const r = rows[0];
        if (!r || !r.og_image || r.revoked_at || r.link_revoked_at || (r.expires_at && new Date(r.expires_at) < new Date())) return res.status(404).end();
        const img = path.join(FILES_DIR, r.og_image);
        if (!img.startsWith(FILES_DIR) || !fs.existsSync(img)) return res.status(404).end();
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.send(fs.readFileSync(img));
      }
      if (SHORT_CODE_RE.test(rel)) {
        const { rows } = await pool.query(
          `SELECT f.id, f.stored_name, f.original_name, f.mime, f.revoked_at, f.expires_at, f.allow_scripts,
                  f.note, f.og_title, f.og_description, f.og_image, f.target_url,
                  l.id AS link_id, l.revoked_at AS link_revoked_at
             FROM public_file_links l JOIN public_files f ON f.id = l.file_id
            WHERE l.code = $1`, [rel]);
        const row = rows[0];
        if (!row) return res.status(404).end();
        // ลิงก์ภายนอก (migration 287): ตรวจ allowlist ซ้ำตอนเสิร์ฟ — แถวที่ถูกแก้ตรง DB ต้องไม่กลายเป็น open redirect
        const target = row.target_url ? normalizeTarget(row.target_url) : null;
        const gone = row.revoked_at || row.link_revoked_at || (row.expires_at && new Date(row.expires_at) < new Date())
          || (target && !target.ok);
        logClick(req, { fileId: row.id, linkId: row.link_id, via: 'short', status: gone ? 410 : 200 });
        if (gone) return res.status(410).end();
        const og = ogOf(row, rel);
        if (target) {
          res.setHeader('Cache-Control', 'no-store, private');   // ทุกการกดต้องถึง origin จึงนับได้
          res.setHeader('Referrer-Policy', 'no-referrer');
          if (uaInfo(req.headers['user-agent']).bot) {   // ตัวดึงพรีวิวได้หน้า og ของเรา ไม่ตามไปปลายทาง
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Content-Security-Policy', "default-src 'none'; img-src https:; frame-ancestors 'none'");
            return res.send(filePreview.landingHtml(og));
          }
          return res.redirect(302, target.url);
        }
        // ไฟล์ที่ไม่ใช่ HTML เปิดเป็นดาวน์โหลด ใส่แท็กพรีวิวไม่ได้ → ตัวดึงพรีวิวของ Social ได้หน้าเล็กที่มีแต่แท็ก og
        // คนจริงได้ไฟล์ตามเดิม · รูปแบบ UA ของตัวดึงพรีวิวอยู่ที่ helpers/uaInfo.js (BOT)
        if (row.mime !== 'text/html' && uaInfo(req.headers['user-agent']).bot) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'private, no-cache');
          res.setHeader('Content-Security-Policy', "default-src 'none'; img-src https:; frame-ancestors 'none'");
          return res.send(filePreview.landingHtml(og));
        }
        return await serveFileRow(req, res, row, row.stored_name, og);
      }

      const v = signedImage.verifySignedRequest(rel, req.query.exp, req.query.sig, 'fil');
      if (!v.ok) return res.status(v.status).end();
      // stored names are uuid + one of six extensions, generated by us — anything
      // else never came from POST /api/files
      if (!/^[0-9a-f-]{36}\.(png|jpg|pdf|docx|xlsx|html)$/.test(rel)) return res.status(400).end();

      const result = await pool.query(
        `SELECT f.id, f.original_name, f.mime, f.revoked_at, f.expires_at, f.allow_scripts, f.note,
                f.og_title, f.og_description, f.og_image,
                (SELECT l.code FROM public_file_links l WHERE l.file_id = f.id AND l.revoked_at IS NULL ORDER BY l.id LIMIT 1) AS code
           FROM public_files f WHERE f.stored_name = $1`,
        [rel]
      );
      if (!result.rows.length) return res.status(404).end();
      const row = result.rows[0];
      const gone = row.revoked_at || (row.expires_at && new Date(row.expires_at) < new Date());
      logClick(req, { fileId: row.id, via: 'signed', status: gone ? 410 : 200 });
      if (gone) return res.status(410).end();
      return await serveFileRow(req, res, row, rel, ogOf(row, row.code));
    } catch (e) {
      console.error('[pub/fil] error:', e.message);
      res.status(500).end();
    }
  });

  app.get('/media/:filename', async (req, res) => {
    // unbounded: ค้นแถวเดียวตามชื่อไฟล์คลิปเพื่อเช็คสิทธิ์ ไม่ใช่การอ่าน event ตามช่วงเวลา
    try {
      const token = getSessionToken(req);
      const user = token ? await auth.getUserFromToken(token) : null;
      if (!user) return res.status(401).end();

      const filename = req.params.filename;
      if (!/^[A-Za-z0-9._-]+\.(mp4|webm)$/i.test(filename)) {
        return res.status(400).end();
      }

      // Site-RBAC — เพิ่ม 2026-08-12 (decision #248, GOTCHAS #163) เหตุผลเดียว
      // กับ /snapshots ด้านบน · คลิปหา "กล้องเจ้าของ" จาก events.clip_file ตรงๆ
      // (ไม่ cache — เส้นทางนี้ถูกเรียกน้อยมาก ปัจจุบันยังไม่มีคลิปในระบบเลย)
      // ไม่เจอเจ้าของ = ปฏิเสธไว้ก่อนสำหรับผู้ใช้ที่ถูกจำกัดสิทธิ์
      {
        if (!viewAllows(user, req.path)) return res.status(403).end();   // แกน view (decision #250)
        const allowedSites = await auth.getAllowedSites(user, pool);
        if (allowedSites !== null) {
          const { rows } = await pool.query(
            `SELECT c.site_id FROM events e JOIN cameras c ON c.id = e.camera_id
              WHERE e.clip_file = $1 LIMIT 1`, [filename]);
          const siteId = rows[0]?.site_id;
          if (siteId == null || !allowedSites.includes(siteId)) return res.status(403).end();
        }
      }
      const file = path.join(MEDIA_DIR, filename);
      if (!fs.existsSync(file)) return res.status(404).end();
      // No long cache — clip lifecycle is short + may be deleted by retention
      res.setHeader('Cache-Control', 'private, max-age=60');
      res.sendFile(file);
    } catch (e) {
      res.status(500).end();
    }
  });

  return { THUMBS_DIR, BBOX_CACHE_DIR, thumbWidth, jpegResizer, MEDIA_DIR, REPORTS_DIR, FILES_DIR };
};

module.exports.htmlFileCsp = htmlFileCsp;
