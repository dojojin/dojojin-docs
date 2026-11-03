// ============================================================
// Vigil Platform — Tests: Bosch RCP+ over CGI decoders
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
// Fixtures are REAL bytes captured from production cameras during the BS0
// probe (2026-08-05), not hand-written: BOSCH_3100i at vss and BSH-HDY-4038
// at hdy. That matters here — the whole reason this decoder exists is that the
// document's table of contents lists page numbers rather than tag codes and
// one card reports fields another omits, so a synthetic fixture would encode
// my reading of the spec instead of what the cameras actually send.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { EventEmitter } = require('events');
const {
  decodeTagged, decodeStorageReport, decodeRecordingStatus,
  parseRcpXml, buildBoschSdDetail,
  encodeMqttSettings, decodeMqttSettings, writeMqttSettings, pushMqttSettings,
  rebootBosch,
  decodeTaskNames, taskNameProblem, readTaskNames,
} = require('../src/helpers/boschRcp');
const { validVcaRuleIssues } = require('../src/helpers/vcaRuleIssues');

// CONF_SD_CARD_LIFE_SPAN_STATUS (0x0c5a) — 49 bytes verbatim from BOSCH_3100i,
// one [len:2][tag:2][data] record per line.
const LIFE_3100I = Buffer.from([
  '0005', '0001', '03',                       // MANF_ID = 3
  '0006', '0002', '5344',                     // PROD_ID = "SD"
  '000a', '0003', '534e32353600',             // PROD_STRING = "SN256"
  '0008', '0007', '42a1ce8b',                 // SERIAL_NO
  '0008', '0004', '1dc98000',                 // NUM_BLOCKS = 499,712,000
  '000c', '0006', '53616e6469736b00',         // MANF_NAME = "Sandisk"
].join(''), 'hex');

// CONF_STORAGE_REPORT (0x09cf) — verbatim from BSH-HDY-4038: SD, available,
// read-write, no IO errors, 0 KB read / ~0.9 GB written.
const REPORT_HDY = Buffer.from('0b020200' + '00000000' + '00000000' + '000e1e00', 'hex');

