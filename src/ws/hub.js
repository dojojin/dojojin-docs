// ============================================================
// Vigil Platform — WebSocket Hub
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

// The WebSocket server + everything that feeds it: the upgrade gate
// (verifyClient), the client set, the per-connection topic subscribe handler,
// the camera→site map used to scope broadcasts, and broadcast() itself.
//
// Returns the symbols api-server.js still uses after this move:
//   wss       — routes/health deps + the camera_status push inside
//               checkOfflineCameras (the only remaining direct wss.clients use)
//   broadcast — the pg LISTEN bridge + the occupancy tracker
module.exports = function wsHub(deps) {
  const {
    server, WebSocket, auth, pool,
    mediaScope, viewRegistry, viewAllows, scrubRawJson,
  } = deps;

  // 🔐 WebSocket — reject the upgrade BEFORE it completes if the request
  // carries no valid session. The broadcast stream is PDPA-sensitive (event
  // details, Face Capture attributes, snapshot filenames), so an anonymous
  // client must never be allowed to subscribe. Token sources mirror the REST
  // API: the `session` cookie (sent automatically on a same-origin upgrade)
  // or a `?token=` query param (Safari ITP fallback). `auth` is required
  // further down — verifyClient is a closure, only invoked at connect time.
  const wss = new WebSocket.Server({
    server,
    verifyClient: (info, cb) => {
      let token = null;
      try { token = new URL(info.req.url, 'http://x').searchParams.get('token'); } catch {}
      if (!token && info.req.headers.cookie) {
        for (const c of info.req.headers.cookie.split(';')) {
          const [k, ...v] = c.trim().split('=');
          if (k === 'session') { token = decodeURIComponent(v.join('=')); break; }
        }
      }
      if (!token) return cb(false, 401, 'Unauthorized');
      auth.getUserFromToken(token)
        .then(async (u) => {
          if (!u) return cb(false, 401, 'Unauthorized');
          // Site-RBAC บน WS — เพิ่ม 2026-08-12 (decision #248, GOTCHAS #163)
          // เดิมเช็คแค่ `!!u` แล้ว broadcast ยิงให้ทุก client เท่ากันหมด →
          // viewer ที่ผูกกับ hkt รับ event สดของ hdy ได้ (พิสูจน์แล้ว 54 ข้อความ/20 วิ)
          // เก็บ scope ไว้กับ req เพื่อส่งต่อให้ connection handler (verifyClient
          // กับ handler คุยกันได้ทางนี้ทางเดียว)
          // หมายเหตุ: scope ถูกอ่านตอน "ต่อ" ครั้งเดียว — ถ้าแอดมินแก้สิทธิ์ระหว่าง
          // ที่ผู้ใช้เปิดจออยู่ จะมีผลเมื่อ reconnect (ยอมรับได้ ไม่ใช่ escalation)
          try { info.req._allowedSites = await auth.getAllowedSites(u, pool); }
          catch { info.req._allowedSites = []; }   // อ่านสิทธิ์ไม่ได้ = ปฏิเสธไว้ก่อน
          // แกน view ด้วย (decision #250) — ไม่งั้น user ที่ถูก 403 ทาง HTTP ยังรับ
          // event สดของหน้าที่ตัวเองเข้าไม่ได้ผ่าน WS ได้อยู่ดี (ช่องโหว่คลาสเดียวกับ #163)
          info.req._allowedViews = u.allowed_views ?? null;
          // raw_json.rawXml ของ anprAlarm มี IP/MAC ของกล้อง — non-admin ต้องได้
          // รุ่นที่ปิดบังแล้ว (security backlog 2026-08-12 · S1 — เจ้าของสั่ง)
          // auditor นับเป็น non-admin · อ่านครั้งเดียวตอนต่อ เหมือน _allowedSites
          info.req._isAdmin = (u.role === 'admin');
          cb(true, 200, 'OK');
        })
        .catch(() => cb(false, 500, 'Auth error'));
    },
  });

  const wsClients = new Set();
  // P5 — หัวข้อที่ client ขอรับแบบเต็มได้ นอกเหนือจากนี้เมิน
  const WS_TOPICS = new Set(['lpr', 'face']);
  wss.on('connection', (ws, req) => {
    // Auth already enforced at the upgrade by verifyClient above, which also
    // resolved this connection's site scope onto req (decision #248).
    // null = unrestricted (admin/auditor) · array = จำกัดตาม Site
    ws._allowedSites = req?._allowedSites ?? null;
    ws._allowedViews = req?._allowedViews ?? null;
    // fail closed — ธงหาย = ถือว่าไม่ใช่ admin (ต้องปิดบัง) ไม่ใช่ `?? null` แบบสองบรรทัดบน
    ws._isAdmin = req?._isAdmin === true;
    // P5 — ค่าเริ่มต้นว่าง = "ยังไม่ขอ stream หนัก" → ได้ event รุ่น lite
    // (ดู broadcast) client เปิดเองด้วย {"type":"subscribe","topics":[...]}
    ws._topics = new Set();
    wsClients.add(ws);
    ws.on('message', (buf) => {
      // frame จาก client เชื่อไม่ได้ และ throw ที่นี่ = ทั้ง connection ตาย
      // → กลืนทุก error, ปฏิเสธของแปลกเงียบ ๆ
      try {
        if (!buf || buf.length > 1024) return;            // frame ใหญ่ = ไม่ใช่ของเรา
        const m = JSON.parse(String(buf));
        if (m?.type !== 'subscribe' || !Array.isArray(m.topics)) return;
        ws._topics = new Set(m.topics.filter(t => WS_TOPICS.has(t)));
      } catch {}
    });
    ws.on('close', () => wsClients.delete(ws));
  });

  // หา camera_id เจ้าของข้อความ เพื่อตัดสินว่าจะส่งให้ client คนไหนบ้าง
  // รูปแบบข้อความที่มีจริง (ยืนยันจากทุกจุดที่เรียก broadcast 2026-08-12):
  //   new_event / new_face   → event.camera_id
  //   occupancy_update       → camera_id (top level)
  //   clip_done              → camera_id (top level)
  //   event_snapshot         → ไม่มี camera_id · ได้จาก path ของ snapshot_file
  function _broadcastCameraId(data) {
    if (data?.camera_id) return String(data.camera_id);
    if (data?.event?.camera_id) return String(data.event.camera_id);
    if (data?.snapshot_file) {
      const segs = String(data.snapshot_file).split('/');
      const id = mediaScope.cameraIdFromSnapshotPath(segs, _wsCamSiteMap ? _wsCamSiteMap.keys() : []);
      return (typeof id === 'string') ? id : undefined;
    }
    return undefined;
  }

  // สำเนา camera→site map สำหรับ broadcast (ต้องเป็น sync — broadcast ถูกเรียกถี่
  // มากและอยู่ในเส้นทาง ingest จะ await ต่อข้อความไม่ได้) refresh เป็นระยะแทน
  let _wsCamSiteMap = null;
  async function _refreshWsCamSiteMap() {
    try { _wsCamSiteMap = await mediaScope.cameraSiteMap(pool); }
    catch (e) { console.warn('[ws] cam-site map refresh failed:', e.message); }
  }
  _refreshWsCamSiteMap();
  setInterval(_refreshWsCamSiteMap, 60_000).unref?.();

  // P5 — "หัวข้อหนัก" ของข้อความ: ชนิดที่ยิงถี่และ payload ใหญ่ ตัวอื่นส่งเหมือนเดิม
  // วัดจริง 2026-09-05: anprAlarm ~10 ข้อความ/วิ (raw_json ≈2.7 KB ต่อใบ) +
  // FaceCapture ~3.4/วิ = 265–380 KB ต่อ 10 วิ ต่อ "ทุก" แท็บที่เปิดค้าง
  function _wsHeavyTopic(data) {
    if (data?.type === 'new_event' && data.event?.event_type === 'anprAlarm') return 'lpr';
    if (data?.type === 'new_face') return 'face';
    return null;
  }
  // รุ่นย่อของ event — เหลือเฉพาะ field ที่ตัวนับวันนี้ / badge เมนู / toast /
  // map pulse ใช้จริง (≈200–300 B) หน้าที่ต้องใช้ raw_json เต็มจะ subscribe เอง
  function _liteEvent(row) {
    const r = row || {};
    const rj = (r.raw_json && typeof r.raw_json === 'object') ? r.raw_json : {};
    const lite = {
      id: r.id,
      camera_id: r.camera_id,
      event_type: r.event_type,
      event_time: r.event_time,
      rule_name: r.rule_name,
      object_class: r.object_class,
      snapshot_file: r.snapshot_file,
      _lprAlert: r._lprAlert,
      raw_json: {},
    };
    for (const k of ['plate', 'region', 'gender', 'glass']) {
      if (rj[k] !== undefined) lite.raw_json[k] = rj[k];
    }
    return lite;
  }

  function broadcast(data) {
    const json = JSON.stringify(data);
    const camId = _broadcastCameraId(data);
    const typeRoute = viewRegistry.WS_TYPE_ROUTE[data?.type];
    const heavy = _wsHeavyTopic(data);
    let liteJson = null;   // stringify ครั้งเดียวต่อ broadcast ไม่ใช่ต่อ client
    // รุ่นเต็มของ non-admin ต้องปิดบัง IP/MAC ของกล้องใน raw_json.rawXml
    // (security backlog 2026-08-12 · S1 — เจ้าของสั่ง) · รุ่น lite ไม่ต้องแตะ
    // เพราะ _liteEvent คัดเฉพาะ plate/region/gender/glass อยู่แล้ว
    // เช็คว่ามี rawXml จริงก่อน — broadcast ถูกใช้กับ clip_done/event_snapshot ฯลฯ
    // ที่ไม่มี event.raw_json เลย จะได้ไม่ stringify ก้อนที่สองเปล่า ๆ ทุกข้อความ
    const needScrub = typeof data?.event?.raw_json?.rawXml === 'string';
    let scrubJson = null;
    wsClients.forEach(ws => {
      if (ws.readyState !== WebSocket.OPEN) return;
      // แกน view — ตัดก่อนแกน Site เพราะไม่ต้องรู้จักกล้องก็ตัดสินได้
      if (ws._allowedViews != null &&
          !(typeRoute && viewAllows({ allowed_views: ws._allowedViews }, typeRoute))) return;
      // P5 — เลือก payload หลังด่าน view/site เดิมทั้งสองด่าน (ไม่แตะสิทธิ์)
      // ไม่ได้ subscribe หัวข้อนี้ = ได้รุ่น lite ไม่ใช่ "ไม่ได้เลย" เพราะตัวนับ/
      // badge/toast ของทุกหน้ายังต้องขยับตาม event ที่ไม่ได้อยู่บนหน้าตัวเอง
      const payload = (heavy && !ws._topics?.has(heavy))
        ? (liteJson ??= JSON.stringify({ type: data.type, lite: true, event: _liteEvent(data.event) }))
        : (needScrub && !ws._isAdmin)
          ? (scrubJson ??= JSON.stringify({ ...data, event: { ...data.event, raw_json: scrubRawJson(data.event.raw_json) } }))
          : json;
      // unrestricted → ส่งเหมือนเดิมทุกข้อความ (พฤติกรรมเดิม 100%)
      if (ws._allowedSites === null || ws._allowedSites === undefined) return ws.send(payload);
      // ผู้ใช้ที่ถูกจำกัด: ต้องระบุกล้องเจ้าของได้ และกล้องนั้นต้องอยู่ใน Site ที่มีสิทธิ์
      // ระบุไม่ได้ = ไม่ส่ง (fail closed — เสียแค่การอัปเดตสด ไม่ทำให้หน้าจอพัง)
      if (!camId || !_wsCamSiteMap) return;
      if (mediaScope.cameraInScope(ws._allowedSites, camId, _wsCamSiteMap)) ws.send(payload);
    });
  }

  return { wss, broadcast };
};
