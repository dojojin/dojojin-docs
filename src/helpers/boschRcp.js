// ============================================================
// Vigil Platform — Helper: Bosch RCP+ over CGI
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Reads Bosch on-camera storage/recording state via RCP+ tunnelled over CGI
// (`/rcp.xml?command=…&direction=READ`), which returns XML over plain HTTP with
// digest auth — not the binary RCP+ protocol on TCP 1756. Spec:
// docs/vendor/bosch/RCP_doc_9_41_0019.pdf §1.7 (CGI form) and the per-command
// pages cited beside each tag below.
//
// Everything here is READ-only, with exactly one exception: pushMqttSettings()
// / writeMqttSettings() issue direction=WRITE for CONF_MQTT_SETTINGS (0x0d0a,
// p.752-754) — the "ส่งค่า MQTT เข้ากล้อง" button (Mosquitto migration phase B1,
// decision 6.1 item 4: owner wants the system able to set a camera's own MQTT
// broker/user/password, not just read camera state). The write path never logs
// or returns the password (tag 3, write-only, never echoed on read) — see the
// comments on writeMqttSettings.
//
// Why this exists: the ONVIF GetRecordingSummary poll we already run answers
// only "how far does the footage reach", so the Bosch camera panel showed four
// rows against Hikvision's eleven. Worse, it answers it wrongly on some
// cameras — 4 of 6 Bosch cameras report the 2000-01-01 epoch sentinel (i.e.
// "nothing recorded") while RCP+ RECORDING_STATUS on the same camera at the
// same moment says RUNNING. This reads the camera's own storage registers
// instead.
//
// The output is deliberately shaped like helpers/hikStorage.js buildSdDetail()
// so dashboard/page-cameras.js recBoxHik() renders it unmodified.
// ============================================================
'use strict';

const http = require('http');
const { parseChallenge, buildDigestHeader } = require('./digestAuth');

// Tag codes are read off each command's own page in the reference. NOTE: the
// numbers in the doc's table of contents are PAGE numbers, not tag codes —
// guessing from the ToC yields 0x40 (invalid command) responses.
const CMD = {
  SD_CARD_STATUS:        { tag: '0x0b89', type: 'T_WORD',  num: 1 }, // p.929 bit0 = card present
  SD_LIFE_SPAN_STATUS:   { tag: '0x0c5a', type: 'P_OCTET', num: 1 }, // p.926 tagged: manf/model/blocks/life%
  STORAGE_REPORT:        { tag: '0x09cf', type: 'P_OCTET', num: 1 }, // p.1056 avail/access/io-errors/throughput
  STORAGE_LOAD:          { tag: '0x0bba', type: 'T_DWORD', num: 0 }, // p.1052 percent used
  RECORDING_STATUS:      { tag: '0x0a9b', type: 'P_OCTET', num: 1 }, // p.896 OFFLINE/PEND/RUNNING/ERROR
  RECORDING_RETENTION:   { tag: '0x0a30', type: 'T_DWORD', num: 1 }, // p.894 seconds
  MQTT_SETTINGS:         { tag: '0x0d0a', type: 'P_OCTET', num: 1 }, // p.752 num=MQTT instance
  BOARD_RESET:           { tag: '0x0811', type: 'F_FLAG',  num: 0 }, // p.173 write-only, reboots the device
  RE_TASK_NAMES:         { tag: '0x0b2b', type: 'P_OCTET', num: 1 }, // p.1242 task names, 66-byte entries, name ≤64 B
};

// p.897
const REC_STATUS = { 1: 'offline', 2: 'idle', 3: 'pend', 4: 'running', 5: 'error', 6: 'rec_src_error' };
// p.1057
const ACCESS_TYPE = { 0: null, 1: 'R', 2: 'RW' };
const AVAILABILITY = { 0: 'unknown', 1: 'no', 2: 'yes', 3: 'locked' };

// ── pure decoders (unit-tested) ──────────────────────────────

// Bosch tagged payload: [len:2][tag:2][data:len-4] repeated. p.926-928.
const LIFE_TAGS = { 1: 'manf_id', 2: 'prod_id', 3: 'prod_string', 4: 'num_blocks',
                    5: 'life_span_percent_done', 6: 'manf_name', 7: 'serial_no' };