describe('Bosch RCP+ decoders', () => {
  it('decodes the real 0x0c5a lifespan payload from BOSCH_3100i', () => {
    const d = decodeTagged(LIFE_3100I);
    assert.equal(d.manf_name, 'Sandisk');
    assert.equal(d.prod_string, 'SN256');
    assert.equal(d.num_blocks, 0x1dc98000);
    // 499,712,000 blocks x 512 B = ~256 GB, matching the card the owner fitted.
    assert.ok(Math.abs((d.num_blocks * 512) / 1e9 - 255.9) < 0.5);
    assert.equal(d.serial_no, 0x42a1ce8b);
    // Neither Sandisk card in the fleet reports consumed lifespan — the doc
    // says "only for supported cards". Absent, not zero: a 0 would render as
    // "0% worn", which is a claim we cannot make.
    assert.equal(d.life_span_percent_done, undefined);
  });

  it('stops cleanly on a truncated tagged payload instead of looping', () => {
    assert.deepEqual(decodeTagged(Buffer.from('0005000103000600', 'hex')), { manf_id: 3 });
    assert.deepEqual(decodeTagged(Buffer.alloc(0)), {});
    assert.deepEqual(decodeTagged(null), {});
  });

  it('decodes the real 0x09cf storage report from BSH-HDY-4038', () => {
    const r = decodeStorageReport(REPORT_HDY);
    assert.equal(r.availability, 'yes');
    assert.equal(r.access, 'RW');
    assert.equal(r.io_errors, 0);
    assert.equal(r.write_kb, 0x000e1e00);
  });

  it('decodes recording status, and keeps datarate raw (unit undocumented)', () => {
    // camera 1, primary, RUNNING, no error, then flags+reserved, then datarate.
    const buf = Buffer.concat([Buffer.from([1, 1, 4, 0]), Buffer.alloc(4), Buffer.from('000100b6', 'hex')]);
    const r = decodeRecordingStatus(buf);
    assert.equal(r.status, 'running');
    assert.equal(r.error, 0);
    assert.equal(r.datarate_raw, 0x000100b6);
  });

  it('treats an <err> body as failure even though the camera answered HTTP 200', () => {
    // A model that lacks a register still replies 200 — 0x40 is "command not
    // valid here" (BOSCH_3100i does exactly this for STORAGE_LOAD). Reading it
    // as success is how a capability gap turns into fabricated data.
    assert.deepEqual(parseRcpXml('<rcp><result><err>0x40</err></result></rcp>'),
      { ok: false, error: 'rcp 0x40' });
    assert.equal(parseRcpXml('<rcp><result><hex>0x0001</hex></result></rcp>').num, 1);
    const empty = parseRcpXml('<rcp><result><str></str></result></rcp>');
    assert.equal(empty.ok, true); assert.equal(empty.buf.length, 0);
    const blank = parseRcpXml('<rcp><result><str> </str></result></rcp>');
    assert.equal(blank.ok, true); assert.equal(blank.buf.length, 0);
  });

  it('omits used/free capacity when the camera cannot report load', () => {
    // BOSCH_3100i: capacity known, STORAGE_LOAD unavailable. used_mb must stay
    // null so the panel draws no capacity bar, rather than an empty one.
    const d = buildBoschSdDetail({
      cardPresent: true, life: { num_blocks: 0x1dc98000, manf_name: 'Sandisk', prod_string: 'SN256' },
      report: { access: 'RW', availability: 'yes' }, loadPct: null,
      rec: { status: 'running' }, retentionSec: 86400,
    });
    assert.ok(d.card.capacity_mb > 200000);
    assert.equal(d.card.used_mb, null);
    assert.equal(d.card.free_mb, null);
    assert.equal(d.state, 'recording');
    assert.equal(d.recording.schedule_enabled, true);
    // Unit-less datarate must not reach the quality row.
    assert.equal(d.recording.bitrate_kbps, null);
    assert.equal(d.retention_sec, 86400);
  });

  it('derives used/free when load IS reported (BSH-HDY-4038 path)', () => {
    const d = buildBoschSdDetail({
      cardPresent: true, life: { num_blocks: 0x07730000 }, report: { access: 'RW', availability: 'yes' },
      loadPct: 4, rec: { status: 'running' },
    });
    assert.equal(d.card.used_mb, Math.round(d.card.capacity_mb * 0.04));
    assert.equal(d.card.free_mb, d.card.capacity_mb - d.card.used_mb);
  });

  it('maps state: no card, error, and not-recording', () => {
    assert.equal(buildBoschSdDetail({ cardPresent: false }).state, 'no_card');
    assert.equal(buildBoschSdDetail({ cardPresent: false }).card, null);
    assert.equal(buildBoschSdDetail({ cardPresent: true, rec: { status: 'error' } }).state, 'error');
    assert.equal(buildBoschSdDetail({ cardPresent: true, rec: { status: 'offline' } }).state, 'idle');
    // Card fine but recording state unreadable — 'ok', not a fault.
    assert.equal(buildBoschSdDetail({ cardPresent: true, rec: null }).state, 'ok');
  });
});

