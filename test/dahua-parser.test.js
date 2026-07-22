// ============================================================
// Vigil Platform — Tests: Dahua CGI protocol parser
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  parseDahuaEventText, parseSnapManagerCode, parseSnapManagerIndex, extractObjectClass, DAHUA_EVENT_MAP,
  deviceKey, codesForCategories, channelAllowsCode, extractFaceAttributes,
  faceComparisonListType, FACE_BLACKLIST_SIM_THRESHOLD,
  parseDahuaTrafficJunction, dahuaRgbaToName, normalizeDahuaEmotion,
} = require('../src/ingesters/dahua-protocol');
const { xyzToColorName } = require('../src/color-utils');

const FIXTURES = path.join(__dirname, 'fixtures/dahua');
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8').trim();

describe('parseDahuaEventText', () => {
  it('returns null for plain Heartbeat body (no Code= field)', () => {
    assert.equal(parseDahuaEventText('Heartbeat'), null);
    assert.equal(parseDahuaEventText(''), null);
  });

  it('parses CrossRegionDetection Enter', () => {
    const r = parseDahuaEventText(fixture('event-cross-region-enter.txt'));
    assert.ok(r, 'should not return null');
    assert.equal(r.code, 'CrossRegionDetection');
    assert.equal(r.action, 'Start');
    assert.ok(r.mapping, 'should have mapping');
    assert.equal(r.mapping.event_type, 'FieldDetector/ObjectsInside');
    assert.equal(r.data.Direction, 'Enter');
    assert.equal(r.data.Object.ObjectID, 42);
    assert.equal(r.data.Object.ObjectType, 'Human');
  });

  it('parses CrossRegionDetection Leave — same code, different direction', () => {
    const r = parseDahuaEventText(fixture('event-cross-region-leave.txt'));
    assert.equal(r.code, 'CrossRegionDetection');
    assert.equal(r.data.Direction, 'Leave');
  });

  it('dedup key includes index, ObjectID and Direction', () => {
    const enter = parseDahuaEventText(fixture('event-cross-region-enter.txt'));
    const leave = parseDahuaEventText(fixture('event-cross-region-leave.txt'));
    assert.equal(enter.dedupKey, 'CrossRegionDetection|0|42|Enter');
    assert.equal(leave.dedupKey, 'CrossRegionDetection|0|42|Leave');
    assert.notEqual(enter.dedupKey, leave.dedupKey, 'Enter and Leave must have different dedup keys');
  });

  it('parses index as the 0-based NVR channel', () => {
    const r = parseDahuaEventText(fixture('event-cross-region-enter.txt'));
    assert.equal(r.index, 0);
  });

  it('dedup key differs across channels for the same code/ObjectID/Direction — NVR case', () => {
    const ch2 = 'Code=CrossRegionDetection;action=Start;index=2;data={"Object":{"ObjectID":7},"Direction":"Enter"}';
    const ch4 = 'Code=CrossRegionDetection;action=Start;index=4;data={"Object":{"ObjectID":7},"Direction":"Enter"}';
    const a = parseDahuaEventText(ch2);
    const b = parseDahuaEventText(ch4);
    assert.equal(a.index, 2);
    assert.equal(b.index, 4);
    assert.notEqual(a.dedupKey, b.dedupKey, 'same code+ObjectID+Direction on different channels must not collide');
  });

  it('parses CrossLineDetection with Vehicle object', () => {
    const r = parseDahuaEventText(fixture('event-line-crossing.txt'));
    assert.equal(r.code, 'CrossLineDetection');
    assert.equal(r.mapping.event_type, 'LineDetector/Crossed');
    assert.equal(r.data.Object.ObjectType, 'Vehicle');
    assert.equal(r.data.Direction, 'LeftToRight');
  });

  it('returns non-null with mapping=null for unmapped code', () => {
    const r = parseDahuaEventText(fixture('event-unmapped-code.txt'));
    assert.ok(r, 'should not return null — caller must handle last_seen_at');
    assert.equal(r.code, 'StorageNotExist');
    assert.equal(r.mapping, null);
  });

  it('returns non-null for Stop action — caller filters it out', () => {
    const r = parseDahuaEventText(fixture('event-stop-action.txt'));
    assert.ok(r, 'should not return null — caller filters action');
    assert.equal(r.action, 'Stop');
    assert.equal(r.code, 'CrossRegionDetection');
  });

  it('handles malformed JSON data gracefully — data stays {}', () => {
    const r = parseDahuaEventText('Code=CrossLineDetection;action=Start;index=0;data={broken json');
    assert.ok(r);
    assert.deepEqual(r.data, {});
  });

  it('dedup key is stable for same ObjectID and Direction', () => {
    const t1 = 'Code=CrossRegionDetection;action=Start;index=0;data={"UTC":1,"Object":{"ObjectID":7},"Direction":"Enter"}';
    const t2 = 'Code=CrossRegionDetection;action=Start;index=0;data={"UTC":2,"Object":{"ObjectID":7},"Direction":"Enter"}';
    assert.equal(parseDahuaEventText(t1).dedupKey, parseDahuaEventText(t2).dedupKey);
  });

  it('dedup key differs for different ObjectIDs (separate persons)', () => {
    const t1 = 'Code=CrossRegionDetection;action=Start;index=0;data={"Object":{"ObjectID":1},"Direction":"Enter"}';
    const t2 = 'Code=CrossRegionDetection;action=Start;index=0;data={"Object":{"ObjectID":2},"Direction":"Enter"}';
    assert.notEqual(parseDahuaEventText(t1).dedupKey, parseDahuaEventText(t2).dedupKey);
  });
});

