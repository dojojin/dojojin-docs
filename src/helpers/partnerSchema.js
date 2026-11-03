// ============================================================
// Vigil Platform — Partner API surface definition (Phase TP3)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// One description of what /v1 exposes, read by two things that must never
// disagree: routes/partner-api.js, which builds the SQL, and openapi-gen.js,
// which tells partners what to expect.
//
// Kept in one place because the failure mode of two places is a spec that
// documents a column the query does not select, or worse, one it does. A
// generated document is only worth more than a hand-written one if it is
// generated from the same source the code uses.
// ============================================================
'use strict';

// Postgres type -> JSON Schema. Only the types that actually appear across the
// three exposed views; anything unmapped falls back to string rather than
// guessing, because a wrong type in a published contract is worse than a vague
// one.
const TYPE_MAP = {
  'bigint': { type: 'integer', format: 'int64' },
  'integer': { type: 'integer', format: 'int32' },
  'smallint': { type: 'integer', format: 'int32' },
  'real': { type: 'number', format: 'float' },
  'double precision': { type: 'number', format: 'double' },
  'numeric': { type: 'number' },
  'boolean': { type: 'boolean' },
  'timestamp with time zone': { type: 'string', format: 'date-time' },
  'date': { type: 'string', format: 'date' },
  'jsonb': { type: 'object', additionalProperties: true },
  'json': { type: 'object', additionalProperties: true },
  'character varying': { type: 'string' },
  'text': { type: 'string' },
};

// Every column is nullable. That is not laziness — a plate with no region, an
// appearance with no gender and a camera with no coordinates are all normal
// here, and a partner who codes against a non-null contract breaks on the
// first row that omits one.
const pgType = (t) => {
  const base = TYPE_MAP[t] || { type: 'string' };
  return { ...base, type: [base.type, 'null'] };
};