// ── CONF_MQTT_SETTINGS (push-MQTT-into-camera, Mosquitto migration B1) ─────
// Golden fixture: real READ from BOSCH_8000i (2026-09-28 probe, see the
// mosquitto-migration-plan doc). Bytes are [tag:2][len:2][data] repeated, tag
// FIRST (opposite order from decodeTagged's fixture above) — tag1 address,
// tag2 username, tag4 prefix, no tag5/6. Built here from the documented
// strings/tag order (not hand-transcribed hex) so a hex-arithmetic slip can't
// silently make the "golden" fixture wrong.
function tlv(tag, str) {
  const data = Buffer.from(str, 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt16BE(tag, 0);
  head.writeUInt16BE(data.length, 2);
  return Buffer.concat([head, data]);
}
const MQTT_FIXTURE = Buffer.concat([
  tlv(1, 'mqtt://192.168.10.139'),
  tlv(2, 'cam-bosch-8000i'),
  tlv(4, 'BOSCH_8000i'),
]);

describe('CONF_MQTT_SETTINGS decode/encode (0x0d0a)', () => {
  it('decodes the real BOSCH_8000i fixture', () => {
    assert.deepEqual(decodeMqttSettings(MQTT_FIXTURE), {
      address: 'mqtt://192.168.10.139', username: 'cam-bosch-8000i', prefix: 'BOSCH_8000i',
    });
  });

  it('round-trips encode → decode', () => {
    const buf = encodeMqttSettings({ address: 'mqtt://10.0.10.5', username: 'cam-x', prefix: 'CAM-X', qos: 1 });
    assert.deepEqual(decodeMqttSettings(buf), { address: 'mqtt://10.0.10.5', username: 'cam-x', prefix: 'CAM-X', qos: 1 });
  });

  it('never decodes tag 3 (password) even if present in the bytes', () => {
    const buf = Buffer.concat([tlv(1, 'mqtt://x'), tlv(3, 'hunter2'), tlv(2, 'u')]);
    const out = decodeMqttSettings(buf);
    assert.ok(!('password' in out), 'password must never appear in a decoded result');
    assert.equal(out.address, 'mqtt://x');
    assert.equal(out.username, 'u');
  });

  it('trims a trailing NUL the same way decodeTagged does', () => {
    const data = Buffer.concat([Buffer.from('BOSCH_8000i', 'utf8'), Buffer.from([0])]);
    const head = Buffer.alloc(4); head.writeUInt16BE(4, 0); head.writeUInt16BE(data.length, 2);
    assert.equal(decodeMqttSettings(Buffer.concat([head, data])).prefix, 'BOSCH_8000i');
  });

  it('stops cleanly on a truncated payload instead of throwing', () => {
    assert.deepEqual(decodeMqttSettings(Buffer.from([0, 1, 0, 99])), {});
    assert.deepEqual(decodeMqttSettings(null), {});
  });
});

// ── writeMqttSettings / pushMqttSettings — mocked transport ────────────────
// http.request is mocked at the module level (boschRcp.js and this file share
// the same core 'http' singleton) so no real network call, camera, or broker
// is ever touched. Each response is served from a queue in call order:
// writeMqttSettings always does before-read → write → after-read (3 calls);
// pushMqttSettings adds one more up front only when it needs the fallback
// read for the broker address.
function xmlOctet(buf) { return `<rcp><result><str>${buf.toString('hex')}</str></result></rcp>`; }
function xmlErr(code)  { return `<rcp><result><err>${code}</err></result></rcp>`; }
// A generic non-empty WRITE ack (verified fact: the real camera's write reply
// parsed ok:true — exact bytes unverified, so this uses <hex>, matching other
// RCP+ acks in this doc rather than guessing at octet content). NOT xmlOctet
// with an empty buffer — parseRcpXml's <str> match treats "" as falsy and
// reports {ok:false,error:'no result'}, which would misrepresent a real empty-
// octet ack as a failure; this sidesteps that instead of relying on it.
function xmlAck() { return '<rcp><result><hex>0x00</hex></result></rcp>'; }

function mockRcpQueue(t, bodies) {
  let i = 0;
  t.mock.method(http, 'request', (opts, cb) => {
    const body = bodies[i] !== undefined ? bodies[i] : xmlErr('0x40');
    i += 1;
    const req = new EventEmitter();
    req.end = () => {
      setImmediate(() => {
        const res = new EventEmitter();
        res.statusCode = 200;
        res.headers = {};
        cb(res);
        setImmediate(() => { res.emit('data', Buffer.from(body)); res.emit('end'); });
      });
    };
    return req;
  });
  return () => i; // call counter, for assertions
}

const CAM = { ip_address: '127.0.0.1', http_port: 80, camera_id: 'BOSCH_8000i' };
const NEW_SETTINGS = { address: 'mqtt://192.168.10.5:1883', username: 'cam-bosch-8000i', password: 'S3cr3tPass!1', prefix: 'BOSCH_8000i' };

describe('writeMqttSettings — write then verify by reading back', () => {
  it('success: write ok, read-back matches what was requested', async (t) => {
    const after = encodeMqttSettings(NEW_SETTINGS);
    mockRcpQueue(t, [xmlOctet(MQTT_FIXTURE), xmlAck(), xmlOctet(after)]);
    const r = await writeMqttSettings(CAM, NEW_SETTINGS);
    assert.equal(r.ok, true);
    assert.equal(r.before.address, 'mqtt://192.168.10.139'); // the "before" read
    assert.equal(r.after.address, NEW_SETTINGS.address);
    assert.equal(r.after.username, NEW_SETTINGS.username);
    assert.ok(!('password' in r.after), 'password must never appear in the result');
  });

  it('camera rejects the write (<err>) — reports failure, never fabricates an after', async (t) => {
    mockRcpQueue(t, [xmlOctet(MQTT_FIXTURE), xmlErr('0x40')]);
    const r = await writeMqttSettings(CAM, NEW_SETTINGS);
    assert.equal(r.ok, false);
    assert.match(r.error, /write:.*rcp 0x40/);
    assert.equal(r.before.address, 'mqtt://192.168.10.139');
    assert.equal(r.after, undefined);
  });

  it('write reports ok but the read-back does not match — flagged, not trusted blindly', async (t) => {
    // Camera answers ok to the write, but a read-back shows the OLD address —
    // e.g. it silently ignored an unsupported field. Must not be reported ok.
    mockRcpQueue(t, [xmlOctet(MQTT_FIXTURE), xmlAck(), xmlOctet(MQTT_FIXTURE)]);
    const r = await writeMqttSettings(CAM, NEW_SETTINGS);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'read-back mismatch');
    assert.equal(r.after.address, 'mqtt://192.168.10.139'); // unchanged — proves it didn't trust the write ack alone
  });

  it('never reads the WRITE call\'s own body — an echoed request could contain the password', async (t) => {
    // The write "succeeds" but its own response body decodes to something
    // OTHER than what was actually written (worst case per RCP-over-CGI §1.7:
    // <payload> can echo the request, which for our WRITE contains the
    // password) — deliberately distinguishable from the real read-back so
    // this test would fail if writeMqttSettings ever used w.buf as `after`
    // instead of making its own read-back call.
    const echoedRequest = xmlOctet(encodeMqttSettings({ address: 'mqtt://LEAK-IF-USED', username: 'leak-user', prefix: 'LEAK-PREFIX' }));
    mockRcpQueue(t, [xmlOctet(MQTT_FIXTURE), echoedRequest, xmlOctet(encodeMqttSettings(NEW_SETTINGS))]);
    const r = await writeMqttSettings(CAM, NEW_SETTINGS);
    assert.equal(r.ok, true);
    assert.equal(r.after.address, NEW_SETTINGS.address, 'after must come from the 3rd call (read-back), not the 2nd (write ack)');
    assert.ok(!('password' in r.after));
  });
});