describe('parseSnapManagerCode', () => {
  it('parses direct Code= format', () => {
    assert.equal(parseSnapManagerCode(fixture('snapmanager-direct.txt')), 'CrossRegionDetection');
  });

  it('parses Events[N].Code= array format', () => {
    assert.equal(parseSnapManagerCode(fixture('snapmanager-array.txt')), 'CrossLineDetection');
  });

  it('returns null for unmapped code in snapManager text', () => {
    assert.equal(parseSnapManagerCode('Code=StorageNotExist;action=Start'), null);
  });

  it('returns null for text with no Code= field', () => {
    assert.equal(parseSnapManagerCode('Heartbeat'), null);
  });
});

describe('parseSnapManagerIndex', () => {
  it('parses direct index= format', () => {
    assert.equal(parseSnapManagerIndex(fixture('snapmanager-direct.txt')), 0);
  });

  it('parses Events[N].Index= array format', () => {
    assert.equal(parseSnapManagerIndex(fixture('snapmanager-array.txt')), 0);
  });

  it('returns null when no index is present', () => {
    assert.equal(parseSnapManagerIndex('Code=CrossRegionDetection;action=Start'), null);
    assert.equal(parseSnapManagerIndex('Heartbeat'), null);
  });

  it('parses a non-zero NVR channel from the array format', () => {
    assert.equal(parseSnapManagerIndex('Events[0].Code=TrafficJunction\nEvents[0].Action=Start\nEvents[0].Index=3'), 3);
  });
});

describe('extractObjectClass', () => {
  it('maps Human → Person', () => {
    assert.equal(extractObjectClass({ Object: { ObjectType: 'Human' } }), 'Person');
  });

  it('maps Vehicle → Vehicle', () => {
    assert.equal(extractObjectClass({ Object: { ObjectType: 'Vehicle' } }), 'Vehicle');
  });

  it('maps NonMotor → Vehicle', () => {
    assert.equal(extractObjectClass({ Object: { ObjectType: 'NonMotor' } }), 'Vehicle');
  });

  it('falls back to Objects[0] when Object is absent', () => {
    assert.equal(extractObjectClass({ Objects: [{ ObjectType: 'Human' }] }), 'Person');
  });

  it('returns null when no object type present', () => {
    assert.equal(extractObjectClass({}), null);
    assert.equal(extractObjectClass(null), null);
  });

  it('passes through unknown types unchanged', () => {
    assert.equal(extractObjectClass({ Object: { ObjectType: 'Motorcycle' } }), 'Motorcycle');
  });
});