function decodeTagged(buf, names = LIFE_TAGS) {
  const out = {};
  if (!buf) return out;
  let off = 0;
  while (off + 4 <= buf.length) {
    const len = buf.readUInt16BE(off);
    const tag = buf.readUInt16BE(off + 2);
    if (len < 4 || off + len > buf.length) break;
    const d = buf.slice(off + 4, off + len);
    const key = names[tag] || `tag${tag}`;
    out[key] = (tag === 3 || tag === 6) ? d.toString('utf8').replace(/\0+$/, '')
             : d.length === 1 ? d[0]
             : d.length === 2 ? d.readUInt16BE(0)
             : d.length === 4 ? d.readUInt32BE(0)
             : d.toString('hex');
    off += len;
  }
  return out;
}

// CONF_MQTT_SETTINGS tagged payload (p.752-754): [tag:2][len:2][data:len]
// repeated — tag FIRST, opposite byte order from decodeTagged() above (that
// one is [len][tag], confirmed against a different command's real bytes).
// Confirmed against a real READ from BOSCH_8000i (2026-09-28): tag1 "mqtt://
// 192.168.10.139", tag2 "cam-bosch-8000i", tag4 "BOSCH_8000i" — no trailing
// NUL on any field, so encode doesn't add one either.
const MQTT_TAGS = { address: 1, username: 2, password: 3, prefix: 4, filter: 5, qos: 6 };

// Builds the WRITE payload. Field order follows the tag numbers; qos (t_octet,
// 1 byte) only included if given. password (tag 3) is write-only per the spec
// page — it is never present in a READ reply, so decodeMqttSettings() below
// never emits it even if somehow echoed back.
// ponytail: only carries {address, username, password, prefix, qos} — the doc
// doesn't say whether a WRITE replaces the whole tag list or merges, and the
// one real camera probed has no tag 5 (topic filter) set. If a camera in the
// fleet ever sets a topic filter, add a `filter` param here and carry the
// current value forward (read-before-write) so this doesn't silently clear it.
function encodeMqttSettings({ address, username, password, prefix, qos } = {}) {
  const parts = [];
  const put = (tag, val) => {
    if (val === undefined || val === null) return;
    const data = typeof val === 'number' ? Buffer.from([val & 0xff]) : Buffer.from(String(val), 'utf8');
    const head = Buffer.alloc(4);
    head.writeUInt16BE(tag, 0);
    head.writeUInt16BE(data.length, 2);
    parts.push(head, data);
  };
  put(MQTT_TAGS.address, address);
  put(MQTT_TAGS.username, username);
  put(MQTT_TAGS.password, password);
  put(MQTT_TAGS.prefix, prefix);
  put(MQTT_TAGS.qos, qos);
  return Buffer.concat(parts);
}

// Decodes a READ reply. tag 3 (password) is skipped unconditionally — write-
// only per the spec page, and even if a firmware quirk ever echoed it back,
// this function must never be the place a secret leaks into a log or a
// dashboard response.
function decodeMqttSettings(buf) {
  const out = {};
  if (!buf) return out;
  let off = 0;
  while (off + 4 <= buf.length) {
    const tag = buf.readUInt16BE(off);
    const len = buf.readUInt16BE(off + 2);
    if (off + 4 + len > buf.length) break;
    const data = buf.slice(off + 4, off + 4 + len);
    off += 4 + len;
    if (tag === MQTT_TAGS.password) continue; // never decode — defense in depth
    if (tag === MQTT_TAGS.address)       out.address  = data.toString('utf8').replace(/\0+$/, '');
    else if (tag === MQTT_TAGS.username) out.username = data.toString('utf8').replace(/\0+$/, '');
    else if (tag === MQTT_TAGS.prefix)   out.prefix   = data.toString('utf8').replace(/\0+$/, '');
    else if (tag === MQTT_TAGS.filter)   out.filter   = data.toString('utf8').replace(/\0+$/, '');
    else if (tag === MQTT_TAGS.qos)      out.qos      = data.length ? data[0] : undefined;
  }
  return out;
}

// p.1056 — fixed header, then a variable iSCSI tail we don't use.
function decodeStorageReport(buf) {
  if (!buf || buf.length < 16) return null;
  return {
    medium_type:   buf[0],
    availability:  AVAILABILITY[buf[1]] ?? String(buf[1]),
    access:        ACCESS_TYPE[buf[2]] ?? null,
    io_error_type: buf[3],
    io_errors:     buf.readUInt32BE(4),
    read_kb:       buf.readUInt32BE(8),
    write_kb:      buf.readUInt32BE(12),
  };
}