// ── CONF_BOARD_RESET (0x0811) — rebootBosch ─────────────────────────────────
describe('rebootBosch — CONF_BOARD_RESET write, mapped for "camera may drop mid-reply"', () => {
  it('normal write ack -> ok', async (t) => {
    mockRcpQueue(t, [xmlAck()]);
    const r = await rebootBosch(CAM);
    assert.deepEqual(r, { ok: true });
  });

  it("body-less reply ('no result') -> ok, not a failure (a bare flag write may not echo anything)", async (t) => {
    mockRcpQueue(t, ['<rcp><result></result></rcp>']);
    const r = await rebootBosch(CAM);
    assert.deepEqual(r, { ok: true });
  });

  it('camera rejects the command (<err>) -> ok:false', async (t) => {
    mockRcpQueue(t, [xmlErr('0x40')]);
    const r = await rebootBosch(CAM);
    assert.equal(r.ok, false);
    assert.match(r.error, /rcp 0x40/);
  });

  it('no ip -> ok:false without any network call', async (t) => {
    const calls = mockRcpQueue(t, []);
    const r = await rebootBosch({});
    assert.deepEqual(r, { ok: false, error: 'no ip' });
    assert.equal(calls(), 0);
  });

  for (const code of ['ECONNRESET', 'socket hang up', 'timeout']) {
    it(`transport drop mid-reboot (${code}) -> ok:true, unconfirmed:true — camera going down looks identical to a network hiccup`, async (t) => {
      t.mock.method(http, 'request', () => {
        const req = new EventEmitter();
        req.destroy = () => {};
        req.end = () => {
          setImmediate(() => {
            if (code === 'timeout') { req.emit('timeout'); return; }
            const err = new Error(code);
            if (code === 'ECONNRESET') err.code = code;
            req.emit('error', err);
          });
        };
        return req;
      });
      const r = await rebootBosch(CAM);
      assert.equal(r.ok, true);
      assert.equal(r.unconfirmed, true);
      assert.equal(r.error, code);
    });
  }
});