describe('DAHUA_EVENT_MAP completeness', () => {
  it('all mapped codes have event_type and rule_name', () => {
    for (const [code, m] of Object.entries(DAHUA_EVENT_MAP)) {
      assert.ok(m.event_type, `${code} missing event_type`);
      assert.ok(m.rule_name, `${code} missing rule_name`);
    }
  });

  it('includes the NVR onboard-AI codes (2026-07-15 multi-channel plan)', () => {
    for (const code of ['TrafficJunction', 'FaceDetection', 'FaceRecognition',
                         'FaceAttribute', 'FaceAnalysis', 'VehicleDetect',
                         'NonMotorDetect', 'HumanTrait', 'FaceComparision']) {
      assert.ok(DAHUA_EVENT_MAP[code], `${code} should be mapped`);
    }
  });
});

describe('extractFaceAttributes', () => {
  it('maps Sex "Man" → gender "Male", "Woman" → "Female"', () => {
    assert.equal(extractFaceAttributes({ Object: { Sex: 'Man' } }).gender, 'Male');
    assert.equal(extractFaceAttributes({ Object: { Sex: 'Woman' } }).gender, 'Female');
  });

  it('unknown/missing Sex → gender null', () => {
    assert.equal(extractFaceAttributes({ Object: {} }).gender, null);
    assert.equal(extractFaceAttributes({}).gender, null);
  });

  it('derives glasses:false from Feature "NoGlasses" (live-verified sample)', () => {
    const r = extractFaceAttributes({ Object: { Sex: 'Man', Age: 58, Feature: ['NoGlasses', 'Neutral'] } });
    assert.equal(r.gender, 'Male');
    assert.equal(r.glasses, false);
    assert.equal(r.age, 58);
  });

  it('derives glasses:true from a "Glasses"-only Feature entry', () => {
    assert.equal(extractFaceAttributes({ Object: { Feature: ['Glasses'] } }).glasses, true);
  });

  it('no Feature array → glasses null (no numeric Glass fallback — unconfirmed enum)', () => {
    assert.equal(extractFaceAttributes({ Object: { Glass: 1 } }).glasses, null);
  });

  it('normalizes Confidence (0-100) to a 0-1 score', () => {
    assert.equal(extractFaceAttributes({ Object: { Confidence: 87 } }).confidence, 0.87);
  });

  it('preserves raw numeric/text fields for later reference', () => {
    const r = extractFaceAttributes({
      Object: { Sex: 'Man', Age: 58, Glass: 1, Mask: 1, Emotion: 'Neutral', Feature: ['NoGlasses', 'Neutral'] },
    });
    assert.deepEqual(r.raw, {
      sex: 'Man', age: 58, glass: 1, mask: 1, emotion: 'Neutral', feature: ['NoGlasses', 'Neutral'],
      beard: null, hat: null,
    });
  });

  it('preserves raw beard/hat fields (2026-07-15) — no enum mapping applied yet', () => {
    const r = extractFaceAttributes({ Object: { Beard: 2, Hat: 0 } });
    assert.equal(r.raw.beard, 2);
    assert.equal(r.raw.hat, 0);
  });

  it('falls back to data.Face when data.Object is absent', () => {
    assert.equal(extractFaceAttributes({ Face: { Sex: 'Woman' } }).gender, 'Female');
  });
});

describe('extractObjectClass — NVR onboard-AI payloads', () => {
  it('TrafficJunction plate object (ObjectType="Plate", live-verified) → Vehicle', () => {
    assert.equal(extractObjectClass({ Object: { ObjectType: 'Plate' } }), 'Vehicle');
  });

  it('FaceRecognition object (ObjectType="HumanFace", live-verified 2026-07-15) → Person', () => {
    assert.equal(extractObjectClass({ Object: { ObjectType: 'HumanFace' } }), 'Person');
  });

  it('payloads with no Object.ObjectType → null', () => {
    assert.equal(extractObjectClass({ Name: 'FaceDetection0' }), null);
  });
});

