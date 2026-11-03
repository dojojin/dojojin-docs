// ============================================================
// Vigil Platform — Helper: Hikvision on-camera storage (microSD)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// The camera detail panel has said "SD status is Bosch-only" since it was
// written. Hikvision does report it — over three separate ISAPI documents that
// each answer a different question, and none of which is useful alone:
//
//   ContentMgmt/Storage         is a card present, how big, how full
//   ContentMgmt/record/tracks   is recording even CONFIGURED, and at what bitrate
//   ContentMgmt/search          is there anything actually ON it
//   System/status               push destinations, wear, and the traffic-camera disk list
//   Traffic/ANR                 can the camera replay what it buffered
//
// Every one of them is optional and they are answered by DIFFERENT model
// families. Nothing here may gate one document on another's HTTP code: doing
// exactly that is how ANPR cameras ended up with no telemetry (403 on Storage
// was read as "unreachable") and then, once that was fixed, how their perfectly
// readable record/tracks got skipped as well. Ask for everything, use what
// answers.
//
// Keeping them apart is what made the Phuket cards look fine for a month. All 34
// reported a healthy card with plenty of free space; the search says zero clips
// over thirty days and the track says enableSchedule=false. A card that is
// mounted, formatted, and recording nothing looks identical to a working one if
// you only read the first document.
//
// So this returns one object with both halves clearly separated — what the
// camera is CONFIGURED to do, and what is actually there — because conflating
// them is the failure this exists to surface.
//
// Pure parsing. The HTTP calls belong to the caller (the edge has the camera
// credentials; central does not), which also makes every branch below testable
// against captured XML rather than a live camera.
// ============================================================
'use strict';

