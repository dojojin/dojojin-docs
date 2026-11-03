// ============================================================
// Vigil Platform — Blacklist import pipeline
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Spec: docs/superpowers/specs/2026-07-24-blacklist-central-database-design.md
//
// Pulls a source's roster through the edge proxy, mirrors it verbatim into
// blacklist.source_records, then dedups/links into blacklist.master.
//
// Two properties this file is built around:
//  1. IDEMPOTENT. Re-running a full import must not duplicate anything.
//     source_records is keyed UNIQUE(source_id, external_id); master linkage is
//     keyed UNIQUE(source_record_id) — so a re-import updates in place and
//     re-uses the existing master instead of minting a second one.
//  2. CHUNKED. GuruSquare's whole blacklist in one response measured 376 MB
//     live. Import walks month-sized windows so no single request is huge.
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const { encryptPii, idHash, plateHash, maskId, checkThaiNationalId } = require('./blacklist-crypto');
const { parseHcpRemark } = require('./hcpRemark');
const { edgeProxyBaseUrl } = require('./edgeProxyBaseUrl');
const { scanVanished } = require('./blacklistVanish');

const PHOTO_DIR = path.join(__dirname, '..', '..', 'blacklist-photos');

// ---------- edge call ----------
function edgeFetch(siteCode, body, timeoutMs = 180000) {
  const secret = process.env.SNAPSHOT_PROXY_SECRET || '';
  if (!secret) throw new Error('SNAPSHOT_PROXY_SECRET not configured');
  const edgeUrl = edgeProxyBaseUrl(siteCode, process.env.SNAPSHOT_PROXY_DOMAIN || 'dojojin.tech');
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const preq = https.request(`${edgeUrl}/blacklist-source-fetch`, {
      method: 'POST', timeout: timeoutMs,
      // agent:false — one fresh connection per call. Node 18+ turns keepAlive on
      // for the global agent, and api-server is long-lived, so it would reuse a
      // socket the Cloudflare tunnel had already closed. The reused socket fails
      // instantly with Cloudflare's own plain-text "error code: 502" (~0.2s),
      // while the identical request from a short-lived process succeeds in ~7s.
      // Imports are infrequent and slow; pooling buys nothing and costs this.
      agent: false,
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (pr) => {
      const chunks = [];
      pr.on('data', d => chunks.push(d));
      pr.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve(JSON.parse(text)); }
        catch { reject(new Error(`bad edge response (HTTP ${pr.statusCode}): ${text.slice(0, 200)}`)); }
      });
    });
    preq.on('error', reject);
    preq.on('timeout', () => preq.destroy(new Error('edge fetch timeout')));
    preq.write(payload);
    preq.end();
  });
}

// เจ้าของถาม 2026-09-17 หลัง GuruSquare (HKT) ปิด API key เอง — sync วน 45
// windows แล้วได้ "error code: 502" (ข้อความของ Cloudflare tunnel เอง ไม่ใช่
// error จากแอป — request ค้างจนโดน Cloudflare ตัดก่อนถึงจุดที่โค้ดจะจับ error
// แบบ "key ผิด" ได้) ซ้ำกัน 45 บรรทัดอ่านไม่รู้เรื่องว่าเป็นปัญหาเดียวกัน — เรียก
// /blacklist-source-test (probe เบาๆ ตัวอย่าง 30 วัน) ก่อนเริ่มวนทั้งชุดเสมอ
// เชื่อมต่อไม่ได้ตั้งแต่ probe แรก = จบทันทีด้วยข้อความเดียวที่อ่านง่ายกว่า
// ไม่ต้องรอวนครบ 45 รอบ (แต่ละรอบก็ค้างจน timeout เหมือนกันหมด)
function edgeTest(siteCode, body, timeoutMs = 30000) {
  const secret = process.env.SNAPSHOT_PROXY_SECRET || '';
  if (!secret) throw new Error('SNAPSHOT_PROXY_SECRET not configured');
  const edgeUrl = edgeProxyBaseUrl(siteCode, process.env.SNAPSHOT_PROXY_DOMAIN || 'dojojin.tech');
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const preq = https.request(`${edgeUrl}/blacklist-source-test`, {
      method: 'POST', timeout: timeoutMs, agent: false,
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (pr) => {
      const chunks = [];
      pr.on('data', d => chunks.push(d));
      pr.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve(JSON.parse(text)); }
        catch { reject(new Error(`bad edge response (HTTP ${pr.statusCode}): ${text.slice(0, 200)}`)); }
      });
    });
    preq.on('error', reject);
    preq.on('timeout', () => preq.destroy(new Error('edge test timeout')));
    preq.write(payload);
    preq.end();
  });
}

// ---------- month windows ----------
// GuruSquare filters on `lastupdate`, so walking calendar months covers the
// whole set exactly once with no overlap and no gap.
function monthWindows(startISO, endISO) {
  const out = [];
  const d = new Date(startISO + 'T00:00:00Z');
  const end = new Date(endISO + 'T00:00:00Z');
  while (d < end) {
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    const to = next < end ? next : end;
    out.push({
      from: d.toISOString().slice(0, 19),
      to: to.toISOString().slice(0, 19),
    });
    d.setTime(next.getTime());
  }
  return out;
}

function savePhoto(sourceId, externalId, b64) {
  if (!b64) return null;
  const dir = path.join(PHOTO_DIR, String(sourceId));
  fs.mkdirSync(dir, { recursive: true });
  // externalId comes from an external system — sanitize before it becomes a path.
  const safe = String(externalId).replace(/[^0-9A-Za-z_-]/g, '_');
  const rel = path.join(String(sourceId), `${safe}.jpg`);
  fs.writeFileSync(path.join(PHOTO_DIR, rel), Buffer.from(b64, 'base64'));
  return rel;
}

// ---------- normalize one GuruSquare record ----------
// GuruSquare's LPR blacklist carries no national ID / passport — only an owner
// name. Per spec §4.3 that means id_hash = NULL, so every record becomes its own
// master row with NO auto-dedup. That is deliberate: name-only fuzzy matching
// would merge different people who happen to share a name, which is far worse
// than leaving two rows that a human can merge later.
function normalizeGuruSquare(rec) {
  const plate = (rec.plate_number || '').trim();
  const noteParts = [];
  // remark leads: it is the case text an operator actually needs to read, and
  // burying it after four vehicle attributes is how it gets truncated out of
  // every list view. Historically GuruSquare had no such field and the case
  // text was crammed into `owner` instead — see the note on `name` below.
  if (rec.remark) noteParts.push(String(rec.remark).trim());
  if (rec.carbrand) noteParts.push(`ยี่ห้อ ${rec.carbrand}`);
  if (rec.carcolor) noteParts.push(`สี ${rec.carcolor}`);
  if (rec.cartype) noteParts.push(`ประเภท ${rec.cartype}`);
  if (rec.platetype) noteParts.push(`ชนิดป้าย ${rec.platetype}`);
  if (rec.owner_detail) noteParts.push(String(rec.owner_detail).trim());
  return {
    external_id: rec.external_id,
    data_type: 'lpr',
    id_type: null,
    id_country: null,
    id_number: null,      // no ID in this source
    name: (rec.owner || '').trim() || null,
    // case_ref means ONE thing across every source: the unit that reported the
    // case. GuruSquare has no such field — its province used to be stored here,
    // which made the API alias it as `province` and print a police unit onto the
    // mock plate for DSS rows. Province lives in raw_json only (migration 095).
    case_ref: null,
    case_note: noteParts.join(' · ') || null,
    plate_numbers: plate ? [plate] : [],
    photo_b64: rec.photo_b64 || null,
    raw_json: {
      last_update: rec.last_update, province: rec.province, cartype: rec.cartype,
      carcolor: rec.carcolor, carbrand: rec.carbrand, platetype: rec.platetype,
      owner_detail: rec.owner_detail,
      blacklisttype: rec.blacklisttype, remark: rec.remark,
      // group_name is the ONE key every source publishes for the bridge to
      // filter on (DSS puts its risk_group here). GuruSquare had nothing to put
      // in it, so a bridge rule for this source could only be "take everything"
      // — which is why รถ VIP and รถผู้ต้องสงสัย have stood empty while
      // รถตามหมายจับ held every plate. blacklisttype is that missing category.
      //
      // Stored VERBATIM. Measured 2026-08-01 the source uses four values:
      // blacklist 312 · watchlist 146 · test 3 · whitelist 2.
      //
      // `whitelist` there does NOT mean allow-list — the owner confirmed it was
      // created only to try the field out and belongs with watchlist; a genuine
      // allow-list vehicle is a VIP and this source does not send those at all.
      // That correction lives in the bridge RULE, not
      // here, on purpose: rewriting the value at ingest would destroy what the
      // source actually said, and if GuruSquare ever fixes the label to mean a
      // real whitelist, a silent rewrite would file VIP vehicles as suspects.
      // The rule is visible to an operator and editable; this is not.
      group_name: rec.blacklisttype || null,
    },
  };
}

// ---------- CH1 · อะไรในระเบียนนี้เปลี่ยนไปจากรอบก่อน ----------
// คีย์ใน raw_json ที่ **ห้าม** บันทึกเป็นการแก้ไข: เป็นรหัสอ้างอิง/URL/เวลา ไม่ใช่
// เนื้อหาที่คนแก้ · ถ้าวันหนึ่งค่าพวกนี้หมุนทุกรอบดึง (signed URL, session id)
// มันจะกลายเป็น "การแก้ไข" ปลอมนับพันแถวต่อวัน
//
// ponytail: deny-list ไม่ใช่ allow-list — เนื้อหาที่ vendor ใหม่ส่งมาควรถูกจับ
// โดยไม่ต้องมาแก้โค้ดก่อน · ถ้าตารางโตผิดปกติเมื่อไหร่ ให้เติมคีย์ลง deny-list นี้
const CHANGE_SKIP_KEYS = new Set([
  'hcp_face_url', 'hcp_face_index', 'hcp_vehicle_id', 'group_index',
  'last_update',   // เวลาที่ต้นทางแก้ — เก็บเป็น source_time ของแถวอื่นอยู่แล้ว
  'added_by',
  // รหัสคนของ HCP = คีย์ตายตัว ไม่ใช่เนื้อหา · ถ้าไม่ข้าม รอบแรกที่เริ่มดึง personInfo
  // จะได้ record_changes หนึ่งแถวต่อคนทั้ง ~1,900 คน แล้วหน้าจอจะขึ้น "ต้นทางแก้ล่าสุด"
  // ให้ทุกคนพร้อมกันทั้งที่ไม่มีใครแก้อะไรเลย
  'hcp_person_code',
  // ผลแยกช่องเป็นของที่ derive มาจาก hcp_remark — ติดตามตัวต้นฉบับพอ ไม่งั้นการแก้
  // คำอธิบายหนึ่งครั้งจะถูกบันทึกสองแถว
  'hcp_remark_parsed',
]);