describe('pushMqttSettings — resolves what to write, then delegates to writeMqttSettings', () => {
  function withEnv(name, value, fn) {
    const prev = process.env[name];
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
    return Promise.resolve().then(fn).finally(() => {
      if (prev === undefined) delete process.env[name]; else process.env[name] = prev;
    });
  }

  it('refuses when the camera has no mqtt_username/mqtt_password — never touches the network', async (t) => {
    const calls = mockRcpQueue(t, []);
    const r = await pushMqttSettings({ ...CAM });
    assert.equal(r.ok, false);
    assert.match(r.error, /provision/);
    assert.equal(calls(), 0, 'must not make any RCP call without credentials');
  });

  it('refuses when mqtt_password is still ciphertext (CAMERA_SECRET_KEY missing/wrong)', async (t) => {
    const calls = mockRcpQueue(t, []);
    const r = await pushMqttSettings({ ...CAM, mqtt_username: 'cam-bosch-8000i', mqtt_password: 'enc:v1:deadbeef' });
    assert.equal(r.ok, false);
    assert.match(r.error, /เข้ารหัส/);
    assert.equal(calls(), 0);
  });

  it('uses EDGE_CAMERA_BROKER_URL when set, without an extra fallback read', async (t) => {
    await withEnv('EDGE_CAMERA_BROKER_URL', 'mqtt://10.0.10.9:1883', async () => {
      const after = encodeMqttSettings({ address: 'mqtt://10.0.10.9:1883', username: 'cam-bosch-8000i', prefix: 'BOSCH_8000i' });
      // writeMqttSettings's own 3 calls (before-read, write, after-read) + the
      // reboot write — no extra call for an address fallback that was never needed.
      const calls = mockRcpQueue(t, [xmlOctet(MQTT_FIXTURE), xmlAck(), xmlOctet(after), xmlAck()]);
      const r = await pushMqttSettings({ ...CAM, mqtt_username: 'cam-bosch-8000i', mqtt_password: 'S3cr3tPass!1' });
      assert.equal(r.ok, true);
      assert.equal(r.after.address, 'mqtt://10.0.10.9:1883');
      assert.equal(r.reboot.ok, true);
      assert.ok(r.rebooted_at);
      assert.equal(calls(), 4);
    });
  });

  it('falls back to the camera\'s current broker address when EDGE_CAMERA_BROKER_URL is unset', async (t) => {
    await withEnv('EDGE_CAMERA_BROKER_URL', undefined, async () => {
      const after = encodeMqttSettings({ address: 'mqtt://192.168.10.139', username: 'cam-bosch-8000i', prefix: 'BOSCH_8000i' });
      // 1) fallback read  2) write's own before-read  3) write  4) write's after-read
      mockRcpQueue(t, [xmlOctet(MQTT_FIXTURE), xmlOctet(MQTT_FIXTURE), xmlAck(), xmlOctet(after)]);
      const r = await pushMqttSettings({ ...CAM, mqtt_username: 'cam-bosch-8000i', mqtt_password: 'S3cr3tPass!1' });
      assert.equal(r.ok, true);
      assert.equal(r.after.address, 'mqtt://192.168.10.139');
    });
  });

  it('refuses when there is no env address and the camera reports none either', async (t) => {
    await withEnv('EDGE_CAMERA_BROKER_URL', undefined, async () => {
      mockRcpQueue(t, [xmlOctet(Buffer.alloc(0))]); // fallback read — no tag1 in reply
      const r = await pushMqttSettings({ ...CAM, mqtt_username: 'cam-bosch-8000i', mqtt_password: 'S3cr3tPass!1' });
      assert.equal(r.ok, false);
      assert.match(r.error, /EDGE_CAMERA_BROKER_URL/);
    });
  });

  it('does not reboot when the write fails — no reboot call, no reboot field', async (t) => {
    await withEnv('EDGE_CAMERA_BROKER_URL', 'mqtt://10.0.10.9:1883', async () => {
      // before-read, then the write itself is rejected — writeMqttSettings
      // returns before the after-read, so only 2 calls total should happen.
      const calls = mockRcpQueue(t, [xmlOctet(MQTT_FIXTURE), xmlErr('0x40')]);
      const r = await pushMqttSettings({ ...CAM, mqtt_username: 'cam-bosch-8000i', mqtt_password: 'S3cr3tPass!1' });
      assert.equal(r.ok, false);
      assert.equal(r.reboot, undefined);
      assert.equal(r.rebooted_at, undefined);
      assert.equal(calls(), 2, 'must not make a 3rd (reboot) call after a failed write');
    });
  });

  it('write succeeds but the reboot itself fails — overall ok stays true, but no rebooted_at', async (t) => {
    await withEnv('EDGE_CAMERA_BROKER_URL', 'mqtt://10.0.10.9:1883', async () => {
      const after = encodeMqttSettings({ address: 'mqtt://10.0.10.9:1883', username: 'cam-bosch-8000i', prefix: 'BOSCH_8000i' });
      mockRcpQueue(t, [xmlOctet(MQTT_FIXTURE), xmlAck(), xmlOctet(after), xmlErr('0x40')]);
      const r = await pushMqttSettings({ ...CAM, mqtt_username: 'cam-bosch-8000i', mqtt_password: 'S3cr3tPass!1' });
      assert.equal(r.ok, true);
      assert.equal(r.reboot.ok, false);
      assert.equal(r.rebooted_at, undefined);
    });
  });
});

