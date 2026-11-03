// ============================================================
// Vigil Platform — Blacklist Source Connection Probes
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Read-only "test connection" probes for the blacklist import settings page
// (docs/superpowers/specs/2026-07-24-blacklist-central-database-design.md).
// Each function takes operator-supplied connection config FOR THIS CALL ONLY —
// nothing here persists credentials (migration 093 / blacklist schema does not
// exist yet, so there is nowhere durable to store them even if we wanted to).
// Every outbound call is a fixed, named request shape per source (never a
// generic "fetch this URL/path") — bounds the SSRF surface to the same
// operator-trust level as adding a camera by IP elsewhere in this app, not
// a step beyond it.
'use strict';

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { parseChallenge, buildDigestHeader } = require('./digestAuth');

const SAMPLE_SIZE = 3;

// Reveal-on-demand per spec §4.2 — masked by default so a live test doesn't
// dump full national IDs to the browser just to prove connectivity/shape.
function maskId(v) {
  const s = String(v || '');
  if (s.length <= 4) return s ? '*'.repeat(s.length) : '';
  return s.slice(0, 2) + 'x'.repeat(s.length - 4) + s.slice(-2);
}

// ---------- DSS Pro (Dahua-HTTP-API-For-DSS-V8.7 §3.1 Login Authentication) ----------
function dssRequest(host, port, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = https.request({
      host, port, path, method, rejectUnauthorized: false, timeout: 15000,
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'Accept-Language': 'en',
        'Time-Zone': 'Asia/Bangkok',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = []; res.on('data', d => chunks.push(d));
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* non-JSON */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', reject); r.on('timeout', () => r.destroy(new Error('timeout')));
    if (data) r.write(data);
    r.end();
  });
}

async function testDssPro({ host, port = 443, username, password }) {
  if (!host || !username || !password) return { ok: false, error: 'ต้องระบุ host / username / password' };
  const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

  const step1 = await dssRequest(host, port, 'POST', '/brms/api/v1.0/accounts/authorize',
    { userName: username, ipAddress: '', clientType: 'WINPC_V2' });
  if (!step1.body || !step1.body.realm || !step1.body.randomKey)
    return { ok: false, error: `เชื่อมต่อไม่ได้ (trigger step: HTTP ${step1.status})` };
  const { realm, randomKey } = step1.body;

  // signature per §3.1.2 Submit Credentials
  const temp1 = md5(password);
  const temp2 = md5(username + temp1);
  const temp3 = md5(temp2);
  const temp4 = md5(`${username}:${realm}:${temp3}`);
  const signature = md5(`${temp4}:${randomKey}`);

  const step2 = await dssRequest(host, port, 'POST', '/brms/api/v1.0/accounts/authorize',
    { userName: username, randomKey, signature, clientType: 'WINPC_V2', userType: '0', ipAddress: '' });
  if (!step2.body || !step2.body.token) return { ok: false, error: 'login ไม่ผ่าน — ตรวจ username/password' };
  const token = step2.body.token;

  const repos = await dssRequest(host, port, 'GET',
    '/brms/api/v1.1/face/application/control/repository/page?page=1&pageSize=50&orderType=&orderDirection=0&keyword=&source=&surveyType=',
    null, { 'X-Subject-Token': token });
  const groups = (repos.body?.data?.pageData || []).map(g => ({
    id: g.repositoryId, name: g.repositoryName, personCount: Number(g.facePersonCount) || 0,
    isFailed: g.isFailed === '1',
  }));

  const persons = await dssRequest(host, port, 'GET',
    `/obms/api/v1.1/acs/person/page?orgCode=001&containChild=1&page=1&pageSize=${SAMPLE_SIZE}&accessType=1&inFaceRepository=`,
    null, { 'X-Subject-Token': token });
  const sample = (persons.body?.data?.pageData || []).map(p => ({
    id_masked: maskId(p.baseInfo?.personId),
    name: p.baseInfo?.firstName || p.baseInfo?.lastName || '',
    org: p.baseInfo?.orgName || '',
    group: p.faceComparisonInfo?.faceComparisonGroupName || '',
  }));

  return {
    ok: true, dataType: 'face', groups, sample,
    sampleTotal: persons.body?.data?.totalCount ? Number(persons.body.data.totalCount) : null,
  };
}

// ---------- GuruSquare (LPR blacklist + Events Alarm) ----------
// 2026-09-24 GuruSquare เปลี่ยน API: `/lpr?type=blacklist` ถูกยกเลิก (ตอบ 404
// {"detail":"Not Found"} — sync HKT ล่มเงียบ ๆ ตั้งแต่ ~23 ก.ย.) เป็น path แยก
// ต่อชนิด: /blacklist · /alert · /lprresult · /addBlacklist · ชื่อฟิลด์เหมือนเดิม
// path จึงเป็นอาร์กิวเมนต์ ไม่ฝังตายตัวในฟังก์ชันอีก
// The doc shows a JSON "Params" block under a GET — verified live against the
// real device that this is documentation shorthand for query-string params,
// NOT a literal GET body (a body silently returns "[]", params ignored;
// nginx/upstream just never reads a GET body). Querystring is what the
// device actually honors — confirmed live, not guessed.
function guruSquareRequest(host, port, apiPath, qs, apiKey) {
  const query = new URLSearchParams(qs).toString();
  return new Promise((resolve, reject) => {
    const r = http.request({
      host, port, path: `${apiPath}?${query}`, method: 'GET', timeout: 15000,
      headers: { 'X-API-Key': apiKey },
    }, (res) => {
      const chunks = []; res.on('data', d => chunks.push(d));
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* non-JSON */ }
        resolve({ status: res.statusCode, body: parsed, raw: Buffer.concat(chunks).toString('utf8') });
      });
    });
    r.on('error', reject); r.on('timeout', () => r.destroy(new Error('timeout')));
    r.end();
  });
}