// p.896-897 — camera, recording index, status, error, then the span block.
function decodeRecordingStatus(buf) {
  if (!buf || buf.length < 4) return null;
  return {
    camera:     buf[0],
    rec_index:  buf[1],
    status:     REC_STATUS[buf[2]] ?? String(buf[2]),
    error:      buf[3],
    // Datarate is documented only as "4 Bytes" with no unit (p.897). Kept raw
    // and deliberately NOT mapped to bitrate_kbps: rendering an unknown unit as
    // kbps would put a wrong number on an operator's screen.
    datarate_raw: buf.length >= 12 ? buf.readUInt32BE(8) : null,
  };
}

// CONF_VIPROC_RE_TASK_NAMES (0x0b2b, p.1242) — [algorithm:u16be][count:u16be]
// then `count` fixed 66-byte entries [id:u8][type:u8][name:64 bytes, UTF8,
// NUL-padded, not necessarily NUL-terminated]. The 64-byte cap is the whole
// reason this exists: a name that fills all 64 bytes was very likely cut
// mid-character by the camera's own storage (a Thai name in particular —
// Thai characters are 3 bytes in UTF-8 — see the DINION 5100i incident this
// probe was built for, RCP+ spec §2.785).
const TASK_NAME_ENTRY_BYTES = 66; // 1 id + 1 type + 64 name

function _trimTrailingNul(buf) {
  let end = buf.length;
  while (end > 0 && buf[end - 1] === 0) end--;
  return buf.slice(0, end);
}

// Priority matches the spec's own ordering when more than one applies to the
// same name (e.g. a truncated multi-byte name is both invalid UTF-8 AND at
// the 64-byte cap — 'bad_utf8' is the more actionable label so it wins).
// `+`/`#` and every C0 control byte (<0x20) are single-byte in UTF-8 and can
// never appear as part of a multi-byte sequence, so a raw byte scan is safe
// even before the UTF-8 validity check.
function taskNameProblem(nameBuf) {
  if (!nameBuf) return null;
  const trimmed = _trimTrailingNul(nameBuf);
  if (trimmed.length === 0) return null;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(trimmed);
  } catch {
    return 'bad_utf8';
  }
  if (trimmed.length >= 64) return 'at_limit'; // a full 64-byte name was almost certainly cut
  for (const b of trimmed) {
    if (b === 0x2b || b === 0x23) return 'wildcard';       // '+' or '#' — illegal in an MQTT topic segment
  }
  for (const b of trimmed) {
    if (b < 0x20) return 'control_char';
  }
  return null;
}

// Decodes every task-name entry in the buffer. Never throws — a truncated or
// empty buffer just yields fewer/no entries, same shape as decodeTagged.
function decodeTaskNames(buf) {
  const out = [];
  if (!buf || buf.length < 4) return out;
  const count = buf.readUInt16BE(2);
  let off = 4;
  for (let i = 0; i < count && off + TASK_NAME_ENTRY_BYTES <= buf.length; i++) {
    const id = buf[off];
    const type = buf[off + 1];
    const nameBuf = buf.slice(off + 2, off + TASK_NAME_ENTRY_BYTES);
    const trimmed = _trimTrailingNul(nameBuf);
    // Display name: fatal decode first (the common, well-formed case), falling
    // back to a lossy decode (U+FFFD replacement chars) only so a truncated
    // name still renders as SOMETHING in the UI instead of throwing.
    let name;
    try {
      name = new TextDecoder('utf-8', { fatal: true }).decode(trimmed);
    } catch {
      name = new TextDecoder('utf-8', { fatal: false }).decode(trimmed);
    }
    out.push({ id, type, name, bytes: trimmed.length, problem: taskNameProblem(nameBuf) });
    off += TASK_NAME_ENTRY_BYTES;
  }
  return out;
}