const ENDPOINTS = [
  {
    id: 'listCameras',
    // FC1 — คีย์ใน system_settings ที่คุม retention ของ view นี้ · buildSpec อ่านค่าจริงตอน generate
    retentionKey: null,
    method: 'get',
    path: '/v1/cameras',
    view: 'v_cameras_public',
    summary: 'Cameras this consumer may see',
    description:
      'Reference data. Small and slow-changing — cache it rather than fetching it per event. ' +
      'Scoped to the sites this consumer is bound to.',
    columns: ['id', 'name', 'description', 'site_id', 'latitude', 'longitude',
              'location_label', 'group_id', 'model', 'enabled',
              'last_seen_at', 'last_event_at'],
    timeColumn: null,
    requiredColumns: ['id'],
    params: ['pageSize', 'cursor', 'cameraId'],
  },
  {
    id: 'listLprEvents',
    // FC1 — คีย์ใน system_settings ที่คุม retention ของ view นี้ · buildSpec อ่านค่าจริงตอน generate
    retentionKey: 'lpr_retention_days',
    method: 'get',
    path: '/v1/lpr/events',
    view: 'v_license_plates_public',
    summary: 'Licence plate reads, oldest first',
    description:
      'The continuous feed. Walk it with `cursor`, keep the last `nextCursor` you were given, ' +
      'and resume from it — do not re-derive one from `since`, which replays the tail on every poll. ' +
      '`nextCursor` is null when you have caught up.\n\n' +
      'Descriptive fields (vehicle type, colour, brand, plate type, lane) carry the camera\'s own values, which ' +
      'differ between camera makes; `vehicle_brand` `"0"` means unknown. **`false` in an offence field ' +
      '(`no_helmet`, `no_seatbelt`) is not proof of compliance**: cameras that cannot detect the offence report ' +
      '`false` too.',
    columns: ['id', 'event_id', 'camera_id', 'plate_number', 'confidence',
              'country', 'region', 'bbox_x', 'bbox_y', 'bbox_width',
              'bbox_height', 'detected_at',
              // ขั้น 2 (migration 273) — ค่าเป็นรหัส/คำของกล้องเอง
              'vehicle_type', 'vehicle_color', 'vehicle_brand', 'plate_type', 'plate_color',
              'no_helmet', 'rider_count', 'no_seatbelt', 'lane'],
    timeColumn: 'detected_at',
    requiredColumns: ['id', 'camera_id', 'detected_at'],
    params: ['since', 'until', 'pageSize', 'cursor', 'cameraId'],
    requiredParams: ['since'],
  },
  {
    id: 'listFaceEvents',
    // FC1 — คีย์ใน system_settings ที่คุม retention ของ view นี้ · buildSpec อ่านค่าจริงตอน generate
    retentionKey: 'appearances_retention_days',
    method: 'get',
    path: '/v1/face/events',
    view: 'v_appearances_public',
    summary: 'Detected people and vehicles, oldest first',
    description:
      'Same cursor mechanics as the plate feed. `object_class` says whether a row describes a ' +
      'person or a vehicle; the fields that do not apply are null rather than absent. Attribute values (age ' +
      'group, mask, hat, expression, bag, colours) are the camera\'s own words and differ between camera makes, ' +
      'e.g. `prime` and `middleAged` for age, `yes` or `1` for a mask.',
    columns: ['id', 'event_id', 'camera_id', 'object_id', 'object_class',
              'gender', 'age_group', 'upper_color', 'lower_color',
              'top_category', 'bottom_category', 'hair_length', 'glasses',
              'helmet_wear', 'vehicle_type', 'vehicle_color',
              'confidence', 'detected_at',
              // ขั้น 2 (migration 273)
              'mask', 'hat', 'expression', 'bag_category', 'overall_color', 'hair_color'],
    timeColumn: 'detected_at',
    requiredColumns: ['id', 'camera_id', 'detected_at'],
    params: ['since', 'until', 'pageSize', 'cursor', 'cameraId'],
    requiredParams: ['since'],
  },
  {
    id: 'searchLpr',
    // FC1 — คีย์ใน system_settings ที่คุม retention ของ view นี้ · buildSpec อ่านค่าจริงตอน generate
    retentionKey: 'lpr_retention_days',
    method: 'post',
    path: '/v1/lpr/search',
    view: 'v_license_plates_public',
    summary: 'Find a plate',
    description:
      'POST rather than GET because Thai characters cannot be signed in a query string — they ' +
      'travel percent-encoded and arrive decoded, and two encoders that are both correct produce ' +
      'different strings to sign. A JSON body is signed over its raw bytes, so the question does ' +
      'not arise. 90% of the plates here contain Thai.\n\n' +
      'Exact by default. A partial search needs at least 3 characters and a `since`, because two ' +
      'characters is too short for the index to discriminate and reads several gigabytes.',
    columns: ['id', 'event_id', 'camera_id', 'plate_number', 'confidence',
              'country', 'region', 'bbox_x', 'bbox_y', 'bbox_width',
              'bbox_height', 'detected_at',
              // ขั้น 2 (migration 273) — ค่าเป็นรหัส/คำของกล้องเอง
              'vehicle_type', 'vehicle_color', 'vehicle_brand', 'plate_type', 'plate_color',
              'no_helmet', 'rider_count', 'no_seatbelt', 'lane'],
    timeColumn: 'detected_at',
    requiredColumns: ['id', 'camera_id', 'detected_at', 'plate_number'],
    bodyParams: ['plate', 'exact', 'since', 'until', 'pageSize', 'cursor', 'cameraId'],
  },
  // ── สถิติ (S1 · migration 270) — แถวสรุป ไม่มี id · key ของแถวคือ (เวลา, camera_id) ──────────
  // ส่งตัวนับดิบเท่านั้น ไม่มีอัตรา % (เจ้าของตัดสิน 2026-10-22) · ชื่อคอลัมน์ของ view = ชื่อฟิลด์ = สัญญา /v1
  {
    id: 'statsVehiclesHourly',
    retentionKey: null,
    method: 'get',
    path: '/v1/stats/vehicles/hourly',
    view: 'v_vehicle_stats_hourly_public',
    summary: 'Vehicle counts per camera per hour, by vehicle type',
    description:
      'One row per camera per hour. `vehicles` is the total; `by_type` breaks it down by the class ' +
      'the camera reported, using the camera\'s own codes (e.g. `twoWheelVehicle`, `SUVMPV`, `pickupTruck`, ' +
      '`unknown`). Counts only, no rates.\n\n' +
      '**Recent hours can still change.** Counts are summarised every 15 minutes and reconciled nightly ' +
      'at 05:00 (Asia/Bangkok), so a row may be revised after you read it. Re-read anything whose ' +
      '`updated_at` is newer than your copy. Kept for 120 days.',
    columns: ['hour_start', 'camera_id', 'vehicles', 'by_type', 'updated_at'],
    timeColumn: 'hour_start',
    keyColumn: 'camera_id',
    requiredColumns: ['hour_start', 'camera_id'],
    params: ['since', 'until', 'pageSize', 'cursor', 'cameraId'],
    requiredParams: ['since'],
  },
  {
    id: 'statsLprHourly',
    retentionKey: null,
    method: 'get',
    path: '/v1/stats/lpr/hourly',
    view: 'v_lpr_stats_hourly_public',
    summary: 'Licence plate camera detections per camera per hour',
    description:
      'One row per camera per hour. `detections` counts every vehicle the plate camera reported; ' +
      '`no_plate` is how many of those had no readable plate. Counts only, no rates.\n\n' +
      '**Recent hours can still change** (summarised every 15 minutes, reconciled nightly at 05:00 ' +
      'Asia/Bangkok). Re-read anything whose `updated_at` is newer than your copy.',
    columns: ['hour_start', 'camera_id', 'detections', 'no_plate', 'updated_at'],
    timeColumn: 'hour_start',
    keyColumn: 'camera_id',
    requiredColumns: ['hour_start', 'camera_id'],
    params: ['since', 'until', 'pageSize', 'cursor', 'cameraId'],
    requiredParams: ['since'],
  },
  {
    id: 'statsLprDaily',
    retentionKey: null,
    method: 'get',
    path: '/v1/stats/lpr/daily',
    view: 'v_lpr_stats_daily_public',
    summary: 'Daily plate statistics per camera: province, vehicle type, brand, plate colour, vehicle colour',
    description:
      'One row per camera per day, where the day is the calendar day in **Asia/Bangkok**; `since` and ' +
      '`until` are converted to that calendar day. Each dimension is an object of value to count, for ' +
      'example `region: {"กรุงเทพมหานคร": 812}`. Vehicle types and plate colours are the camera\'s own ' +
      'codes; vehicle colours are the camera\'s own colour names. A dimension you are not granted is absent from the row. ' +
      'Counts only, no rates.\n\n' +
      '**Today and yesterday can still change** (reconciled nightly at 05:00 Asia/Bangkok). Re-read ' +
      'anything whose `updated_at` is newer than your copy.',
    columns: ['day', 'camera_id', 'region', 'vehicle_type', 'vehicle_brand', 'plate_color', 'vehicle_color', 'updated_at'],
    timeColumn: 'day',
    timeType: 'date',
    keyColumn: 'camera_id',
    requiredColumns: ['day', 'camera_id'],
    params: ['since', 'until', 'pageSize', 'cursor', 'cameraId'],
    requiredParams: ['since'],
  },
  // ── สถิติคน (migration 276) — appearance_dim_daily · เก็บ 365 วัน (ข้อมูลดิบ 40) ─────────────────
  {
    id: 'statsPersonDaily',
    retentionKey: null,
    method: 'get',
    path: '/v1/stats/person/daily',
    view: 'v_person_stats_daily_public',
    summary: 'Daily people statistics per camera: gender, age, clothing, accessories, expression',
    description:
      'One row per camera per calendar day in **Asia/Bangkok**, counted by the time the camera saw the object. ' +
      '`since` and `until` are converted to that calendar day. Each dimension is an object of value to count, ' +
      'e.g. `gender: {"male": 812, "female": 640}`.\n\n' +
      '`object_class` counts every detected object (`Person`, `Motorcycle`, `Car`, ...); every other dimension ' +
      'counts people only. Detections the camera did not classify are not counted, so the values of one dimension ' +
      'add up to at most `object_class.Person`; the difference is "not reported". Values are the camera\'s own ' +
      'words and differ between camera makes (e.g. `prime` and `middleAged` for age). Counts only, no rates.\n\n' +
      '**Today and yesterday can still change** (summarised every 15 minutes, reconciled nightly at 05:00 ' +
      'Asia/Bangkok). Re-read anything whose `updated_at` is newer than your copy. Kept for 365 days.',
    columns: ['day', 'camera_id', 'object_class', 'gender', 'age_group', 'upper_color', 'lower_color',
              'top_category', 'bottom_category', 'glasses', 'hat', 'mask', 'expression', 'bag_category', 'updated_at'],
    timeColumn: 'day',
    timeType: 'date',
    keyColumn: 'camera_id',
    requiredColumns: ['day', 'camera_id'],
    params: ['since', 'until', 'pageSize', 'cursor', 'cameraId'],
    requiredParams: ['since'],
  },
  // ── Traffic Enforcement (S2 · migration 271) — ตัวนับดิบ + ตัวหาร ไม่ส่งอัตรา · ไม่มีรายวัน (รวมรายชั่วโมงเองได้ตรง) ──
  {
    id: 'enforcementHourly',
    retentionKey: null,
    method: 'get',
    path: '/v1/enforcement/hourly',
    view: 'v_enforcement_hourly_public',
    summary: 'Traffic offences per camera per hour, with the counts to divide by',
    description:
      'One row per camera per hour. `no_helmet`, `no_seatbelt` and `riders3` are what the camera reported. ' +
      '`no_helmet_with_plate` is the part of `no_helmet` where the plate was read well enough to identify the ' +
      'vehicle by our criteria. Our own dashboard shows the motorcycle part of it, ' +
      '`by_type.twoWheelVehicle.no_helmet_with_plate`; the row totals also include three-wheelers. If we tighten those criteria, rows ' +
      'recorded afterwards follow the new criteria; rows already recorded do not change.\n\n' +
      '`by_type` gives, per vehicle class (the camera\'s own codes), `vehicles` and any offences counted for that ' +
      'class, so a rate can be computed without another call. Counts only, no rates. Zero counts are omitted.\n\n' +
      '**A zero is not proof of compliance.** Many cameras cannot detect some offences. Check ' +
      '`GET /v1/enforcement/cameras` before reading a zero.\n\n' +
      '**Recent hours can still change** (summarised every 15 minutes, reconciled nightly at 05:00 ' +
      'Asia/Bangkok). Re-read anything whose `updated_at` is newer than your copy. Kept for 120 days.',
    columns: ['hour_start', 'camera_id', 'no_helmet', 'no_helmet_with_plate', 'no_seatbelt', 'riders3', 'by_type', 'updated_at'],
    timeColumn: 'hour_start',
    keyColumn: 'camera_id',
    requiredColumns: ['hour_start', 'camera_id'],
    params: ['since', 'until', 'pageSize', 'cursor', 'cameraId'],
    requiredParams: ['since'],
  },
  {
    id: 'enforcementDaily',
    retentionKey: null,
    method: 'get',
    path: '/v1/enforcement/daily',
    view: 'v_enforcement_daily_public',
    summary: 'Traffic offences per camera per day, with the counts to divide by',
    description:
      'The daily form of the hourly offence feed: the same fields, one row per camera per calendar day in ' +
      '**Asia/Bangkok**. `since` and `until` are converted to that calendar day. Counts only, no rates; ' +
      '`by_type` holds the per-class counts to divide by.\n\n' +
      '**A zero is not proof of compliance** — many cameras cannot detect some offences.\n\n' +
      '**Today and yesterday can still change** (summarised every 15 minutes, reconciled nightly at 05:00 ' +
      'Asia/Bangkok). Re-read anything whose `updated_at` is newer than your copy. Kept for about 120 days.',
    columns: ['day', 'camera_id', 'no_helmet', 'no_helmet_with_plate', 'no_seatbelt', 'riders3', 'by_type', 'updated_at'],
    timeColumn: 'day',
    timeType: 'date',
    keyColumn: 'camera_id',
    requiredColumns: ['day', 'camera_id'],
    params: ['since', 'until', 'pageSize', 'cursor', 'cameraId'],
    requiredParams: ['since'],
  },
  {
    id: 'enforcementCameras',
    retentionKey: null,
    method: 'get',
    path: '/v1/enforcement/cameras',
    view: 'v_enforcement_cameras_public',
    summary: 'Which cameras have reported each kind of offence',
    description:
      'One row per camera. `reports_no_helmet` is true when the camera has reported at least one rider without ' +
      'a helmet in the data we keep (120 days), and likewise for the other flags. **false means it has never ' +
      'reported one** — usually because it cannot detect it or detection is not enabled — not that nobody ' +
      'offended. The flags do not depend on any time window you request.',
    columns: ['camera_id', 'reports_no_helmet', 'reports_no_seatbelt', 'reports_riders3', 'first_hour', 'last_hour'],
    timeColumn: null,
    keyColumn: 'camera_id',
    requiredColumns: ['camera_id'],
    params: ['pageSize', 'cursor', 'cameraId'],
  },
];

