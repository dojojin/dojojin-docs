// ============================================================
// Vigil Platform — Helper: Hikvision httpHost XML (parse / retarget / slice)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Pure string work on /ISAPI/Event/notification/httpHosts documents, split out
// of lpr-receiver.js so it carries its own self-check (`node src/helpers/
// httpHostXml.js`) — the server module can't host one, requiring it boots a
// listener and a DB pool.
//
// Why regex and not a parser: every other Hikvision XML read in this codebase
// (alarm-server-status, hikvision-isapi, model-detect) does the same, the
// documents are flat, and adding a dependency for four tags is not worth it.
// ============================================================
'use strict';

// The opening tag of ONE notification — and deliberately not the list wrapper.
// `HttpHostNotification` is a prefix of `HttpHostNotificationList`, so the
// obvious `<HttpHostNotification[^>]*>` also matches
// `<HttpHostNotificationList version="2.0" ...>` and silently operates on the
// wrapper instead of the first entry. That shipped once and produced a document
// with two opening tags, which the camera rejected with "Invalid XML Content"
// (statusCode 6). Requiring either `>` immediately or whitespace before any
// attribute is what separates the two names.
const OPEN_TAG = String.raw`<HttpHostNotification(?:\s[^>]*)?>`;
const OPEN_TAG_RE = new RegExp(OPEN_TAG);
const ENTRY_RE = () => new RegExp(`${OPEN_TAG}[\\s\\S]*?</HttpHostNotification>`, 'g');
const ENTRY_CAPTURE_RE = () => new RegExp(`${OPEN_TAG}([\\s\\S]*?)</HttpHostNotification>`, 'g');

// Swap ONLY the destination in a fetched single-slot document.
//
// This is the whole safety argument for the repoint feature: the live config
// carries <ANPR><detectionUpLoadPicturesType> and <SubscribeEvent><heartbeat>,
// which a hand-built body (e.g. the face configureAlarmServer template) does
// not have. Building the PUT from a template instead of mutating the fetched
// bytes drops those silently — plate images stop arriving and nothing errors.
// `format` is optional and only passed for the face path. The ANPR cutover never
// needed it — those cameras already emit what lpr-core parses — but a face
// camera's slot carries parameterFormatType=XML because that is what CIB reads,
// and a slot pointed at us has to say which of the two it is sending. Left
// undefined the field is not touched at all, so every existing caller behaves
// exactly as before.
function retargetHttpHost(xml, { ip, port, url, format }) {
  const swap = (s, tag, val) =>
    new RegExp(`<${tag}>[^<]*</${tag}>`).test(s)
      ? s.replace(new RegExp(`<${tag}>[^<]*</${tag}>`), `<${tag}>${val}</${tag}>`)
      : s;
  let out = swap(xml, 'ipAddress', ip);
  out = swap(out, 'portNo', String(port));
  out = swap(out, 'url', url);
  // A slot addressed by hostname would ignore the ipAddress we just set.
  out = swap(out, 'addressingFormatType', 'ipaddress');
  if (format) out = swap(out, 'parameterFormatType', format);
  return out;
}

// [{id, ip, port, url}] from either a single or a plural httpHosts document.
function parseSlots(xml) {
  const slots = [];
  for (const m of String(xml).matchAll(ENTRY_CAPTURE_RE())) {
    const b = m[1];
    slots.push({
      id:   (b.match(/<id>(\d+)<\/id>/) || [])[1] || '?',
      ip:   (b.match(/<ipAddress>([^<]*)<\/ipAddress>/) || [])[1] || '',
      port: parseInt((b.match(/<portNo>(\d+)<\/portNo>/) || [])[1], 10) || 0,
      url:  (b.match(/<url>([^<]*)<\/url>/) || [])[1] || '',
    });
  }
  return slots;
}

// Pull one <HttpHostNotification> out of a plural doc, re-wrapped as a
// standalone document the camera accepts on /httpHosts/<id>. Needed because a
// backup captures the PLURAL document (UVSS cameras have two slots) but restore
// writes one slot at a time.
function sliceSlot(xml, slotId) {
  for (const m of String(xml).matchAll(ENTRY_RE())) {
    if (new RegExp(`<id>${slotId}</id>`).test(m[0]))
      return '<?xml version="1.0" encoding="UTF-8"?>\n' +
             m[0].replace(OPEN_TAG_RE,
               '<HttpHostNotification version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">');
  }
  return null;
}

module.exports = { retargetHttpHost, parseSlots, sliceSlot };