// Shape the probe results the way hikStorage.buildSdDetail does, so the same
// UI renderer handles both vendors. Pure — all I/O already done by the caller.
function buildBoschSdDetail({ cardPresent, life, report, loadPct, rec, retentionSec } = {}) {
  const blocks = life && life.num_blocks;
  const capacity_mb = blocks ? Math.round((blocks * 512) / 1048576) : null;
  // STORAGE_LOAD is a whole-device percentage and is not available on every
  // model (BOSCH_3100i answers 0x40 while BSH-HDY-4038 returns 4). Only derive
  // used/free when the camera actually gave us a number — a computed 0 would
  // draw an empty capacity bar that looks like fact.
  const used_mb = (capacity_mb != null && typeof loadPct === 'number')
    ? Math.round(capacity_mb * loadPct / 100) : null;
  const free_mb = (capacity_mb != null && used_mb != null) ? capacity_mb - used_mb : null;

  const card = cardPresent ? {
    id: '1',
    name: life && (life.prod_string || life.manf_name) ? [life.manf_name, life.prod_string].filter(Boolean).join(' ') : null,
    status: 'ok',
    capacity_mb, free_mb, used_mb,
    property: report ? report.access : null,
    // Bosch exposes neither a filesystem label nor an encryption flag through
    // these registers; null keeps the row hidden rather than asserting either.
    format_type: null, encryption: null, installed_at: null,
  } : null;

  const running = rec && rec.status === 'running';
  let state;
  if (!cardPresent) state = 'no_card';
  else if (rec && (rec.status === 'error' || rec.status === 'rec_src_error')) state = 'error';
  else if (report && report.availability === 'no') state = 'error';
  else if (running) state = 'recording';
  else if (rec) state = 'idle';           // card fine, camera simply not recording
  else state = 'ok';                      // card fine, recording state unreadable

  return {
    state,
    card,
    recording: rec ? {
      schedule_enabled: running,
      // codec/resolution/fps/bitrate come from a different command group that
      // this probe does not read yet, and the one number we do have (datarate)
      // has no documented unit. All null → recBoxHik omits the quality row
      // entirely instead of printing a half-truth.
      mode: null, loop: null, codec: null, resolution: null, fps: null,
      bitrate_kbps: null, days_if_enabled: null,
      bosch_status: rec.status,
      bosch_datarate_raw: rec.datarate_raw,
    } : null,
    // Left to the existing ONVIF GetRecordingSummary poll, which already fills
    // recording_data_from/until/count — duplicating it here would give the same
    // row two sources that can disagree.
    content: null,
    // Bosch reports consumed lifespan as a percentage, and only on cards that
    // support it (p.928 "only for supported cards"; neither Sandisk card in the
    // fleet does). Not the same quantity as Hikvision's rewrite count, so it
    // rides its own field rather than being forced into `wear`.
    wear: null,
    life_span_percent_done: (life && typeof life.life_span_percent_done === 'number')
      ? life.life_span_percent_done : null,
    storage: report,
    retention_sec: (typeof retentionSec === 'number' && retentionSec > 0) ? retentionSec : null,
    uploads: null,
    vendor: 'bosch',
  };
}

// ── transport ────────────────────────────────────────────────
// _rcpCall never logs `uri` or `payloadHex` — for a WRITE those carry the
// camera's MQTT password in the clear (RCP-over-CGI puts the payload in the
// query string, per spec §1.7). Every caller in this file must keep it that
// way: pull only .ok/.error/.buf/.num out of the result, never the request.