describe('codesForCategories', () => {
  it('face → the 5 face codes (incl. FaceComparision, 2026-07-15)', () => {
    assert.deepEqual(
      codesForCategories(['face']).sort(),
      ['FaceAnalysis', 'FaceAttribute', 'FaceComparision', 'FaceDetection', 'FaceRecognition'].sort()
    );
  });

  it('anpr → TrafficJunction only', () => {
    assert.deepEqual(codesForCategories(['anpr']), ['TrafficJunction']);
  });

  it('null/empty → every mapped code (capture-all)', () => {
    assert.deepEqual(codesForCategories(null).sort(), Object.keys(DAHUA_EVENT_MAP).sort());
    assert.deepEqual(codesForCategories([]).sort(), Object.keys(DAHUA_EVENT_MAP).sort());
  });

  it('multiple categories union and dedup', () => {
    const codes = codesForCategories(['face', 'anpr', 'face']);
    assert.equal(codes.length, 6); // 5 face codes + TrafficJunction, no duplicates
    assert.ok(codes.includes('TrafficJunction'));
  });

  it('unknown category contributes no codes instead of throwing', () => {
    assert.deepEqual(codesForCategories(['not-a-real-category']), []);
  });
});

describe('channelAllowsCode', () => {
  it('null/empty categories allow everything', () => {
    assert.equal(channelAllowsCode(null, 'VehicleDetect'), true);
    assert.equal(channelAllowsCode([], 'FaceDetection'), true);
  });

  it("['face'] allows FaceDetection, rejects VehicleDetect", () => {
    assert.equal(channelAllowsCode(['face'], 'FaceDetection'), true);
    assert.equal(channelAllowsCode(['face'], 'VehicleDetect'), false);
  });
});

describe('deviceKey', () => {
  it('explicit device_id wins over connection identity', () => {
    assert.equal(
      deviceKey({ device_id: 'hdy-nvr1', ip_address: '172.17.22.10', username: 'admin' }),
      'hdy-nvr1'
    );
  });

  it('falls back to ip:port:user when device_id is absent', () => {
    assert.equal(
      deviceKey({ ip_address: '172.17.22.10', http_port: 80, username: 'admin' }),
      '172.17.22.10:80:admin'
    );
  });

  it('defaults http_port to 80 when absent', () => {
    assert.equal(
      deviceKey({ ip_address: '10.0.0.5', username: 'admin' }),
      '10.0.0.5:80:admin'
    );
  });

  it('two channels sharing ip/port/user resolve to the same device', () => {
    const ch0 = { ip_address: '172.17.22.10', http_port: 80, username: 'admin', nvr_channel: 0 };
    const ch1 = { ip_address: '172.17.22.10', http_port: 80, username: 'admin', nvr_channel: 1 };
    assert.equal(deviceKey(ch0), deviceKey(ch1));
  });

  it('different credentials produce different device keys', () => {
    const a = { ip_address: '172.17.22.10', username: 'admin' };
    const b = { ip_address: '172.17.22.10', username: 'operator' };
    assert.notEqual(deviceKey(a), deviceKey(b));
  });
});

describe('faceComparisonListType', () => {
  it('below threshold → null (every live sample so far — Sim:0)', () => {
    assert.equal(faceComparisonListType(0), null);
    assert.equal(faceComparisonListType(69), null);
  });

  it('at/above threshold → blackList', () => {
    assert.equal(faceComparisonListType(70), 'blackList');
    assert.equal(faceComparisonListType(100), 'blackList');
  });

  it('boundary is inclusive (>=), matches the NVR\'s own configured 70%', () => {
    assert.equal(FACE_BLACKLIST_SIM_THRESHOLD, 70);
    assert.equal(faceComparisonListType(69.99), null);
    assert.equal(faceComparisonListType(70.0), 'blackList');
  });

  it('missing/malformed Sim → null, does not throw', () => {
    assert.equal(faceComparisonListType(null), null);
    assert.equal(faceComparisonListType(undefined), null);
    assert.equal(faceComparisonListType('not-a-number'), null);
  });

  it('custom threshold override', () => {
    assert.equal(faceComparisonListType(50, 50), 'blackList');
    assert.equal(faceComparisonListType(49, 50), null);
  });
});

