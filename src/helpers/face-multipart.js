// ============================================================
// Vigil Platform — Helper: Hikvision face-alarm multipart
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Pure parse + transform for the Hikvision "Alarm Server" face push.
// Shared by the FAS LAN receiver (hikvision-isapi.js) and the api-server
// cross-site receiver (routes/face-push.js, IM3-R). No I/O, no module state
// → unit-testable in isolation.
//
// Wire format (multipart/form-data):
//   Part 'alarmResult'         JSON  — recognition result (name/listType/similarity + Face.Property attrs)
//   Part 'mixedTargetDetection' JSON — body/appearance (handled separately)
//   Parts faceImage/backgroundImage/faceLibImage  JPEG — crop / full frame / FDLib ref photo
// ============================================================
'use strict';

// Split a multipart body into { alarmJson, bodyJson, images:{name:Buffer}, partsInfo }.
//
// partsInfo is a structural manifest (name/contentType/bytes per part, no
// bodies) of every part seen in this single walk — added 2026-08-05 so a
// caller can log what actually arrived on the SUCCESS path too, not just when
// parsing fails. The XML-vs-JSON question that blocked Phase 3/4 of the CIB
// face migration was only visible before via _describeUnparsed, which never
// fires when alarmJson parses fine — so a working payload's actual part types
// were invisible. This costs nothing extra: the walk already inspects every
// part's headers to route it, partsInfo just keeps what it already computed.
function parseFaceAlarmMultipart(body, boundary) {
  const bound  = Buffer.from('--' + (boundary || 'boundary'));
  const hdrEnd = Buffer.from('\r\n\r\n');
  let off = 0;
  let alarmJson = null;
  let bodyJson  = null;
  const images = {};
  const partsInfo = [];

  while (true) {
    const bs = body.indexOf(bound, off);
    if (bs < 0) break;
    const hs = bs + bound.length;
    if (body.slice(hs, hs + 2).toString() === '--') break; // end boundary
    const he = body.indexOf(hdrEnd, hs);
    if (he < 0) break;
    const hdrs      = body.slice(hs, he).toString('utf8');
    const ct        = (hdrs.match(/Content-Type:\s*([^\r\n;]+)/i) || [])[1]?.trim() || '';
    const nm        = (hdrs.match(/name="([^"]+)"/i) || [])[1] || '';
    const cl        = parseInt((hdrs.match(/Content-Length:\s*(\d+)/i) || [])[1] || '0', 10);
    const bodyStart = he + 4;
    partsInfo.push({ name: nm || '(unnamed)', contentType: ct || '(none)', bytes: cl });

    if (/application\/json/i.test(ct) && nm !== 'mixedTargetDetection') {
      let jsonEnd = cl > 0 ? bodyStart + cl : body.indexOf(Buffer.from('\r\n--'), bodyStart);
      if (jsonEnd < 0) jsonEnd = body.length;
      try {
        const parsed = JSON.parse(body.slice(bodyStart, jsonEnd).toString('utf8'));
        // A Hikvision alarm server slot isn't face-recognition-only — it
        // carries whatever alarm types the camera has enabled, and every one
        // of them arrives as an equally-valid `application/json` part. Before
        // this check, "any JSON part not literally named mixedTargetDetection"
        // was accepted as the face alarmResult, so e.g. regionTargetNumberCounting
        // (a people-counting alarm, no face data at all) was parsed and handed
        // to faceAlarmToRecord/ingestFaceAlarmEvent, which extract
        // CaptureResult[0]... down a chain that doesn't exist on that shape —
        // every field comes back null and an empty "FaceRecognition, no match"
        // row still gets written. Confirmed live 2026-08-05, Phase 3 of the CIB
        // face migration (docs/PLAN_hkt-face-cib-forward_2026-08-04.md):
        // 2,602/2,602 FaceRecognition rows from the pilot camera had this exact
        // all-null shape. A genuine face alarmResult always carries
        // CaptureResult (see faceAlarmToRecord below) — anything else isn't one,
        // whatever the multipart part happens to be named.
        if (Array.isArray(parsed?.CaptureResult)) alarmJson = parsed;
      } catch {}
    } else if (/application\/json/i.test(ct) && nm === 'mixedTargetDetection') {
      let jsonEnd = cl > 0 ? bodyStart + cl : body.indexOf(Buffer.from('\r\n--'), bodyStart);
      if (jsonEnd < 0) jsonEnd = body.length;
      try { bodyJson = JSON.parse(body.slice(bodyStart, jsonEnd).toString('utf8')); } catch {}
    } else if (/image/i.test(ct) && cl > 0) {
      images[nm] = body.slice(bodyStart, bodyStart + cl);
    }

    off = bodyStart + (cl > 0 ? cl : 0);
  }

  return { alarmJson, bodyJson, images, partsInfo };
}

// Pure transform: alarmJson → the events.raw_json shape + a short summary.
// Mirrors the canonical mapping in hikvision-isapi.js ingestFaceAlarmEvent so a
// face event ingested via either receiver renders identically on the dashboard.
function faceAlarmToRecord(alarmJson) {
  const cap       = alarmJson?.CaptureResult?.[0] ?? null;
  const candidate = cap?.FaceContrastResult?.[0]?.faces?.[0]?.identify?.[0]?.candidate?.[0] ?? null;
  const attrMap   = {};
  for (const p of (cap?.Face?.Property ?? [])) {
    if (p.description) attrMap[p.description] = p.value;
  }

  const personName = candidate?.reserve_field?.name ?? null;
  const listType   = candidate?.listType ?? null;
  const fdLibName  = candidate?.FDLibName ?? null;
  const similarity = candidate?.similarity ?? null;
  const humanId    = candidate?.human_id ?? null;

  const rawJson = {
    vendor: 'hikvision',
    eventType: 'faceRecognition',
    personName, listType, fdLibName, similarity, humanId,
    age:            attrMap.age ?? null,
    ageGroup:       attrMap.ageGroup ?? null,
    gender:         attrMap.gender ?? null,
    glass:          attrMap.glass ?? null,
    mask:           attrMap.mask ?? null,
    hat:            attrMap.hat ?? null,
    faceExpression: attrMap.faceExpression ?? null,
    faceScore:      attrMap.score ?? null,
  };
  return { rawJson, personName, listType, fdLibName, similarity };
}

module.exports = { parseFaceAlarmMultipart, faceAlarmToRecord };