function _rcpCall(cam, { tag, type, num }, direction, payloadHex) {
  let uri = `/rcp.xml?command=${tag}&type=${type}&direction=${direction}&num=${num}`;
  if (payloadHex) uri += `&payload=${payloadHex}`;
  const opts = { hostname: cam.ip_address, port: cam.http_port || 80, path: uri, method: 'GET', timeout: 8000 };
  return new Promise((resolve) => {
    const go = (authHeader) => {
      const req = http.request(authHeader ? { ...opts, headers: { Authorization: authHeader } } : opts, (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
          if (res.statusCode === 401 && !authHeader) {
            const wa = res.headers['www-authenticate'];
            if (!wa || !/digest/i.test(wa)) return resolve({ ok: false, error: 'auth' });
            return go(buildDigestHeader(cam.username, cam.password, 'GET', uri, parseChallenge(wa)));
          }
          if (res.statusCode !== 200) return resolve({ ok: false, error: `HTTP ${res.statusCode}` });
          resolve(parseRcpXml(body));
        });
      });
      req.on('error', (e) => resolve({ ok: false, error: e.code || e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.end();
    };
    go(null);
  });
}

function rcpRead(cam, cmd, payloadHex) { return _rcpCall(cam, cmd, 'READ', payloadHex); }
function rcpWrite(cam, cmd, payloadHex) { return _rcpCall(cam, cmd, 'WRITE', payloadHex); }

// The camera answers 200 even for a rejected command — the failure is an <err>
// inside the result (0x40 = command not valid on this model). Treating HTTP 200
// as success is how a per-model capability gap would look like real data.
function parseRcpXml(xml) {
  const err = (xml.match(/<err>([^<]*)<\/err>/) || [])[1];
  if (err) return { ok: false, error: `rcp ${err}` };
  const hex = (xml.match(/<result>\s*<hex>([^<]*)/) || [])[1];
  const str = (xml.match(/<str>([\s\S]*?)<\/str>/) || [])[1];
  // an empty <str></str> is a valid empty payload (e.g. no MQTT settings yet),
  // not a missing result
  if (str !== undefined) return { ok: true, buf: Buffer.from(str.replace(/\s+/g, ''), 'hex') };
  if (hex) return { ok: true, num: parseInt(hex.replace(/^0x/, ''), 16) };
  return { ok: false, error: 'no result' };
}

// Probe one Bosch camera. Never throws; every command degrades on its own so a
// model that lacks one register still yields everything else.
async function boschSdProbe(cam) {
  if (!cam || !cam.ip_address) return { ok: false, error: 'no ip' };

  const st = await rcpRead(cam, CMD.SD_CARD_STATUS);
  if (!st.ok) return { ok: false, error: `sd status: ${st.error}` };
  const cardPresent = (st.num & 0x0001) === 1;

  const [lifeR, repR, loadR, retR] = await Promise.all([
    rcpRead(cam, CMD.SD_LIFE_SPAN_STATUS),
    rcpRead(cam, CMD.STORAGE_REPORT),
    rcpRead(cam, CMD.STORAGE_LOAD),
    rcpRead(cam, CMD.RECORDING_RETENTION),
  ]);

  // RECORDING_STATUS is the one command that needs a request payload:
  // camera index + recording index + 50 reserved bytes (p.896).
  const recPayload = '0x' + Buffer.concat([Buffer.from([1, 1]), Buffer.alloc(50)]).toString('hex');
  const recR = await rcpRead(cam, CMD.RECORDING_STATUS, recPayload);

  const detail = buildBoschSdDetail({
    cardPresent,
    life:   lifeR.ok ? decodeTagged(lifeR.buf) : null,
    report: repR.ok ? decodeStorageReport(repR.buf) : null,
    loadPct: loadR.ok ? loadR.num : null,
    rec:    recR.ok ? decodeRecordingStatus(recR.buf) : null,
    retentionSec: retR.ok ? retR.num : null,
  });

  return { ok: true, detail, checked_at: new Date().toISOString() };
}

// ── CONF_VIPROC_RE_TASK_NAMES (READ) ────────────────────────────
async function readTaskNames(cam) {
  if (!cam || !cam.ip_address) return { ok: false, error: 'no ip' };
  const r = await rcpRead(cam, CMD.RE_TASK_NAMES);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, tasks: decodeTaskNames(r.buf) };
}

// ── CONF_MQTT_SETTINGS (READ) ───────────────────────────────────
async function readMqttSettings(cam) {
  if (!cam || !cam.ip_address) return { ok: false, error: 'no ip' };
  const r = await rcpRead(cam, CMD.MQTT_SETTINGS);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, settings: decodeMqttSettings(r.buf) };
}

// ── CONF_MQTT_SETTINGS (WRITE) — the one write path in this file ───────────
// Writes, then reads the settings back and verifies address/username/prefix
// landed. Never returns or inspects the WRITE call's own parsed body — the
// CGI reply echoes the *request* in a <payload> section alongside the real
// <result> (spec §1.7 example), and our XML parser's <str> match is not
// anchored to <result>, so the write response could in principle hand back
// the very payload (containing the password) we just sent. Only `.ok`/
// `.error` from the write are used; the read-back is what actually proves
// the change took.
async function writeMqttSettings(cam, { address, username, password, prefix } = {}) {
  if (!cam || !cam.ip_address) return { ok: false, error: 'no ip' };
  const before = await readMqttSettings(cam);
  const payload = encodeMqttSettings({ address, username, password, prefix });
  const w = await rcpWrite(cam, CMD.MQTT_SETTINGS, '0x' + payload.toString('hex'));
  const beforeSettings = before.ok ? before.settings : null;
  if (!w.ok) return { ok: false, before: beforeSettings, error: `write: ${w.error}` };
  const after = await readMqttSettings(cam);
  if (!after.ok) return { ok: false, before: beforeSettings, error: `read-back: ${after.error}` };
  const matches = after.settings.address === address
    && after.settings.username === username
    && after.settings.prefix === prefix;
  if (!matches) return { ok: false, before: beforeSettings, after: after.settings, error: 'read-back mismatch' };
  return { ok: true, before: beforeSettings, after: after.settings };
}