async function testGuruSquare({ host, port = 13000, apiKey }) {
  if (!host || !apiKey) return { ok: false, error: 'ต้องระบุ host / API key' };
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const params = {
    datefrom: from.toISOString().slice(0, 19),
    dateto: now.toISOString().slice(0, 19),
  };
  const r = await guruSquareRequest(host, port, '/blacklist', params, apiKey);
  if (r.status !== 200 || !Array.isArray(r.body)) {
    return { ok: false, error: `HTTP ${r.status} — ${(r.raw || '').slice(0, 200)}` };
  }
  const sample = r.body.slice(0, SAMPLE_SIZE).map(rec => ({
    plate: rec.plate_number, province: rec.province_organization, brand: rec.carbrand,
    color: rec.carcolor, type: rec.cartype,
    owner_masked: rec.owner ? maskId(rec.owner) : '',
  }));
  return { ok: true, dataType: 'lpr', sample, sampleTotal: r.body.length };
}

// ---------- DSS Pro full import fetch (edge-side, downscaled) ----------
// Login is factored out so the import can reuse one token across pages instead
// of re-authenticating per page (shared admin account — keep login attempts low).
async function dssLogin(host, port, username, password) {
  const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');
  const step1 = await dssRequest(host, port, 'POST', '/brms/api/v1.0/accounts/authorize',
    { userName: username, ipAddress: '', clientType: 'WINPC_V2' });
  if (!step1.body || !step1.body.realm) throw new Error(`เชื่อมต่อไม่ได้ (HTTP ${step1.status})`);
  const { realm, randomKey } = step1.body;
  const temp3 = md5(md5(username + md5(password)));
  const signature = md5(`${md5(`${username}:${realm}:${temp3}`)}:${randomKey}`);
  const step2 = await dssRequest(host, port, 'POST', '/brms/api/v1.0/accounts/authorize',
    { userName: username, randomKey, signature, clientType: 'WINPC_V2', userType: '0', ipAddress: '' });
  if (!step2.body || !step2.body.token) throw new Error('login ไม่ผ่าน — ตรวจ username/password');
  return step2.body.token;
}

