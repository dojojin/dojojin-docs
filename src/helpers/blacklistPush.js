// ============================================================
// Vigil Platform — Blacklist push-back (writing our corrections into a source)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Reading from a third-party system is safe. Writing into one is not: a bad
// push edits somebody else's operational blocklist, and these are police
// systems. Everything here is built so the dangerous paths fail closed.
//
// The diff lives here rather than in the route because the scheduler needs the
// same numbers the operator was shown. Two implementations of "what would we
// push" is exactly how an unattended job transmits something no preview ever
// displayed.
//
// Transport: through the edge, like every other blacklist call. DSS Pro sits on
// the site LAN and central cannot reach it. The edge exposes named operations
// (person-update / vehicle-save), never a generic "PUT this URL", so a bug in
// central cannot be turned into an arbitrary write against a police server.
// ============================================================
'use strict';

const https = require('https');
const crypto = require('crypto');
const { edgeProxyBaseUrl } = require('./edgeProxyBaseUrl');

// ---------- the diff ----------
// Every local correction that differs from what the source holds, restricted to
// the data types this source is allowed to push. The type filter lives inside
// the diff — not at the call site — because the checksum is computed from the
// result. Filtering afterwards would leave gate 3 confirming a set that no
// longer matches what gets sent.
async function buildPushDiff(pool, sourceId, pushTypes) {
  const types = Array.isArray(pushTypes) ? pushTypes : [];
  const { rows } = await pool.query(`
    SELECT r.external_id, r.data_type,
           r.name AS src_name, r.plate_numbers AS src_plates, r.case_note AS src_case_note,
           r.raw_json AS src_raw,
           r.raw_json->>'carbrand'     AS src_brand,
           r.raw_json->>'cartype'      AS src_vehicle_type,
           r.raw_json->>'carcolor'     AS src_vehicle_color,
           r.raw_json->>'platetype'    AS src_plate_type,
           r.raw_json->>'owner_detail' AS src_case_kind,
           r.raw_json->>'province'     AS src_province,
           r.photo_path AS src_photo_path,
           o.name AS our_name, o.plate_numbers AS our_plates, o.case_note AS our_case_note,
           o.brand AS our_brand, o.vehicle_type AS our_vehicle_type,
           o.vehicle_color AS our_vehicle_color, o.plate_type AS our_plate_type,
           o.case_kind AS our_case_kind, o.province AS our_province,
           o.photo_path AS our_photo_path,
           o.excluded, o.exclude_reason, o.note, o.updated_by, o.updated_at
      FROM blacklist.overrides o
      JOIN blacklist.source_records r
        ON r.source_id = o.source_id AND r.external_id = o.external_id
     WHERE o.source_id = $1
       AND ($2::text[] = '{}' OR r.data_type = ANY($2))
     ORDER BY o.updated_at DESC`, [sourceId, types]);

  const changes = rows.map(r => {
    const fields = [];
    const cmp = (key, from, to) => {
      if (to == null) return;                                   // NULL = defer to source
      const a = Array.isArray(from) ? from.join(',') : (from ?? '');
      const b = Array.isArray(to) ? to.join(',') : to;
      if (a !== b) fields.push({ field: key, from: from ?? null, to });
    };
    cmp('name', r.src_name, r.our_name);
    cmp('plate_numbers', r.src_plates, r.our_plates);
    cmp('case_note', r.src_case_note, r.our_case_note);
    // The six vehicle fields + photo that P4 made editable. They belong in the
    // diff even where no source can receive them yet: a correction the operator
    // made and the preview never mentions is indistinguishable from one that
    // was pushed. Which of these actually travel is each transmitter's
    // decision (see TRANSMITTERS) — the diff's job is only to notice them.
    cmp('brand', r.src_brand, r.our_brand);
    cmp('vehicle_type', r.src_vehicle_type, r.our_vehicle_type);
    cmp('vehicle_color', r.src_vehicle_color, r.our_vehicle_color);
    cmp('plate_type', r.src_plate_type, r.our_plate_type);
    cmp('case_kind', r.src_case_kind, r.our_case_kind);
    cmp('province', r.src_province, r.our_province);
    cmp('photo_path', r.src_photo_path, r.our_photo_path);
    return {
      external_id: r.external_id, data_type: r.data_type,
      label: r.our_name || r.src_name || (r.src_plates || [])[0] || r.external_id,
      fields,
      // an exclusion is OUR decision about OUR reservoir — it is not a deletion
      // request against the source, and must never be pushed
      excluded: !!r.excluded, exclude_reason: r.exclude_reason,
      note: r.note, updated_by: r.updated_by, updated_at: r.updated_at,
      _raw: r.src_raw || {},
    };
  }).filter(c => c.fields.length || c.excluded);

  const pushable = changes.filter(c => c.fields.length && !c.excluded);
  // The checksum covers the types too: a source switched from face+lpr to
  // face-only must invalidate a preview taken before the switch, even if the
  // face rows themselves did not change.
  const checksum = crypto.createHash('sha256')
    .update(JSON.stringify([types.slice().sort(), pushable.map(c => [c.external_id, c.fields])]))
    .digest('hex').slice(0, 16);
  return { changes, pushable, checksum };
}