describe('password never leaks — across every writeMqttSettings outcome', () => {
  const PW = 'S3cr3tPass!1';
  const PW_HEX = Buffer.from(PW, 'utf8').toString('hex');

  // Checks the plaintext, its hex encoding, AND a raw Buffer serialized by
  // JSON.stringify (which node renders as {"type":"Buffer","data":[…]} — a
  // decimal byte array containing neither the plaintext nor its hex form, so
  // it would slip past a check for PW/PW_HEX alone).
  function assertNoLeak(dump) {
    assert.ok(!dump.includes(PW), 'plaintext password must not appear');
    assert.ok(!dump.includes(PW_HEX), 'hex-encoded password must not appear');
    assert.ok(!dump.includes('"type":"Buffer"'), 'a raw Buffer must never be serialized into the result');
  }

  async function runAndCapture(t, bodies) {
    mockRcpQueue(t, bodies);
    const logs = [];
    const spy = (...args) => logs.push(args.map(String).join(' '));
    t.mock.method(console, 'log', spy);
    t.mock.method(console, 'warn', spy);
    t.mock.method(console, 'error', spy);
    const r = await writeMqttSettings(CAM, { ...NEW_SETTINGS, password: PW });
    return { r, logs };
  }

  it('success path', async (t) => {
    const after = encodeMqttSettings({ ...NEW_SETTINGS, password: undefined });
    const { r, logs } = await runAndCapture(t, [xmlOctet(MQTT_FIXTURE), xmlAck(), xmlOctet(after)]);
    const dump = JSON.stringify(r) + logs.join('\n');
    assertNoLeak(dump);
  });

  it('camera-error path', async (t) => {
    const { r, logs } = await runAndCapture(t, [xmlOctet(MQTT_FIXTURE), xmlErr('0x40')]);
    const dump = JSON.stringify(r) + logs.join('\n');
    assertNoLeak(dump);
  });

  it('read-back-mismatch path', async (t) => {
    const { r, logs } = await runAndCapture(t, [xmlOctet(MQTT_FIXTURE), xmlAck(), xmlOctet(MQTT_FIXTURE)]);
    const dump = JSON.stringify(r) + logs.join('\n');
    assertNoLeak(dump);
  });

  it('transport-error path (connection refused mid-write)', async (t) => {
    let i = 0;
    t.mock.method(http, 'request', (opts, cb) => {
      const call = i++;
      const req = new EventEmitter();
      req.end = () => {
        setImmediate(() => {
          if (call === 1) { req.emit('error', new Error('ECONNREFUSED')); return; } // the WRITE call itself
          const res = new EventEmitter();
          res.statusCode = 200; res.headers = {};
          cb(res);
          setImmediate(() => { res.emit('data', Buffer.from(xmlOctet(MQTT_FIXTURE))); res.emit('end'); });
        });
      };
      return req;
    });
    const logs = [];
    const spy = (...args) => logs.push(args.map(String).join(' '));
    t.mock.method(console, 'log', spy); t.mock.method(console, 'warn', spy); t.mock.method(console, 'error', spy);
    const r = await writeMqttSettings(CAM, { ...NEW_SETTINGS, password: PW });
    assert.equal(r.ok, false);
    const dump = JSON.stringify(r) + logs.join('\n');
    assertNoLeak(dump);
  });
});