const _cvStr = (v) => {
  if (v == null) return null;
  if (Array.isArray(v)) return v.join(',');
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  return s === '' ? null : s;
};

// GuruSquare ส่งเวลาที่ต้นทางแก้มาให้ตรง ๆ — ใช้ได้เลย ไม่ต้องเดา
// แหล่งที่ไม่ส่งมา = null และหน้าจอจะแสดงเฉพาะ "เราเห็นเมื่อไหร่"
function srcEditTime(norm) {
  const v = norm && norm.raw_json && norm.raw_json.last_update;
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function diffRecord(before, norm) {
  if (!before) return [];
  const out = [];
  const cmp = (field, a, b) => {
    const x = _cvStr(a), y = _cvStr(b);
    if (x !== y) out.push({ field, old_value: x, new_value: y });
  };
  cmp('name', before.name, norm.name);
  cmp('case_ref', before.case_ref, norm.case_ref);
  cmp('case_note', before.case_note, norm.case_note);
  cmp('plate_numbers', before.plate_numbers, norm.plate_numbers);

  const oldRaw = before.raw_json || {};
  const newRaw = norm.raw_json || {};
  for (const k of new Set([...Object.keys(oldRaw), ...Object.keys(newRaw)])) {
    if (CHANGE_SKIP_KEYS.has(k)) continue;
    cmp(k, oldRaw[k], newRaw[k]);
  }
  return out;
}

// ---------- upsert one normalized record + link to master ----------
async function upsertRecord(client, sourceId, norm) {
  // `*_pre` = ค่าที่ยกมาจากรอบก่อนเพราะรอบนี้ไม่ได้ถามต้นทาง (ดู normalizeHcpFace)
  //
  // 🔴 `hcp_person_code` = เลขประจำตัวใน HCP ที่ **ไม่ผ่านเกณฑ์บัตรไทย** (สุ่มวัด
  // 2026-09-09: 40 คน มี personCode 39 · เป็นเลข 13 หลักผ่าน mod-11 แค่ 19 · ที่เหลือ
  // ยาว 8-10 ตัว = พาสปอร์ต/เลขต่างชาติ) · เก็บไว้ให้ดูบนจอได้ แต่ **ห้ามทำ id_hash**
  // เพราะ hash คือกุญแจรวมคนเป็น master เดียว — เลขพาสปอร์ตไม่ได้การันตีว่าไม่ซ้ำ
  // ข้ามประเทศ ถ้าเผลอ hash แล้วชนกัน คนสองคนจะถูกรวมเป็นคนเดียวถาวร แก้ต้องแยกมือ
  const hash = (norm.id_number && norm.id_type !== 'hcp_person_code')
    ? idHash(norm.id_number, norm.id_type, norm.id_country)
    : (norm.id_hash_pre || null);
  const idEnc = norm.id_number ? encryptPii(norm.id_number) : (norm.id_enc_pre || null);
  const photoPath = norm.photo_b64 ? savePhoto(sourceId, norm.external_id, norm.photo_b64) : null;
  // Second match key, for vehicles. A plate identifies a car the way a national
  // ID identifies a person, so the same plate from two different cases — or from
  // two different SOURCES — resolves to one master carrying both cases
  // (owner-confirmed 2026-07-26: merge across sources).
  const pHash = (norm.plate_numbers && norm.plate_numbers.length)
    ? plateHash(norm.plate_numbers[0]) : null;

  // COALESCE on photo_path: a re-import that was run withPhotos=false must not
  // wipe a photo an earlier full import already stored.
  const { rows } = await client.query(`
    WITH prev AS (
      -- CH1 — ค่าก่อนรอบนี้ · CTE ถูกประเมินกับ snapshot ก่อน INSERT จึงเห็นของเก่า
      -- (พิสูจน์กับตารางจริงแล้ว: UPDATE คืนค่าเก่า · INSERT ใหม่ล้วนคืน null)
      -- ทำแบบนี้เพื่อไม่ต้องยิง SELECT เพิ่มอีกรอบต่อระเบียนต่อการ import
      SELECT name, case_ref, case_note, plate_numbers, raw_json
        FROM blacklist.source_records
       WHERE source_id = $1 AND external_id = $3
    )
    INSERT INTO blacklist.source_records
      (source_id, data_type, external_id, id_type, id_country, id_number_enc, id_hash,
       name, case_ref, case_note, photo_path, plate_numbers, raw_json, plate_hash, last_seen_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, NOW())
    ON CONFLICT (source_id, external_id) DO UPDATE SET
      data_type = EXCLUDED.data_type,
      id_type = EXCLUDED.id_type, id_country = EXCLUDED.id_country,
      id_number_enc = EXCLUDED.id_number_enc, id_hash = EXCLUDED.id_hash,
      name = EXCLUDED.name, case_ref = EXCLUDED.case_ref, case_note = EXCLUDED.case_note,
      photo_path = COALESCE(EXCLUDED.photo_path, blacklist.source_records.photo_path),
      plate_numbers = EXCLUDED.plate_numbers, raw_json = EXCLUDED.raw_json,
      plate_hash = EXCLUDED.plate_hash,
      updated_at = NOW(),
      -- BS1: ต้นทางส่งแถวนี้มาในรอบนี้ = ยังไม่หาย · และถ้าเคยถูกทำเครื่องหมายว่าหาย
      -- แล้วกลับมา ต้องล้างเครื่องหมายทิ้ง ไม่งั้นของที่ต้นทางเอากลับมาจะค้างสถานะผิด
      last_seen_at = NOW(),
      vanished_at = NULL,
      vanish_reason = NULL
    RETURNING id, (xmax = 0) AS inserted, (SELECT row_to_json(prev) FROM prev) AS before`,
    [sourceId, norm.data_type, norm.external_id, norm.id_type, norm.id_country, idEnc, hash,
     norm.name, norm.case_ref, norm.case_note, photoPath, norm.plate_numbers,
     JSON.stringify(norm.raw_json || {}), pHash]);

  const srecId = rows[0].id;
  const wasInserted = rows[0].inserted;

  // CH1 — บันทึกว่าต้นทางแก้อะไรบ้าง · แถวที่เพิ่งเข้ามาใหม่ไม่มีอะไรให้เทียบ
  const changed = wasInserted ? [] : diffRecord(rows[0].before, norm);
  if (changed.length) {
    await client.query(`
      INSERT INTO blacklist.record_changes
        (source_id, external_id, field, old_value, new_value, source_time)
      SELECT $1, $2, c.field, c.old_value, c.new_value, $4::timestamptz
        FROM jsonb_to_recordset($3::jsonb) AS c(field text, old_value text, new_value text)`,
      [sourceId, norm.external_id, JSON.stringify(changed), srcEditTime(norm)]);
  }

  // BS2 — the source sent this row again, so the system's own "the source
  // deleted it" exclusion is now false and must go, or the row would be dropped
  // from master by the check below and never come back.
  //
  // `updated_by = 'system:vanish'` is the whole point of the guard: an exclusion
  // a PERSON made ("this record is junk") outlives the source re-sending it.
  // Only the machine's guess gets withdrawn automatically.
  await client.query(
    `DELETE FROM blacklist.overrides
      WHERE source_id = $1 AND external_id = $2 AND updated_by = 'system:vanish'
        AND name IS NULL AND plate_numbers IS NULL AND case_note IS NULL
        AND brand IS NULL AND vehicle_type IS NULL AND vehicle_color IS NULL
        AND plate_type IS NULL AND case_kind IS NULL AND province IS NULL
        AND photo_path IS NULL AND note IS NULL`,
    [sourceId, norm.external_id]);
  // …and if the row also carries real corrections, keep the row but lift the flag.
  await client.query(
    `UPDATE blacklist.overrides SET excluded = FALSE, exclude_reason = NULL, updated_at = NOW()
      WHERE source_id = $1 AND external_id = $2 AND updated_by = 'system:vanish' AND excluded`,
    [sourceId, norm.external_id]);

  // Exclusion check (migration 094). The raw row above is still refreshed — we
  // never lose the evidence of what the source sent — but an operator-excluded
  // record must not be (re)linked into master. This is what stops a deleted
  // record resurrecting itself on the next import: the exclusion is keyed on
  // (source_id, external_id), which survives every re-import.
  const exc = await client.query(
    `SELECT excluded FROM blacklist.overrides WHERE source_id = $1 AND external_id = $2`,
    [sourceId, norm.external_id]);
  if (exc.rows[0] && exc.rows[0].excluded) {
    // drop any link it had, so master reflects the exclusion immediately
    await client.query('DELETE FROM blacklist.master_links WHERE source_record_id = $1', [srecId]);
    await client.query(`DELETE FROM blacklist.master m
      WHERE NOT EXISTS (SELECT 1 FROM blacklist.master_links l WHERE l.master_id = m.id)`);
    return { srecId, masterId: null, wasInserted, newMaster: false, excluded: true };
  }

  // Already linked from a previous run? Reuse that master — this is what keeps
  // re-imports from minting a duplicate master every single time.
  const existing = await client.query(
    'SELECT master_id FROM blacklist.master_links WHERE source_record_id = $1', [srecId]);
  if (existing.rows[0]) {
    await client.query(
      `UPDATE blacklist.master SET display_name = COALESCE($2, display_name),
              photo_path = COALESCE(photo_path, $3), updated_at = NOW() WHERE id = $1`,
      [existing.rows[0].master_id, norm.name, photoPath]);
    return { srecId, masterId: existing.rows[0].master_id, wasInserted, newMaster: false };
  }

  // Match keys in priority order: a national ID identifies a PERSON and beats a
  // plate (a car changes hands, a person doesn't). Plate is the fallback for
  // sources that carry no ID at all — which is every LPR source we have.
  // No key at all => its own master, no guessing (spec §4.3).
  let masterId = null;
  if (hash) {
    const hit = await client.query('SELECT id FROM blacklist.master WHERE id_hash = $1', [hash]);
    if (hit.rows[0]) masterId = hit.rows[0].id;
  }
  if (!masterId && pHash) {
    const hit = await client.query('SELECT id FROM blacklist.master WHERE plate_hash = $1', [pHash]);
    if (hit.rows[0]) masterId = hit.rows[0].id;
  }
  let newMaster = false;
  if (!masterId) {
    const ins = await client.query(
      `INSERT INTO blacklist.master (id_hash, plate_hash, id_type, id_country, id_number_enc, display_name, photo_path)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [hash, pHash, norm.id_type, norm.id_country, idEnc, norm.name, photoPath]);
    masterId = ins.rows[0].id;
    newMaster = true;
  }
  await client.query(
    `INSERT INTO blacklist.master_links (master_id, source_record_id) VALUES ($1,$2)
     ON CONFLICT DO NOTHING`, [masterId, srecId]);

  return { srecId, masterId, wasInserted, newMaster };
}

// ---------- normalize one DSS Pro person ----------
// Unlike GuruSquare, DSS Pro DOES carry a Thai national ID (13 digits, 100%
// coverage measured on 957 live records) — so these records get a real id_hash
// and will genuinely dedup against any future ID-bearing source.
//
// external_id is the HMAC, NOT the raw national ID. DSS Pro exposes no separate
// internal key, so the ID is the only stable idempotency key — but external_id
// is stored in PLAINTEXT (it is a lookup key, not an encrypted column). Writing
// the national ID there would defeat the whole point of encrypting
// id_number_enc. The HMAC is equally stable and equally unique, and reveals
// nothing.
function normalizeDssPro(rec) {
  const pid = String(rec.person_id || '').trim();
  const name = [rec.first_name, rec.last_name].filter(Boolean).join(' ').trim() || null;
  const hash = pid ? idHash(pid, 'national_id', null) : null;
  return {
    // no ID at all => fall back to the source's own composite so re-import stays
    // idempotent instead of inserting a fresh row every run
    external_id: hash || `noid:${rec.org_code || ''}:${name || ''}`,
    data_type: 'face',
    id_type: pid ? 'national_id' : null,
    id_country: null,
    id_number: pid || null,
    name,
    case_ref: rec.org_name || null,      // reporting unit, e.g. บุคคลหมายจับ / สภ.นราธิวาส
    case_note: rec.remark || null,
    plate_numbers: [],
    photo_b64: rec.photo_b64 || null,
    raw_json: {
      org_code: rec.org_code, org_name: rec.org_name,
      group_id: rec.group_id, group_name: rec.group_name,   // High Risk Person / Blacklist Person HDY
      gender: rec.gender || null,
      tel: rec.tel || null,
      // Access-validity window, NOT a creation date — see fetchDssProPersons.
      valid_from: rec.valid_from || null,
      valid_to: rec.valid_to || null,
    },
  };
}

// ---------- normalize one DSS Pro vehicle ----------
// The risk tier (High/Medium Risk Vehicle) is the field GuruSquare's API does
// not expose at all, so it is promoted to raw_json.group_name — the same key the
// face side uses — and the UI's existing group badge picks it up for free.
function normalizeDssProVehicle(rec) {
  const plate = String(rec.plate_number || '').trim();
  const bits = [];
  if (rec.brand) bits.push(`ยี่ห้อ ${rec.brand}`);
  if (rec.color) bits.push(`สี ${rec.color}`);
  if (rec.remark) bits.push(String(rec.remark).trim());
  return {
    external_id: `veh:${rec.external_id}`,   // namespaced: person and vehicle ids
    data_type: 'lpr',                         // are independent sequences in DSS
    id_type: null, id_country: null, id_number: null,
    name: null,                               // DSS records no owner name for a vehicle
    case_ref: rec.org_name || null,           // the owning unit belongs here, once
    case_note: bits.join(' · ') || null,
    plate_numbers: plate ? [plate] : [],
    photo_b64: null,                          // measured: carPic 0/516 on this source
    raw_json: {
      brand: rec.brand, color: rec.color, org_name: rec.org_name,
      group_name: rec.risk_group,             // High Risk Vehicle / Medium Risk Vehicle
      remark: rec.remark,
    },
  };
}

async function importDssProVehicles(pool, source, opts = {}) {
  const cfg = source.config || {};
  const stats = { fetched: 0, inserted: 0, updated: 0, mastersCreated: 0, excludedSkipped: 0, noProvince: 0, windows: 0, errors: [] };
  let resp;
  try {
    resp = await edgeFetch(source.site_code || 'hdy', {
      source: 'dss_pro', dataType: 'lpr',
      config: { host: cfg.host, port: cfg.port, username: cfg.username, password: opts.password },
      pageSize: 1000,
    });
  } catch (e) {
    stats.errors.push(e.message);
    return finishImport(pool, source, stats, opts);
  }
  if (!resp || resp.ok === false) {
    stats.errors.push((resp && resp.error) || 'unknown edge error');
    return finishImport(pool, source, stats, opts);
  }

  const records = resp.records || [];
  stats.fetched = records.length;
  stats.windows = 1;
  // ดึงหน้าเดียว — ครบก็ต่อเมื่อได้น้อยกว่าขนาดหน้า ถ้าเต็มหน้าพอดีแปลว่าอาจมีหน้าถัดไป
  stats.fullSweep = records.length < (resp.pageSize || 1000);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const rec of records) {
      const norm = normalizeDssProVehicle(rec);
      const r = await upsertRecord(client, source.id, norm);
      if (r.wasInserted) stats.inserted++; else stats.updated++;
      if (r.newMaster) stats.mastersCreated++;
      if (r.excluded) stats.excludedSkipped++;
      // This source never carries a province field at all (measured: 0/516) —
      // every plate lands here, not just a partial subset.
      if (norm.plate_numbers.length && !norm.raw_json.province) stats.noProvince++;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    stats.errors.push(`db: ${e.message}`);
  } finally { client.release(); }

  return finishImport(pool, source, stats, opts);
}

async function importDssPro(pool, source, opts = {}) {
  const cfg = source.config || {};
  const withPhotos = opts.withPhotos !== false;
  const pageSize = opts.pageSize || 200;
  const stats = { fetched: 0, inserted: 0, updated: 0, mastersCreated: 0, excludedSkipped: 0, windows: 0, errors: [] };

  let page = 1, total = null;
  // Page until we've seen `total`. Hard page cap is a runaway guard, not a limit
  // we expect to hit (957 records / 200 per page = 5 pages).
  while (page <= 100) {
    let resp;
    try {
      resp = await edgeFetch(source.site_code || 'hdy', {
        source: 'dss_pro',
        config: { host: cfg.host, port: cfg.port, username: cfg.username, password: opts.password },
        page, pageSize, withPhotos, withDetail: opts.withDetail !== false,
      });
    } catch (e) {
      stats.errors.push(`page ${page}: ${e.message}`);
      break;   // pagination is sequential — a dead page means the rest is unreliable
    }
    if (!resp || resp.ok === false) { stats.errors.push(`page ${page}: ${(resp && resp.error) || 'unknown edge error'}`); break; }

    const records = resp.records || [];
    if (total === null) total = resp.total || 0;
    if (!records.length) break;
    stats.fetched += records.length;
    stats.windows++;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const rec of records) {
        const r = await upsertRecord(client, source.id, normalizeDssPro(rec));
        if (r.wasInserted) stats.inserted++; else stats.updated++;
        if (r.newMaster) stats.mastersCreated++;
        if (r.excluded) stats.excludedSkipped++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      stats.errors.push(`page ${page} (db): ${e.message}`);
    } finally { client.release(); }

    if (stats.fetched >= total) break;
    page++;
  }

  return finishImport(pool, source, stats, opts);
}

// ---------- the import run ----------
async function importGuruSquare(pool, source, opts = {}) {
  const cfg = source.config || {};
  const from = opts.from || '2023-01-01';
  const to = opts.to || new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const withPhotos = opts.withPhotos !== false;
  const windows = monthWindows(from, to);

  // กวาดทั้งชุดก็ต่อเมื่อ **เราเป็นคนกำหนดช่วงเอง** — ถ้าคนเรียกระบุ from/to มา
  // แปลว่าเป็นการดึงบางส่วน แถวนอกช่วงจะดูเหมือนหายทั้งที่ยังอยู่ (ดู blacklistVanish)
  const stats = { fetched: 0, inserted: 0, updated: 0, mastersCreated: 0, excludedSkipped: 0, noProvince: 0, windows: windows.length, errors: [],
                  fullSweep: !opts.from && !opts.to };

  // Pre-check ก่อนวนทั้งชุด (ดูเหตุผลที่หัว edgeTest()) — status ที่ได้ไม่ใช่ 'ok'
  // (errors.length > 0) ⇒ finishImport() จะข้าม scanVanished ให้เอง
  // (blacklistVanish.js เช็ค status !== 'ok' อยู่แล้ว) จึงไม่เสี่ยงมาร์กของเดิม
  // ว่าหายไปทั้งที่แค่ต่อไม่ติดตอนเปิดรอบ
  try {
    const probe = await edgeTest(source.site_code || 'hdy', {
      source: 'gurusquare', config: { host: cfg.host, port: cfg.port, apiKey: opts.apiKey },
    });
    if (!probe || probe.ok === false) {
      stats.errors.push(`เชื่อมต่อ GuruSquare ไม่ได้ตั้งแต่ probe แรก (ตรวจ API key/host) — ${(probe && probe.error) || 'unknown'}`);
      return finishImport(pool, source, stats, opts);
    }
  } catch (e) {
    stats.errors.push(`เชื่อมต่อ GuruSquare ไม่ได้ตั้งแต่ probe แรก (ตรวจ API key/host) — ${e.message}`);
    return finishImport(pool, source, stats, opts);
  }

  for (const w of windows) {
    let resp;
    try {
      resp = await edgeFetch(source.site_code || 'hdy', {
        source: 'gurusquare',
        config: { host: cfg.host, port: cfg.port, apiKey: opts.apiKey },
        from: w.from, to: w.to, withPhotos,
      });
    } catch (e) {
      // One bad window must not abandon the whole import — record and continue.
      stats.errors.push(`${w.from.slice(0, 7)}: ${e.message}`);
      continue;
    }
    if (!resp || resp.ok === false) {
      stats.errors.push(`${w.from.slice(0, 7)}: ${(resp && resp.error) || 'unknown edge error'}`);
      continue;
    }
    const records = resp.records || [];
    stats.fetched += records.length;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const rec of records) {
        const norm = normalizeGuruSquare(rec);
        const r = await upsertRecord(client, source.id, norm);
        if (r.wasInserted) stats.inserted++; else stats.updated++;
        if (r.newMaster) stats.mastersCreated++;
        if (norm.plate_numbers.length && !norm.raw_json.province) stats.noProvince++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      stats.errors.push(`${w.from.slice(0, 7)} (db): ${e.message}`);
    } finally {
      client.release();
    }
  }

  return finishImport(pool, source, stats, opts);
}

// Shared tail for every importer: stamp the source row and write the audit trail.
// ---------- HikCentral Professional (HC3) ----------
// HCP ให้ **ชื่อสองช่องที่เจ้าหน้าที่กรอกสลับกันไปมา** — วัดจากของจริง:
//   given="ผู้ต้องหาตามหมายจับ" (หมวดหมู่) · family="นาย ภาณุวัฒน์ …" (ชื่อจริง)
//   given="นายชาญยุทธ พาลี" (ชื่อจริง)    · family="ลักทรัพย์ในเวลากลางคืน" (ฐานความผิด)
//
// เดิมที่นี่เขียนว่า "แยกไม่ได้ด้วยกฎใด ๆ" จึงต่อสองช่องเป็นชื่อเดียว — **ไม่จริง**
// สำรวจทั้ง source 2026-09-09 (1,931 คน) พบว่า **คำนำหน้าชื่อ** แยกได้เกือบพันคน:
//   ช่องหลังมีคำนำหน้า ช่องหน้าไม่มี → ชื่อจริงอยู่ช่องหลัง        842 คน
//   ช่องหน้ามีคำนำหน้า ช่องหลังไม่มี → ชื่อจริงอยู่ช่องหน้า        126 คน
//   ช่องหลังว่าง (ชื่อกับป้ายรวมกันช่องเดียว)                      811 คน
// ⇒ ตัดสินด้วย "คำนำหน้าอยู่ช่องไหน" ไม่ใช่ "ช่องไหนมาก่อน" · ที่ยังแยกไม่ออกจริง ๆ
// ค่อยต่อสองช่องเหมือนเดิม (ของเดิมไม่แย่ลง) และเก็บช่องดิบไว้ใน raw_json เสมอ
//
// Description ของ HCP (personInfo.remark) เข้ามาที่ `rec.remark` แล้วถูกแยกเป็นช่อง
// ด้วย parseHcpRemark — นี่คือที่ที่ "ทำไมคนนี้ถึงอยู่ในบัญชี" มีคำตอบเป็นครั้งแรก
//
// 🔒 PDPA: raw_json ถูกส่งออกไปที่เบราว์เซอร์ทั้งก้อน (blacklist-sources.js:320-321
// ส่งทั้ง `raw_json` และ `eff`) ⇒ **ห้ามเก็บเลข 13 หลักดิบลงไป** ไม่งั้นเลขบัตรจะหลุด
// ผ่านทางที่เลี่ยง id_number_enc + maskId + endpoint reveal-id ที่มี audit ไปเลย
// ⇒ เก็บลง raw_json เฉพาะรูป mask · เลขจริงเดินทางเส้นเดิม: norm.id_number →
// encryptPii + idHash ใน upsertRecord เท่านั้น
// คำนำหน้าชื่อคน — ตัวชี้ว่า "ช่องนี้คือชื่อคน" ไม่ใช่ป้ายหมวดหรือฐานความผิด
// ห้ามใช้ `\b` กับคำไทย มันไม่ทำงาน (ไทยไม่มีเว้นวรรคระหว่างคำ) — ยึดหัวสตริงพอ
const TITLE_RE = /^\s*(นางสาว|นาง|นาย|น\.?ส\.?|ด\.?ช\.?|ด\.?ญ\.?|เด็กชาย|เด็กหญิง|Mr\.?|Mrs\.?|Miss|Ms\.?)/i;
// ป้ายหมวดที่ต้นทางใช้ซ้ำ ๆ — ใช้ตัดหัวออกเมื่อชื่อกับป้ายรวมอยู่ช่องเดียว
// (เรียงยาวไปสั้น: "บุคคลตามหมายจับ" มี "บุคคล" อยู่ข้างใน)
const HCP_LABELS = [
  'ผู้ต้องหาตามหมายจับ', 'บุคคลตามหมายจับ', 'บุคคลอยู่เกินกำหนด', 'บุคคลหน้าขาว จชต.',
  'บุคคลหน้าขาว', 'บุคคลสูญหาย', 'บุคคลต่างด้าว', 'บุคคลเฝ้าระวัง', 'บุคคลติดตาม',
];
const _isName = (s) => TITLE_RE.test(String(s || ''));

/**
 * แยก "ชื่อคน" ออกจาก "ป้ายหมวด / ฐานความผิด" ที่ต้นทางกรอกปนกันมาสองช่อง
 * @returns {{name: string|null, category: string|null}}
 */
function splitHcpName(given, family) {
  const g = String(given || '').trim(), f = String(family || '').trim();
  const both = [g, f].filter(Boolean).join(' ') || null;
  if (!g || !f) {
    // ช่องเดียว: ป้ายกับชื่อรวมกัน — ตัดป้ายที่รู้จักออกจากหัว ที่เหลือคือชื่อ
    const one = g || f;
    for (const lb of HCP_LABELS) {
      if (one.startsWith(lb)) {
        const rest = one.slice(lb.length).trim();
        return { name: rest || one, category: lb };
      }
    }
    return { name: one || null, category: null };
  }
  const gt = _isName(g), ft = _isName(f);
  if (ft && !gt) return { name: f, category: g };   // แบบ "บุคคลหน้าขาว จชต." / "นายรีซูวัน …"
  if (gt && !ft) return { name: g, category: f };   // แบบ "นายชาญยุทธ พาลี" / "ลักทรัพย์ในเวลากลางคืน"
  // ทั้งคู่มี/ไม่มีคำนำหน้าเหมือนกัน — ยังแยกไม่ได้จริง ๆ ต่อกันเหมือนของเดิม
  // แต่ถ้าช่องหน้าเป็นป้ายที่รู้จัก ก็ยังตัดสินได้โดยไม่ต้องเดา
  for (const lb of HCP_LABELS) if (g.startsWith(lb)) return { name: f, category: g };
  return { name: both, category: null };
}

function normalizeHcpFace(rec) {
  const sex = { 1: 'ชาย', 2: 'หญิง' }[Number(rec.sex)] || null;
  const p = parseHcpRemark(rec.remark);
  // เจ้าหน้าที่บางคนพิมพ์ "เลขบัตร" ลงช่องชื่อ (พบจริงในผลสำรวจ) — นั่นไม่ใช่ชื่อ
  const _gNum = String(rec.given_name || '').replace(/[\s-]/g, '');
  const idInGiven = /^\d{13}$/.test(_gNum) && checkThaiNationalId(_gNum).ok ? _gNum : null;
  const split = splitHcpName(idInGiven ? null : rec.given_name, rec.family_name);
  const name = split.name;
  // ป้ายหมวด/ฐานความผิดที่แกะออกมาได้ → "หัวข้อเหตุการณ์" ตามที่เจ้าของสั่ง
  // ถ้าช่องนั้นมีของจากคำอธิบายอยู่แล้ว ก็ถอยไปช่องประเภท แล้วค่อยไปกอง extra
  // — ไม่ทิ้งข้อความของต้นทางทิ้งไม่ว่ากรณีใด
  if (split.category) {
    if (!p.case_title) p.case_title = split.category;
    else if (!p.watch_type) p.watch_type = split.category;
    else if (!p.extra.includes(split.category)) p.extra.push(split.category);
  }
  // เลขประจำตัว เรียงตามความน่าเชื่อถือ: เลขในคำอธิบาย → เลขที่พิมพ์ลงช่องชื่อ →
  // personCode ของ HCP ที่ผ่านเกณฑ์บัตรไทย → personCode ที่เหลือ (พาสปอร์ต ฯลฯ)
  // สามอันแรกเป็น national_id ใช้รวม master ได้ · อันสุดท้ายโชว์ได้อย่างเดียว
  const _code = String(rec.person_code || '').replace(/[\s-]/g, '');
  const codeIsThaiId = /^\d{13}$/.test(_code) && checkThaiNationalId(_code).ok;
  const idNumber = p.id_number || idInGiven || (codeIsThaiId ? _code : null);
  const idAlt = (!idNumber && _code) ? _code : null;
  // ชื่อคดี + บรรทัดที่แยกไม่ออก = หมายเหตุที่คนอ่าน · ไม่มีคำอธิบายเลยค่อยถอยไปใช้
  // "เพศชาย/หญิง" แบบเดิม เพื่อไม่ให้แถวที่ต้นทางไม่ได้กรอกอะไรเลยแย่ลงกว่าเดิม
  // ⚠️ mask ด้วย เพราะเจ้าหน้าที่บางคนพิมพ์เลข 13 หลัก **ลอย ๆ ไม่มีคำนำหน้า** —
  // บรรทัดแบบนั้นไม่เข้าคำสำคัญใดเลยจึงกลายเป็น title แล้วไหลลง case_note ตรง ๆ
  // หมายเหตุที่คนอ่าน = ประเภทการเฝ้าระวัง + หัวข้อเหตุการณ์ + บรรทัดที่แยกไม่ออก
  // เรียงตามที่ต้นทางพิมพ์มา (ประเภทมาก่อนเสมอ — "มีหมายจับ" คือสิ่งที่ต้องเห็นก่อน)
  // ถ้าต้นทางไม่ได้กรอกอะไรเลย ยังคง "เพศชาย/หญิง" แบบเดิมไว้ ไม่ให้แถวว่างเปล่า
  // ⚠️ mask ด้วย เพราะเจ้าหน้าที่บางคนพิมพ์เลข 13 หลักลอย ๆ ในบรรทัดอิสระ
  const note = maskId13([p.watch_type, p.case_title, ...p.extra].filter(Boolean).join('\n'))
    || (sex ? `เพศ${sex}` : null);
  // เก็บ hcp_remark_parsed แบบไม่มี id_number (ดูหมายเหตุ PDPA ด้านบน) — หน้าจอ
  // อ่านเลขบัตรจาก id_masked/reveal-id เส้นเดิมอยู่แล้ว ไม่ต้องใช้ค่าจากตรงนี้
  const { id_number: _idPlain, raw: _rawPlain, ...rest } = p;
  // mask เลข 13 หลักในทุกช่องข้อความอิสระ — เจ้าหน้าที่พิมพ์เลขบัตรลอย ๆ ได้ทุกบรรทัด
  const parsedSafe = { ...rest,
    watch_type: maskId13(rest.watch_type),
    case_title: maskId13(rest.case_title),
    extra: rest.extra.map(maskId13) };
  return {
    // คีย์เป็น (คลัง + ใบหน้า) ไม่ใช่ใบหน้าเปล่า ๆ — วัดจากของจริง: **คนเดียวกันเป็น
    // สมาชิกได้หลายคลัง โดย HCP ใช้ `indexCode` เดิม** (12 คนใน 1,565 แถว เช่น
    // indexCode 1474 อยู่ทั้ง CTL และ KML) · ถ้าคีย์ด้วยใบหน้าอย่างเดียว แถวหลังจะ
    // ทับแถวแรก แล้ว "คนนี้อยู่ในบัญชีของ CTL" จะหายไปเงียบ ๆ → กฎ bridge ของ CTL
    // จะมองไม่เห็นเขา ทั้งที่ CTL เป็นคนขึ้นบัญชีไว้เอง
    external_id: `face:${rec.group_index}:${rec.external_id}`,
    data_type: 'face',
    // คลังใบหน้าไม่มีช่องเลขบัตร — เลขมาจาก Description ที่เจ้าหน้าที่พิมพ์ · ตั้งสามช่อง
    // พร้อมกันเสมอ ไม่งั้นแถวที่ไม่มีเลขจะได้ id_type ติดมาโดยที่ id_hash เป็น NULL
    // แล้ว diffRecord จะรายงานว่า "ต้นทางแก้" ทุกแถวโดยไม่มีอะไรเปลี่ยนจริง
    ...(idNumber
      ? { id_type: 'national_id', id_country: 'TH', id_number: idNumber }
      // เลขที่ยกมาจากรอบก่อน: ข้อความถูก mask แล้ว parse กลับเป็นเลขไม่ได้ จึงส่ง
      // ค่าที่เข้ารหัส + hash ของเดิมต่อไปตรง ๆ (ดู upsertRecord)
      // ⚠️ ต้องมาก่อน idAlt เสมอ — เลขบัตรจริงที่เคยได้มาแล้ว ห้ามถูกลดชั้นลงเป็น
      // personCode ของรอบนี้ ไม่งั้นแถวที่เคยรวม master ได้จะหลุดออกจาก master เดิม
      : rec.id_hash_pre
        ? { id_type: 'national_id', id_country: 'TH', id_number: null,
            id_hash_pre: rec.id_hash_pre, id_enc_pre: rec.id_enc_pre }
        : idAlt
          ? { id_type: 'hcp_person_code', id_country: null, id_number: idAlt }
          : { id_type: null, id_country: null, id_number: null }),
    name,
    case_ref: rec.group_name || null,          // ชื่อคลัง = ที่มาของคดี (CTL / TCC / 3จว. …)
    case_note: note,
    plate_numbers: [],
    // 🔑 รูปดึงได้แล้วตั้งแต่ 2026-08-09 — วิธีอยู่ใน blacklistSourceProbes._hcpFacePhoto
    // (`person/picture_data` โดยใช้ indexCode ของใบหน้าเป็น personId)
    photo_b64: rec.photo_b64 || null,
    raw_json: {
      hcp_face_index: rec.external_id,
      given_name: rec.given_name, family_name: rec.family_name,
      sex: rec.sex, group_index: rec.group_index, group_name: rec.group_name,
      hcp_face_url: rec.face_url || null,
      hcp_person_code: rec.person_code || null,
      // เขียนคีย์ทั้งสองเสมอ **แม้ต้นทางไม่ได้กรอก** (ค่าเป็น null) — เพราะ gate ของ
      // รอบถัดไปดูว่า "มีคีย์ไหม" ไม่ใช่ "มีค่าไหม" · ถ้าเขียนเฉพาะตอนมีค่า แถวที่ไม่มี
      // คำอธิบายจะถูกยิง personInfo ซ้ำทุกรอบไปตลอดกาล
      //
      // …แต่เขียนก็ต่อเมื่อ **edge ตัวนั้นรู้จักช่องนี้จริง** (`'remark' in rec`) · edge ที่
      // ยังไม่ได้อัปโค้ดจะไม่ส่ง `remark` มาเลย ถ้าเราเขียน null ให้ทุกแถว gate จะจำว่า
      // "ถามครบแล้ว" แล้ววันที่ edge อัปเสร็จจะไม่มีใครถูกถามอีกเลยตลอดกาล
      ...('remark' in rec ? {
        hcp_remark: p.raw ? maskId13(p.raw) : null,   // mask เลข 13 หลักในข้อความดิบ (PDPA)
        hcp_remark_parsed: p.raw ? parsedSafe : null,
      } : {}),
    },
  };
}

// เลข 13 หลักที่โผล่ในข้อความอิสระ = เลขบัตรประชาชน · ปิดบังก่อนเก็บลง raw_json
// เพราะ raw_json ทั้งก้อนเดินทางไปถึงเบราว์เซอร์ (ดูหมายเหตุ PDPA ที่ normalizeHcpFace)
// รับทั้ง `5838682146901` และ `5-8386-82146-90-1` — ต้นทางพิมพ์มาทั้งสองแบบ
const maskId13 = (s) => (s == null ? s
  : String(s).replace(/\d(?:[\s-]?\d){12}/g, (d) => maskId(d.replace(/[\s-]/g, ''))) || null);

function normalizeHcpVehicle(rec) {
  const plate = String(rec.plate_number || '').trim();
  const bits = [];
  if (rec.phone) bits.push(`โทร ${rec.phone}`);
  if (rec.plate_area) bits.push(String(rec.plate_area).trim());
  if (rec.expired) bits.push(`หมดอายุ ${String(rec.expired).slice(0, 10)}`);
  return {
    external_id: `veh:${rec.external_id}`,
    data_type: 'lpr',
    id_type: null, id_country: null, id_number: null,
    // personName ของ HCP คือ given+family ที่ต้นทางต่อให้แล้ว — ในทางปฏิบัติมันคือ
    // "ชื่อ + คดี + ให้แจ้งที่ไหน" รวมกัน ไม่ใช่ชื่อล้วน (วัดจากของจริงทั้ง 13 แถว)
    name: rec.person_name || null,
    case_ref: rec.group_name || null,
    case_note: bits.join(' · ') || null,
    plate_numbers: plate ? [plate] : [],
    photo_b64: null,
    raw_json: {
      hcp_vehicle_id: rec.external_id,
      person_name: rec.person_name, phone: rec.phone,
      vehicle_color: rec.vehicle_color, plate_area: rec.plate_area,
      effective: rec.effective, expired: rec.expired,
      group_index: rec.group_index, group_name: rec.group_name,
    },
  };
}

// ทั้งใบหน้าและรถเดินทางเดียวกัน ต่างกันแค่ dataType ที่ขอจาก edge กับ normalizer
// ที่ใช้ · edge เป็นคนคุยกับ HCP เสมอ (central ไปไม่ถึง `10.0.10.9`)
async function importHcp(pool, source, opts = {}) {
  const dataType = opts.dataType === 'lpr' ? 'lpr' : 'face';
  const normalize = dataType === 'lpr' ? normalizeHcpVehicle : normalizeHcpFace;
  const stats = { fetched: 0, inserted: 0, updated: 0, mastersCreated: 0, excludedSkipped: 0, windows: 1, errors: [] };

  const site = source.site_code || 'hkt';
  const withPhotos = opts.withPhotos !== false;

  // ใบหน้าเดินทีละคลัง — ทั้งชุดพร้อมรูปประมาณ 18 MB ใหญ่เกินจะขอในคำขอเดียว
  // และการแบ่งทำให้เห็นความคืบหน้าเป็นคลัง ๆ แทนที่จะเงียบไปสองนาที
  const batches = [];
  if (dataType === 'face') {
    try {
      const gl = await edgeFetch(site, { source: 'hcp', dataType: 'face', mode: 'groups' });
      for (const g of ((gl || {}).groups || [])) if (!g.skipped) batches.push(g.index_code);
    } catch (e) {
      stats.errors.push(e.message);
      return finishImport(pool, source, stats, opts);
    }
    if (!batches.length) stats.errors.push('ไม่พบคลังใบหน้าที่นำเข้าได้');
  } else batches.push(null);

  const records = [];
  let photos = 0, photoFails = 0, remarks = 0, remarkFails = 0;
  for (const group of batches) {
    // ไม่ดาวน์โหลดรูปที่มีอยู่แล้วซ้ำ — รอบสองจึงเร็วและไม่กินแบนด์วิดท์เปล่า
    let havePhotos = [];
    if (dataType === 'face' && withPhotos) {
      const { rows } = await pool.query(
        `SELECT external_id FROM blacklist.source_records
          WHERE source_id = $1 AND data_type = 'face' AND photo_path IS NOT NULL
            AND external_id LIKE $2`, [source.id, `face:${group}:%`]);
      havePhotos = rows.map((r) => `${group}:${String(r.external_id).split(':').pop()}`);
    }
    // เช่นเดียวกับรูป: คนที่เคยดึงคำอธิบายมาแล้วไม่ต้องยิง personInfo ซ้ำ
    // เงื่อนไขคือ **มีคีย์** (`?`) ไม่ใช่ค่าไม่เป็น null — คนที่ต้นทางไม่ได้กรอกอะไรเลย
    // ก็ถือว่าถามไปแล้ว ไม่งั้นจะโดนยิงซ้ำทุกรอบตลอดไป
    let haveRemarks = [];
    // ของที่ต้องยกมาเองเมื่อรอบนี้ไม่ได้ถาม — ดูหมายเหตุ "รอบที่ไม่ได้ถาม" ใต้ลูป
    const carry = new Map();
    if (dataType === 'face') {
      const { rows } = await pool.query(
        // person_code ต้องยกมาด้วย (เพิ่ม 2026-09-09) — เดิมยกแค่ remark/id_hash/id_enc
        // แล้ว upsert เขียน raw_json ทับทั้งก้อน ⇒ `hcp_person_code` ถูกเขียนเป็น null
        // ทุกรอบที่ไม่ได้ถามต้นทาง · หลักฐาน: ทั้ง source มี person_code เหลือ 23 แถว
        // เท่ากับจำนวนที่เพิ่งถามสดพอดี ทั้งที่ HCP ส่งมาให้เกือบทุกคน (39/40)
        // เป็นบั๊กคลาสเดียวกับ GOTCHAS #195 ที่เคยแก้ให้ remark ไปแล้วครั้งหนึ่ง
        `SELECT external_id, raw_json->>'hcp_remark' AS remark,
                raw_json->>'hcp_person_code' AS person_code, id_hash, id_number_enc
           FROM blacklist.source_records
          WHERE source_id = $1 AND data_type = 'face' AND raw_json ? 'hcp_remark'
            AND external_id LIKE $2`, [source.id, `face:${group}:%`]);
      for (const r of rows) {
        const key = `${group}:${String(r.external_id).split(':').pop()}`;
        haveRemarks.push(key);
        carry.set(key, r);
      }
    }
    let resp;
    try {
      resp = await edgeFetch(site, { source: 'hcp', dataType, group, withPhotos, havePhotos, haveRemarks });
    } catch (e) { stats.errors.push(`${group || dataType}: ${e.message}`); continue; }
    if (!resp || resp.ok === false) { stats.errors.push((resp && resp.error) || 'unknown edge error'); continue; }
    // 🔴 รอบที่ไม่ได้ถาม: edge ตั้ง `remark: null` ให้ทุกแถวตั้งแต่ต้น (ไม่ใช่ไม่ส่งคีย์)
    // แถวที่เราสั่งข้ามจึงกลับมาหน้าตาเหมือน "ต้นทางไม่ได้กรอกอะไร" เป๊ะ ๆ · upsert
    // เขียน raw_json ทั้งก้อนทับ ⇒ คำอธิบาย + เลขบัตรที่ derive จากมันหายทั้งหมด
    // เกิดจริงแล้ว 2026-09-08 06:24 UTC (auto-pull): 364 คำอธิบาย + 364 เลขบัตร → 0
    // ⇒ ยกของเดิมมาใส่เองตาม "รายชื่อที่เราสั่งข้าม" ไม่ใช่ตามรูปร่าง payload
    // (ข้อความที่เก็บไว้ mask เลข 13 หลักแล้ว parse ใหม่ได้ทุกช่องยกเว้นเลขบัตร
    //  จึงต้องยก id_hash / id_number_enc มาตรง ๆ ห้าม hash จาก ciphertext)
    for (const rec of (resp.records || [])) {
      const prev = carry.get(`${rec.group_index}:${rec.external_id}`);
      if (!prev) continue;
      rec.remark = prev.remark;
      rec.person_code = prev.person_code;
      rec.id_hash_pre = prev.id_hash;
      rec.id_enc_pre = prev.id_number_enc;
    }
    records.push(...(resp.records || []));
    photos += resp.photos || 0;
    photoFails += resp.photo_fails || 0;
    remarks += resp.remarks || 0;
    remarkFails += resp.remark_fails || 0;
    if (dataType === 'face') {
      console.log(`[hcp-import] คลัง ${group}: ${(resp.records || []).length} คน · รูปใหม่ ${resp.photos || 0}`
        + `${resp.photo_fails ? ` · รูปพลาด ${resp.photo_fails}` : ''}${havePhotos.length ? ` · มีรูปแล้ว ${havePhotos.length}` : ''}`
        + ` · คำอธิบายใหม่ ${resp.remarks || 0}${resp.remark_fails ? ` · ไม่มี/พลาด ${resp.remark_fails}` : ''}`
        + `${haveRemarks.length ? ` · ถามแล้ว ${haveRemarks.length}` : ''}`);
    }
    stats.groups = (resp.groups || []).filter((g) => g.skipped).length ? resp.groups : stats.groups;
  }
  const resp = { records, groups: [] };
  stats.photos = photos;
  stats.photoFails = photoFails;
  stats.remarks = remarks;
  stats.remarkFails = remarkFails;
  stats.fetched = records.length;
  // edge เดินหน้าจนหมดทุกกลุ่มก่อนตอบกลับ (ดู fetchHcpFaces/fetchHcpVehicles)
  // ยกเว้นกรณีชนเพดานจำนวนหน้า ซึ่ง edge จะรายงาน truncated มาให้
  stats.fullSweep = stats.errors.length === 0;   // ทุกคลังผ่านครบถึงจะนับว่ากวาดทั้งชุด
  // สรุปกลุ่มลง log ไม่ใช่ลง stats — finishImport เอา stats ทั้งก้อนไปใส่ audit_log
  // การยัด object 17 กลุ่มลงไปทำให้แถว audit อ่านไม่ออกโดยไม่ได้อะไรเพิ่ม
  console.log(`[hcp-import] ${dataType}: รวม ${records.length} แถว`
    + (dataType === 'face' ? ` · รูปใหม่ ${photos}${photoFails ? ` · พลาด ${photoFails}` : ''}` : ''));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const rec of records) {
      const r = await upsertRecord(client, source.id, normalize(rec));
      if (r.wasInserted) stats.inserted++; else stats.updated++;
      if (r.newMaster) stats.mastersCreated++;
      if (r.excluded) stats.excludedSkipped++;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    stats.errors.push(`db: ${e.message}`);
  } finally { client.release(); }

  return finishImport(pool, source, stats, opts);
}

// Which of `plates` (a proposed bridge removal set) are NOT yet confirmed
// safe to drop. "Confirmed gone" has two forms, not one: the source stopped
// returning the row (vanished_at), or an operator explicitly excluded it from
// the review screen (overrides.excluded — e.g. "duplicate plate"). Both are a
// human/system decision already made; only a removal with NEITHER reason
// attached is unexplained and should still hold for manual review.
// Found 2026-08-18: กข7384 sat blocking the whole auto-sync because an admin
// excluded it as a duplicate — a real, confirmed removal — and the gate below
// only recognized the vanish-scan reason. Exported so the Settings status
// badge (BS3) counts exactly what would block the next auto-sync, not a
// second guess at the same rule.
// ป้ายที่เข้ามาคือป้ายจาก `lpr_watchlist` ซึ่ง bridge เขียนไว้แบบ **normalize แล้ว**
// (blacklistBridge.js:217 เรียก normalizePlate ก่อน insert) ส่วน source_records
// เก็บรูปดิบตามที่ต้นทางส่งมา — เทียบตรง ๆ จึงไม่เจอกันเมื่อต้นทางใส่ขีด/ช่องว่าง
//
// เจอจริง 2026-08-19: `ช-5232` `จ-1103` `น-3414` `ฌ-9242` ถูกมาร์ค vanished แล้ว
// แต่ในเฝ้าระวังเป็น `ช5232` ฯลฯ ⇒ ค้นไม่เจอ ⇒ ถูกนับเป็น "ยังไม่ยืนยัน" ⇒
// **บล็อก auto-sync ทั้งก้อน 294 ป้าย** ทั้งที่ทุกใบยืนยันแล้ว · และเพราะมันไม่มีวัน
// เจอ ป้ายกลุ่มนี้จะบล็อกไปตลอดกาล ไม่ใช่แค่รอบเดียว
//
// แก้โดย normalize ทั้งสองฝั่งด้วย normalizePlate ตัวเดียวกับที่ bridge ใช้ตอนเขียน
// (ห้ามเขียน regex ใหม่ — คนละสูตรเมื่อไหร่ก็กลับมาไม่ตรงกันอีก)
async function unconfirmedRemovals(pool, plates) {
  if (!plates || !plates.length) return [];
  const { normalizePlate } = require('./blacklist-crypto');
  // ส่งคู่ (ป้ายเดิม, ป้าย normalize) ไปเทียบ แล้วคืน "ป้ายเดิม" กลับเสมอ —
  // ผู้เรียกเอาไปเทียบกับ diff.remove ซึ่งใช้รูปของ lpr_watchlist
  const norm = plates.map((p) => normalizePlate(p));
  // "Confirmed gone" มี **สามรูป** ไม่ใช่สอง:
  //   1. ต้นทางเลิกส่งแถวนั้น (vanished_at)
  //   2. คนกดยกเว้นเอง (overrides.excluded)
  //   3. ต้นทาง **แก้เลขป้าย** บนแถวเดิม — แถวยังอยู่ ไม่ vanish ไม่ excluded
  //      แต่ป้ายเก่าไม่อยู่ใน plate_numbers ของมันอีกแล้ว
  // เจอจริง 2026-08-29: GuruSquare แก้ 2กง2651 → 2กง2655 บน external_id เดิม
  // ⇒ ป้ายเก่าไม่มีระเบียนไหนถืออยู่เลย รูป 1/2 จึงหาไม่เจอ ⇒ นับเป็น "ยังไม่ยืนยัน"
  // ⇒ บล็อก auto-sync ทั้งก้อน **ถาวร** (ไม่มีวัน vanish เพราะแถวต้นทางยังอยู่ดี ๆ)
  // พาการถอนที่ยืนยันแล้ว (ผธ4973 — ต้นทางลบจริง) ค้างเฝ้าระวัง+ยิง LINE ต่อ
  // และป้ายที่แก้แล้ว (2655) ก็ไม่ถูกเพิ่มเข้าเฝ้าระวังด้วย เพราะ add โดนบล็อกไปพร้อมกัน
  //
  // วิธีแยก "แก้ป้าย" ออกจาก "บั๊กของ diff" (ตาข่ายเหตุ 481 แถวต้องไม่หลุด):
  // ตามลิงก์จากแถวเฝ้าระวังเอง — master ของมันยังมีระเบียนเป็น ๆ โยงอยู่ แต่ไม่มี
  // ระเบียนไหน (นับ override ของคนด้วย) ถือป้ายนี้แล้ว = ต้นทางแก้ป้ายจริง ปล่อยถอนได้
  // ส่วน diff ที่พังจะเสนอถอนทั้งที่ระเบียนยังถือป้ายอยู่ → ไม่เข้ารูป 3 → ยัง hold เหมือนเดิม
  const { rows } = await pool.query(
    `SELECT p.plate FROM unnest($1::text[], $2::text[]) AS p(plate, norm)
      WHERE NOT EXISTS (
        SELECT 1 FROM blacklist.source_records sr
          LEFT JOIN blacklist.overrides o
            ON o.source_id = sr.source_id AND o.external_id = sr.external_id
          CROSS JOIN LATERAL unnest(sr.plate_numbers) AS sp(raw)
         WHERE upper(regexp_replace(sp.raw, '[^0-9A-Za-z฀-๿]', '', 'g')) = p.norm
           AND (sr.vanished_at IS NOT NULL OR COALESCE(o.excluded, FALSE) = TRUE))
        AND NOT EXISTS (
        SELECT 1 FROM lpr_watchlist w
         WHERE w.origin = 'blacklist_bridge' AND w.blacklist_master_id IS NOT NULL
           AND upper(regexp_replace(w.plate_number, '[^0-9A-Za-z฀-๿]', '', 'g')) = p.norm
           AND EXISTS (
             SELECT 1 FROM blacklist.master_links l
               JOIN blacklist.source_records sr ON sr.id = l.source_record_id
              WHERE l.master_id = w.blacklist_master_id AND sr.vanished_at IS NULL)
           AND NOT EXISTS (
             SELECT 1 FROM blacklist.master_links l
               JOIN blacklist.source_records sr ON sr.id = l.source_record_id
               LEFT JOIN blacklist.overrides o
                 ON o.source_id = sr.source_id AND o.external_id = sr.external_id
              CROSS JOIN LATERAL unnest(COALESCE(o.plate_numbers, sr.plate_numbers)) AS sp(raw)
              WHERE l.master_id = w.blacklist_master_id
                AND upper(regexp_replace(sp.raw, '[^0-9A-Za-z฀-๿]', '', 'g')) = p.norm))`,
    [plates, norm]);
  return rows.map((r) => r.plate);
}

async function finishImport(pool, source, stats, opts) {
  const status = stats.errors.length ? (stats.fetched ? 'partial' : 'error') : 'ok';
  const note = stats.errors.length
    ? `${stats.fetched} rec · ${stats.errors.length} error(s): ${stats.errors.slice(0, 3).join('; ')}`
    : `${stats.fetched} rec · +${stats.inserted} new · ${stats.updated} updated`
      + (stats.excludedSkipped ? ` · ${stats.excludedSkipped} ถูกยกเว้น (ไม่เข้าถังกลาง)` : '')
      // Non-blocking notice (WA #3-4): a plate with no province can't be verified
      // by any plate_region watch-list group, so it silently never alerts — flag
      // it here instead of leaving it invisible until someone asks why.
      + (stats.noProvince ? ` · ${stats.noProvince} ป้ายไม่มีจังหวัด (ต้นทางไม่ระบุ — จะไม่ผูกเข้ากลุ่มที่ต้องยืนยันจังหวัด)` : '');

  await pool.query(
    `UPDATE blacklist.sources SET last_import_at = NOW(), last_import_status = $2,
            last_import_note = $3, updated_at = NOW() WHERE id = $1`,
    [source.id, status, note]);

  await pool.query(
    `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
    [opts.userId || null, opts.username || 'system', 'blacklist_import',
     JSON.stringify({ source_id: source.id, source_type: source.source_type, label: source.label, ...stats })]
  ).catch(() => { /* audit must never sink an otherwise-good import */ });

  // BS1 — ทำเครื่องหมายว่าอะไรหายไปจากต้นทาง · **ทำเครื่องหมายอย่างเดียว ไม่แตะข้อมูล**
  // ด่านทั้งหมดอยู่ใน scanVanished เพื่อให้ทุก importer ได้กติกาชุดเดียวกัน
  const dataType = stats.dataType || opts.dataType || (source.data_types || [])[0];
  let vanish = null;
  try {
    vanish = await scanVanished(pool, source, {
      dataType, runStart: opts._runStart, fullSweep: stats.fullSweep === true, status,
      actor: opts.username,
    });
    if (vanish.held) {
      console.warn(`[blacklist-vanish] source ${source.id}: หาย ${vanish.pct}% เกินเพดาน `
        + `${vanish.limit_pct}% — ไม่ทำเครื่องหมายสักแถว รอคนตรวจ`);
    } else if (vanish.marked) {
      console.log(`[blacklist-vanish] source ${source.id}: ทำเครื่องหมาย ${vanish.marked} แถว `
        + `(ต้นทางเปลี่ยนเลขแถว ${vanish.renumbered})`);
    }
  } catch (e) {
    // การสแกนล้ม ต้องไม่ทำให้ import ที่สำเร็จแล้วกลายเป็นล้มเหลว
    console.warn('[blacklist-vanish] scan failed:', e.message);
  }

  // ── BS2 · ซิงก์ต่ออัตโนมัติแบบมีด่าน (เจ้าของเลือกทางนี้ 2026-08-13) ──────
  //
  // ปัญหาเดิม: import เดินอัตโนมัติทุกชั่วโมง แต่ bridge.sync() เป็นงานที่คนต้องกด
  // ผลคือทั้งของใหม่และการถอนของที่ต้นทางลบไปแล้วค้างรอคนเป็นวัน ๆ
  // (วัดจริง: import ล่าสุด 13 ส.ค. · sync ล่าสุด 7 ส.ค. — ห่างกัน 6 วัน)
  //
  // ⚠️ ด่านสำคัญ: การถอนที่ยังยืนยันไม่ได้ **hold เฉพาะตัวมันเอง** (แยกคิว —
  // เจ้าของเลือก 2026-08-29 หลัง GOTCHAS #183; เดิม hold ทั้งก้อนแล้วใบเดียว
  // พาการถอนที่ยืนยันแล้ว+add ทั้งหมดค้างตาม) · ตาข่ายบั๊ก 2026-08-07 ยังอยู่:
  // diff() ที่พังจะเสนอถอนป้ายที่ระเบียนยังถืออยู่ → unconfirmed → ไม่มีวันถึง DELETE
  //
  // เรียกเมื่อ import สำเร็จและกวาดครบเท่านั้น — เงื่อนไขเดียวกับที่ scanVanished ใช้
  // เพราะรอบที่กวาดไม่ครบ "หาย" ไม่ได้แปลว่าถูกลบ
  if (status === 'ok' && stats.fullSweep === true) {
    // require ตรงนี้ ไม่ใช่บนหัวไฟล์ — blacklistBridge require ไฟล์นี้กลับมา
    // (PHOTO_DIR) การ require บนหัวไฟล์จะเป็นวงกลม แล้วได้ module ครึ่งใบ
    const bridge = require('./blacklistBridge');
    const r = await bridge.attemptAutoSync(pool, { username: 'auto-sync' });
    if (r.ok && r.skipped) {
      if (r.skipped !== 'nothing to sync') {
        console.warn(`[blacklist-bridge] ไม่ซิงก์อัตโนมัติ — ${r.skipped} · รอคนกดจากหน้าจอ`);
      }
    } else if (r.ok) {
      // ใบที่ถูก hold ต้องขึ้น log พร้อมชื่อทุกรอบ — ของค้างที่มองไม่เห็นคือเหตุ #183
      console.log(`[blacklist-bridge] auto sync: +${r.added} ~${r.updated} -${r.removed}`
        + (r.held ? ` · hold ${r.held} ใบรอตรวจ: ${r.held_plates.join(', ')}` : ''));
    }

    // FB4 — same posture, face side. Gated on dataType==='face' so an LPR-only
    // import doesn't pay for a diffFace() that would just find nothing to do.
    if (dataType === 'face') {
      const faceBridge = require('./blacklistFaceBridge');
      const rf = await faceBridge.attemptAutoFaceSync(pool, { username: 'auto-sync' });
      if (rf.ok && rf.skipped) {
        if (rf.skipped !== 'nothing to sync') {
          console.warn(`[face-blacklist-bridge] ไม่ซิงก์อัตโนมัติ — ${rf.skipped} · รอคนกดจากหน้าจอ`);
        }
      } else if (rf.ok) {
        console.log(`[face-blacklist-bridge] auto sync: +${rf.added} ~${rf.updated} -${rf.removed}`
          + (rf.embed_failed ? ` (embed_failed ${rf.embed_failed})` : ''));
      }
    }
  }

  return { ok: status !== 'error', status, ...stats, vanish };
}

async function runImport(pool, source, opts = {}) {
  // เวลาเริ่มรอบ ไม่ใช่เวลาจบ — BS1 ใช้ค่านี้ตัดสินว่าแถวไหน "รอบนี้ไม่ได้แตะ"
  // ถ้าใช้เวลาจบ แถวที่ถูกแตะระหว่างรอบยาว ๆ จะดูเก่ากว่าและถูกนับว่าหาย
  opts = { ...opts, _runStart: new Date() };
  if (source.source_type === 'gurusquare') return importGuruSquare(pool, source, opts);
  if (source.source_type === 'dss_pro') {
    // One connection can feed both sides; import whichever the operator enabled.
    const types = source.data_types || [];
    if (opts.dataType === 'lpr' || (!types.includes('face') && types.includes('lpr'))) {
      return importDssProVehicles(pool, source, opts);
    }
    return importDssPro(pool, source, opts);
  }
  if (source.source_type === 'hcp') {
    // เหมือน dss_pro: การเชื่อมต่อเดียวป้อนได้ทั้งสองฝั่ง เลือกตามที่เจ้าหน้าที่เปิดไว้
    const types = source.data_types || [];
    if (opts.dataType === 'lpr' || (!types.includes('face') && types.includes('lpr'))) {
      return importHcp(pool, source, { ...opts, dataType: 'lpr' });
    }
    return importHcp(pool, source, { ...opts, dataType: 'face' });
  }
  throw new Error(`import not implemented for source type '${source.source_type}'`);
}

// upsertRecord is exported for the manual-entry route (BM1a). A hand-typed
// plate has to land in source_records -> master -> master_links in exactly the
// shape an import produces, or the bridge treats it as a second-class row —
// which is the entire complaint that phase exists to fix. Calling this rather
// than writing the three INSERTs again also inherits the parts that are easy to
// forget: the exclusion check, master reuse by id_hash then plate_hash, and the
// COALESCE that stops a re-save wiping a photo.
module.exports = { runImport, monthWindows, normalizeGuruSquare, normalizeDssPro, normalizeDssProVehicle,
  normalizeHcpFace, normalizeHcpVehicle, upsertRecord, savePhoto, PHOTO_DIR,
  diffRecord, srcEditTime, CHANGE_SKIP_KEYS, unconfirmedRemovals,
  // exported for the GuruSquare alarm poller (gsAlarmPoll.js) — reuses this
  // edge-proxy call rather than growing a second HTTP client for the same tunnel
  edgeFetch };

// ---------- self-check ----------
// `node src/helpers/blacklistImport.js` — covers the two pure pieces (window
// walking and record normalization). The DB/edge paths are exercised by the
// real import run, not mocked here.
if (require.main === module) {
  const assert = require('assert');

  // windows must tile the range exactly: no gap, no overlap, none empty
  const w = monthWindows('2023-10-01', '2024-01-15');
  assert.strictEqual(w.length, 4, '2023-10 .. 2024-01 spans 4 windows');
  assert.strictEqual(w[0].from.slice(0, 10), '2023-10-01');
  assert.strictEqual(w[3].to.slice(0, 10), '2024-01-15', 'last window must stop at the end date, not overshoot');
  for (let i = 1; i < w.length; i++) {
    assert.strictEqual(w[i].from, w[i - 1].to, 'windows must be contiguous (no gap, no overlap)');
  }
  assert.deepStrictEqual(monthWindows('2024-01-01', '2024-01-01'), [], 'empty range yields no windows');

  // a single-day range still produces one usable window
  assert.strictEqual(monthWindows('2024-03-05', '2024-03-06').length, 1);

  // normalization: plate trimmed into an array, vehicle attrs folded into the note
  const n = normalizeGuruSquare({
    external_id: '42', plate_number: ' 1กก1234 ', owner: ' สมชาย ', province: 'สงขลา',
    carbrand: 'Toyota', carcolor: 'White', cartype: 'Car', platetype: 'ป้ายขาว',
    owner_detail: 'บ้านเลขที่ 1', photo_b64: null,
  });
  assert.deepStrictEqual(n.plate_numbers, ['1กก1234'], 'plate must be trimmed');
  assert.strictEqual(n.name, 'สมชาย', 'owner name must be trimmed');
  assert.strictEqual(n.data_type, 'lpr');
  assert.strictEqual(n.id_number, null, 'GuruSquare carries no national ID');
  assert.ok(n.case_note.includes('Toyota') && n.case_note.includes('บ้านเลขที่ 1'));

  // a record with no plate must still normalize (1 such row exists live) —
  // empty array, not [''], or the bridge would later try to watch a blank plate
  const empty = normalizeGuruSquare({ external_id: '43', plate_number: '   ', owner: null });
  assert.deepStrictEqual(empty.plate_numbers, [], 'blank plate must yield an empty array');
  assert.strictEqual(empty.name, null);
  assert.strictEqual(empty.case_note, null, 'no attributes => no note, not an empty string');

  // ---- DSS Pro normalization ----
  // The load-bearing property: the raw national ID must never appear in
  // external_id, which is stored in plaintext as a lookup key.
  process.env.BLACKLIST_SECRET_KEY = require('crypto').randomBytes(32).toString('hex');
  const NID = '1234567890123';
  const d = normalizeDssPro({
    person_id: NID, first_name: 'สมชาย', last_name: 'ใจดี', org_code: '001021',
    org_name: 'บุคคลหมายจับ', remark: 'หมายจับคดีอาญา', group_name: 'High Risk Person',
  });
  assert.strictEqual(d.data_type, 'face');
  assert.strictEqual(d.id_type, 'national_id');
  assert.strictEqual(d.id_number, NID, 'raw ID must reach the encrypt step');
  assert.ok(!d.external_id.includes(NID), 'external_id must NOT leak the raw national ID');
  assert.strictEqual(d.external_id, idHash(NID, 'national_id', null), 'external_id must be the HMAC');
  assert.strictEqual(d.name, 'สมชาย ใจดี', 'first+last must be joined');
  assert.strictEqual(d.case_ref, 'บุคคลหมายจับ');
  assert.deepStrictEqual(d.plate_numbers, [], 'face records carry no plates');

  // same person, same key across runs => re-import updates rather than duplicates
  assert.strictEqual(normalizeDssPro({ person_id: ' 1-2345-67890-12-3 ' }).external_id,
    d.external_id, 'formatting differences must still hash to the same key');

  // no-ID person: must still get a stable key, and no id_type
  const noid = normalizeDssPro({ person_id: '', first_name: 'ก', org_code: '001' });
  assert.strictEqual(noid.id_type, null);
  assert.strictEqual(noid.id_number, null);
  assert.ok(noid.external_id.startsWith('noid:'), 'no-ID person needs a deterministic fallback key');
  assert.strictEqual(normalizeDssPro({ person_id: '', first_name: 'ก', org_code: '001' }).external_id,
    noid.external_id, 'fallback key must be stable across runs');

  // ---- DSS Pro vehicle ----
  const v = normalizeDssProVehicle({
    external_id: '870', plate_number: ' กง6453 ', brand: 'ISUZU', color: 'Gray',
    remark: 'ปล้นรถ พบเห็นสกัดจับ', org_name: 'สภ.นราธิวาส', risk_group: 'High Risk Vehicle',
  });
  assert.strictEqual(v.data_type, 'lpr');
  assert.deepStrictEqual(v.plate_numbers, ['กง6453'], 'plate must be trimmed');
  // person ids and vehicle ids are separate sequences in DSS — without the
  // namespace, vehicle 870 would collide with person-hash-less external_id 870
  assert.ok(v.external_id.startsWith('veh:'), 'vehicle ids must be namespaced');
  assert.strictEqual(v.raw_json.group_name, 'High Risk Vehicle',
    'risk tier must land on the same key the face side uses, so the badge works unchanged');
  assert.strictEqual(v.photo_b64, null, 'this source carries no vehicle photos');
  assert.ok(v.case_note.includes('ISUZU') && v.case_note.includes('ปล้นรถ'));

  const vEmpty = normalizeDssProVehicle({ external_id: '1', plate_number: '  ' });
  assert.deepStrictEqual(vEmpty.plate_numbers, [], 'blank plate must yield an empty array');
  assert.strictEqual(vEmpty.case_note, null);

  // ---- HCP face (HC3) ----
  // ทั้งสองแบบที่เจ้าหน้าที่ HCP กรอกจริง ต้องได้ชื่อจริงติดมาใน name ทั้งคู่
  const hf1 = normalizeHcpFace({ external_id: '2081', given_name: 'ผู้ต้องหาตามหมายจับ',
    family_name: 'นาย ภาณุวัฒน์ สุวรรณรัตน', sex: '1', group_index: '19', group_name: 'BLACKLIST CTL' });
  assert.strictEqual(hf1.name, 'ผู้ต้องหาตามหมายจับ นาย ภาณุวัฒน์ สุวรรณรัตน');
  assert.strictEqual(hf1.data_type, 'face');
  assert.strictEqual(hf1.case_ref, 'BLACKLIST CTL', 'ชื่อคลังคือที่มาของคดี');
  assert.strictEqual(hf1.external_id, 'face:19:2081',
    'คีย์ต้องเป็น (คลัง + ใบหน้า) — คนเดียวกันอยู่ได้หลายคลังโดยใช้ indexCode เดิม');
  assert.notStrictEqual(
    normalizeHcpFace({ external_id: '1474', group_index: '19', group_name: 'CTL' }).external_id,
    normalizeHcpFace({ external_id: '1474', group_index: '12', group_name: 'KML' }).external_id,
    'คนเดียวกันใน 2 คลัง ต้องไม่ทับกัน ไม่งั้นสมาชิกภาพของคลังแรกหายเงียบ');
  assert.strictEqual(hf1.id_number, null, 'คลังใบหน้าของ HCP ไม่มีเลขบัตร');
  assert.strictEqual(hf1.photo_b64, null, 'ไม่ส่งรูปมา = ไม่มีรูป');
  assert.strictEqual(normalizeHcpFace({ external_id: '1', group_index: '19', photo_b64: 'AAAA' }).photo_b64, 'AAAA',
    'รูปที่ edge ดึงมาต้องเดินทางถึง upsertRecord ไม่ถูกทิ้งกลางทาง');
  const hf2 = normalizeHcpFace({ external_id: '2427', given_name: 'สมชาย หอมเกตุ',
    family_name: 'แจ้ง พ.ต.ต.ธีรศักดิ์ 0931539251', sex: '2', group_name: '191' });
  assert.ok(hf2.name.includes('สมชาย หอมเกตุ'), 'ชื่อจริงอยู่คนละช่องกับแถวบน ต้องยังติดมา');
  assert.strictEqual(hf2.case_note, 'เพศหญิง');
  assert.strictEqual(normalizeHcpFace({ external_id: '1', given_name: '', family_name: '  ' }).name, null,
    'ไม่มีชื่อเลย ต้องเป็น null ไม่ใช่สตริงว่าง');

  // ---- HCP vehicle (HC3) ----
  const hv = normalizeHcpVehicle({ external_id: '43', plate_number: '6ขจ7186',
    person_name: 'นายมิคาอิล ทรูรีน คดีนอมินี พบเจอแจ้ง สภ.ท่าฉัตรไชย', phone: '0961288700',
    plate_area: '', effective: '2026-08-06T00:00:00+07:00', expired: '2028-08-05T23:59:59+07:00',
    group_index: '1', group_name: 'Blacklist' });
  assert.strictEqual(hv.data_type, 'lpr');
  assert.deepStrictEqual(hv.plate_numbers, ['6ขจ7186']);
  assert.ok(hv.external_id.startsWith('veh:'));
  assert.ok(hv.case_note.includes('0961288700') && hv.case_note.includes('2028-08-05'));
  assert.deepStrictEqual(normalizeHcpVehicle({ external_id: '9', plate_number: '  ' }).plate_numbers, [],
    'ป้ายว่างต้องได้ array ว่าง ไม่ใช่ [\'\']');

  // ---- CH1 · diffRecord ----
  // แถวใหม่ล้วน = ไม่มีอะไรให้เทียบ ต้องไม่บันทึกเป็น "การแก้ไข"
  assert.deepStrictEqual(diffRecord(null, { name: 'ก' }), [], 'แถวใหม่ต้องไม่มี change');
  assert.deepStrictEqual(diffRecord({ name: 'ก', raw_json: {} }, { name: 'ก', raw_json: {} }), [],
    'ไม่มีอะไรเปลี่ยน ต้องได้ array ว่าง');

  const d1 = diffRecord(
    { name: 'เก่า', case_note: 'n', plate_numbers: ['กก1111'], raw_json: { carcolor: 'ขาว', last_update: 'x' } },
    { name: 'ใหม่', case_note: 'n', plate_numbers: ['ขข2222'], raw_json: { carcolor: 'ดำ', last_update: 'y' } });
  assert.deepStrictEqual(d1.map(c => c.field).sort(), ['carcolor', 'name', 'plate_numbers'],
    'last_update ต้องถูกข้าม — เป็นเวลาไม่ใช่เนื้อหา');
  assert.deepStrictEqual(d1.find(c => c.field === 'plate_numbers'),
    { field: 'plate_numbers', old_value: 'กก1111', new_value: 'ขข2222' });

  // '' กับ null ต้องนับว่าเท่ากัน ไม่งั้นแหล่งที่สลับไปมาจะสร้าง change ปลอมทุกรอบ
  assert.deepStrictEqual(diffRecord({ name: '', raw_json: {} }, { name: null, raw_json: {} }), [],
    'สตริงว่างกับ null ต้องไม่นับเป็นการแก้');
  // คีย์ที่หายไปจาก raw_json = ต้นทางลบค่านั้น ต้องบันทึก
  assert.deepStrictEqual(diffRecord({ raw_json: { province: 'สงขลา' } }, { raw_json: {} }),
    [{ field: 'province', old_value: 'สงขลา', new_value: null }]);
  // คีย์ใน deny-list ต้องเงียบแม้ค่าจะเปลี่ยน
  assert.deepStrictEqual(diffRecord({ raw_json: { hcp_face_url: 'a' } }, { raw_json: { hcp_face_url: 'b' } }), [],
    'คีย์ id/url ที่อาจหมุนได้ ต้องไม่ถูกนับเป็นการแก้');

  assert.strictEqual(srcEditTime({ raw_json: { last_update: '2026-08-12T01:10:52' } }).slice(0, 10), '2026-08-11',
    'last_update เป็นเวลาท้องถิ่น แปลงเป็น ISO แล้วเลื่อนตาม TZ ของเครื่อง');
  assert.strictEqual(srcEditTime({ raw_json: {} }), null);
  assert.strictEqual(srcEditTime({ raw_json: { last_update: 'ไม่ใช่วันที่' } }), null, 'ค่าพังต้องได้ null ไม่ใช่ Invalid Date');

  console.log('blacklistImport self-check: all assertions passed');
}
