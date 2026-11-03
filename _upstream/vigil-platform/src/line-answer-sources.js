// ============================================================
// Vigil Platform — ทะเบียนแหล่งข้อมูลของคำสั่งผ่าน LINE
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// อยู่ใน **โค้ด ไม่ใช่ DB** ด้วยเหตุผลเดียวกับ view-registry.js: ถ้าปล่อยให้ตั้ง URL
// เองจากหน้าเว็บ มันคือช่องยิง request ภายในระบบ (SSRF) และตั้งพลาดครั้งเดียวก็ดึง
// ข้อมูลข้ามขอบเขตสิทธิ์ได้ · หน้าตั้งค่าจึงให้ "เลือกจากรายการนี้" เท่านั้น
//
// ทุก path ที่นี่ยิงผ่าน loopback **ในนามผู้ใช้จริง** ⇒ ขอบเขตไซต์/สิทธิ์หน้า/การกัน
// เขียนของ auditor มาพร้อมกันเอง ไม่มีคิวรีคู่ขนานให้เพี้ยนออกจากหน้าจอ
//
// รูปร่างของ payload ทุกตัวยืนยันด้วยการยิงจริงเมื่อ 2026-09-08 (ห้ามเดา — WA #3)
//   /api/traffic/helmet-series : { date, hourly[{hour,moto,no_helmet,no_helmet_ok}], daily[{date,…}] }
//   /api/traffic/helmet-top    : { rows[{rank,hits,plates[{plate,cams,region,…}]}], totals{hits,plates} }
//   /api/lpr/stats             : { total, unique, noread, vehicles, no_helmet, … }
// ============================================================
'use strict';

const TH_OFFSET_MS = 7 * 3600000;
// LINE แสดง carousel ได้สูงสุด 12 ใบ · ใบแรกเป็นสรุป ⇒ เหลือที่ให้ภาพ 11 ใบ
// ตั้งไว้ 10 เผื่อขอบให้ครบ และเพื่อให้ "แสดง 10 จาก N" อ่านเป็นตัวเลขกลม ๆ
const PHOTO_MAX = 10;
const { vtypeLabel } = require('./helpers/lprLabels');
const { signedImageUrl, sealUrl } = require('./helpers/signedImage');
const { objLabel } = require('./helpers/eventObjectClass');
const { describeFaceAttrs, ageGroupTh } = require('./helpers/faceQueryTh');

/** YYYY-MM-DD ตามเวลาไทยของ instant หนึ่ง */
function thDate(d) {
  return new Date(d.getTime() + TH_OFFSET_MS).toISOString().slice(0, 10);
}
const num = (v) => Number(v || 0);
const fmt = (n) => num(n).toLocaleString('en-US');