// ── CONF_VIPROC_RE_TASK_NAMES (0x0b2b) — rule-name limit check ─────────────
// The incident this exists for: DINION 5100i (172.29.51.53) had a Thai rule
// name Bosch cut mid-character at its 64-byte cap, which made the MQTT topic
// invalid UTF-8 and NanoMQ silently dropped every PUBLISH on it for 60 days.
function taskNameEntry(id, type, nameBuf) {
  const padded = Buffer.concat([nameBuf, Buffer.alloc(64 - nameBuf.length)]);
  return Buffer.concat([Buffer.from([id, type]), padded]);
}
function taskNamesBuffer(entries) {
  const header = Buffer.alloc(4);
  header.writeUInt16BE(entries.length, 2);
  return Buffer.concat([header, ...entries]);
}
// 'ก' (U+0E01) is 3 bytes (e0 b8 81) in UTF-8. 21 whole chars = 63 bytes, then
// one more lead byte (e0) with no continuation bytes — exactly 64 bytes,
// guaranteed cut mid-character rather than relying on a real name happening
// to land there.
const KAW = Buffer.from('ก', 'utf8');
const THAI_CUT_64 = Buffer.concat([...Array(21).fill(KAW), Buffer.from([KAW[0]])]);
const ASCII_AT_LIMIT = Buffer.from('A'.repeat(64), 'utf8');
const NAME_WITH_HASH = Buffer.from('Zone#1', 'utf8');
const THAI_OK = Buffer.from('ตรวจจับวัตถุ', 'utf8');

describe('taskNameProblem', () => {
  it('a Thai name cut mid-character at the 64-byte cap → bad_utf8', () => {
    assert.equal(taskNameProblem(THAI_CUT_64), 'bad_utf8');
  });

  it('a full 64-byte ASCII name (valid UTF-8, no wildcard/control) → at_limit', () => {
    assert.equal(taskNameProblem(ASCII_AT_LIMIT), 'at_limit');
  });

  it('a name containing # → wildcard (illegal in an MQTT topic segment)', () => {
    const buf = Buffer.concat([NAME_WITH_HASH, Buffer.alloc(64 - NAME_WITH_HASH.length)]);
    assert.equal(taskNameProblem(buf), 'wildcard');
  });

  it('a name containing a control character → control_char', () => {
    const withCtrl = Buffer.from('Zone\x07', 'utf8');
    const buf = Buffer.concat([withCtrl, Buffer.alloc(64 - withCtrl.length)]);
    assert.equal(taskNameProblem(buf), 'control_char');
  });

  it('a normal, well-formed Thai name → no problem', () => {
    const buf = Buffer.concat([THAI_OK, Buffer.alloc(64 - THAI_OK.length)]);
    assert.equal(taskNameProblem(buf), null);
  });

  it('an unused (all-NUL) slot → no problem, not "empty control char"', () => {
    assert.equal(taskNameProblem(Buffer.alloc(64)), null);
  });

  it('null/undefined input never throws', () => {
    assert.equal(taskNameProblem(null), null);
    assert.equal(taskNameProblem(undefined), null);
  });
});