// Fetch a person's head-shot. The URL comes back FROM the API, so it is treated
// as untrusted input: we only ever fetch it if its hostname matches the operator-
// configured DSS host. Without that check a compromised or spoofed DSS response
// could point this at any internal address and turn the edge into an SSRF proxy.
function dssFetchPhoto(host, port, token, rawUrl) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(rawUrl); } catch { return resolve(null); }
    if (u.hostname !== host) return resolve(null);   // refuse off-host URLs
    const req = https.request({
      host, port: u.port || port, path: u.pathname + u.search, method: 'GET',
      rejectUnauthorized: false, timeout: 20000, headers: { 'X-Subject-Token': token },
    }, (res) => {
      const chunks = []; res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        // The endpoint answers 200 + a JSON error body when unauthorized, so
        // sniff the JPEG magic rather than trusting the status code.
        resolve(buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 ? buf : null);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

const DSS_PHOTO_MAX_W = 480;   // head-shots — 480px is plenty for identification
const DSS_PHOTO_QUALITY = 80;

async function fetchDssProPersons({ host, port = 443, username, password, page = 1, pageSize = 200, withPhotos = true, withDetail = true }) {
  if (!host || !username || !password) throw new Error('ต้องระบุ host / username / password');
  const token = await dssLogin(host, port, username, password);

  const r = await dssRequest(host, port, 'GET',
    `/obms/api/v1.1/acs/person/page?orgCode=001&containChild=1&page=${page}&pageSize=${pageSize}&accessType=1&inFaceRepository=`,
    null, { 'X-Subject-Token': token });
  const data = r.body?.data;
  if (!data) throw new Error(`person/page ตอบผิดรูป (HTTP ${r.status})`);

  let sharp = null;
  if (withPhotos) { try { sharp = require('sharp'); } catch { /* forward original */ } }

  const out = [];
  for (const p of (data.pageData || [])) {
    const b = p.baseInfo || {};

    // person/page is a SUMMARY view — it omits remark, gender and tel entirely
    // (measured: remark 0/957 from the list, but populated on the detail view).
    // One extra GET per person is the only way to reach the case text, so the
    // caller can turn it off when it only needs the roster skeleton.
    let detail = null;
    if (withDetail && b.personId) {
      const d = await dssRequest(host, port, 'GET',
        `/obms/api/v1.1/acs/person/${encodeURIComponent(b.personId)}`, null, { 'X-Subject-Token': token });
      detail = d.body?.data || null;
    }
    const db = detail?.baseInfo || {};
    const auth = detail?.authenticationInfo || {};

    let photo_b64 = null;
    if (withPhotos && b.facePicture) {
      const raw = await dssFetchPhoto(host, port, token, b.facePicture);
      if (raw) {
        if (sharp) {
          try {
            photo_b64 = (await sharp(raw).rotate()
              .resize({ width: DSS_PHOTO_MAX_W, withoutEnlargement: true })
              .jpeg({ quality: DSS_PHOTO_QUALITY }).toBuffer()).toString('base64');
          } catch { photo_b64 = null; }
        } else photo_b64 = raw.toString('base64');
      }
    }
    out.push({
      person_id: b.personId || null,          // Thai national ID — Central hashes/encrypts it
      first_name: b.firstName || null,
      last_name: b.lastName || null,
      org_code: b.orgCode || null,
      org_name: b.orgName || null,
      remark: db.remark || b.remark || null,  // detail view is where the case text lives
      gender: db.gender || null,
      tel: db.tel || null,                    // reporting officer's contact, not the subject's
      // DSS has no per-person "added on" field. startTime/endTime are the access
      // VALIDITY window and come in a handful of batch values (4 distinct across
      // a 40-record sample: 2025-08-11 / 2025-11-05 / 2026-02-02 / 2026-05-11),
      // so treat them as an intake-batch marker, never as a creation date.
      valid_from: auth.startTime || null,
      valid_to: auth.endTime || null,
      group_id: p.faceComparisonInfo?.faceComparisonGroupId || null,
      group_name: p.faceComparisonInfo?.faceComparisonGroupName || null,
      photo_b64,
    });
  }
  return { ok: true, dataType: 'face', total: Number(data.totalCount) || 0, page, pageSize, records: out };
}

// ---------- DSS Pro vehicle blocklist ----------
// A SEPARATE module from the face roster: /ipms (parking/entrance) rather than
// /obms (personnel). Measured live 2026-07-25: 516 vehicles, every one with a
// plate, 499 with a case remark, and — unlike GuruSquare — 514 carry a risk tier
// (surveyGroups: High Risk Vehicle 355 / Medium Risk Vehicle 163). No photos on
// this source at all (carPic 0/516), so the vehicle tile falls back to a plaque.
//
// NOTE the vehicleType filter param is IGNORED by this server — passing 1/2/4/5
// all return the same 516. Don't add it back thinking it narrows anything.
async function fetchDssProVehicles({ host, port = 443, username, password, page = 1, pageSize = 1000 }) {
  if (!host || !username || !password) throw new Error('ต้องระบุ host / username / password');
  const token = await dssLogin(host, port, username, password);

  const r = await dssRequest(host, port, 'GET',
    `/ipms/api/v1.1/vehicle/page?orgCode=001&page=${page}&pageSize=${pageSize}`,
    null, { 'X-Subject-Token': token });
  const data = r.body?.data;
  if (!data) throw new Error(`vehicle/page ตอบผิดรูป (HTTP ${r.status})`);

  const records = (data.pageData || []).map(v => ({
    external_id: String(v.id),
    plate_number: v.plateNo || null,
    brand: (v.vehicleBrand && v.vehicleBrand !== '-1') ? v.vehicleBrand : null,
    color: (v.vehicleColor && v.vehicleColor !== '0') ? v.vehicleColor : null,
    remark: v.remark || null,
    org_name: v.orgName || null,
    // the risk tier lives on surveyGroups, not on any scalar field
    risk_group: (v.surveyGroups || []).map(g => g.name || g.groupName).filter(Boolean).join(', ') || null,
  }));
  return { ok: true, dataType: 'lpr', total: Number(data.totalCount) || records.length, page, pageSize, records };
}

// ---------- capability discovery ----------
// Ask a source what it ACTUALLY holds instead of hardcoding assumptions. This
// exists because the settings page had DSS Pro registered as face-only, while
// the same server was also serving 516 blocklisted vehicles nobody knew about.
// Each probe is independent: one capability failing must not hide the other.
async function discoverSource({ source, host, port, username, password, apiKey }) {
  const out = { face: { available: false }, lpr: { available: false } };

  if (source === 'dss_pro') {
    try {
      const token = await dssLogin(host, port || 443, username, password);
      const f = await dssRequest(host, port || 443, 'GET',
        '/obms/api/v1.1/acs/person/page?orgCode=001&containChild=1&page=1&pageSize=1&accessType=1&inFaceRepository=',
        null, { 'X-Subject-Token': token });
      const fc = Number(f.body?.data?.totalCount);
      if (Number.isFinite(fc)) out.face = { available: true, count: fc, label: 'บุคคลในกลุ่มเฝ้าระวัง' };

      const v = await dssRequest(host, port || 443, 'GET',
        '/ipms/api/v1.1/vehicle/page?orgCode=001&page=1&pageSize=1', null, { 'X-Subject-Token': token });
      const vc = Number(v.body?.data?.totalCount);
      if (Number.isFinite(vc)) out.lpr = { available: true, count: vc, label: 'ยานพาหนะเฝ้าระวัง' };
    } catch (e) { out.error = e.message; }
    return out;
  }

  if (source === 'hcp') {
    // ไม่ถามอะไรจากผู้ใช้เลย — กุญแจอยู่ใน env ของ edge นี้ · ถ้าเรียกไม่ได้แปลว่า
    // ยืนอยู่ผิดเครื่อง (central ไปไม่ถึง HCP) ไม่ใช่ config ผิด
    try {
      const t = await testHcp();
      const fg = t.faceGroups.filter((g) => !g.skipped);
      const vg = t.vehicleGroups.filter((g) => !g.skipped);
      if (fg.length) out.face = { available: true, count: t.faceTotal, label: `${fg.length} คลังใบหน้า` };
      if (vg.length) out.lpr = { available: true, count: t.vehicleTotal, label: `${vg.length} กลุ่มรถ` };
    } catch (e) { out.error = e.message; }
    return out;
  }

  if (source === 'gurusquare') {
    try {
      const now = new Date();
      const from = new Date(now.getTime() - 3650 * 24 * 3600 * 1000);
      const r = await guruSquareRequest(host, port || 13000, '/blacklist', {
        datefrom: from.toISOString().slice(0, 19),
        dateto: new Date(now.getTime() + 86400000).toISOString().slice(0, 19),
      }, apiKey);
      if (r.status === 200 && Array.isArray(r.body)) {
        out.lpr = { available: true, count: r.body.length, label: 'ทะเบียนเฝ้าระวัง' };
      } else out.error = `HTTP ${r.status}`;
    } catch (e) { out.error = e.message; }
    return out;
  }

  if (source === 'dahua_nvr') {
    try {
      const f = await testDahuaNvrFace({ host, port: port || 80, username, password });
      if (f.ok) {
        out.face = {
          available: true, label: 'กลุ่มใบหน้าบนเครื่อง',
          count: (f.groups || []).reduce((s, g) => s + (g.personCount || 0), 0),
          groups: f.groups,
        };
      }
    } catch { /* face side unavailable — keep probing LPR */ }
    try {
      const l = await testDahuaNvrLpr({ host, port: port || 80, username, password });
      if (l.ok) out.lpr = { available: true, count: l.sampleTotal || 0, label: 'TrafficBlackList บนเครื่อง' };
    } catch { /* ignore */ }
    return out;
  }

  out.error = 'discovery ยังไม่รองรับแหล่งข้อมูลนี้';
  return out;
}

// ---------- GuruSquare full import fetch (edge-side, downscaled) ----------
// The probe above pulls a masked 3-record sample to prove connectivity. THIS is
// the import path: full records, unmasked, for one date window at a time.
//
// Why chunked + downscaled: the whole blacklist in one call measured **376 MB**
// live (1,080 records averaging ~349 KB each — every record carries a full-res
// car photo as base64). That is not survivable through the Cloudflare tunnel in
// a single response. So the edge does the same downscale-at-ingest trick already
// used for LPR scene images (lpr-core.resizeScene, RF-IMG): re-encode each photo
// to max 800px / q75 JPEG here, at the edge, before it ever crosses the tunnel.
// Measured effect: ~349 KB/record -> ~30-40 KB/record.
const GS_PHOTO_MAX_W = 800;
const GS_PHOTO_QUALITY = 75;

// Shared downscale for every GuruSquare photo field (blacklist roster's
// image_car, /alert's image_car, /lprresult's image_car). Factored out of
// fetchGuruSquareRange 2026-09-24 so the two new alarm-feed fetchers below
// reuse the exact same "corrupt photo -> null, sharp missing -> forward
// original" behavior instead of a second copy of it.
async function _gsDownscale(b64) {
  if (!b64 || String(b64).length <= 100) return null;
  const raw = Buffer.from(String(b64).replace(/^data:image\/\w+;base64,/, ''), 'base64');
  let sharp = null;
  try { sharp = require('sharp'); } catch { /* forward original if sharp is absent */ }
  if (!sharp) return raw.toString('base64');
  try {
    return (await sharp(raw).rotate()
      .resize({ width: GS_PHOTO_MAX_W, withoutEnlargement: true })
      .jpeg({ quality: GS_PHOTO_QUALITY })
      .toBuffer()).toString('base64');
  } catch { return null; } // a corrupt photo must not sink the whole record
}

async function fetchGuruSquareRange({ host, port = 13000, apiKey, from, to, withPhotos = true }) {
  if (!host || !apiKey) throw new Error('ต้องระบุ host / API key');
  if (!from || !to) throw new Error('ต้องระบุช่วงวันที่ (from/to)');
  const r = await guruSquareRequest(host, port, '/blacklist', { datefrom: from, dateto: to }, apiKey);
  if (r.status !== 200 || !Array.isArray(r.body)) {
    throw new Error(`HTTP ${r.status} — ${(r.raw || '').slice(0, 200)}`);
  }

  const out = [];
  for (const rec of r.body) {
    const photo_b64 = withPhotos ? await _gsDownscale(rec.image_car) : null;
    out.push({
      external_id: String(rec.id),
      last_update: rec.lastupdate || null,
      plate_number: rec.plate_number || null,
      province: rec.province_organization || null,
      cartype: rec.cartype || null,
      carcolor: rec.carcolor || null,
      carbrand: rec.carbrand || null,
      platetype: rec.platetype || null,
      owner: rec.owner || null,
      owner_detail: rec.owner_address_and_detail || null,
      // Added 2026-08-01. This function builds a new object field by field, so
      // anything not named here is dropped at the edge and never reaches
      // central — which is exactly what happened to these two: measured, all
      // 463 stored records carried only seven raw_json keys and neither of
      // these was among them.
      blacklisttype: rec.blacklisttype || null,
      remark: rec.remark || null,
      photo_b64,
    });
  }
  return { ok: true, dataType: 'lpr', count: out.length, records: out };
}

// ---------- GuruSquare real-time alarm feed (`/alert`) ----------
// A SEPARATE endpoint from `/blacklist` above — one row per actual hit on a
// blacklisted plate (~2/day at HKT), not the whole roster. No pagination;
// callers must keep the window short (blacklist.gs_alarms poller does).
async function fetchGuruSquareAlerts({ host, port = 13000, apiKey, from, to, withPhotos = true }) {
  if (!host || !apiKey) throw new Error('ต้องระบุ host / API key');
  if (!from || !to) throw new Error('ต้องระบุช่วงวันที่ (from/to)');
  const r = await guruSquareRequest(host, port, '/alert', { datefrom: from, dateto: to }, apiKey);
  if (r.status !== 200 || !Array.isArray(r.body)) {
    throw new Error(`HTTP ${r.status} — ${(r.raw || '').slice(0, 200)}`);
  }
  const out = [];
  for (const rec of r.body) {
    const photo_b64 = withPhotos ? await _gsDownscale(rec.image_car) : null;
    out.push({
      external_id: Number(rec.id),
      timestamp: rec.timestamp,
      plate_number: rec.plate_number || null,
      province: rec.province_organization || null,
      cartype: rec.cartype || null,
      carcolor: rec.carcolor || null,
      carbrand: rec.carbrand || null,
      platetype: rec.platetype || null,
      owner: rec.owner || null,
      owner_detail: rec.owner_address_and_detail || null,
      photo_b64,
    });
  }
  return { ok: true, kind: 'alert', count: out.length, records: out };
}

// GuruSquare timestamps (both /alert and /lprresult) are Asia/Bangkok local,
// no offset attached. A small local copy of the same math gsAlarmPoll.js uses
// on the central side — not required from there, because this file runs on
// the EDGE and gsAlarmPoll.js is a central-only deployment target.
const _GS_TS_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})$/;
function _gsEpoch(str) {
  const m = String(str || '').trim().match(_GS_TS_RE);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - 7 * 3600 * 1000;
}
function _gsLocalFromEpoch(ms) {
  const d = new Date(ms + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T`
       + `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

// ---------- GuruSquare read log (`/lprresult`) — fallback camera match ----------
// Used when an /alert hit can't be matched to one of OUR events (e.g. the
// camera that actually saw the car isn't ours, or our ingest missed it). The
// same plate shows up in GuruSquare's own read log 3-24s before the alarm —
// this pages through it (images=false, cheap) to find the match, then makes
// ONE second, narrow-window request with images=true to fetch just that one
// photo. Paginated (size/offset), hard-capped at 20 pages as a runaway guard.
async function fetchGuruSquareLprMatch({ host, port = 13000, apiKey, from, to, plate }) {
  if (!host || !apiKey) throw new Error('ต้องระบุ host / API key');
  if (!from || !to || !plate) throw new Error('ต้องระบุช่วงวันที่ (from/to) และป้ายทะเบียน');
  const wantPlate = String(plate).replace(/\s+/g, '');
  const size = 500;
  const matches = [];
  for (let page = 0, offset = 0; page < 20; page++, offset += size) {
    const r = await guruSquareRequest(host, port, '/lprresult',
      { datefrom: from, dateto: to, size, offset, images: 'false' }, apiKey);
    if (r.status !== 200 || !Array.isArray(r.body)) {
      throw new Error(`HTTP ${r.status} — ${(r.raw || '').slice(0, 200)}`);
    }
    for (const rec of r.body) {
      if (String(rec.plate_number || '').replace(/\s+/g, '') === wantPlate) {
        matches.push({
          id: rec.id, timestamp: rec.timestamp,
          cctv_name: rec.cctv_name || null, ipaddress: rec.ipaddress || null,
          plate_number: rec.plate_number || null,
        });
      }
    }
    if (r.body.length < size) break; // last page
  }

  let best = null;
  if (matches.length) {
    // "closest to `to`" — `to` is the end of the alarm window, so this is
    // whichever read happened nearest the alarm itself.
    const toEpoch = _gsEpoch(to);
    let bestMatch = matches[0], bestDist = Infinity;
    for (const m of matches) {
      const e = _gsEpoch(m.timestamp);
      const dist = (e == null || toEpoch == null) ? Infinity : Math.abs(e - toEpoch);
      if (dist < bestDist) { bestDist = dist; bestMatch = m; }
    }
    let photo_b64 = null;
    try {
      const t = _gsEpoch(bestMatch.timestamp);
      const from2 = t != null ? _gsLocalFromEpoch(t) : bestMatch.timestamp;
      const to2 = t != null ? _gsLocalFromEpoch(t + 1000) : bestMatch.timestamp;
      const r2 = await guruSquareRequest(host, port, '/lprresult',
        { datefrom: from2, dateto: to2, size: 500, offset: 0, images: 'true' }, apiKey);
      if (r2.status === 200 && Array.isArray(r2.body)) {
        // id ของ /lprresult เป็นสตริง "1790213186.8540976_10_5_100_9" — Number() ได้ NaN
        // และ NaN !== NaN ⇒ เคยหารูปไม่เจอทุกครั้ง (ทำซ้ำกับของจริง 2026-09-24) ต้องเทียบสตริง
        const hit = r2.body.find((x) => String(x.id) === String(bestMatch.id));
        if (hit) photo_b64 = await _gsDownscale(hit.image_car);
      }
    } catch { /* photo re-fetch is best-effort — a failed lookup still returns the match */ }
    best = {
      id: bestMatch.id, timestamp: bestMatch.timestamp,
      cctv_name: bestMatch.cctv_name, ipaddress: bestMatch.ipaddress,
      plate_number: bestMatch.plate_number, photo_b64,
    };
  }
  return { ok: true, kind: 'lprresult', matches, best };
}

// ---------- Dahua NVR (read-only allowlist, per cgi file) ----------
// faceRecognitionServer.cgi = Face groups/persons. recordFinder.cgi?name=TrafficBlackList
// = LPR blacklist plates — 'find' only; recordUpdater.cgi (insert/update/remove/removeEx,
// the WRITE side of the same TrafficBlackList table) is a different cgi and is never called here.
const FACE_ALLOWED_ACTIONS = new Set(['findGroup', 'startFind', 'doFind', 'stopFind']);
const LPR_ALLOWED_ACTIONS = new Set(['find']);
function dahuaCgiGet(host, port, user, pass, cgi, action, qs, allowedActions) {
  if (!allowedActions.has(action)) throw new Error(`blocked: ${action} not in read-only allowlist for ${cgi}`);
  const uriPath = `/cgi-bin/${cgi}?action=${action}${qs || ''}`;
  return new Promise((resolve, reject) => {
    const req1 = http.request({ host, port, path: uriPath, method: 'GET', timeout: 20000 }, (res1) => {
      if (res1.statusCode !== 401) {
        const chunks = []; res1.on('data', d => chunks.push(d));
        res1.on('end', () => resolve({ status: res1.statusCode, body: Buffer.concat(chunks) }));
        return;
      }
      const challenge = parseChallenge(res1.headers['www-authenticate'] || '');
      const auth = buildDigestHeader(user, pass, 'GET', uriPath, challenge);
      const req2 = http.request({ host, port, path: uriPath, method: 'GET', timeout: 20000, headers: { Authorization: auth } }, (res2) => {
        const chunks = []; res2.on('data', d => chunks.push(d));
        res2.on('end', () => resolve({ status: res2.statusCode, body: Buffer.concat(chunks) }));
      });
      req2.on('error', reject); req2.on('timeout', () => req2.destroy(new Error('timeout')));
      req2.end();
      res1.resume();
    });
    req1.on('error', reject); req1.on('timeout', () => req1.destroy(new Error('timeout')));
    req1.end();
  });
}

function parseCgiTable(body, prefix) {
  const rows = {};
  const re = new RegExp(`^${prefix}\\[(\\d+)\\]\\.(\\w+)(?:\\[\\d+\\])?=(.*)$`);
  for (const line of body.toString('utf8').split(/\r?\n/)) {
    const m = line.match(re);
    if (!m) continue;
    rows[m[1]] = rows[m[1]] || {};
    if (rows[m[1]][m[2]] === undefined) rows[m[1]][m[2]] = m[3];
  }
  return Object.values(rows);
}

async function testDahuaNvrFace({ host, port = 80, username, password }) {
  if (!host || !username || !password) return { ok: false, error: 'ต้องระบุ host / username / password' };
  const r = await dahuaCgiGet(host, port, username, password, 'faceRecognitionServer.cgi', 'findGroup', '', FACE_ALLOWED_ACTIONS);
  if (r.status !== 200) return { ok: false, error: `HTTP ${r.status}` };
  const groups = parseCgiTable(r.body, 'GroupList').map(g => ({
    id: g.groupID, name: g.groupName, type: g.groupType, personCount: Number(g.groupSize) || 0,
  }));
  return { ok: true, dataType: 'face', groups };
}

// recordFinder.cgi?action=find&name=TrafficBlackList — Dahua HTTP API v3.37 §recordFinder.
// LIVE-VERIFIED 2026-07-25 against 20 real ANPR cameras on the hdy edge: the doc's
// bare StartTime/EndTime returns HTTP 400 — the real device requires the
// condition.StartTime/condition.EndTime prefix (same convention as condition.PlateNumber).
// With that fix every camera returned HTTP 200 "found=0" (protocol round-trips
// correctly; the table itself is simply empty fleet-wide — no LPR blacklist has
// ever been provisioned to a Dahua camera here, which is expected pre-launch).
async function testDahuaNvrLpr({ host, port = 80, username, password }) {
  if (!host || !username || !password) return { ok: false, error: 'ต้องระบุ host / username / password' };
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
  const qs = `&name=TrafficBlackList&count=${SAMPLE_SIZE}&condition.StartTime=${encodeURIComponent(fmt(from))}&condition.EndTime=${encodeURIComponent(fmt(now))}`;
  const r = await dahuaCgiGet(host, port, username, password, 'recordFinder.cgi', 'find', qs, LPR_ALLOWED_ACTIONS);
  if (r.status !== 200) return { ok: false, error: `HTTP ${r.status}` };
  const sample = parseCgiTable(r.body, 'records').slice(0, SAMPLE_SIZE).map(rec => ({
    plate: rec.PlateNumber, owner_masked: rec.MasterOfCar ? maskId(rec.MasterOfCar) : '', created: rec.CreateTime,
  }));
  return { ok: true, dataType: 'lpr', sample, sampleTotal: sample.length };
}

// ---------- HikCentral Professional (HC3) ----------
// ต่างจากแหล่งอื่นตรงที่ **ไม่มี credential ใน config เลย** — AK/SK อยู่ใน env ของ
// edge hkt เท่านั้น (`HCP_SECRET_KEY_ENC`) เพราะ central ไปไม่ถึง `10.0.10.9` อยู่แล้ว
// จึงไม่มีเหตุให้เก็บกุญแจของ HCP ไว้บน central
//
// ทุกเส้นทางที่นี่เป็น **query/list อ่านอย่างเดียว** — HCP เป็นระบบของตำรวจที่มีคนอื่นใช้อยู่
// ห้ามเขียนอะไรกลับเข้าไปเด็ดขาด
const { hcpCall: _hcpCall, hcpPageAll: _hcpPageAll, HCP_PAGE: HCP_PAGE_SIZE } = require('./hcpPage');
// picture_data ตอบเป็น data-URI ดิบ ไม่มี `code` ให้ตรวจ — hcpCall จะมองว่าผิดพลาด
// จึงต้องเรียกตรงและอ่าน body เอง
async function _hcpCallRaw(path, body) {
  const hcp = require('../hcp-client');
  await hcp.init();
  const r = await hcp.call('POST', path, body, {});
  return r.body || {};
}
// กลุ่มที่ **ไม่ใช่บัญชีดำ** ต้องไม่ถูกดึงมาตั้งแต่ต้นทาง — ถ้าปล่อยให้ลงตารางเราแล้ว
// วันหนึ่งมันเดินต่อไป bridge จะกลายเป็น "เฝ้าระวังคนที่ตั้งใจยกเว้น" ซึ่งกลับหัวกับความจริง
const _hcpIsAllowList = (name) => /white\s*list|vip/i.test(String(name || ''));

// กลุ่มทั้งหมด + จำนวนสมาชิกจริงต่อกลุ่ม — เป็นทั้งปุ่ม "ทดสอบการเชื่อมต่อ" และ
// ตัวบอกว่าจะได้ข้อมูลมาเท่าไหร่ก่อนกดนำเข้าจริง
async function testHcp() {
  const fg = await _hcpCall('/artemis/api/frs/v1/face/groupList', { pageNo: 1, pageSize: HCP_PAGE_SIZE });
  const faceGroups = [];
  for (const g of (fg.list || [])) {
    const skip = _hcpIsAllowList(g.name);
    let count = null;
    if (!skip) {
      const r = await _hcpCall('/artemis/api/frs/v1/face', { pageNo: 1, pageSize: 1, faceGroupIndexCode: g.indexCode });
      count = Number(r.total) || 0;
    }
    faceGroups.push({ index_code: String(g.indexCode), name: g.name, count, skipped: skip });
  }

  const vg = await _hcpCall('/artemis/api/resource/v1/vehicleGroup/vehicleGroupList', { pageNo: 1, pageSize: 100 });
  const vehicleGroups = [];
  for (const g of (vg.list || [])) {
    const skip = _hcpIsAllowList(g.vehicleGroupName);
    let count = null;
    if (!skip) {
      // นับด้วยการเดินหน้าจริง — `total` ของเส้นนี้เชื่อไม่ได้ (ดูหมายเหตุที่ _hcpPageAll)
      const r = await _hcpPageAll('/artemis/api/resource/v1/vehicle/vehicleList',
        { vehicleGroupIndexCode: g.vehicleGroupIndexCode }, () => {});
      count = r.got;
    }
    vehicleGroups.push({ index_code: String(g.vehicleGroupIndexCode), name: g.vehicleGroupName, count, skipped: skip });
  }

  const sum = (a) => a.reduce((n, x) => n + (x.count || 0), 0);
  return {
    ok: true, dataType: 'face+lpr',
    faceGroups, vehicleGroups,
    faceTotal: sum(faceGroups), vehicleTotal: sum(vehicleGroups),
    sample: faceGroups.filter((g) => !g.skipped).slice(0, SAMPLE_SIZE).map((g) => ({ group: g.name, count: g.count })),
    sampleTotal: faceGroups.filter((g) => !g.skipped).length,
  };
}

// ใบหน้าทุกกลุ่ม (ยกเว้นกลุ่มยกเว้น) · **ไม่มีรูป** — `facePic.faceUrl` ที่ HCP คืนมา
// เป็น hash เปล่า ไม่ใช่ `Dev://…` ที่ `frs/v1/application/picture` รับ (ยืนยันสองทาง:
// ยิงจริงได้ `code 2 url parameter error` + คู่มือระบุว่า url ต้องขึ้นต้นด้วย Dev/Server/Vsm)
// รายชื่อคลัง (ไม่นับสมาชิก) — central เรียกก่อนเพื่อจะได้ดึงทีละคลัง ไม่เอา 18 MB มาในคำขอเดียว
async function listHcpFaceGroups() {
  const fg = await _hcpCall('/artemis/api/frs/v1/face/groupList', { pageNo: 1, pageSize: HCP_PAGE_SIZE });
  return {
    ok: true, dataType: 'face',
    groups: (fg.list || []).map((g) => ({ index_code: String(g.indexCode), name: g.name,
                                          skipped: _hcpIsAllowList(g.name) })),
  };
}

// 🔑 วิธีดึงรูปในคลังใบหน้า (ค้นเจอ 2026-08-09 — ก่อนหน้านี้ลองผิดมา 33 วิธี)
//
//   POST /artemis/api/resource/v1/person/picture_data
//   { personId: <indexCode ของใบหน้า>, picUri: <facePic.faceUrl> }   → data:image/jpeg;base64,…
//
// กุญแจคือ **`indexCode` ของใบหน้าใช้เป็น `personId`** — ตรงกับเลขใน URL ที่หน้าเว็บ HCP
// เรียกเอง (`/ISAPI/Bumblebee/Platform/V0/PersonCredential/Persons/2408/Photo`)
// ⚠️ `frs/v1/application/picture` **ไม่เกี่ยวเลย** — เส้นนั้นรับเฉพาะ URL ที่ผูกกับอุปกรณ์
// (`Dev://…&DEVICE=n`) ซึ่งรูปที่เจ้าหน้าที่อัปโหลดเข้าคลังไม่มีวันมี
async function _hcpFacePhoto(indexCode, faceUrl) {
  if (!faceUrl) return null;
  const r = await _hcpCallRaw('/artemis/api/resource/v1/person/picture_data',
    { personId: String(indexCode), picUri: faceUrl });
  const s = String((r || {}).raw || (r || {}).data || '');
  if (!/^data:image|^\/9j\//.test(s)) return null;
  return s.includes(',') ? s.split(',').pop() : s;   // เก็บเฉพาะ base64 ไม่เอา data-URI prefix
}

// Description ที่เจ้าหน้าที่กรอกไว้บน HCP **ไม่ได้อยู่ในคลังใบหน้า** — `frs/v1/face`
// คืนแค่ indexCode / ชื่อ / เพศ / faceUrl เท่านั้น (ยิงจริงยืนยันแล้ว) · ตัวข้อความอยู่ที่
// `remark` ของ personInfo และเข้าถึงได้ด้วย **indexCode ของใบหน้าเป็น personId**
// (กุญแจดอกเดียวกับที่ _hcpFacePhoto ใช้) ⇒ ต้องยิงเพิ่มอีกหนึ่งคำขอต่อคน
async function _hcpPersonInfo(indexCode) {
  const d = await _hcpCall('/artemis/api/resource/v1/person/personId/personInfo',
    { personId: String(indexCode) });
  return { remark: (d.remark || null), person_code: (d.personCode || null) };
}

// ดึงใบหน้า — ทีละคลัง (`group`) เพื่อคุมขนาดคำขอ · `withPhotos` ปิดได้เมื่ออยากได้แค่รายชื่อ
// `havePhotos` / `haveRemarks` = `<คลัง>:<ใบหน้า>` ที่ central มีรูป / มีคำอธิบายแล้ว
// จะได้ไม่ดึงซ้ำทุกรอบ · แยกสองชุดเพราะสองอย่างนี้มา/ไม่มาไม่พร้อมกัน (รูปพลาดได้
// โดยที่ remark สำเร็จ และกลับกัน) ถ้าใช้ชุดเดียวกันจะมีฝั่งหนึ่งถูกดึงซ้ำตลอดกาล
async function fetchHcpFaces({ group, withPhotos = true, havePhotos = [], haveRemarks = [] } = {}) {
  const fg = await _hcpCall('/artemis/api/frs/v1/face/groupList', { pageNo: 1, pageSize: HCP_PAGE_SIZE });
  const have = new Set((havePhotos || []).map(String));
  const haveR = new Set((haveRemarks || []).map(String));
  const records = [];
  const groups = [];
  let photos = 0, photoFails = 0, noUrl = 0, remarks = 0, remarkFails = 0;
  for (const g of (fg.list || [])) {
    if (_hcpIsAllowList(g.name)) { groups.push({ name: g.name, skipped: true }); continue; }
    if (group && String(g.indexCode) !== String(group)) continue;
    const pending = [];
    const pendingRemark = [];
    const r = await _hcpPageAll('/artemis/api/frs/v1/face', { faceGroupIndexCode: g.indexCode }, (f) => {
      const fi = f.faceInfo || {};
      const rec = {
        external_id: String(f.indexCode),
        given_name: fi.personGivenName || null,
        family_name: fi.personFamilyName || null,
        sex: fi.sex ?? null,
        face_url: (f.facePic || {}).faceUrl || null,
        group_index: String(g.indexCode),
        group_name: g.name,
        photo_b64: null,
        remark: null,
        person_code: null,
      };
      records.push(rec);
      const key = `${g.indexCode}:${rec.external_id}`;
      if (withPhotos && rec.face_url && !have.has(key)) pending.push(rec);
      else if (withPhotos && !rec.face_url) noUrl++;
      // ไม่ผูกกับ withPhotos — คำอธิบายเป็นข้อความ ไม่ใช่รูป จะขอรายชื่อล้วน
      // (withPhotos=false) แล้วยังต้องได้คำอธิบายมาด้วย
      if (!haveR.has(key)) pendingRemark.push(rec);
    });
    for (const rec of pending) {
      try {
        rec.photo_b64 = await _hcpFacePhoto(rec.external_id, rec.face_url);
        if (rec.photo_b64) photos++; else photoFails++;
      } catch { photoFails++; }
    }
    // เรียงทีละคน เหมือนเส้นรูป — HCP เป็นระบบเดียวกันและเคยล้มเมื่อยิงพร้อมกันเยอะ ๆ
    // · personInfo ล้ม/ว่าง = ปล่อย remark เป็น null แล้วนับไว้ ห้ามทำให้ sync ทั้งรอบพัง
    for (const rec of pendingRemark) {
      try {
        const p = await _hcpPersonInfo(rec.external_id);
        rec.remark = p.remark;
        rec.person_code = p.person_code;
        if (p.remark) remarks++; else remarkFails++;
      } catch { remarkFails++; }
    }
    groups.push({ name: g.name, count: r.reported, fetched: r.got, truncated: r.truncated });
  }
  return { ok: true, dataType: 'face', total: records.length, groups, records,
           photos, photo_fails: photoFails, no_photo_url: noUrl,
           remarks, remark_fails: remarkFails };
}

async function fetchHcpVehicles() {
  const vg = await _hcpCall('/artemis/api/resource/v1/vehicleGroup/vehicleGroupList', { pageNo: 1, pageSize: 100 });
  const records = [];
  const groups = [];
  for (const g of (vg.list || [])) {
    if (_hcpIsAllowList(g.vehicleGroupName)) { groups.push({ name: g.vehicleGroupName, skipped: true }); continue; }
    const r = await _hcpPageAll('/artemis/api/resource/v1/vehicle/vehicleList',
      { vehicleGroupIndexCode: g.vehicleGroupIndexCode }, (v) => {
        records.push({
          external_id: String(v.vehicleId),
          plate_number: v.plateNo || null,
          person_name: v.personName || null,
          phone: v.phoneNo || null,
          vehicle_color: v.vehicleColor ?? null,
          plate_area: v.plateAreaName || null,
          effective: v.effectiveDate || null,
          expired: v.expiredDate || null,
          group_index: String(g.vehicleGroupIndexCode),
          group_name: g.vehicleGroupName,
        });
      });
    groups.push({ name: g.vehicleGroupName, count: r.got, fetched: r.got, truncated: r.truncated });
  }
  return { ok: true, dataType: 'lpr', total: records.length, groups, records };
}

module.exports = {
  testDssPro, testGuruSquare, testDahuaNvrFace, testDahuaNvrLpr,
  testHcp, fetchHcpFaces, fetchHcpVehicles, listHcpFaceGroups,
  fetchGuruSquareRange, fetchGuruSquareAlerts, fetchGuruSquareLprMatch,
  fetchDssProPersons, fetchDssProVehicles, discoverSource, maskId,
  // exported for the push path (blacklistSourcePush.js) — the write side reuses
  // this login rather than growing a second implementation of DSS Pro's
  // two-step MD5 handshake
  dssRequest, dssLogin,
};