// 🔴 การ์ด "กล้องที่ออฟไลน์" เคยปัดเศษเป็นชั่วโมงเต็มด้วย Math.round(sec/3600) —
// กล้องที่เพิ่งดับไม่ถึงชั่วโมง (ของจริง 2026-09-15: ไซต์ HKT ดับเป็นรอบทุก ~58 นาที)
// จะกลายเป็น "0 ชม." ซึ่งไม่มีความหมายอะไรเลยกับคนอ่านการ์ด
function _offlineDur(sec) {
  if (sec == null) return '-';
  if (sec < 60) return `${Math.round(sec)} วิ`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} นาที`;
  const hr = Math.floor(sec / 3600);
  return hr < 24 ? `${hr} ชม.` : `${Math.floor(hr / 24)} วัน`;
}

// ── การ์ดที่นับรถต้องบอกเสมอว่านับจากกล้องแบบไหน ─────────────────
// ไซต์เดียวกันนับรถได้จากสองแหล่งที่ไม่เกี่ยวกันเลย และเลขไม่มีทางเท่ากัน:
// RMUTR-V มี Dahua ANPR (อ่านป้าย → 7,246 คัน) และ Bosch 5100i นับเส้นผ่าน
// หมวดเหตุการณ์ (LineDetector/Crossed → 12,273 ครั้ง) ในวันเดียวกัน
// เจ้าของทักเรื่องนี้เอง 2026-09-09 — ไม่มีบรรทัดนี้ คนอ่านเห็นสองเลขแล้วสรุปว่าระบบนับผิด
// ติดเฉพาะการ์ดที่ "นับรถ" ซึ่งมีคู่แข่งอีกแหล่งจริง — การ์ดอันดับป้าย/ค้นป้าย/เฝ้าระวัง
// ไม่ต้องติด เพราะฝั่ง VCA ไม่มีอะไรตอบคำถามเดียวกันได้ ติดไปก็เป็นบรรทัดที่ไม่ช่วยตัดสินใจ
// เขียนสั้นให้จบในบรรทัดเดียวบนจอมือถือ — ของเดิมยาวจนตัดสองบรรทัดใต้ตัวเลข
const SENSOR_LPR = 'นับจากกล้องอ่านป้ายทะเบียน';
const SENSOR_VCA = 'นับจากกล้องวิเคราะห์ภาพ ไม่ใช่กล้องอ่านป้าย';

/** ช่วงเวลาที่ผู้ใช้ไม่ได้ระบุ = ค่าเริ่มต้นของแหล่งนั้น (ไม่เดาเป็นวันนี้ทุกที่) */
function _defaultPeriod(now, kind) {
  const th = new Date(now.getTime() + TH_OFFSET_MS);
  const midnight = new Date(Date.UTC(th.getUTCFullYear(), th.getUTCMonth(), th.getUTCDate()) - TH_OFFSET_MS);
  return { kind: kind || 'today', from: midnight, to: now, label: 'วันนี้', days: 1, hours: 24 };
}

const SOURCES = {
  // ── ยอดผู้ไม่สวมหมวกนิรภัย ───────────────────────────────────
  helmet_count: {
    label: 'ยอดผู้ไม่สวมหมวกนิรภัย',
    path: '/api/traffic/helmet-series',
    accepts: ['period', 'site'],
    link: '/traffic',
    query(slots, now) {
      const p = slots.period || _defaultPeriod(now);
      // ถามช่วงสั้น (ไม่เกิน 1 วัน) ใช้ hourly ของวันนั้น · ยาวกว่านั้นใช้ daily 120 วัน
      // ที่ endpoint เดียวกันส่งมาให้อยู่แล้ว — ยิงครั้งเดียวได้ทั้งสองแบบ
      return { date: thDate(new Date(p.to.getTime() - 1)) };
    },
    format(data, slots, now) {
      const p = slots.period || _defaultPeriod(now);
      const oneDay = p.to - p.from <= 86400000 + 1000;
      let noHelmet = 0, moto = 0, rows = [];
      if (oneDay) {
        // ชั่วโมงที่อยู่ในช่วงที่ถาม (ตีความตามเวลาไทย)
        const fromH = new Date(p.from.getTime() + TH_OFFSET_MS).getUTCHours();
        const toEx = new Date(p.to.getTime() - 1 + TH_OFFSET_MS).getUTCHours();
        for (const h of data.hourly || []) {
          if (h.hour < fromH || h.hour > toEx) continue;
          noHelmet += num(h.no_helmet); moto += num(h.moto);
        }
        // ช่วงที่กินหลายชั่วโมง แจงรายชั่วโมงที่หนักที่สุดให้เห็นด้วย
        if (toEx - fromH >= 2) {
          rows = (data.hourly || [])
            .filter((h) => h.hour >= fromH && h.hour <= toEx)
            .sort((a, b) => num(b.no_helmet) - num(a.no_helmet))
            .slice(0, 5)
            .map((h) => [`${String(h.hour).padStart(2, '0')}:00`, fmt(h.no_helmet)]);
        }
      } else {
        const fromD = thDate(p.from), toD = thDate(new Date(p.to.getTime() - 1));
        for (const d of data.daily || []) {
          if (d.date < fromD || d.date > toD) continue;
          noHelmet += num(d.no_helmet); moto += num(d.moto);
        }
        rows = (data.daily || [])
          .filter((d) => d.date >= fromD && d.date <= toD)
          .slice(-7)
          .map((d) => [d.date, fmt(d.no_helmet)]);
      }
      const pct = moto ? Math.round((noHelmet / moto) * 1000) / 10 : null;
      return {
        big: fmt(noHelmet), unit: 'ราย', rows,
        note: moto ? `จากรถจักรยานยนต์ ${fmt(moto)} คัน คิดเป็น ${pct}%` : null,
        empty: !moto && !noHelmet,
      };
    },
  },

  // ── อันดับป้ายที่ไม่สวมหมวก / ฝ่าฝืน ─────────────────────────
  // สองคำสั่งใช้แหล่งเดียวกันโดยตั้งใจ: ข้อมูลระดับ "ป้ายทะเบียน" ที่ระบบมีตอนนี้
  // คือการฝ่าฝืนเรื่องหมวกนิรภัย/เข็มขัดจาก ANPR เท่านั้น ต่างกันแค่หัวการ์ด
  helmet_top: {
    label: 'อันดับป้ายที่ไม่สวมหมวกนิรภัย',
    path: '/api/traffic/helmet-top',
    accepts: ['period', 'limit', 'site'],
    link: '/traffic',
    query(slots, now) {
      const p = slots.period || _defaultPeriod(now);
      const limit = Math.min(Math.max(slots.limit || 10, 5), 20);   // endpoint บังคับ 5-20 อยู่แล้ว
      // endpoint นี้รับ preset (day|yesterday|d3|d5|d7|month) หรือ custom + from/to (วันที่ล้วน)
      const days = Math.ceil((p.to - p.from) / 86400000);
      if (p.kind === 'yesterday') return { period: 'yesterday', limit };
      if (p.kind === 'today' || p.kind === 'hour' || p.kind === 'this_hour' || days <= 1) {
        return { period: 'day', limit };
      }
      if (days <= 3) return { period: 'd3', limit };
      if (days <= 5) return { period: 'd5', limit };
      if (days <= 7) return { period: 'd7', limit };
      return { period: 'custom', from: thDate(p.from), to: thDate(new Date(p.to.getTime() - 1)), limit };
    },
    format(data, slots) {
      const want = slots.limit || 10;
      const rows = [];
      for (const r of data.rows || []) {
        for (const p of r.plates || []) {
          if (rows.length >= want) break;
          rows.push([`${p.plate}${p.region ? ` (${p.region})` : ''}`, `${fmt(r.hits)} ครั้ง`]);
        }
        if (rows.length >= want) break;
      }
      // เจ้าของสั่ง 2026-09-08: บอกแค่ "นับจากอะไร" พอ ไม่ต้องมีตัวเลขรวมท้ายการ์ด
      // (ตัวเลขสองก้อนนั้นไม่ได้ช่วยตัดสินใจอะไร และแย่งความสนใจจากอันดับซึ่งเป็นคำตอบ)
      return {
        rows,
        note: rows.length ? 'นับเฉพาะป้ายที่รูปพร้อมข้อมูลทะเบียนชัดเจน' : null,
        empty: !rows.length,
      };
    },
  },


  // ── รถเฝ้าระวังที่กล้องเจอ ──────────────────────────────────
  // ตอบคำถามที่เจ้าหน้าที่ถามบ่อยที่สุดในกลุ่ม: "วันนี้เจอรถในบัญชีคันไหนบ้าง"
  watchlist_hits: {
    label: 'รถเฝ้าระวังที่เจอ',
    path: '/api/lpr/alerts',
    accepts: ['period', 'limit', 'site'],
    link: '/lpr',
    query(slots, now) {
      const p = slots.period || _defaultPeriod(now);
      const named = { today: 'today', yesterday: 'yesterday' }[p.kind];
      return named
        ? { period: named, limit: Math.min(slots.limit || 20, 50) }
        : { period: 'custom', from: p.from.toISOString(), to: p.to.toISOString(),
            limit: Math.min(slots.limit || 20, 50) };
    },
    format(data, slots) {
      const rows = (Array.isArray(data) ? data : []).slice(0, slots.limit || 10).map((r) => {
        const plate = (r.raw_json && r.raw_json.plate) || r.plate_number || '-';
        const t = r.event_time ? new Date(r.event_time) : null;
        const hhmm = t ? new Date(t.getTime() + TH_OFFSET_MS).toISOString().slice(11, 16) : '';
        return [`${plate}  ${r.camera_name || r.camera_id || ''}`.trim(), hhmm];
      });
      const total = Array.isArray(data) ? data.length : 0;
      return {
        big: fmt(total), unit: 'ครั้ง', rows, rowsTotal: total,
        empty: !total,
      };
    },
  },

  // ── ค้นป้ายทะเบียนหนึ่งป้าย ─────────────────────────────────
  // มาจากงานจริง: ป้ายรถทดสอบ (1กอ88) อ่านผิดบ่อย ต้องตามว่าคันนี้ผ่านที่ไหนมาบ้าง
  // ใช้ exact=1 เสมอ — ค้นแบบใกล้เคียงจะได้ป้ายคนอื่นปนมาแล้วคนอ่านแยกไม่ออก
  plate_lookup: {
    label: 'ค้นป้ายทะเบียน',
    path: '/api/lpr',
    accepts: ['period', 'limit', 'plate', 'site'],
    // endpoint นี้คืนแต่ camera_id ("C4-CHL-SB-01") ซึ่งคนอ่านในกลุ่มไม่รู้ว่าที่ไหน
    // ⇒ ขอชื่อกล้องมาด้วย (ตัวรันเติมให้ใน slots._camNames)
    needsCameraNames: true,
    link: '/lpr',
    query(slots, now) {
      const p = slots.period || _defaultPeriod(now, 'range');
      return {
        q: slots.plate || '', exact: '1',
        from: p.from.toISOString(), to: p.to.toISOString(),
        limit: Math.min(slots.limit || 10, 20),
      };
    },
    format(data, slots) {
      const list = Array.isArray(data) ? data : (data.rows || []);
      const names = slots._camNames || null;
      const rows = list.slice(0, slots.limit || 10).map((r) => {
        const t = r.event_time ? new Date(r.event_time) : null;
        const when = t
          ? new Date(t.getTime() + TH_OFFSET_MS).toISOString().slice(5, 16).replace('T', ' ')
          : '';
        const cam = r.camera_name || (names && names[r.camera_id]) || r.camera_id || '-';
        return [cam, when];
      });
      return {
        big: fmt(list.length), unit: 'ครั้งที่ผ่านกล้อง',
        rows, rowsTotal: list.length,
        note: slots.plate ? `ป้าย ${slots.plate}` : 'ไม่ได้ระบุป้ายทะเบียน',
        empty: !list.length,
      };
    },
  },

  // ── กล้องที่ออฟไลน์ตอนนี้ ───────────────────────────────────
  // 🔒 endpoint นี้กันไว้ที่ admin/auditor อยู่แล้ว ⇒ ผู้สั่งที่ผูกกับบัญชี viewer
  // จะได้ข้อความ "บัญชีที่ผูกไว้ไม่มีสิทธิ์ดูข้อมูลชุดนี้" ซึ่งถูกต้องแล้ว
  camera_offline: {
    label: 'กล้องที่ออฟไลน์',
    path: '/api/health/details',
    // endpoint นี้ตอบภาพรวมทั้งระบบเสมอ (ไม่รับตัวกรอง) ⇒ กรองฝั่งเราจากรายชื่อกล้อง
    // ที่ขอบเขตของคำถามครอบไว้ · เดิมไม่รับ slot ไซต์เลย พิมพ์ "ภูเก็ต" มาก็ถูกทิ้งเงียบ
    accepts: ['site', 'camera'],
    link: '/health',
    query() { return {}; },
    format(data, slots) {
      const c = (data && data.cameras) || {};
      const only = slots._cameras && slots._cameras.length ? new Set(slots._cameras) : null;
      const list = only ? (c.list || []).filter((x) => only.has(x.id)) : (c.list || []);
      const total = only ? list.length : (c.total || 0);
      // 🔴 เรียงกล้องที่ดับนานสุดขึ้นก่อน (แก้ 2026-09-15) — เดิมเรียงตามลำดับที่
      // endpoint ส่งมา (ไม่ได้จงใจเรียงอะไร) กล้องที่ดับมา 19 ชม. กับดับมา 8 นาที
      // ปนกันอยู่ในลิสต์เดียว ทั้งที่ 10 แถวแรกคือสิ่งที่คนอ่านการ์ดจะเห็น
      const off = list.filter((x) => x.status === 'offline')
        .sort((a, b) => (b.last_seen_sec || 0) - (a.last_seen_sec || 0));
      const rows = off.slice(0, 10).map((x) => [x.name || x.id, _offlineDur(x.last_seen_sec)]);
      return {
        big: fmt(off.length), unit: `จาก ${fmt(total)} ตัว`,
        rows, rowsTotal: off.length,
        empty: !off.length,
        emptyText: 'ไม่มีกล้องออฟไลน์ในขอบเขตนี้',
      };
    },
  },

  // ── จำนวนรถแยกตามประเภท ────────────────────────────────────
  // ทุกไซต์ใช้คำสั่งเดียวกัน — ประเภทไม่ได้ hardcode แต่มาจากที่กล้องอ่านได้จริง
  // (ไซต์ที่ไม่มีรถบัสก็จะไม่มีบรรทัดรถบัส แทนที่จะขึ้นเลข 0 ให้รก)
  vehicle_types: {
    label: 'จำนวนรถแยกตามประเภท',
    path: '/api/lpr/stats',
    accepts: ['period', 'site', 'camera'],
    link: '/lpr',
    query(slots, now) {
      const p = slots.period || _defaultPeriod(now);
      if (p.kind === 'today') return { period: 'today' };
      if (p.kind === 'yesterday') return { period: 'yesterday' };
      return { period: 'custom', from: p.from.toISOString(), to: p.to.toISOString() };
    },
    format(data) {
      const list = Array.isArray(data.vtype) ? data.vtype : [];
      const total = list.reduce((a, b) => a + num(b.n), 0);
      // ถามจำนวน = อยากได้จำนวน — สัดส่วนต่อบรรทัดถูกตัดออกตามที่เจ้าของสั่ง (2026-09-09)
      const rows = list.slice(0, 10).map((v) => [vtypeLabel(v.type, 'th', v.type), fmt(v.n)]);
      return {
        big: fmt(total), unit: 'คัน', rows, rowsTotal: list.length,
        // 🔑 ไซต์เดียวกันอาจนับรถได้จากสองแหล่งที่ไม่เกี่ยวกันเลย (RMUTR-V มีทั้ง
        // Dahua ANPR และ Bosch นับเส้น) เลขจึงไม่มีทางเท่ากัน ⇒ การ์ดต้องบอกเสมอว่า
        // เลขนี้มาจากกล้องแบบไหน ไม่งั้นคนอ่านเห็นสองเลขแล้วนึกว่าระบบนับผิด
        note: SENSOR_LPR,
        empty: !total,
      };
    },
  },

  // ── รูปรถของป้ายหนึ่ง ───────────────────────────────────────
  // "ขอรูปรถป้าย 1กอ88 วันนี้" — เจ้าหน้าที่ต้องเห็นรูปเพื่อยืนยันว่าใช่คันเดียวกัน
  // ระบบอ่านป้ายผิดได้ (รถทดสอบ 1กอ88 อ่านผิดบ่อย) ตัวเลขอย่างเดียวจึงไม่พอ
  plate_photos: {
    label: 'รูปรถของป้ายทะเบียน',
    path: '/api/lpr',
    accepts: ['period', 'limit', 'plate', 'site', 'camera'],
    needsCameraNames: true,
    link: '/lpr',
    query(slots, now) {
      const p = slots.period || _defaultPeriod(now);
      return {
        q: slots.plate || '', exact: '1',
        from: p.from.toISOString(), to: p.to.toISOString(),
        // ขอมาเกินที่จะแสดงเสมอ เพื่อ **รู้ว่ามีมากกว่านั้นไหม** แล้วบอกผู้ใช้ได้ตรง
        // (LINE แสดง carousel ได้สูงสุด 12 ใบ ใบแรกเป็นสรุป ⇒ เหลือที่ให้ภาพ 11 ใบ)
        limit: Math.min(Math.max(slots.limit || PHOTO_MAX, PHOTO_MAX) * 3, 60),
      };
    },
    format(data, slots) {
      // แยกสองจำนวนให้ชัด: "เจอรถกี่ครั้ง" กับ "มีภาพกี่ใบ" — ไม่เท่ากันเสมอ
      // เพราะภาพถูกกวาดตาม retention ไปก่อนแถวข้อมูล (เจอตอนเขียนเทสต์ 2026-09-08:
      // ใช้จำนวนที่กรองแล้วไปตัดสินข้อความ ทำให้ตอบว่า "ไม่พบรถ" ทั้งที่เจอแต่ไม่มีภาพ)
      const all = Array.isArray(data) ? data : (data.rows || []);
      const list = all.filter((r) => r.snapshot_file);
      const names = slots._camNames || {};
      const shown = Math.min(slots.limit || PHOTO_MAX, PHOTO_MAX);
      const photos = list.slice(0, shown).map((r) => ({
        file: r.snapshot_file,
        title: r.plate_number || slots.plate || '',
        caption: [names[r.camera_id] || r.camera_id,
                  new Date(new Date(r.event_time).getTime() + TH_OFFSET_MS)
                    .toISOString().slice(5, 16).replace('T', ' ')].filter(Boolean).join('  '),
      }));
      return {
        photos,
        big: fmt(photos.length), unit: 'ภาพ',
        // มีมากกว่าที่ LINE แสดงได้ = ต้องบอก ไม่งั้นคนอ่านนึกว่าเห็นครบแล้ว
        note: [slots.plate ? `ป้าย ${slots.plate}` : null,
               list.length > photos.length
                 ? `แสดง ${photos.length} ภาพล่าสุด จากทั้งหมด ${fmt(list.length)} ภาพในช่วงนี้`
                 : null].filter(Boolean).join('\n'),
        // ไม่มีรูปเลย ≠ ไม่มีรถผ่าน — บอกให้ตรงว่าอะไรไม่มี
        empty: !photos.length,
        emptyText: all.length ? 'พบรถแต่ไม่มีภาพที่ยังเก็บไว้' : 'ไม่พบรถของป้ายนี้ในช่วงเวลาที่ถาม',
      };
    },
    // ลิงก์ภาพต้องเซ็นชื่อ — LINE โหลดรูปจากภายนอกโดยไม่มี session ของเรา
    signPhotos(photos, ttlSec) {
      return photos.map((p) => ({ ...p, url: signedImageUrl(p.file, ttlSec, 'img') }))
                   .filter((p) => p.url);
    },
  },

  // ── หมวดเหตุการณ์ (การ์ด "หมวดกำหนดเอง (แยกนับ)" บนหน้าสถิติ) ──────────
  // เจ้าของสั่ง 2026-09-08 ให้ถามจากในแชทได้ "ตามข้อมูลจริงของแต่ละ Site"
  // ⚠️ หมวดที่ลงท้าย (IN)/(OUT) เป็นคนละ category id กันบน DB — หน้าเว็บรวมเป็นการ์ดเดียว
  // แล้วโชว์เข้า/ออกในใบเดียว ที่นี่ต้องรวมแบบเดียวกัน ไม่งั้นเลขในแชทกับบนจอไม่ตรงกัน
  category_counts: {
    label: 'หมวดเหตุการณ์',
    path: '/api/stats/categories',
    accepts: ['period', 'limit', 'site', 'camera', 'category'],
    link: '/stats',
    query(slots, now) {
      const p = slots.period || _defaultPeriod(now);
      return { from: p.from.toISOString(), to: p.to.toISOString() };
    },
    format(data, slots) {
      const cats = (data.categories || []).filter((c) => num(c.count) > 0);
      const byBase = new Map();
      for (const c of cats) {
        const m = String(c.name || '').match(/^(.*?)\s*\((IN|OUT)\)\s*$/i);
        const base = (m ? m[1] : String(c.name || '')).trim();
        const dir = m ? m[2].toUpperCase() : null;
        if (!byBase.has(base)) byBase.set(base, { base, total: 0, prev: 0, in: 0, out: 0 });
        const b = byBase.get(base);
        b.total += num(c.count);
        b.prev += num(c.prev_count);
        if (dir === 'IN') b.in += num(c.count);
        if (dir === 'OUT') b.out += num(c.count);
      }
      let list = [...byBase.values()].sort((a, b) => b.total - a.total);
      // ขอเฉพาะหมวดเดียว — ตัวเลขใหญ่ต้องกลายเป็นของหมวดนั้น ไม่ใช่ยอดรวมทั้งไซต์
      // ที่มีแถวเดียวห้อยอยู่ข้างล่าง (คนอ่านจะอ่านตัวใหญ่แล้วจบ)
      if (slots.category) list = list.filter((b) => b.base === slots.category);
      const want = Math.min(slots.limit || 10, 20);
      // ถามจำนวน = อยากได้จำนวน — % เทียบช่วงก่อนหน้าถูกตัดออกตามที่เจ้าของสั่ง (2026-09-09)
      // เข้า/ออก เป็น "บรรทัดย่อย" ใต้ชื่อหมวด ไม่ใช่ต่อท้ายชื่อ — ต่อท้ายแล้วชื่อตัดบรรทัด
      // จนตัวเลขรวมทางขวาไม่ตรงกับชื่อของตัวเอง · ด้านที่เป็น 0 ไม่ต้องเขียน
      const io = (b) => [b.in ? `เข้า ${fmt(b.in)}` : '', b.out ? `ออก ${fmt(b.out)}` : '']
        .filter(Boolean).join(' · ');
      // ถามหมวดเดียว: ชื่อหมวดอยู่บนหัวการ์ดแล้ว เอามาซ้ำเป็นแถวที่มีเลขเท่าตัวใหญ่อีก
      // ไม่ได้บอกอะไรเพิ่ม ⇒ ใช้ที่ตรงนั้นแจงเข้า/ออก ซึ่งเป็นสิ่งเดียวที่ยังไม่ได้เห็น
      const rows = (slots.category && list.length === 1)
        ? [['เข้า', fmt(list[0].in)], ['ออก', fmt(list[0].out)]].filter(([, v]) => v !== '0')
        : list.slice(0, want).map((b) => [b.base, fmt(b.total), io(b) || null]);
      const total = list.reduce((a, b) => a + b.total, 0);
      return {
        big: fmt(total), unit: 'ครั้ง', rows,
        rowsTotal: slots.category ? null : list.length,
        note: SENSOR_VCA,
        empty: !total,
        // ของจริง: หมวดเหตุการณ์ถูกตั้งไว้เฉพาะบางไซต์ (vss 9 หมวด · rmutr-v 8 หมวด)
        // ไซต์ที่ไม่ได้ตั้งจะได้ 0 เสมอ — ต้องบอกให้ตรง ไม่ใช่ "ไม่พบข้อมูลในช่วงเวลานี้"
        // ซึ่งชวนให้เข้าใจว่าเลือกช่วงเวลาผิด
        emptyText: slots.category
          ? `ไม่มีเหตุการณ์ของหมวด ${slots.category} เลยในช่วงนี้`
          : 'ไม่มีเหตุการณ์ในหมวดใดเลยในขอบเขตนี้ (บางไซต์ยังไม่ได้ตั้งหมวดไว้)',
      };
    },
  },
  // ── รูปเหตุการณ์จากกล้องวิเคราะห์ภาพ ─────────────────────────
  // เจ้าของเปิดหน้ารายละเอียดเหตุการณ์ (Vehicle Check (OUT) · รถบรรทุก · รหัสวัตถุ 121766)
  // แล้วถามว่าขอรูป/ข้อมูลของรถคันนี้ในช่วงเวลานี้ได้ไหม (2026-09-09)
  //
  // ⚠️ ขอบเขตที่ทำได้จริง: "รถคันนี้" = **การวิ่งผ่านรอบนั้น** (รหัสวัตถุคือเลข track
  // ที่ Bosch รีเซ็ตใหม่ทุกครั้ง ไม่ใช่ตัวตนของรถ) หรือ "รถชนิดนี้ในช่วงเวลานี้"
  // ตามรถคันเดิมข้ามวัน/ข้ามกล้องไม่ได้ — ต้องมี vehicle re-ID ซึ่งยังไม่มี
  event_photos: {
    label: 'รูปเหตุการณ์จากกล้อง',
    path: '/api/events',
    accepts: ['period', 'limit', 'site', 'camera', 'object_class', 'object_id'],
    needsCameraNames: true,
    link: '/events',
    query(slots, now) {
      let p = slots.period || _defaultPeriod(now);
      // 🔴 `object_id` ไม่มี index — ค้น 7 วันบน 3 กล้องวัดได้ 39.7 วิ · 1 วัน 2.5-4.4 วิ
      //    (วัดจริง 2026-09-09 บน events 40M แถว) ⇒ จำกัดหน้าต่างไว้ 1 วันเสมอ
      //    แล้ว **บอกบนการ์ด** ว่าใช้ช่วงไหน ไม่ใช่เงียบ · track หนึ่งกินเวลาไม่กี่นาที
      //    อยู่แล้ว การถามด้วยรหัสวัตถุจึงมากับ "วันไหน/ชั่วโมงไหน" เสมอโดยธรรมชาติ
      if (slots.object_id && (p.to - p.from) > 86400000 + 1000) {
        p = { ...p, from: new Date(p.to.getTime() - 86400000) };
        slots._clampedTo1Day = true;
      }
      const q = {
        from: p.from.toISOString(), to: p.to.toISOString(),
        hasSnapshot: 'true',
        // ขอเกินที่จะแสดงเสมอ เพื่อรู้ว่ามีมากกว่านั้นไหมแล้วบอกผู้ใช้ได้ตรง
        limit: Math.min(Math.max(slots.limit || PHOTO_MAX, PHOTO_MAX) * 3, 60),
      };
      if (slots.object_class) q.object_classes = slots.object_class;
      if (slots.object_id) q.object_id = slots.object_id;
      return q;
    },
    format(data, slots) {
      const all = Array.isArray(data) ? data : (data.events || data.rows || []);
      const names = slots._camNames || {};
      const shown = Math.min(slots.limit || PHOTO_MAX, PHOTO_MAX);
      // ภาพเต็มเฟรมสื่อความมากกว่าในแชท (เห็นถนน/ทิศทาง) — ภาพครอปเป็นตัวสำรอง
      const fileOf = (r) => (r.raw_json && r.raw_json._snapshot_full) || r.snapshot_file;
      const list = all.filter(fileOf);
      const photos = list.slice(0, shown).map((r) => {
        const spd = r.raw_json && r.raw_json._speed_avg;
        return {
          file: fileOf(r),
          title: objLabel(r.object_class),
          caption: [
            new Date(new Date(r.event_time).getTime() + TH_OFFSET_MS)
              .toISOString().slice(11, 16),
            names[r.camera_id] || r.camera_id,
            spd ? `${Math.round(spd * 3.6)} กม./ชม.` : null,
          ].filter(Boolean).join('  '),
        };
      });
      return {
        photos,
        big: fmt(photos.length), unit: 'ภาพ',
        note: [
          slots.object_id ? `รหัสวัตถุ ${slots.object_id}` : null,
          slots._clampedTo1Day ? 'ค้นรหัสวัตถุได้ทีละ 1 วัน — ระบุวันหรือช่วงเวลาให้แคบลงถ้ายังไม่เจอ' : null,
          slots.object_class ? objLabel(slots.object_class) : null,
          list.length > photos.length
            ? `แสดง ${photos.length} ภาพล่าสุด จากทั้งหมด ${fmt(list.length)} ภาพในช่วงนี้`
            : null,
        ].filter(Boolean).join(' · ') || null,
        empty: !photos.length,
        // แยกให้ชัดว่า "ไม่มีเหตุการณ์" กับ "มีแต่ภาพหมดอายุแล้ว" ไม่ใช่เรื่องเดียวกัน
        // (ภาพเก็บ 10 วัน ส่วนแถวข้อมูลเก็บ 100 วัน — ถามย้อนไกลจะเจอกรณีหลังเสมอ)
        emptyText: all.length
          ? 'พบเหตุการณ์แต่ภาพถูกลบตามอายุการเก็บแล้ว (เก็บภาพ 10 วัน)'
          // ค้นด้วยรหัสวัตถุมองได้ทีละ 1 วัน ⇒ ไม่เจอส่วนใหญ่แปลว่า "ผิดวัน" ไม่ใช่ "ไม่มี"
          // ต้องบอกวิธีถามใหม่ให้ตรงในบรรทัดเดียวกัน ไม่ใช่ปล่อยให้เดาเอง
          : (slots.object_id
            ? 'ไม่พบเหตุการณ์ของรหัสวัตถุนี้ในช่วงที่ค้น — ระบุวันด้วย เช่น "ขอรูปวัตถุ '
              + slots.object_id + ' เมื่อวาน 18:00-19:00"'
            : 'ไม่พบเหตุการณ์ที่ตรงกับที่ถามในช่วงเวลานี้'),
      };
    },
    signPhotos(photos, ttlSec) {
      return photos.map((p) => ({ ...p, url: signedImageUrl(p.file, ttlSec, 'img') }))
                   .filter((p) => p.url);
    },
  },

  // ── สถานะกล้องบน HikCentral (HCP) ──────────────────────────
  // "สรุปสถานะ กล้องบน HCP รายงานเฉพาะกล้องที่ดับมาหน่อย" (เจ้าของ 2026-09-09)
  //
  // คนละชุดกับ "กล้องออฟไลน์" ของเรา: ตัวนั้นดูจาก last_seen_at ของ event ที่ไหลเข้า
  // ระบบเรา ส่วนตัวนี้คือสิ่งที่ **HCP มองเห็น** ซึ่งครอบกล้องที่ HCP ดูแลอยู่ตัวเดียว
  // ด้วย · สองเลขไม่มีทางเท่ากันและไม่ควรเท่า ⇒ การ์ดเขียนที่มาไว้เสมอ
  //
  // ข้อจำกัดสองข้อที่ต้องเขียนบนการ์ด: **admin เท่านั้น** (endpoint บังคับ) และ
  // **ภูเก็ตที่เดียว** (routes/hcp.js SITE='hkt' เหมือน AcuSeek)
  hcp_camera_status: {
    label: 'สถานะกล้องบน HikCentral',
    path: '/api/hcp/devices',
    accepts: [],
    link: '/health',
    scopeLabel: 'ภูเก็ต · HikCentral',
    query() { return {}; },
    format(data) {
      const sum = (data && data.summary && data.summary.cameras) || {};
      // 1 = online · 2 = offline · 0 = unknown (helpers/hcpDevices.js STATUS)
      const off = (data?.cameras || []).filter((c) => Number(c.status) === 2);
      const rows = off.slice(0, 10).map((c) => [
        (c.ours && c.ours.name) || c.name || c.index_code,
        (c.ours && c.ours.camera_id) ? 'มีในระบบเรา' : 'HCP ดูแลตัวเดียว',
      ]);
      const age = data?.fetched_at
        ? `ข้อมูล ณ ${new Date(new Date(data.fetched_at).getTime() + TH_OFFSET_MS)
            .toISOString().slice(5, 16).replace('T', ' ')}`
        : null;
      return {
        big: fmt(sum.offline || off.length), unit: `จาก ${fmt(sum.total || 0)} ตัว`,
        rows, rowsTotal: off.length,
        note: [
          `ออนไลน์ ${fmt(sum.online || 0)}${sum.unknown ? ` · ไม่ทราบสถานะ ${fmt(sum.unknown)}` : ''}`,
          'นับจากที่ HikCentral มองเห็น ไม่ใช่จากเหตุการณ์ที่ไหลเข้าระบบเรา',
          age,
        ].filter(Boolean).join('\n'),
        empty: !(sum.offline || off.length),
        emptyText: 'HikCentral รายงานว่ากล้องออนไลน์ครบทุกตัว',
      };
    },
  },

  // ── นับเหตุการณ์แยกตามชนิดวัตถุ ────────────────────────────
  // "สรุปจำนวนรถจักรยานยนต์ เมื่อวานก่อนเที่ยง กล้องท่าฉัตรไชย" (เจ้าของ 2026-09-09)
  //
  // ต่างจาก `category_counts` ตรงที่ไม่ต้องมีหมวดตั้งไว้ก่อน — หมวดมีแค่ 2 ไซต์
  // (vss กับ rmutr-v) ส่วนภูเก็ต 86 กล้องไม่มีเลย ⇒ ถามยอดรถชนิดหนึ่งที่ภูเก็ตไม่ได้
  // และต่างจาก `vehicle_types` ตรงที่นับจาก **กล้องวิเคราะห์ภาพ** ไม่ใช่กล้องอ่านป้าย
  //
  // ยอดมาจาก header `X-Total-Count` ของ /api/events ซึ่งมีเพดานนับที่ 10,000
  // (EVENTS_COUNT_CAP) ⇒ ชนเพดานเมื่อไหร่ต้องเขียน "+" และบอกให้แคบขอบเขต
  // ห้ามเอาค่าพื้นไปโชว์เป็นยอดจริง
  object_counts: {
    label: 'จำนวนตามชนิดวัตถุ',
    path: '/api/stats/object-counts',
    accepts: ['period', 'site', 'camera', 'object_class'],
    link: '/events',
    query(slots, now) {
      const p = slots.period || _defaultPeriod(now);
      const q = { from: p.from.toISOString(), to: p.to.toISOString() };
      if (slots.object_class) q.object_classes = slots.object_class;
      return q;
    },
    format(data, slots) {
      const list = (data && data.classes) || [];
      // ระบุชนิดมา = ตัวเลขใหญ่คือของชนิดนั้น · ไม่ระบุ = แจงทุกชนิดที่กล้องเห็น
      const one = slots.object_class
        ? list.find((c) => c.object_class === slots.object_class)
        : null;
      const rows = slots.object_class ? [] : list.slice(0, 10)
        .map((c) => [objLabel(c.object_class), fmt(c.count)]);
      const n = slots.object_class ? (one ? one.count : 0) : num(data && data.total);
      return {
        big: fmt(n), unit: 'ครั้ง', rows, rowsTotal: slots.object_class ? null : list.length,
        note: [
          slots.object_class ? objLabel(slots.object_class) : null,
          // 🔴 รวมกล้องอ่านป้ายด้วย (anprAlarm พก object_class มาเหมือนกัน) — รถคันเดียว
          //    ที่ผ่านทั้งเส้นนับและกล้องอ่านป้ายถูกนับสองครั้ง ต้องเขียนไว้ ไม่ใช่ให้เดาเอง
          'นับจากทุกกล้องที่ระบุชนิดวัตถุได้ (รวมกล้องอ่านป้าย) — คันที่ผ่านทั้งสองแบบถูกนับสองครั้ง',
          data && data.stale_minutes
            ? `ข้อมูลสรุปอัปเดตทุก ${data.stale_minutes} นาที` : null,
        ].filter(Boolean).join('\n'),
        empty: !n,
        // 0 ที่ถูกต้องแต่ชวนเข้าใจผิด: กล้องอ่านป้าย/ใบหน้าบางตัวไม่ได้ส่งชนิดวัตถุมาเลย
        // (ของจริง: C6 ที่ฉัตรไชย มี 1,678 เหตุการณ์ใน 12 ชม. แต่ไม่มีชนิดวัตถุสักแถว)
        emptyText: (slots.object_class
          ? `ไม่พบ${objLabel(slots.object_class)}ในขอบเขตนี้`
          : 'ไม่มีเหตุการณ์ที่ระบุชนิดวัตถุได้ในขอบเขตนี้')
          + '\nหมายเหตุ: กล้องบางตัว (เช่น กล้องใบหน้า) ไม่ได้ส่งชนิดวัตถุมา ยอดจึงเป็น 0 เสมอ',
      };
    },
  },

  // ── ค้นหาใบหน้าตามลักษณะ ───────────────────────────────────
  // เจ้าของสั่ง 2026-09-09 — แท็บ "ค้นหา" ของหน้าข้อมูลใบหน้า แต่สั่งจากในแชท
  //   "ค้นหาใบหน้า ผู้หญิง ใส่เสื้อสีแดง ตอนเช้า" · "ค้นหาใบหน้า คนใส่หน้ากาก ช่วงบ่าย"
  // ตัวกรองทุกตัวส่งค่าเดียวกับที่หน้าเว็บส่ง (ดู helpers/faceQueryTh.js)
  face_photos: {
    label: 'ค้นหาใบหน้า',
    path: '/api/faces',
    accepts: ['period', 'limit', 'site', 'camera', 'face_attrs'],
    needsCameraNames: true,
    link: '/faces',
    query(slots, now) {
      const p = slots.period || _defaultPeriod(now);
      return {
        ...(slots.face_attrs || {}),
        from: p.from.toISOString(), to: p.to.toISOString(),
        // ขอเกินที่จะแสดงเสมอ เพื่อรู้ว่ามีมากกว่านั้นไหม · ไม่ขอ X-Total-Count เพราะ
        // มันเป็น header ที่สายนี้อ่านไม่ได้ และการนับช่วงกว้างเคยทำให้หน้าเว็บค้าง
        with_total: '0',
        limit: Math.min(Math.max(slots.limit || PHOTO_MAX, PHOTO_MAX) * 6, 120),
      };
    },
    format(data, slots) {
      const all = Array.isArray(data) ? data : (data.rows || []);
      const names = slots._camNames || {};
      const shown = Math.min(slots.limit || PHOTO_MAX, PHOTO_MAX);
      const list = all.filter((r) => r.snapshot || r.snapshot_full);
      const chip = (r) => [
        r.gender === 'female' ? 'หญิง' : (r.gender === 'male' ? 'ชาย' : null),
        ageGroupTh(r.age_group) || (r.age ? `${r.age} ปี` : null),
        r.mask === 'yes' ? 'หน้ากาก' : null,
        r.hat === 'yes' ? 'หมวก' : null,
        r.glass === 'sunglasses' ? 'แว่นกันแดด' : (r.glass === 'yes' ? 'แว่น' : null),
      ].filter(Boolean).join(' ');
      const photos = list.slice(0, shown).map((r) => ({
        file: r.snapshot || r.snapshot_full,
        title: names[r.camera_id] || r.camera_id,
        caption: [new Date(new Date(r.event_time).getTime() + TH_OFFSET_MS)
                    .toISOString().slice(11, 16), chip(r)].filter(Boolean).join('  '),
      }));
      const attrs = describeFaceAttrs(slots.face_attrs || {});
      const capped = all.length >= 120;
      return {
        photos,
        big: fmt(photos.length), unit: 'ภาพ',
        note: [
          attrs.length ? `เงื่อนไข: ${attrs.join(' · ')}` : 'ไม่ได้ระบุลักษณะ — แสดงใบหน้าทั้งหมดในช่วงนี้',
          list.length > photos.length
            ? `แสดง ${photos.length} ภาพล่าสุด จากที่พบ ${fmt(list.length)}${capped ? '+' : ''} ภาพในช่วงนี้`
            : null,
        ].filter(Boolean).join('\n'),
        empty: !photos.length,
        emptyText: attrs.length
          ? `ไม่พบใบหน้าที่ตรงเงื่อนไข (${attrs.join(' · ')}) ในช่วงเวลานี้`
          : 'ไม่พบใบหน้าในช่วงเวลานี้',
      };
    },
    signPhotos(photos, ttlSec) {
      return photos.map((p) => ({ ...p, url: signedImageUrl(p.file, ttlSec, 'img') }))
                   .filter((p) => p.url);
    },
  },

  // ── ค้นหาอัจฉริยะ (AcuSeek) ────────────────────────────────
  // เจ้าของสั่ง 2026-09-09: "ค้นหา Acuseek หาคนถือร่มเมื่อวานตอนบ่ายโมง"
  //
  // ต่างจากทุกแหล่งในไฟล์นี้ 3 อย่าง จึงต้องมี fetchAll เป็นของตัวเอง:
  //   1. **สองจังหวะ** — /search คืน taskID แล้วต้องวน /status จนเสร็จ
  //      วัดจริง 2026-09-09: "คนกางร่มเมื่อวานตอนบ่ายโมง" เสร็จที่ 23.2 วิ
  //      (เกิน 12 วิที่คำสั่งอื่นใช้ ⇒ ตั้ง timeoutMs เอง · reply token ของ LINE ให้ 60 วิ
  //      และถ้าเลยจริงก็ยังมีทาง push สำรองอยู่แล้วใน routes/line.js)
  //   2. **ช่วงเวลาให้ฝั่งโน้นอ่านเอง** — acuseekPhrase อ่าน "เมื่อวานตอนบ่ายโมง" เป็น
  //      13:00–14:00 ได้อยู่แล้ว ถ้าเราอ่านซ้ำอีกชั้นแล้วส่งไป จะมีตัวอ่านสองตัวที่
  //      ไม่มีวันตรงกันเป๊ะ แล้วการ์ดจะพิมพ์ช่วงหนึ่งแต่เครื่องค้นอีกช่วงหนึ่ง
  //   3. **ภูเก็ตเท่านั้น** — เครื่องค้นอยู่ 10.0.10.12 (routes/acuseek.js: SITE='hkt')
  //      การ์ดจึงต้องเขียนว่า "ภูเก็ต" ไว้เสมอ ไม่ให้คนถามจากไซต์อื่นเข้าใจว่าเป็นของตัวเอง
  smart_search: {
    label: 'ค้นหาอัจฉริยะ',
    path: '/api/acuseek/search',
    accepts: [],
    link: '/smart-search',
    timeoutMs: 45000,
    // เครื่องค้นมีเครื่องเดียวที่ภูเก็ต — เขียนไว้บนหัวการ์ดเสมอ ไม่ต้องรอให้ใครถาม
    scopeLabel: 'ภูเก็ต',
    // ค้นจริง 23-29 วิ ⇒ เด้งข้อความรับทราบก่อน ไม่ให้คนถามนั่งมองห้องเงียบ ๆ
    // แล้วเข้าใจว่าบอทไม่ทำงาน (เจ้าของสั่ง 2026-09-09)
    ackText(slots) {
      return `กำลังค้น "${String(slots._query || '').slice(0, 60)}" ที่ภูเก็ต — ใช้เวลาราวครึ่งนาที`;
    },
    query(slots) { return { text: slots._query || '' }; },

    async fetchAll(ctx) {
      const { call, slots } = ctx;
      const text = String(slots._query || '').trim();
      if (!text) return { ok: false, status: 400, body: { reason: 'empty' } };
      const started = Date.now();
      // ส่ง similarity เท่าค่าเริ่มต้นของหน้าเว็บเสมอ เพื่อให้เลขในแชทกับบนจอตรงกัน
      const s = await call('/api/acuseek/search', {},
        { method: 'POST', body: { text, similarity: 80 } });
      if (!s.ok || !s.body) return s;
      if (!s.body.ok || !Array.isArray(s.body.taskIDs)) {
        return { ok: true, status: 200, body: { _phase: 'rejected', ...s.body } };
      }
      // วนถามผลจนเสร็จ — ช้ากว่านี้แปลว่าเครื่องค้นกำลังหนัก ไม่ใช่พัง
      for (let i = 0; i < 20; i++) {
        await new Promise((z) => setTimeout(z, 2000));
        const st = await call('/api/acuseek/status', {},
          { method: 'POST', body: { taskIDs: s.body.taskIDs, maxResults: 30 } });
        if (!st.ok) return st;
        if (st.body?.runStatus === 'completed') {
          return { ok: true, status: 200, body: { _phase: 'done', ...s.body, ...st.body } };
        }
        if (Date.now() - started > 40000) break;
      }
      return { ok: true, status: 200, body: { _phase: 'slow', ...s.body } };
    },

    format(data) {
      const d = data || {};
      // คำเตือนต้องเดินทางถึงคนอ่านเสมอ — "คนถือปืน" ได้คะแนน 97 พร้อมภาพที่ไม่มีปืน
      // (เหตุผลเดียวกับหัวไฟล์ routes/acuseek.js · ตัดทิ้งที่นี่คือทำบั๊กเดิมซ้ำบนผิวใหม่)
      const warn = (d.warnings || []).map((w) => w.th || w.id).filter(Boolean);
      const unknown = (d.unknown || []).filter(Boolean);
      const notes = [
        d.english ? `คำที่ใช้ค้น: ${d.english}` : null,
        warn.length ? `ข้อควรระวัง: ${warn.join(' · ')}` : null,
        unknown.length ? `ยังไม่รู้จักคำว่า ${unknown.join(' · ')}` : null,
        'เรียงตามความใกล้เคียงที่เครื่องประเมิน ไม่ใช่ลำดับความถูกต้อง — เปิดดูภาพก่อนสรุปทุกครั้ง',
      ].filter(Boolean);

      if (d._phase === 'rejected' || (!d._phase && !d.ok)) {
        const why = {
          noCameras: 'บัญชีที่ผูกไว้ไม่มีกล้องที่ค้นได้ในระบบนี้ (ค้นได้เฉพาะภูเก็ต)',
          futureWindow: 'ช่วงเวลาที่ระบุยังมาไม่ถึง',
          blocked: 'คำที่พิมพ์มาเป็นสิ่งที่เครื่องค้นทำไม่ได้',
          unknown: 'ยังไม่รู้จักคำที่พิมพ์มาเลยสักคำ ลองเขียนใหม่ให้เป็นสิ่งที่มองเห็นได้ในภาพ',
          empty: 'พิมพ์สิ่งที่ต้องการหามาด้วย เช่น "ค้นหาอัจฉริยะ คนถือร่ม เมื่อวานบ่ายโมง"',
        }[d.reason] || 'ค้นไม่สำเร็จ';
        return { periodLabel: d.timeLabel || null, empty: true,
          emptyText: [why, ...notes.slice(0, 2)].join('\n') };
      }
      if (d._phase === 'slow') {
        return { periodLabel: d.timeLabel || null, empty: true,
          emptyText: ['เครื่องค้นยังทำงานไม่เสร็จภายในเวลาที่รอได้ — เปิดดูผลได้ในระบบ',
                      ...notes.slice(0, 1)].join('\n') };
      }

      // นับกล้องจาก "ตัวอย่างที่ดึงมา" ไม่ใช่จากทั้งหมด ⇒ ต้องเขียนกำกับให้ตรง
      // ไม่งั้นคนอ่านนึกว่าเป็นสัดส่วนของทั้ง 236 รายการ
      const rows = [];
      const byCam = new Map();
      for (const r of d.results || []) {
        const k = r.camera_name || r.camera_id || `ช่อง ${r.channelID}`;
        byCam.set(k, (byCam.get(k) || 0) + 1);
      }
      [...byCam.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
        .forEach(([k, n]) => rows.push([k, fmt(n)]));

      const shown = (d.results || []).length;
      // ภาพของ AcuSeek ไม่ใช่ไฟล์บนดิสก์ — เป็น URL ภายในของเครื่องค้น ต้องปิดผนึกก่อนส่ง
      // (ดู signPhotos ด้านล่าง) · ใช้ภาพครอปเหมือนตารางบนหน้าเว็บ ภาพเต็มเป็นตัวสำรอง
      const photos = (d.results || []).slice(0, PHOTO_MAX).map((r) => ({
        file: r.cropUrl || r.fullUrl,
        title: r.camera_name || r.camera_id || `ช่อง ${r.channelID}`,
        caption: [String(r.time || '').slice(11, 16),
                  r.similarity != null ? `${r.similarity}%` : null].filter(Boolean).join('  '),
      })).filter((p) => p.file);

      return {
        photos,
        big: `${fmt(d.total)}${d.saturated ? '+' : ''}`, unit: 'รายการ',
        // ช่วงเวลาที่ **เครื่องค้นตีความจากประโยค** — ต้องขึ้นหัวการ์ดเสมอ ให้ค้านได้ทันที
        periodLabel: d.timeLabel || null,
        rows, rowsTotal: null,
        note: [
          photos.length ? `แสดง ${photos.length} ภาพล่าสุด จากทั้งหมด ${fmt(d.total)}${d.saturated ? '+' : ''} รายการ` : null,
          rows.length ? `กล้องที่พบมากสุด: ${rows.slice(0, 3).map(([k, n]) => `${k} ${n}`).join(' · ')}`
                        + ` (นับจาก ${fmt(shown)} รายการล่าสุดที่ดึงมา)` : null,
          ...notes,
          d.dropped_by_scope ? `ซ่อนไว้ ${fmt(d.dropped_by_scope)} รายการ เพราะอยู่นอกกล้องที่บัญชีนี้ดูได้` : null,
        ].filter(Boolean).join('\n'),
        empty: !d.total,
        emptyText: ['ไม่พบภาพที่ตรงกับที่ค้นในช่วงเวลานั้น', ...notes.slice(0, 2)].join('\n'),
      };
    },

    // ปิดผนึก URL ภายในก่อนเซ็น — URL ต้นทางมี token ของเครื่องเก็บภาพอยู่ในตัว
    // และข้อความ LINE ค้างอยู่ในเครื่องของทุกคนในห้อง (ดู helpers/signedImage.sealUrl)
    signPhotos(photos, ttlSec) {
      return photos.map((p) => ({ ...p, url: signedImageUrl(sealUrl(p.file), ttlSec, 'seek') }))
                   .filter((p) => p.url);
    },
  },

  // ── ยอดอ่านป้ายทะเบียน ─────────────────────────────────────
  lpr_count: {
    label: 'ยอดอ่านป้ายทะเบียน',
    path: '/api/lpr/stats',
    accepts: ['period', 'site', 'camera', 'province'],
    link: '/lpr',

    // ระบุจังหวัดของป้าย = คนละคิวรีกัน — `/api/lpr/stats` ไม่มีตัวกรองจังหวัดเลย
    // (เจ้าของพิมพ์ "สรุปจำนวนป้ายทะเบียน จังหวัด ยะลา ที่หาดใหญ่ เมื่อวาน" แล้วได้ยอด
    //  รวมของหาดใหญ่ทั้งหมดกลับไป — คำว่า "จังหวัดยะลา" ถูกทิ้งเงียบ 2026-09-09)
    // ⇒ สลับไปนับที่ `/api/lpr?count=only` ซึ่งมี `region` และนับจริงพร้อมเพดานเวลา
    async fetchAll(ctx) {
      const { call, slots, now } = ctx;
      const p = slots.period || _defaultPeriod(now);
      if (!slots.province) {
        // part=kpi ไม่มีตัวเลขระดับป้ายแล้ว (2026-10-06 · ดู lpr-query.js plateCounts) ⇒ ขอ unique
        // แยกทาง part=plates ขนานกัน · ได้ไม่สำเร็จ = บรรทัด "ป้ายไม่ซ้ำ" ขึ้น "-" ไม่ใช่ 0 หลอก
        const q = SOURCES.lpr_count.query(slots, now);
        const [k, pl] = await Promise.all([call('/api/lpr/stats', q), call('/api/lpr/stats', { ...q, part: 'plates' })]);
        return k.ok ? { ...k, body: { ...(k.body || {}), unique: pl.ok ? pl.body?.unique : null } } : k;
      }
      const q = { count: 'only', region: slots.province,
                  from: p.from.toISOString(), to: p.to.toISOString() };
      if (slots._cameras && slots._cameras.length) q.cameras = slots._cameras.join(',');
      const out = await call('/api/lpr', q);
      return out.ok ? { ...out, body: { _province: true, ...(out.body || {}) } } : out;
    },
    query(slots, now) {
      const p = slots.period || _defaultPeriod(now);
      if (p.kind === 'today') return { period: 'today', part: 'kpi' };
      if (p.kind === 'yesterday') return { period: 'yesterday', part: 'kpi' };
      // ที่เหลือส่งเป็นช่วงกำหนดเอง — endpoint รับ ISO เต็มรูป จึงตอบ "ชั่วโมงที่แล้ว" ได้ตรง
      return { period: 'custom', from: p.from.toISOString(), to: p.to.toISOString(), part: 'kpi' };
    },
    format(data, slots = {}) {
      // สาขา "เฉพาะจังหวัด" — นับแถวที่ตรงจังหวัดนั้น ไม่ใช่ยอดรวมของขอบเขต
      if (data && data._province) {
        const n = data.n;
        return {
          big: n == null ? '-' : fmt(n), unit: 'ป้าย',
          rows: [],
          note: [
            `เฉพาะป้ายจังหวัด${slots.province} · ${SENSOR_LPR}`,
            data.exact === false ? 'เป็นค่าประมาณ (นับไม่ทันในเวลาที่ให้)' : null,
          ].filter(Boolean).join('\n'),
          empty: !n,
          emptyText: `ไม่พบป้ายจังหวัด${slots.province} ในขอบเขตนี้ — ลองตรวจชื่อจังหวัดอีกครั้ง`,
        };
      }
      const read = num(data.total), noread = num(data.noread), veh = num(data.vehicles);
      return {
        big: fmt(read), unit: 'ป้ายที่อ่านได้',
        rows: [
          ['อ่านไม่ได้', fmt(noread)],
          ['ยานพาหนะทั้งหมด', fmt(veh)],
          ['ป้ายไม่ซ้ำ', data.unique == null ? '-' : fmt(data.unique)],
        ],
        // เดิมเขียน "อ่านได้ 87.4% ของยานพาหนะที่ผ่าน" — ตัดออกตามคำสั่งเจ้าของ
        // (ถามจำนวนไม่ต้องมี %) · อัตราการอ่านได้เป็นตัวชี้วัดคุณภาพ ดูในหน้า LPR
        note: SENSOR_LPR,
        empty: !veh && !read,
      };
    },
  },
};

// คำสั่ง violation_top ใช้แหล่งเดียวกับ helmet_top ต่างแค่หัวการ์ด (ดูหมายเหตุด้านบน)
SOURCES.violation_top = { ...SOURCES.helmet_top, label: 'อันดับป้ายที่ฝ่าฝืน' };

const getSource = (key) => SOURCES[key] || null;
const sourceKeys = () => Object.keys(SOURCES);

module.exports = { SOURCES, getSource, sourceKeys, thDate, defaultPeriod: _defaultPeriod };