describe('decodeTaskNames', () => {
  it('decodes a 4-entry buffer end to end, matching each entry to its problem', () => {
    const buf = taskNamesBuffer([
      taskNameEntry(1, 15, THAI_CUT_64),
      taskNameEntry(2, 15, ASCII_AT_LIMIT),
      taskNameEntry(3, 2, NAME_WITH_HASH),
      taskNameEntry(4, 2, THAI_OK),
    ]);
    const tasks = decodeTaskNames(buf);
    assert.equal(tasks.length, 4);
    assert.equal(tasks[0].id, 1); assert.equal(tasks[0].problem, 'bad_utf8'); assert.equal(tasks[0].bytes, 64);
    assert.equal(tasks[1].id, 2); assert.equal(tasks[1].problem, 'at_limit'); assert.equal(tasks[1].name, 'A'.repeat(64));
    assert.equal(tasks[2].id, 3); assert.equal(tasks[2].problem, 'wildcard'); assert.equal(tasks[2].name, 'Zone#1');
    assert.equal(tasks[3].id, 4); assert.equal(tasks[3].problem, null);
    assert.equal(tasks[3].name, 'ตรวจจับวัตถุ');
    assert.equal(tasks[3].bytes, Buffer.byteLength('ตรวจจับวัตถุ', 'utf8'));
  });

  it('stops cleanly on a missing/truncated buffer instead of throwing', () => {
    assert.deepEqual(decodeTaskNames(null), []);
    assert.deepEqual(decodeTaskNames(Buffer.alloc(0)), []);
    assert.deepEqual(decodeTaskNames(Buffer.alloc(3)), []); // shorter than the 4-byte header
    const shortHeader = Buffer.alloc(4);
    shortHeader.writeUInt16BE(1, 2); // count=1, but not enough bytes follow for one 66-byte entry
    assert.deepEqual(decodeTaskNames(Buffer.concat([shortHeader, Buffer.alloc(10)])), []);
  });
});

describe('readTaskNames — transport wrapper (mocked RCP+)', () => {
  it('reads and decodes in one call', async (t) => {
    const buf = taskNamesBuffer([taskNameEntry(1, 15, THAI_OK)]);
    mockRcpQueue(t, [xmlOctet(buf)]);
    const r = await readTaskNames(CAM);
    assert.equal(r.ok, true);
    assert.equal(r.tasks.length, 1);
    assert.equal(r.tasks[0].problem, null);
  });

  it('camera rejects the command (<err>) → ok:false, never throws', async (t) => {
    mockRcpQueue(t, [xmlErr('0x40')]);
    const r = await readTaskNames(CAM);
    assert.equal(r.ok, false);
  });

  it('no ip → ok:false without any network call', async (t) => {
    const calls = mockRcpQueue(t, []);
    const r = await readTaskNames({});
    assert.deepEqual(r, { ok: false, error: 'no ip' });
    assert.equal(calls(), 0);
  });
});

// ── helpers/vcaRuleIssues.js — payload validation for Device/vca-rules ─────
describe('validVcaRuleIssues — payload arrives from outside the process, re-validated before a query', () => {
  it('keeps only well-shaped entries, drops the rest', () => {
    const out = validVcaRuleIssues([
      { id: 1, type: 15, name: 'ok', problem: 'at_limit' },
      { id: 'not-a-number', type: 15, name: 'x', problem: 'at_limit' }, // bad id type
      { id: 2, type: 15, name: 'x', problem: 'not-a-real-problem' },   // bad problem value
      { id: 3, type: 15, name: 123, problem: 'wildcard' },              // bad name type
      null,
      'garbage',
    ]);
    assert.deepEqual(out, [{ id: 1, type: 15, name: 'ok', problem: 'at_limit' }]);
  });

  it('non-array input yields an empty array, never throws', () => {
    assert.deepEqual(validVcaRuleIssues(null), []);
    assert.deepEqual(validVcaRuleIssues(undefined), []);
    assert.deepEqual(validVcaRuleIssues('x'), []);
    assert.deepEqual(validVcaRuleIssues({}), []);
  });

  it('rejects an oversized name (payload-inflation guard)', () => {
    const out = validVcaRuleIssues([{ id: 1, type: 1, name: 'x'.repeat(201), problem: 'at_limit' }]);
    assert.deepEqual(out, []);
  });
});