// ---------- edge transport ----------
function edgePush(siteCode, body, timeoutMs = 120000) {
  const secret = process.env.SNAPSHOT_PROXY_SECRET || '';
  if (!secret) throw new Error('SNAPSHOT_PROXY_SECRET not configured');
  const url = `${edgeProxyBaseUrl(siteCode, process.env.SNAPSHOT_PROXY_DOMAIN || 'dojojin.tech')}/blacklist-source-push`;
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    // agent:false for the same reason as the import path — api-server is
    // long-lived and would otherwise reuse a socket the tunnel already closed.
    const req = https.request(url, {
      method: 'POST', timeout: timeoutMs, agent: false,
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (r) => {
      const chunks = [];
      r.on('data', d => chunks.push(d));
      r.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve(JSON.parse(text)); }
        catch { reject(new Error(`bad edge response (HTTP ${r.statusCode}): ${text.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('edge push timeout')));
    req.write(payload);
    req.end();
  });
}

// ---------- per-source transmitters ----------
// A record's fields as the SOURCE wants them, not as we store them. Keeping the
// mapping next to the transmitter means a change to DSS Pro's contract touches
// one function.
function dssPersonPayload(change) {
  const out = {};
  for (const f of change.fields) {
    if (f.field === 'name') out.personName = f.to;
    if (f.field === 'case_note') out.remark = f.to;
  }
  return out;
}

function dssVehiclePayload(change) {
  const out = { id: change.external_id };
  for (const f of change.fields) {
    if (f.field === 'plate_numbers') out.plateNo = Array.isArray(f.to) ? f.to[0] : f.to;
    if (f.field === 'case_note') out.remark = f.to;
  }
  return out;
}

const TRANSMITTERS = {
  dss_pro: async (source, cfg, pushable) => {
    // A record can now be pushable on a field DSS Pro has no home for (colour,
    // brand, province…). Its payload comes back with nothing but the id, and
    // sending that is a write with no content that still counts itself as sent.
    // Drop those here rather than in the diff: the operator should still see the
    // correction in the preview, they just must not be told it travelled.
    const persons  = pushable.filter(c => c.data_type === 'face'
      && Object.keys(dssPersonPayload(c)).length > 0);
    const vehicles = pushable.filter(c => c.data_type === 'lpr'
      && Object.keys(dssVehiclePayload(c)).length > 1);   // > 1 = more than `id`
    const ops = [];
    // DSS Pro has no batch update for persons — one PUT per personId. Vehicles
    // do have a batch endpoint, so they go in one call.
    if (persons.length) {
      ops.push({
        op: 'person-update',
        items: persons.map(c => ({ personId: c.external_id, body: dssPersonPayload(c) })),
      });
    }
    if (vehicles.length) {
      ops.push({ op: 'vehicle-save', items: vehicles.map(dssVehiclePayload) });
    }
    const sent = persons.length + vehicles.length;
    const unmapped = pushable.length - sent;
    if (!ops.length) return { ok: true, sent: 0, unmapped, results: [] };
    const resp = await edgePush(source.site_code || 'hdy', {
      source: 'dss_pro',
      config: { host: cfg.host, port: cfg.port, username: cfg.username, password: cfg.password },
      ops,
    });
    if (!resp || resp.ok === false) throw new Error((resp && resp.error) || 'unknown edge error');
    return { ok: true, sent, unmapped, results: resp.results || [] };
  },
};

// ---------- the push ----------
// Returns { ok, sent, ... } or throws. Refusals are thrown with a `code` so the
// caller can tell "not allowed" from "broke".
function refuse(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

async function pushToSource(pool, source, cfg, opts = {}) {
  const types = source.push_types || [];
  if (!types.length) throw refuse('no_types', 'ยังไม่ได้เลือกชนิดข้อมูลที่จะส่งกลับ');
  if (!source.push_enabled) throw refuse('not_enabled', 'push-back ยังไม่ได้เปิดใช้งานสำหรับแหล่งข้อมูลนี้');

  // Replace means deleting rows from a system we do not own. The gates, the
  // column and the UI are built; the delete call is not, and will not be until
  // it has been exercised against a real DSS Pro in a window the owner
  // schedules. A fake server can prove the request is well-formed — it cannot
  // prove which rows a police system removes when it receives one.
  if (source.push_mode === 'replace') {
    throw refuse('replace_not_live',
      'โหมด replace ยังไม่เปิดใช้งานจริง — ต้องทดสอบกับ DSS Pro ตัวจริงในช่วงเวลาที่นัดหมายก่อน (ตอนนี้ระบบจะไม่ลบข้อมูลของต้นทาง)');
  }

  const d = await buildPushDiff(pool, source.id, types);
  if (opts.checksum !== undefined && opts.checksum !== d.checksum) {
    throw refuse('stale_checksum', 'รายการเปลี่ยนไปหลังจากที่คุณตรวจสอบ — กรุณาดูรายการใหม่แล้วยืนยันอีกครั้ง');
  }
  if (!d.pushable.length) return { ok: true, sent: 0, checksum: d.checksum, note: 'ไม่มีรายการที่ต้องส่ง' };

  if (process.env.BLACKLIST_PUSH_LIVE !== '1') {
    throw refuse('dry_run',
      'โหมดทดสอบ: ระบบยังไม่ส่งข้อมูลกลับไปยังต้นทางจริง (ตั้ง BLACKLIST_PUSH_LIVE=1 เมื่อพร้อมและได้รับอนุญาตจากเจ้าของระบบต้นทาง)');
  }

  const tx = TRANSMITTERS[source.source_type];
  if (!tx) throw refuse('no_transmitter', `ยังไม่มีตัวส่งข้อมูลกลับสำหรับแหล่งข้อมูลประเภท ${source.source_type}`);

  const result = await tx(source, cfg, d.pushable);
  return { ...result, checksum: d.checksum };
}

module.exports = { buildPushDiff, pushToSource, dssPersonPayload, dssVehiclePayload };

// ---------- self-check ----------
// `node src/helpers/blacklistPush.js` — the parts worth guarding are the ones
// that decide what leaves the building: the type filter, the checksum's
// sensitivity to it, and that excluded rows are never pushable.
if (require.main === module) {
  const assert = require('assert');

  const rows = [
    { external_id: 'p1', data_type: 'face', src_name: 'เก่า', our_name: 'ใหม่', excluded: false,
      src_plates: null, our_plates: null, src_case_note: null, our_case_note: null, raw_json: {} },
    { external_id: 'v1', data_type: 'lpr', src_name: null, our_name: null, excluded: false,
      src_plates: ['กก1111'], our_plates: ['กก2222'], src_case_note: null, our_case_note: null, raw_json: {} },
    { external_id: 'p2', data_type: 'face', src_name: 'x', our_name: 'y', excluded: true,
      src_plates: null, our_plates: null, src_case_note: null, our_case_note: null, raw_json: {} },
    // Corrected colour only — a P4 field. It must reach the preview (the
    // operator changed something) and must NOT reach DSS Pro, which has no
    // colour field: the payload would be an id and nothing else.
    { external_id: 'v2', data_type: 'lpr', src_name: null, our_name: null, excluded: false,
      src_plates: null, our_plates: null, src_case_note: null, our_case_note: null,
      src_vehicle_color: 'ขาว', our_vehicle_color: 'เทา', raw_json: {} },
  ];
  const fakePool = {
    query: async (_sql, [, types]) => ({
      rows: rows.filter(r => !types.length || types.includes(r.data_type)),
    }),
  };

  (async () => {
    const both = await buildPushDiff(fakePool, 1, ['face', 'lpr']);
    assert.strictEqual(both.pushable.length, 3, 'face+lpr should push three rows');
    assert.ok(!both.pushable.some(c => c.excluded), 'excluded rows must never be pushable');
    assert.strictEqual(both.changes.length, 4, 'excluded rows still appear in the preview');

    // A P4-only correction is seen by the diff…
    const colourOnly = both.pushable.find(c => c.external_id === 'v2');
    assert.deepStrictEqual(colourOnly.fields,
      [{ field: 'vehicle_color', from: 'ขาว', to: 'เทา' }],
      'a colour correction must appear in the diff');
    // …and is dropped by the transmitter, because its payload is bare.
    assert.deepStrictEqual(dssVehiclePayload(colourOnly), { id: 'v2' },
      'DSS Pro has nowhere to put a colour — payload must stay bare so it is filtered');

    const faceOnly = await buildPushDiff(fakePool, 1, ['face']);
    assert.strictEqual(faceOnly.pushable.length, 1, 'face-only must not transmit the lpr row');
    assert.notStrictEqual(faceOnly.checksum, both.checksum,
      'narrowing push_types must invalidate an earlier confirmation');

    // Same rows, same types, different order in → same checksum out, otherwise a
    // preview and its confirm could disagree for no real reason.
    const reordered = await buildPushDiff(fakePool, 1, ['lpr', 'face']);
    assert.strictEqual(reordered.checksum, both.checksum, 'type order must not change the checksum');

    const none = await buildPushDiff(fakePool, 1, []);
    assert.strictEqual(none.pushable.length, 3, 'empty types = unfiltered diff (callers gate on push_types)');

    assert.deepStrictEqual(dssPersonPayload(both.pushable.find(c => c.data_type === 'face')),
      { personName: 'ใหม่' });
    assert.deepStrictEqual(dssVehiclePayload(both.pushable.find(c => c.data_type === 'lpr')),
      { id: 'v1', plateNo: 'กก2222' });

    // Replace must refuse before it ever builds a request.
    await assert.rejects(
      () => pushToSource(fakePool, { id: 1, push_types: ['face'], push_enabled: true, push_mode: 'replace' }, {}),
      (e) => e.code === 'replace_not_live');
    await assert.rejects(
      () => pushToSource(fakePool, { id: 1, push_types: [], push_enabled: true, push_mode: 'merge' }, {}),
      (e) => e.code === 'no_types');
    await assert.rejects(
      () => pushToSource(fakePool, { id: 1, push_types: ['face'], push_enabled: false, push_mode: 'merge' }, {}),
      (e) => e.code === 'not_enabled');

    console.log('blacklistPush self-check: all assertions passed');
  })().catch(e => { console.error(e); process.exit(1); });
}