// Shared parameter definitions, so the spec and the validator in
// partner-api.js describe the same limits.
const PARAM_DOCS = {
  since: {
    in: 'query', description: 'Oldest event to return, ISO 8601. Bounded by this consumer\'s lookback window.',
    schema: { type: 'string', format: 'date-time' },
  },
  until: {
    in: 'query', description: 'Exclusive upper bound, ISO 8601. Omit to include everything up to now.',
    schema: { type: 'string', format: 'date-time' },
  },
  pageSize: {
    in: 'query', description: 'Rows per page, 1 to 1000.',
    schema: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
  },
  cursor: {
    in: 'query', description: 'Opaque. Pass back the `nextCursor` from the previous page; do not construct one.',
    schema: { type: 'string' },
  },
  cameraId: {
    in: 'query', description: 'Restrict to one camera. Must be one this consumer can see.',
    schema: { type: 'string' },
  },
};

// ระยะ 2 ขั้น 1 — endpoint ส่งเฉพาะคอลัมน์ที่ partner ได้สิทธิ์ · requiredColumns คือที่ขาดไม่ได้
// (id/เวลา/camera_id ใช้ทำ cursor, กรองไซต์, เรียงลำดับ · plate_number ใช้ค้นหา) ขาดตัวใดตัวหนึ่ง = 403 ทั้ง endpoint
function resolveColumns(ep, readable) {
  const have = new Set(readable);
  const missingRequired = (ep.requiredColumns || []).filter((c) => !have.has(c));
  const cols = ep.columns.filter((c) => have.has(c));
  return { cols, dropped: ep.columns.filter((c) => !have.has(c)), missingRequired };
}