// ------------------------------------------------------------
// Self-check (node src/helpers/httpHostXml.js) — runs against the REAL slot-1
// document read off camera C28-KAT-SB-15 (10.3.100.28) on 2026-07-29, so the
// preserved-fields assertions are testing the actual shape in production, not
// an invented fixture.
// ------------------------------------------------------------
if (require.main === module) {
  const assert = require('assert');
  const REAL = `<?xml version="1.0" encoding="UTF-8"?>
<HttpHostNotification version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
<id>1</id>
<url>/receive_hik_phuget</url>
<protocolType>HTTP</protocolType>
<parameterFormatType>XML</parameterFormatType>
<addressingFormatType>ipaddress</addressingFormatType>
<ipAddress>202.124.201.106</ipAddress>
<portNo>10001</portNo>
<userName></userName>
<httpAuthenticationMethod>none</httpAuthenticationMethod>
<ANPR>
<detectionUpLoadPicturesType>all</detectionUpLoadPicturesType>
</ANPR>
<SubscribeEvent>
<heartbeat>25</heartbeat>
<eventMode>all</eventMode>
</SubscribeEvent>
<enabled>true</enabled>
</HttpHostNotification>`;

  const out = retargetHttpHost(REAL, { ip: '10.0.10.50', port: 3003, url: '/lpr/TOKEN123' });

  // destination swapped
  assert.match(out, /<ipAddress>10\.0\.10\.50<\/ipAddress>/);
  assert.match(out, /<portNo>3003<\/portNo>/);
  assert.match(out, /<url>\/lpr\/TOKEN123<\/url>/);
  // the ones that matter: camera-side ANPR settings must survive verbatim
  assert.match(out, /<detectionUpLoadPicturesType>all<\/detectionUpLoadPicturesType>/, 'ANPR picture mode preserved');
  assert.match(out, /<heartbeat>25<\/heartbeat>/, 'heartbeat preserved');
  assert.match(out, /<eventMode>all<\/eventMode>/, 'eventMode preserved');
  assert.match(out, /<enabled>true<\/enabled>/, 'enabled preserved');
  // old destination fully gone
  assert.ok(!out.includes('202.124.201.106') && !out.includes('receive_hik_phuget') && !out.includes('10001'));
  // parse round-trip
  assert.deepStrictEqual(parseSlots(out)[0], { id: '1', ip: '10.0.10.50', port: 3003, url: '/lpr/TOKEN123' });
  // re-targeting an already-targeted doc is a no-op
  assert.strictEqual(retargetHttpHost(out, { ip: '10.0.10.50', port: 3003, url: '/lpr/TOKEN123' }), out, 'idempotent');

  // plural (UVSS two-slot) → slice the right one, no cross-contamination.
  // Shaped like the real thing: the list wrapper CARRIES ATTRIBUTES and the
  // entries do NOT — that asymmetry is what broke slot 1 in production, so the
  // fixture has to reproduce it rather than use a bare <HttpHostNotificationList>.
  const entry = REAL.replace(/<\?xml[^>]*\?>\s*/, '')
                    .replace(/<HttpHostNotification[^>]*>/, '<HttpHostNotification>');
  const PLURAL = '<?xml version="1.0" encoding="UTF-8"?>\r\n' +
    '<HttpHostNotificationList version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">\r\n' +
    entry + '\r\n' +
    entry.replace('<id>1</id>', '<id>2</id>').replace('202.124.201.106', '10.3.10.9') +
    '\r\n</HttpHostNotificationList>';

  assert.strictEqual(parseSlots(PLURAL).length, 2, 'plural parses both slots');

  // Slot 1 is the regression case: it is the entry the list wrapper sits in
  // front of, so a regex that also matches <HttpHostNotificationList ...> mangles
  // exactly this one and leaves slot 2 looking fine.
  const slot1 = sliceSlot(PLURAL, 1);
  assert.strictEqual((slot1.match(/<HttpHostNotification[\s>]/g) || []).length, 1,
    'slot 1 slice has exactly ONE opening tag (regression: list wrapper leaked in)');
  assert.ok(!slot1.includes('HttpHostNotificationList'), 'slot 1 slice has no list wrapper');
  assert.match(slot1, /<id>1<\/id>/);
  assert.match(slot1, /202\.124\.201\.106/, 'slot 1 kept its own ip');
  assert.ok(!slot1.includes('10.3.10.9'), 'slot 1 did not leak slot 2');
  assert.match(slot1, /<detectionUpLoadPicturesType>all<\/detectionUpLoadPicturesType>/, 'slot 1 kept ANPR block');
  assert.strictEqual(parseSlots(slot1).length, 1, 'slot 1 slice is a single-slot doc');

  const slot2 = sliceSlot(PLURAL, 2);
  assert.strictEqual((slot2.match(/<HttpHostNotification[\s>]/g) || []).length, 1,
    'slot 2 slice has exactly ONE opening tag');
  assert.match(slot2, /<id>2<\/id>/);
  assert.match(slot2, /10\.3\.10\.9/, 'slot 2 kept its own ip');
  assert.ok(!slot2.includes('202.124.201.106'), 'slot 2 did not leak slot 1');
  assert.strictEqual(parseSlots(slot2).length, 1, 'slot 2 slice is a single-slot doc');

  assert.strictEqual(sliceSlot(PLURAL, 9), null, 'missing slot → null');

  // format is opt-in: absent leaves parameterFormatType exactly as it was, which
  // is what every pre-existing caller relies on.
  const keepFmt = retargetHttpHost(REAL, { ip: '10.0.10.50', port: 3003, url: '/x' });
  assert.ok(/<parameterFormatType>XML<\/parameterFormatType>/.test(keepFmt), 'no format arg → untouched');
  const setFmt = retargetHttpHost(REAL, { ip: '10.0.10.50', port: 3003, url: '/x', format: 'JSON' });
  assert.ok(/<parameterFormatType>JSON<\/parameterFormatType>/.test(setFmt), 'format arg applied');
  assert.ok(!/<parameterFormatType>XML</.test(setFmt), 'and the old value is gone');
  // Setting it back is the F5 direction and must work the same way.
  assert.ok(/<parameterFormatType>XML</.test(
    retargetHttpHost(setFmt, { ip: '1.2.3.4', port: 80, url: '/y', format: 'XML' })));

  console.log('httpHostXml self-check OK');
}