// ANPR / TrafficJunction plate parser (2026-07-15 ANPR integration) —
// asserted against the real live event (Porsche, plate ศษ4091) captured from
// the ITC237 camera at hdy-anpr1.
describe('parseDahuaTrafficJunction', () => {
  // Trimmed to the fields the parser reads, values verbatim from event 175699.
  const PORSCHE = {
    Lane: 0,
    Object: {
      Text: 'ศษ4091', Speed: 41, Confidence: 222, Province: 'BKK', Country: 'Unknown',
      ObjectType: 'Plate', MainColor: [255, 255, 255, 0],
      MainSeat: { SafeBelt: 'unknow' },
      BoundingBox: [1536, 5960, 2256, 6536],
      OriginalBoundingBox: [360, 849, 528, 925],
    },
    Vehicle: {
      Text: 'Porsche', Category: 'SaloonCar', MainColor: [128, 128, 128, 0],
      VehicleDirection: 'Head', ObjectType: 'Vehicle',
    },
    CommInfo: { Province: 'กรุงเทพมหานคร', Country: 'Unknown' },
  };

  it('parses plate number + full Thai province (prefers CommInfo over BKK short code)', () => {
    const r = parseDahuaTrafficJunction(PORSCHE, xyzToColorName);
    assert.equal(r.plate, 'ศษ4091');
    assert.equal(r.region, 'กรุงเทพมหานคร');
  });

  it('normalizes confidence from 0-255 to 0-100', () => {
    assert.equal(parseDahuaTrafficJunction(PORSCHE, xyzToColorName).confidence, 87); // round(222/255*100)
  });

  it('maps SaloonCar → Hikvision vehicle_type "vehicle" (searchable), keeps rawCategory', () => {
    const r = parseDahuaTrafficJunction(PORSCHE, xyzToColorName);
    assert.equal(r.vehicleType, 'vehicle');     // Hik vocab → object_class Vehicle downstream
    assert.equal(r.rawCategory, 'SaloonCar');   // original Dahua string kept for reference
    assert.equal(r.vehicleBrand, 'Porsche');
  });

  it('maps Pickup → pickupTruck, SUV → SUVMPV, LargeTruck → truck (all live-verified)', () => {
    const mk = (cat) => parseDahuaTrafficJunction({ ...PORSCHE, Vehicle: { ...PORSCHE.Vehicle, Category: cat } }, xyzToColorName).vehicleType;
    assert.equal(mk('Pickup'), 'pickupTruck');
    assert.equal(mk('SUV'), 'SUVMPV');
    assert.equal(mk('LargeTruck'), 'truck');
    assert.equal(mk('Unknown'), null);   // Dahua couldn't classify → null
  });

  it('maps Motorcycle → twoWheelVehicle (live-verified hdy-motor-lotus1)', () => {
    const mk = (cat) => parseDahuaTrafficJunction({ ...PORSCHE, Vehicle: { ...PORSCHE.Vehicle, Category: cat } }, xyzToColorName).vehicleType;
    assert.equal(mk('Motorcycle'), 'twoWheelVehicle');   // → object_class Motorcycle, searchable + moto icon
  });

  it('prefers Object.Speed, falls back to Vehicle.Speed when Object.Speed is invalid (km/h, live-verified)', () => {
    assert.equal(parseDahuaTrafficJunction(PORSCHE, xyzToColorName).speed, 41);  // Object.Speed=41, no Vehicle.Speed
    const bothPresent = { ...PORSCHE, Vehicle: { ...PORSCHE.Vehicle, Speed: 45 } };
    assert.equal(parseDahuaTrafficJunction(bothPresent, xyzToColorName).speed, 41);  // Object.Speed wins even when Vehicle.Speed also present
  });

  it('treats 255 as a sentinel/error value, not a real reading (live-verified: 77/2528 Vehicle.Speed hits)', () => {
    // Object.Speed=255 (invalid) → fall back to Vehicle.Speed
    const objInvalid = { ...PORSCHE, Object: { ...PORSCHE.Object, Speed: 255 }, Vehicle: { ...PORSCHE.Vehicle, Speed: 20 } };
    assert.equal(parseDahuaTrafficJunction(objInvalid, xyzToColorName).speed, 20);
    // Both 255 → null, not 255
    const bothInvalid = { ...PORSCHE, Object: { ...PORSCHE.Object, Speed: 255 }, Vehicle: { ...PORSCHE.Vehicle, Speed: 255 } };
    assert.equal(parseDahuaTrafficJunction(bothInvalid, xyzToColorName).speed, null);
  });

  it('speed is null when neither Vehicle.Speed nor Object.Speed is finite', () => {
    const noSpeed = { ...PORSCHE, Object: { ...PORSCHE.Object, Speed: undefined } };
    assert.equal(parseDahuaTrafficJunction(noSpeed, xyzToColorName).speed, null);
  });

  it('maps Head → in direction, keeps lane', () => {
    const r = parseDahuaTrafficJunction(PORSCHE, xyzToColorName);
    assert.equal(r.direction, 'in');
    assert.equal(r.laneNo, 0);
  });

  it('converts OriginalBoundingBox [x1,y1,x2,y2] → {x,y,width,height}', () => {
    const r = parseDahuaTrafficJunction(PORSCHE, xyzToColorName);
    assert.deepEqual(r.bbox, { x: 360, y: 849, width: 168, height: 76 });
  });

  it('derives colors from RGBA arrays via the shared palette', () => {
    const r = parseDahuaTrafficJunction(PORSCHE, xyzToColorName);
    assert.equal(r.plateColor, 'white');   // [255,255,255]
    assert.equal(r.vehicleColor, 'gray');  // [128,128,128]
  });

  it('no_seatbelt only true on explicit "no" — "unknow" → false', () => {
    assert.equal(parseDahuaTrafficJunction(PORSCHE, xyzToColorName).noSeatbelt, false);
    const belted = { ...PORSCHE, Object: { ...PORSCHE.Object, MainSeat: { SafeBelt: 'no' } } };
    assert.equal(parseDahuaTrafficJunction(belted, xyzToColorName).noSeatbelt, true);
  });

  it('corrects brand OCR quirks (Lsuzu→Isuzu, Hino2→Hino), nulls Unknown, passes others', () => {
    const mk = (t) => parseDahuaTrafficJunction({ ...PORSCHE, Vehicle: { ...PORSCHE.Vehicle, Text: t } }, xyzToColorName).vehicleBrand;
    assert.equal(mk('Lsuzu'), 'Isuzu');
    assert.equal(mk('Hino2'), 'Hino');
    assert.equal(mk('Unknown'), null);   // dropped from the brand chart
    assert.equal(mk('Porsche'), 'Porsche');  // real brand unchanged
  });

  it('unknown vehicle category → null vehicleType (does not guess), rawCategory kept', () => {
    const unknown = { ...PORSCHE, Vehicle: { ...PORSCHE.Vehicle, Category: 'SomeFutureType' } };
    const r = parseDahuaTrafficJunction(unknown, xyzToColorName);
    assert.equal(r.vehicleType, null);
    assert.equal(r.rawCategory, 'SomeFutureType');
  });

  it('returns null when there is no plate text (nothing worth a license_plates row)', () => {
    assert.equal(parseDahuaTrafficJunction({ Object: { Text: '' }, Vehicle: {} }, xyzToColorName), null);
    assert.equal(parseDahuaTrafficJunction({}, xyzToColorName), null);
  });

  it('TrafficJunction maps to anprAlarm event_type', () => {
    assert.equal(DAHUA_EVENT_MAP.TrafficJunction.event_type, 'anprAlarm');
  });

  it('dahuaRgbaToName degrades to null on malformed input', () => {
    assert.equal(dahuaRgbaToName(null, xyzToColorName), null);
    assert.equal(dahuaRgbaToName([1, 2], xyzToColorName), null);
    assert.equal(dahuaRgbaToName([1, 2, 3], null), null);
  });
});

describe('normalizeDahuaEmotion', () => {
  it('maps all 6 live Dahua emotions to the platform vocab', () => {
    assert.equal(normalizeDahuaEmotion('Neutral'), 'neutral');
    assert.equal(normalizeDahuaEmotion('Happy'), 'happy');
    assert.equal(normalizeDahuaEmotion('Confused'), 'confused');
    assert.equal(normalizeDahuaEmotion('Disgust'), 'disgusted');
    assert.equal(normalizeDahuaEmotion('Surprise'), 'surprised');
    assert.equal(normalizeDahuaEmotion('Sadness'), 'sad');
  });
  it('unmapped → lowercase; null/empty → null', () => {
    assert.equal(normalizeDahuaEmotion('Anger'), 'anger');
    assert.equal(normalizeDahuaEmotion(null), null);
    assert.equal(normalizeDahuaEmotion(''), null);
  });
});