// ── CONF_BOARD_RESET (WRITE-only flag, p.173) ──────────────────────────────
// The camera keeps using its OLD MQTT session credentials after a settings
// write until it reboots — verified on real cameras 2026-09-28
// (BH5100i_RMUTR-V_01/02): the new broker/user/pass were stored but the
// camera stayed connected under the old ones until power-cycled. A flag
// write can legitimately look identical to "camera dropped the connection
// while rebooting" (ECONNRESET/socket hang up/timeout) or to a body-less ack
// (parseRcpXml's 'no result') — none of those are failures here, so they all
// map to ok:true, with the transport-drop cases flagged unconfirmed since we
// genuinely can't tell "it rebooted" from "something else killed the socket".
async function rebootBosch(cam) {
  if (!cam || !cam.ip_address) return { ok: false, error: 'no ip' };
  const w = await rcpWrite(cam, CMD.BOARD_RESET, '0x1'); // flag payload form per rcpplusovercgi.pdf example (&payload=0x0)
  if (w.ok || w.error === 'no result') return { ok: true };
  if (w.error === 'ECONNRESET' || w.error === 'socket hang up' || w.error === 'timeout') {
    return { ok: true, unconfirmed: true, error: w.error };
  }
  return { ok: false, error: w.error };
}

// ── orchestration: what to write, resolved for this camera ─────────────────
// Shared by the central route (central-reachable cameras) and the edge
// config agent (edge-site cameras) — same decision either way: broker address
// from EDGE_CAMERA_BROKER_URL (read live, not cached — this file can be
// require()'d before an edge process's own dotenv call runs, see
// edge-config-agent.js:38-39) or, failing that, whatever address the camera
// already has; username/password from the camera's own provisioned MQTT
// credentials; topic prefix = camera_id. Reboots the camera after a
// successful write — see rebootBosch's comment above for why: the camera
// does not pick up the new credentials on its own.
async function pushMqttSettings(cam) {
  if (!cam) return { ok: false, error: 'no camera' };
  // Defense in depth: a plaintext mqtt_password should already be decrypted by
  // the caller (loadCameraConfig()/decryptCamCreds()) — but if CAMERA_SECRET_KEY
  // is missing/wrong, decryptCred() silently returns the ciphertext unchanged
  // (src/crypto-creds.js), and pushing "enc:v1:..." as the camera's password
  // would still read back matching address/username/prefix as ok:true.
  if (typeof cam.mqtt_password === 'string' && cam.mqtt_password.startsWith('enc:v1:')) {
    return { ok: false, error: 'mqtt_password ยังเป็นค่าเข้ารหัส (ถอดรหัสไม่สำเร็จ) — ตรวจ CAMERA_SECRET_KEY' };
  }
  if (!cam.mqtt_username || !cam.mqtt_password) {
    return { ok: false, error: 'กล้องยังไม่มี mqtt_username/mqtt_password — provision ก่อน' };
  }
  const env = require('../config'); // required lazily — see comment above
  let address = env.str('EDGE_CAMERA_BROKER_URL');
  if (!address) {
    const cur = await readMqttSettings(cam);
    address = cur.ok ? cur.settings.address : null;
  }
  if (!address) return { ok: false, error: 'ยังไม่ได้ตั้ง EDGE_CAMERA_BROKER_URL' };
  const prefix = cam.camera_id || cam.id;
  const result = await writeMqttSettings(cam, { address, username: cam.mqtt_username, password: cam.mqtt_password, prefix });
  if (!result.ok) return result;
  const reboot = await rebootBosch(cam);
  const out = { ...result, reboot };
  if (reboot.ok) out.rebooted_at = new Date().toISOString();
  return out;
}

module.exports = {
  boschSdProbe, buildBoschSdDetail,
  decodeTagged, decodeStorageReport, decodeRecordingStatus, parseRcpXml,
  encodeMqttSettings, decodeMqttSettings, readMqttSettings, writeMqttSettings, pushMqttSettings,
  rebootBosch,
  decodeTaskNames, taskNameProblem, readTaskNames,
  CMD,
};