const PAGE_MAX = 1000;
const PAGE_DEFAULT = 100;
const STATEMENT_TIMEOUT = '5s';
const SKEW_MINUTES = 5;

module.exports = { resolveColumns, ENDPOINTS, PARAM_DOCS, TYPE_MAP, pgType, PAGE_MAX, PAGE_DEFAULT, STATEMENT_TIMEOUT, SKEW_MINUTES };

if (require.main === module) {
  const assert = require('assert');
  // Every endpoint must name a view and at least one column, or the generator
  // would emit a path with an empty response schema.
  for (const e of ENDPOINTS) {
    assert.ok(e.view && e.columns.length, `${e.id} incomplete`);
    assert.ok(e.columns.includes(e.keyColumn || 'id'), `${e.id} key column not selected`);
    assert.ok(e.id && e.path.startsWith('/v1/'), `${e.id} bad path`);
    // A time-ordered feed needs its time column in the selected set, since the
    // cursor is built from it.
    for (const c of e.requiredColumns) assert.ok(e.columns.includes(c), `${e.id} required ${c} not in columns`);
    if (e.timeColumn) assert.ok(e.columns.includes(e.timeColumn), `${e.id} missing ${e.timeColumn}`);
    // Duplicate column names would produce a duplicate JSON Schema property.
    assert.strictEqual(new Set(e.columns).size, e.columns.length, `${e.id} duplicate columns`);
    for (const p of e.params || []) assert.ok(PARAM_DOCS[p], `${e.id} undocumented param ${p}`);
  }
  assert.strictEqual(new Set(ENDPOINTS.map(e => e.id)).size, ENDPOINTS.length, 'duplicate operationId');
  // Nullable everywhere — see the note on pgType.
  assert.deepStrictEqual(pgType('bigint'), { type: ['integer', 'null'], format: 'int64' });
  assert.deepStrictEqual(pgType('something unmapped'), { type: ['string', 'null'] });
  console.log('partnerSchema self-check: all assertions passed');
}