// Attributes are allowed on the opening tag because Hikvision uses them
// inconsistently for the same field: the hdd LIST returns
// `<encryptionStatus opt="unencrypted,encrypted">unencrypted</encryptionStatus>`
// while /Storage/hdd/1 returns it bare. A regex that demanded `<tag>` read one
// document and silently returned nothing for the other.
//
// `\s` after the tag name, not `[^>]*` — 'status' is a prefix of 'statusText',
// and matching on prefixes is exactly how sliceSlot() ended up rewriting the
// wrong element in httpHostXml (fixed 2026-07-29).
const T = (xml, tag) => {
  const m = String(xml || '').match(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`));
  return m ? m[1].trim() : '';
};
const N = (xml, tag) => {
  const v = T(xml, tag);
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// "trackType=standard,trackType=video,codecType=H.265,resolution=3840x2160,
//  framerate=1.960000 fps,bitrate=6144 kbps" — the only place the bitrate is
// exposed, and the bitrate is what turns free space into a number of days.
function parseStreamHint(desc) {
  const s = String(desc || '');
  const pick = k => (s.match(new RegExp(`${k}=([^,]+)`)) || [])[1]?.trim() || null;
  const fps = pick('framerate');
  const br = pick('bitrate');
  return {
    codec: pick('codecType'),
    resolution: pick('resolution'),
    fps: fps ? parseFloat(fps) : null,
    bitrate_kbps: br ? parseInt(br, 10) : null,
  };
}

function parseStorage(xml) {
  const cards = [];
  for (const m of String(xml || '').matchAll(/<hdd>([\s\S]*?)<\/hdd>/g)) {
    const b = m[1];
    const capacity = N(b, 'capacity');
    const free = N(b, 'freeSpace');
    cards.push({
      id: T(b, 'id'),
      name: T(b, 'hddName'),
      status: T(b, 'status') || null,           // ok | unformatted | error | …
      capacity_mb: capacity,
      free_mb: free,
      used_mb: capacity != null && free != null ? capacity - free : null,
      // 'RW' vs 'R' — a read-only card records nothing and says status=ok while
      // doing it, so this is not cosmetic.
      property: T(b, 'property') || null,
      format_type: T(b, 'formatType') || null,
      encryption: T(b, 'encryptionStatus') || null,
      installed_at: T(b, 'installationTime') || null,
    });
  }
  return { cards, work_mode: T(xml, 'workMode') || null };
}

// Two families describe "is this actually scheduled" in two different places,
// and reading only the first calls a fully scheduled camera unscheduled.
//
//   DeepinView  <enableSchedule>true|false</enableSchedule>   explicit flag
//   ITC / ANPR  no flag at all, and a <TrackSchedule> holding one
//               <ScheduleAction> per day with <Record>true</Record>
//
// So: trust the flag whenever the camera states it — a face camera that says
// false IS off, and that finding is the reason this helper exists — and only
// fall back to reading the schedule block when there is no flag to trust.
function scheduleEnabled(trackXml) {
  const flag = T(trackXml, 'enableSchedule');
  if (flag) return flag === 'true';
  return /<Record>\s*true\s*<\/Record>/.test(trackXml);
}

function parseTracks(xml) {
  const tracks = [];
  for (const m of String(xml || '').matchAll(/<Track\b[\s\S]*?<\/Track>/g)) {
    const b = m[0];
    tracks.push({
      id: T(b, 'id'),
      enabled: T(b, 'Enable') === 'true',
      // The one that matters. Enable=true with enableSchedule=false is a channel
      // that is switched on and recording nothing — which is every Phuket
      // camera, and is invisible from the storage document alone.
      schedule_enabled: scheduleEnabled(b),
      mode: T(b, 'DefaultRecordingMode') || null,      // CMR = continuous
      loop: T(b, 'LoopEnable') === 'true',
      duration: T(b, 'durationEnabled') === 'true' ? T(b, 'Duration') : null,
      pre_sec: N(b, 'PreRecordTimeSeconds'),
      post_sec: N(b, 'PostRecordTimeSeconds'),
      ...parseStreamHint(T(b, 'Description')),
    });
  }
  return tracks;
}

function parseSearch(xml) {
  const s = String(xml || '');
  const total = N(s, 'totalMatches');
  const starts = [...s.matchAll(/<startTime>([^<]*)<\/startTime>/g)].map(m => m[1]);
  const ends = [...s.matchAll(/<endTime>([^<]*)<\/endTime>/g)].map(m => m[1]);
  const valid = a => a.map(x => new Date(x)).filter(d => !isNaN(d) && d.getFullYear() > 2015);
  const from = valid(starts).sort((a, b) => a - b)[0] || null;
  const to = valid(ends).sort((a, b) => b - a)[0] || null;
  return {
    clips: total ?? 0,
    from: from ? from.toISOString() : null,
    to: to ? to.toISOString() : null,
    days: from && to ? Math.max(0, Math.round((to - from) / 86400000)) : null,
  };
}

// How long the free space lasts at the configured bitrate. Deliberately based on
// the CONFIGURED rate rather than observed growth: with nothing recorded there
// is no growth to observe, and "how long would it last if I turned this on" is
// the question an operator actually has in front of an empty card.
function daysRemaining(freeMb, bitrateKbps) {
  if (!freeMb || !bitrateKbps) return null;
  const mbPerDay = (bitrateKbps / 8) * 86400 / 1024;   // kbit/s → MB/day
  if (mbPerDay <= 0) return null;
  return Math.round((freeMb / mbPerDay) * 10) / 10;
}

// ── /ISAPI/System/status ────────────────────────────────────
// The traffic-camera half of the picture (spec: ISAPI_Traffic_Cameras_Capture_
// Cameras). ANPR cameras answer 403 on ContentMgmt/Storage entirely — it is not
// a permission problem to chase, they are a different device class with a
// different surface — while this document answers for both:
//
//   face  → SDCardStatusInfo only (rewrite counters)
//   ANPR  → uploadTimeConsumingList, and HardDiskStatusList when a card exists
//
// So both documents are read for every camera and each contributes what it has,
// rather than deciding which to call from cam_role. Roles get edited; what a
// camera answers does not.
function parseSystemStatus(xml) {
  const s = String(xml || '');
  if (!s) return null;

  // Present only on models that report a disk here. Its absence proves nothing
  // about the hardware — see the `unsupported` state in buildSdDetail.
  const disks = [...s.matchAll(/<HardDiskStatus>([\s\S]*?)<\/HardDiskStatus>/g)].map(m => {
    const b = m[1];
    const used = N(b, 'hardDiskUsage'), free = N(b, 'hardDiskAvailable');
    return {
      description: T(b, 'description') || null,
      status: T(b, 'status') || null,              // full | normal | abnormal | formatting
      used_mb: used, free_mb: free,
      capacity_mb: used != null && free != null ? used + free : null,
    };
  });

  // How many times the card has been written all the way round. The nearest
  // thing to a wear figure these cameras expose, and the only one that says a
  // card at 100% has been looping for months rather than filling up once.
  const sd = /<SDCardStatusInfo>/.test(s) ? {
    video_rewrites: N(s, 'videoRewritingTimes'),
    snapshot_rewrites: N(s, 'snapshotRewritingTimes'),
  } : null;

  // Every destination the camera pushes to, counted BY THE CAMERA. This is the
  // only view of delivery that neither we nor the partner produced, which is
  // what makes it worth carrying: it recorded that direct-to-CIB delivery ran at
  // 97.69% and 540 ms while the same cameras reach our edge at 99.55% and 47 ms.
  const uploads = [...s.matchAll(/<uploadTimeConsuming>([\s\S]*?)<\/uploadTimeConsuming>/g)].map(m => {
    const b = m[1];
    const ok = N(b, 'uploadSuccessNum'), total = N(b, 'uploadTotalNum');
    return {
      id: T(b, 'id'), ip: T(b, 'uploadIpaddr') || null, port: T(b, 'uploadPort') || null,
      type: T(b, 'uploadType') || null,
      min_ms: N(b, 'minTime'), avg_ms: N(b, 'avgTime'), max_ms: N(b, 'maxTime'),
      ok, total,
      // Rounded here so every reader shows the same number rather than each
      // rounding its own way.
      rate: ok != null && total ? Math.round((ok / total) * 10000) / 100 : null,
      start: T(b, 'uploadStartTime') || null, end: T(b, 'uploadEndTime') || null,
      status: T(b, 'uploadStatus') || null,      // Uploading | End
    };
  });

  return {
    disks, sd_wear: sd, uploads,
    cpu_pct: N(s, 'cpuUtilization'),
    boot_time: T(s, 'bootTime') || null,
    uptime: T(s, 'deviceUpTime') || null,
  };
}

// ── /ISAPI/Traffic/ANR ──────────────────────────────────────
// ANR is what lets a camera hold events while the receiver is down and replay
// them afterwards, so "does this camera have it" decides how much of an outage
// we can lose. It was previously reported as flatly unsupported because it was
// looked for under ContentMgmt/record — which is the DeepinView surface. Traffic
// cameras put it somewhere else entirely (spec 14.5.1.37, PUT /ISAPI/Traffic/ANR)
// and C28-KAT-SB-15 answers it 200.
//
// Returns null when the camera does not implement the document at all, which is
// a different answer from implementing it with nothing configured — the whole
// point of separating these two is that only the second one is fixable.
function parseAnr(xml) {
  const s = String(xml || '');
  if (!/<ANRControl/.test(s)) return null;
  // The arming server is what makes ANR actually do something. Hikvision omits
  // the whole DeviceIpAddress block when unset, and writes placeholders rather
  // than omitting when half-set, so both have to count as "no server".
  const addr = [T(s, 'ipAddress'), T(s, 'ipv6Address'), T(s, 'hostName')]
    .find(v => v && !['0.0.0.0', '::', 'test'].includes(v)) || null;
  return {
    server: addr,
    upload_interval_ms: N(s, 'uploadInterval'),
    upload_timeout_ms: N(s, 'uploadTimeout'),
  };
}

// ── /ISAPI/Event/notification/httpHosts ─────────────────────
// Face cameras have no uploadTimeConsumingList — that is a traffic-camera
// counter, confirmed against C22-PT-SB-10 and absent from the DeepinView spec —
// so for them there is no success rate and no latency to show, ever. What they
// DO expose is where they are configured to push, which still answers the
// question people open this panel with: is this camera pointed at us, at the
// partner, or at something nobody remembers setting up.
//
// Deliberately no rate/latency fields on the way out: a destination row that
// looks identical to the measured kind but silently omits the numbers would
// read as "100%".
function parseHttpHosts(xml) {
  const s = String(xml || '');
  if (!/<HttpHostNotification\b/.test(s)) return null;
  const out = [];
  for (const m of s.matchAll(/<HttpHostNotification(?:\s[^>]*)?>([\s\S]*?)<\/HttpHostNotification>/g)) {
    const b = m[1];
    // Cameras keep a fixed number of slots and park the unused ones on
    // 0.0.0.0 rather than removing them. Those are not destinations.
    const host = T(b, 'hostName') || T(b, 'ipAddress');
    if (!host || host === '0.0.0.0' || host === '::') continue;
    out.push({
      id: T(b, 'id'),
      host,
      port: T(b, 'portNo') || null,
      protocol: T(b, 'protocolType') || null,
      format: T(b, 'parameterFormatType') || null,
      path: T(b, 'url') || null,
    });
  }
  return out;
}

/**
 * One object from the documents above. Any of them may be missing, and missing
 * carries meaning, so callers pass what each request actually returned:
 *
 *   storageSupported === false   the camera REFUSED the storage document
 *                                (403 notSupport) — we cannot see its storage,
 *                                which is not the same as it having none
 *   storageSupported === true    it answered; an empty hddList really is no card
 *   undefined                    unknown; inferred from whether XML was passed
 */
function buildSdDetail({ storageXml, tracksXml, searchXml, statusXml, anrXml, hostsXml,
                         storageSupported, checkedAt } = {}) {
  const { cards, work_mode } = parseStorage(storageXml);
  const sys = parseSystemStatus(statusXml);
  const tracks = parseTracks(tracksXml);
  const search = searchXml ? parseSearch(searchXml) : null;
  const anr = parseAnr(anrXml);
  const destinations = parseHttpHosts(hostsXml);
  // ContentMgmt/Storage first; a traffic camera 403s it, so fall back to the
  // disk list in System/status. Both shapes are normalised to the same fields
  // so nothing downstream has to know which document answered.
  let card = cards[0] || null;
  if (!card && sys && sys.disks.length) {
    const h = sys.disks[0];
    card = { id: '1', name: h.description, status: h.status === 'normal' ? 'ok' : h.status,
             capacity_mb: h.capacity_mb, free_mb: h.free_mb, used_mb: h.used_mb,
             property: null, format_type: null, encryption: null, installed_at: null };
  }
  // Track 101 is the main video channel on every model surveyed; fall back to
  // the first that carries a bitrate so a different numbering still yields one.
  const vid = tracks.find(t => t.id === '101') || tracks.find(t => t.bitrate_kbps) || null;

  // Five states. The middle two are the original point of this helper — a card
  // can be perfectly healthy and still be recording nothing, which reads as
  // "fine" on every other panel we have.
  //
  // `unsupported` is the fifth and it exists because the panel was caught
  // lying: an ITC/ANPR camera refuses ContentMgmt/Storage, System/Storage AND
  // System/emmcInfo, and carries no HardDiskStatusList, so we learn nothing
  // about its storage — yet the panel printed "ไม่มีการ์ด" for all 16 of them.
  // Absence of a document is not absence of hardware. Say we cannot tell.
  const storageRefused = storageSupported === false;
  let state = 'unknown';
  if (!card && storageRefused && (!sys || !sys.disks.length)) state = 'unsupported';
  else if (!card) state = 'no_card';
  else if (card.status && card.status !== 'ok') state = card.status;   // unformatted | error
  else if (!vid || !vid.schedule_enabled) state = 'idle';              // healthy, not recording
  else if (search && search.clips === 0) state = 'armed_empty';        // scheduled, nothing yet
  else state = 'recording';

  return {
    state,
    card,
    work_mode,
    recording: vid ? {
      track: vid.id,
      enabled: vid.enabled,
      schedule_enabled: vid.schedule_enabled,
      mode: vid.mode,
      loop: vid.loop,
      codec: vid.codec,
      resolution: vid.resolution,
      fps: vid.fps,
      bitrate_kbps: vid.bitrate_kbps,
      days_if_enabled: daysRemaining(card?.free_mb, vid.bitrate_kbps),
    } : null,
    content: search,
    // Three answers, not two. "Supported but no arming server set" is something
    // an operator can act on; "the model does not have it" is not, and printing
    // the same words for both is what hid the ANPR cameras' real state.
    // Still always present rather than omitted when absent — a missing row
    // reads as "we forgot to check".
    anr: !anr ? 'unsupported' : anr.server ? 'ready' : 'not_configured',
    anr_detail: anr,
    tracks,
    // From System/status. null when the camera did not answer it at all.
    wear: sys ? sys.sd_wear : null,
    uploads: sys ? sys.uploads : null,
    // Where the camera is CONFIGURED to push, with no delivery figures attached.
    // For face models this is the only destination view that exists.
    destinations,
    device: sys ? { cpu_pct: sys.cpu_pct, boot_time: sys.boot_time, uptime: sys.uptime } : null,
    checked_at: checkedAt || new Date().toISOString(),
  };
}

module.exports = { buildSdDetail, parseStorage, parseTracks, parseSearch, parseStreamHint, daysRemaining, parseSystemStatus, parseAnr, parseHttpHosts };

if (require.main === module) {
  const assert = require('assert');

  // Captured from C22-PT-SB-10 at Phuket, 2026-08-04.
  const STORAGE = `<?xml version="1.0" encoding="UTF-8"?>
<storage version="2.0"><hddList size="8"><hdd>
<id>1</id><hddName>hdde</hddName><hddPath></hddPath><hddType>SATA</hddType>
<status>ok</status><capacity>60350</capacity><freeSpace>41984</freeSpace>
<property>RW</property><formatType>EXT4</formatType>
<Encryption><encryptionStatus opt="unencrypted,encrypted">unencrypted</encryptionStatus></Encryption>
<installationTime>07-Jul-2026 11:55</installationTime>
</hdd></hddList><workMode>quota</workMode></storage>`;

  const TRACKS = `<TrackList><Track>
<id>101</id><Channel>101</Channel><Enable>true</Enable>
<Description>trackType=standard,trackType=video,codecType=H.265,resolution=3840x2160,framerate=1.960000 fps,bitrate=6144 kbps</Description>
<DefaultRecordingMode>CMR</DefaultRecordingMode><LoopEnable>true</LoopEnable>
<CustomExtensionList><CustomExtension>
<enableSchedule>false</enableSchedule><PreRecordTimeSeconds>5</PreRecordTimeSeconds><PostRecordTimeSeconds>5</PostRecordTimeSeconds>
</CustomExtension></CustomExtensionList>
<Duration>P7DT0H</Duration><durationEnabled>false</durationEnabled>
</Track></TrackList>`;

  const SEARCH_EMPTY = `<CMSearchResult><searchID>{X}</searchID><responseStatus>true</responseStatus>
<responseStatusStrg>NO MATCHES</responseStatusStrg><totalMatches>0</totalMatches>
<numOfMatches>0</numOfMatches><matchList></matchList></CMSearchResult>`;

  const d = buildSdDetail({ storageXml: STORAGE, tracksXml: TRACKS, searchXml: SEARCH_EMPTY });

  // The whole reason this helper exists: healthy card, nothing recorded.
  assert.strictEqual(d.state, 'idle', 'ok card + schedule off = idle, not "recording"');
  assert.strictEqual(d.card.status, 'ok');
  assert.strictEqual(d.card.capacity_mb, 60350);
  assert.strictEqual(d.card.free_mb, 41984);
  assert.strictEqual(d.card.used_mb, 18366, 'used is derived, never read from the camera');
  assert.strictEqual(d.card.property, 'RW');
  assert.strictEqual(d.card.format_type, 'EXT4');
  assert.strictEqual(d.card.encryption, 'unencrypted');
  assert.strictEqual(d.card.installed_at, '07-Jul-2026 11:55');
  assert.strictEqual(d.work_mode, 'quota');

  assert.strictEqual(d.recording.schedule_enabled, false, 'the field that says it is not recording');
  assert.strictEqual(d.recording.enabled, true, 'and the one that misleadingly says it is');
  assert.strictEqual(d.recording.mode, 'CMR');
  assert.strictEqual(d.recording.codec, 'H.265');
  assert.strictEqual(d.recording.resolution, '3840x2160');
  assert.strictEqual(d.recording.fps, 1.96);
  assert.strictEqual(d.recording.bitrate_kbps, 6144);
  assert.strictEqual(d.content.clips, 0);
  assert.strictEqual(d.anr, 'unsupported', 'no ANR document asked for or answered');

  // 41,984 MB at 6,144 kbps ≈ 0.6 days. A 60 GB card at 4K holds well under a
  // day, which is the number an operator needs before switching recording on.
  assert.ok(d.recording.days_if_enabled > 0.5 && d.recording.days_if_enabled < 0.8,
    `expected ~0.6 days, got ${d.recording.days_if_enabled}`);

  // ── unformatted: the 25 Phuket cameras ────────────────────
  const unf = buildSdDetail({
    storageXml: STORAGE.replace('<status>ok</status>', '<status>unformatted</status>')
                       .replace('<freeSpace>41984</freeSpace>', '<freeSpace>0</freeSpace>'),
    tracksXml: TRACKS, searchXml: SEARCH_EMPTY });
  assert.strictEqual(unf.state, 'unformatted', 'card status wins over schedule state');
  assert.strictEqual(unf.recording.days_if_enabled, null, 'no free space → no estimate, not 0');

  // ── no card at all: C30 / C31 ─────────────────────────────
  const none = buildSdDetail({ storageXml: '<storage><hddList size="8"></hddList></storage>',
                               tracksXml: TRACKS, searchXml: SEARCH_EMPTY });
  assert.strictEqual(none.state, 'no_card');
  assert.strictEqual(none.card, null);
  assert.strictEqual(none.recording.days_if_enabled, null);

  // ── scheduled but nothing recorded yet vs actually recording ──
  const armed = buildSdDetail({ storageXml: STORAGE,
    tracksXml: TRACKS.replace('<enableSchedule>false<', '<enableSchedule>true<'),
    searchXml: SEARCH_EMPTY });
  assert.strictEqual(armed.state, 'armed_empty', 'scheduled but empty is its own state');

  const REC = `<CMSearchResult><totalMatches>1432</totalMatches>
<matchList>
<searchMatchItem><timeSpan><startTime>2026-07-29T01:00:00Z</startTime><endTime>2026-07-29T02:00:00Z</endTime></timeSpan></searchMatchItem>
<searchMatchItem><timeSpan><startTime>2026-08-04T09:00:00Z</startTime><endTime>2026-08-04T10:00:00Z</endTime></timeSpan></searchMatchItem>
</matchList></CMSearchResult>`;
  const rec = buildSdDetail({ storageXml: STORAGE,
    tracksXml: TRACKS.replace('<enableSchedule>false<', '<enableSchedule>true<'), searchXml: REC });
  assert.strictEqual(rec.state, 'recording');
  assert.strictEqual(rec.content.clips, 1432);
  assert.strictEqual(rec.content.days, 6, 'span is oldest start → newest end');
  assert.ok(rec.content.from.startsWith('2026-07-29'));
  assert.ok(rec.content.to.startsWith('2026-08-04'));

  // Hikvision answers with a 2000-01-01 placeholder when there is no footage —
  // the same trap the Bosch panel documents. It must not become a real span.
  const ph = parseSearch(`<CMSearchResult><totalMatches>0</totalMatches><matchList>
<searchMatchItem><timeSpan><startTime>2000-01-01T00:00:00Z</startTime><endTime>2000-01-01T00:00:00Z</endTime></timeSpan></searchMatchItem>
</matchList></CMSearchResult>`);
  assert.strictEqual(ph.from, null, 'epoch placeholder is not a date');
  assert.strictEqual(ph.days, null);

  // Missing documents degrade, never throw — a camera that 404s two of the
  // three still produces a usable answer.
  const partial = buildSdDetail({ storageXml: STORAGE });
  assert.strictEqual(partial.state, 'idle');
  assert.strictEqual(partial.content, null);
  assert.doesNotThrow(() => buildSdDetail({}));
  assert.strictEqual(buildSdDetail({}).state, 'no_card');

  // ── /ISAPI/System/status ──────────────────────────────────
  // Captured from C10-KAR-SB-04 (ANPR) at Phuket, 2026-08-04. Trimmed to the
  // three blocks that matter; the real document also carries CPU, memory and
  // network counters.
  const STATUS = `<?xml version="1.0" encoding="UTF-8"?>
<DeviceStatus version="2.0">
<CPUList><CPU><cpuUtilization>14.300003</cpuUtilization></CPU></CPUList>
<bootTime>2026-07-14 22:34:26</bootTime>
<deviceUpTime>21 Days 2 Hours 42 Mins 3 Secs </deviceUpTime>
<uploadTimeConsumingList>
<uploadTimeConsuming><id>1</id><uploadIpaddr>10.0.10.50</uploadIpaddr><uploadPort>3003</uploadPort>
<uploadType>ISAPIListen</uploadType><maxTime>116</maxTime><minTime>21</minTime><avgTime>47</avgTime>
<uploadSuccessNum>159502</uploadSuccessNum><uploadTotalNum>160263</uploadTotalNum>
<uploadStartTime>2026-7-30 2:50:25</uploadStartTime><uploadEndTime>-</uploadEndTime>
<uploadStatus>Uploading</uploadStatus></uploadTimeConsuming>
<uploadTimeConsuming><id>3</id><uploadIpaddr>202.124.201.106</uploadIpaddr><uploadPort>10001</uploadPort>
<uploadType>ISAPIListen</uploadType><maxTime>1081</maxTime><minTime>83</minTime><avgTime>336</avgTime>
<uploadSuccessNum>382478</uploadSuccessNum><uploadTotalNum>393864</uploadTotalNum>
<uploadStartTime>2026-7-14 22:34:33</uploadStartTime><uploadEndTime>2026-7-30 2:50:25</uploadEndTime>
<uploadStatus>End</uploadStatus></uploadTimeConsuming>
</uploadTimeConsumingList>
<SDCardStatusInfo><videoRewritingTimes>0</videoRewritingTimes></SDCardStatusInfo>
</DeviceStatus>`;

  const sys = parseSystemStatus(STATUS);
  assert.strictEqual(sys.uploads.length, 2);
  const edge = sys.uploads.find(u => u.ip === '10.0.10.50');
  const cib  = sys.uploads.find(u => u.ip === '202.124.201.106');
  assert.strictEqual(edge.rate, 99.53, `edge rate ${edge.rate}`);
  assert.strictEqual(cib.rate, 97.11, `cib rate ${cib.rate}`);
  assert.strictEqual(edge.avg_ms, 47);
  assert.strictEqual(cib.status, 'End', 'the destination the camera has stopped using');
  assert.strictEqual(edge.status, 'Uploading');
  // The camera records the cutover: the old destination ends the same second the
  // new one starts. That equality is the audit trail for the ANPR migration.
  assert.strictEqual(cib.end, edge.start, 'cutover instant, as the camera saw it');
  assert.strictEqual(sys.sd_wear.video_rewrites, 0);
  assert.strictEqual(sys.sd_wear.snapshot_rewrites, null, 'absent counter is null, not 0');
  assert.strictEqual(sys.cpu_pct, 14.300003);
  assert.ok(sys.uptime.startsWith('21 Days'));
  assert.strictEqual(sys.disks.length, 0, 'no HardDiskStatusList on a card-less ANPR camera');

  // ── the three defects the owner caught, 2026-08-05 ────────
  // Probed on C28-KAT-SB-15 (iDS-2CD9396-HIS, deviceType ITCCAM): every storage
  // document is refused — ContentMgmt/Storage 403 notSupport, System/Storage 403,
  // System/emmcInfo 403 (its /capabilities answers, with lifetimeStatus min=max=0)
  // — and System/status carries no HardDiskStatusList.

  // 1. Refusal must not be reported as "no card". We do not know.
  const refused = buildSdDetail({ statusXml: STATUS, storageSupported: false });
  assert.strictEqual(refused.state, 'unsupported',
    'a camera that refuses every storage document tells us nothing about its card');
  assert.strictEqual(refused.card, null);
  assert.strictEqual(refused.uploads.length, 2, 'and the uploads still come through');
  assert.strictEqual(refused.device.uptime, sys.uptime);

  // An empty hddList from a camera that DID answer is the opposite: real absence.
  const reallyNone = buildSdDetail({ storageXml: '<storage><hddList size="8"></hddList></storage>',
                                     storageSupported: true });
  assert.strictEqual(reallyNone.state, 'no_card', 'answered + empty really is no card');

  // Callers that pass neither flag keep the old behaviour rather than silently
  // turning every card-less camera into 'unsupported'.
  assert.strictEqual(buildSdDetail({ statusXml: STATUS }).state, 'no_card');

  // 2. record/tracks answers 200 on ANPR — a full 7-day continuous schedule —
  // even though every storage document 403s. Gating it on the storage code threw
  // this away. Verbatim from C28-KAT-SB-15.
  const ANPR_TRACKS = `<TrackList version="2.0"><Track>
<id>101</id><Channel>101</Channel><Enable>true</Enable>
<Description>trackType=standard,trackType=video,codecType=H.265,resolution=0x0,framerate=25.000000 fps,bitrate=6144 kbps</Description>
<Duration>P7DT0H</Duration><DefaultRecordingMode>CMR</DefaultRecordingMode><LoopEnable>true</LoopEnable>
<TrackSchedule><ScheduleBlock>
<ScheduleAction><id>1</id>
<ScheduleActionStartTime><DayOfWeek>Monday</DayOfWeek><TimeOfDay>00:00:00</TimeOfDay></ScheduleActionStartTime>
<ScheduleActionEndTime><DayOfWeek>Monday</DayOfWeek><TimeOfDay>24:00:00</TimeOfDay></ScheduleActionEndTime>
<Actions><Record>true</Record><ActionRecordingMode>CMR</ActionRecordingMode></Actions>
</ScheduleAction></ScheduleBlock></TrackSchedule>
</Track></TrackList>`;
  const anprFull = buildSdDetail({ statusXml: STATUS, tracksXml: ANPR_TRACKS, storageSupported: false });
  assert.strictEqual(anprFull.state, 'unsupported', 'storage still unknown…');
  assert.strictEqual(anprFull.recording.mode, 'CMR', '…but the schedule is not');
  assert.strictEqual(anprFull.recording.loop, true);
  assert.strictEqual(anprFull.recording.bitrate_kbps, 6144);
  assert.strictEqual(anprFull.recording.fps, 25);
  assert.strictEqual(anprFull.recording.days_if_enabled, null, 'no readable free space → no estimate');
  // ITC cameras carry no <enableSchedule> — the schedule lives in TrackSchedule.
  // Reading only the flag called a camera with a seven-day continuous schedule
  // "ไม่ได้ตั้งตารางบันทึก" in amber, which is the third over-claim of the same
  // family as `no_card` and the ANR row.
  assert.strictEqual(anprFull.recording.schedule_enabled, true,
    'a TrackSchedule with Record=true is a schedule, flag or no flag');
  // …and the explicit flag still wins where the camera states it. This is the
  // original finding — 34 face cards healthy, scheduled off, recording nothing —
  // and the fallback must not quietly overturn it.
  assert.strictEqual(d.recording.schedule_enabled, false,
    'enableSchedule=false still means off, even with schedule blocks present');
  const faceWithBlocks = buildSdDetail({
    storageXml: STORAGE,
    tracksXml: TRACKS.replace('</Track>', '<TrackSchedule><Actions><Record>true</Record></Actions></TrackSchedule></Track>'),
    searchXml: SEARCH_EMPTY });
  assert.strictEqual(faceWithBlocks.recording.schedule_enabled, false, 'the stated flag wins');
  assert.strictEqual(faceWithBlocks.state, 'idle');

  // 3. ANR: supported, but with no arming server configured. Verbatim response.
  const ANR_BARE = `<?xml version="1.0" encoding="UTF-8"?>
<ANRControl version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><uploadInterval>200</uploadInterval></ANRControl>`;
  const anrOff = buildSdDetail({ statusXml: STATUS, anrXml: ANR_BARE, storageSupported: false });
  assert.strictEqual(anrOff.anr, 'not_configured',
    'the camera has ANR — it just has nowhere to send it');
  assert.strictEqual(anrOff.anr_detail.server, null);
  assert.strictEqual(anrOff.anr_detail.upload_interval_ms, 200);

  const anrOn = buildSdDetail({ anrXml: ANR_BARE.replace('</ANRControl>',
    '<DeviceIpAddress><addressingFormatType>ipaddress</addressingFormatType>' +
    '<ipAddress>10.0.10.50</ipAddress></DeviceIpAddress></ANRControl>') });
  assert.strictEqual(anrOn.anr, 'ready');
  assert.strictEqual(anrOn.anr_detail.server, '10.0.10.50');

  // The spec's own placeholder must not read as a configured server.
  assert.strictEqual(parseAnr(ANR_BARE.replace('</ANRControl>',
    '<DeviceIpAddress><ipAddress>test</ipAddress><ipv6Address>::</ipv6Address>' +
    '</DeviceIpAddress></ANRControl>')).server, null, 'placeholders are not a server');
  // 4. Face models keep no delivery counters, so the configured destination list
  // is all they have. Verbatim from C22-PT-SB-10, including the parked slot.
  const HOSTS = `<?xml version="1.0" encoding="UTF-8"?>
<HttpHostNotificationList version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
<HttpHostNotification version="2.0"><id>1</id><url>/v2/019e49e5-943c-73c5-ac35-321babc7d7a2</url>
<protocolType>HTTP</protocolType><parameterFormatType>XML</parameterFormatType>
<addressingFormatType>ipaddress</addressingFormatType><ipAddress>202.124.201.105</ipAddress>
<portNo>10001</portNo></HttpHostNotification>
<HttpHostNotification version="2.0"><id>2</id><url>/face-push/cf99d5c0-db93-49ff-8c25-2c4aa6b083ca</url>
<protocolType>HTTPS</protocolType><parameterFormatType>XML</parameterFormatType>
<addressingFormatType>hostname</addressingFormatType><hostName>dashboard.dojojin.tech</hostName>
<portNo>443</portNo></HttpHostNotification>
<HttpHostNotification version="2.0"><id>3</id><url>/</url>
<protocolType>HTTP</protocolType><addressingFormatType>ipaddress</addressingFormatType>
<ipAddress>0.0.0.0</ipAddress><portNo>80</portNo></HttpHostNotification>
</HttpHostNotificationList>`;
  const hosts = parseHttpHosts(HOSTS);
  assert.strictEqual(hosts.length, 2, 'the 0.0.0.0 slot is parked, not a destination');
  assert.strictEqual(hosts[0].host, '202.124.201.105');
  // Slot 2 addresses by hostname, not ipAddress — reading only <ipAddress>
  // would drop our own destination and show only the partner's.
  assert.strictEqual(hosts[1].host, 'dashboard.dojojin.tech');
  assert.strictEqual(hosts[1].protocol, 'HTTPS');
  assert.strictEqual(hosts[1].path, '/face-push/cf99d5c0-db93-49ff-8c25-2c4aa6b083ca');
  // No delivery figures on these, ever — the camera does not count them, and a
  // null rate rendered beside a real one reads as 100%.
  assert.ok(!('rate' in hosts[0]) && !('avg_ms' in hosts[0]));
  const face = buildSdDetail({ storageXml: STORAGE, tracksXml: TRACKS, hostsXml: HOSTS });
  assert.strictEqual(face.destinations.length, 2);
  assert.strictEqual(face.uploads, null, 'and no upload counters to confuse it with');
  assert.strictEqual(parseHttpHosts(''), null, 'never asked → no list, not an empty one');
  assert.strictEqual(parseHttpHosts('<HttpHostNotificationList></HttpHostNotificationList>'), null);

  assert.strictEqual(parseAnr(''), null, 'no document at all → unsupported');
  assert.strictEqual(parseAnr('<ResponseStatus><subStatusCode>notSupport</subStatusCode></ResponseStatus>'),
    null, 'a refusal is not a configuration');

  // A traffic camera that DOES carry a disk falls back to the disk list, and
  // 'normal' there means the same as 'ok' in the other document.
  const withDisk = buildSdDetail({ statusXml: STATUS.replace('<SDCardStatusInfo>',
    `<HardDiskStatusList><HardDiskStatus><description>SD</description><status>normal</status>
     <hardDiskUsage>1024.000</hardDiskUsage><hardDiskAvailable>59326.000</hardDiskAvailable>
     </HardDiskStatus></HardDiskStatusList><SDCardStatusInfo>`) });
  assert.strictEqual(withDisk.card.status, 'ok', 'normal → ok, so one vocabulary downstream');
  assert.strictEqual(withDisk.card.capacity_mb, 60350, 'capacity is used+free, not reported');
  assert.strictEqual(withDisk.card.free_mb, 59326);
  assert.strictEqual(withDisk.state, 'idle', 'healthy card, no track configured');

  // ContentMgmt/Storage still wins when both are present — it carries the
  // filesystem, encryption and install date that the status document lacks.
  const both = buildSdDetail({ storageXml: STORAGE, tracksXml: TRACKS, statusXml: STATUS });
  assert.strictEqual(both.card.format_type, 'EXT4');
  assert.strictEqual(both.card.free_mb, 41984);
  assert.strictEqual(both.uploads.length, 2, 'and the uploads still come through');

  // No status document at all — every new field is null, nothing throws.
  const noSys = buildSdDetail({ storageXml: STORAGE, tracksXml: TRACKS });
  assert.strictEqual(noSys.uploads, null);
  assert.strictEqual(noSys.wear, null);
  assert.strictEqual(noSys.device, null);

  console.log('hikStorage self-check: all assertions passed');
}
