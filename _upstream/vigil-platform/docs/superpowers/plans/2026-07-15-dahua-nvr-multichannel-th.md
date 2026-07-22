# แผนงาน: รองรับ Dahua NVR หลาย Channel + ตัวกรอง Event แบบยืดหยุ่นต่อ Channel

**Status:** 🟡 วางแผนแล้ว 2026-07-15 (อนุมัติแล้ว กำลัง implement)
**Site:** HDY (edge node `hdy`, NVR ที่ `172.17.22.10` — Dahua DHI-NVR5216-16P-I/L, 16 channel)
**Author:** Prakasit Rochanavipart (Dojo-mAn) — วางแผนผ่าน Advisor-led cycle (Explore agent 2 ตัว + Plan agent)

> ไฟล์นี้เป็นฉบับแปลไทยของ [`2026-07-15-dahua-nvr-multichannel.md`](2026-07-15-dahua-nvr-multichannel.md) — ศัพท์เทคนิค/ชื่อไฟล์/โค้ดคงเป็นภาษาอังกฤษตามธรรมเนียมโปรเจกต์

---

## ปัญหา

`src/ingesters/dahua-cgi.js` ถูกออกแบบมาสำหรับ **กล้อง IP เดี่ยวที่ edge**: 1 config entry = 1 `camera_id` = 1 IP = 1 CGI event stream ที่เป็นของกล้องตัวนั้นทั้งหมด แต่ NVR ที่ HDY ทำลาย assumption เหล่านี้ทุกข้อ — NVR ตัวเดียวมี 16 channel ที่ส่ง event ผ่าน **stream เดียวปนกันหมด** โดย channel ถูกฝังอยู่แค่ใน header ของ event บรรทัด `Code=X;action=Y;index=N` (ยืนยันจากของจริงแล้ว: `index` = channel เริ่มที่ 0; ตัว JSON body ไม่มี field `Channel` เลย) ปัจจุบัน `parseDahuaEventText` ทิ้งค่า `index` ไป, `DAHUA_EVENT_MAP` ไม่มีโค้ด AI ของตัว NVR เอง (Face/ANPR/Vehicle), และ path ของ snapshot/RTSP hardcode `channel=1` ไว้ตายตัว

**เป้าหมาย:** ทำให้ NVR หนึ่งตัวตั้งค่าเป็นกล้อง logical ได้ N ตัว (1 `camera_id` ต่อ 1 channel) route event ไปยัง channel ที่ถูกต้อง และให้ operator เลือกได้ว่าจะเอา **channel ไหน** และ **event category ไหน** เข้าระบบ (เอาแต่ face, เอาแต่ ANPR, เลือกบางตัว, หรือเอาทั้งหมด) ให้ยืดหยุ่นที่สุด

## เงื่อนไขที่ตกลงกับเจ้าของแล้ว (2026-07-15)

- **ทำ Phase 1 ก่อน** — ANPR (`TrafficJunction`) จะเก็บเป็น generic event ทั่วไป (เก็บทะเบียน+จังหวัดไว้ใน `raw_json`) ส่วน LPR เต็มระบบ (→ ตาราง `license_plates`, watchlist, gates) เป็น Phase 2
- **Authoring แบบ JSON ก่อน** — Phase 1 ใช้ `cameras-config.json` / `POST /api/cameras` เดิมที่มีอยู่แล้ว ส่วน UI บน dashboard + DB column เป็น Phase 3
- **เริ่มที่ Face ch0-1 ก่อน** (dry-run ทีละ channel ก่อน แล้วค่อยเพิ่ม ch1) เพื่อยืนยันว่า NVR เปิด stream ร่วมกันแค่ชุดเดียวจริง ก่อนจะขยายเพิ่ม

## หลักการออกแบบ

**คง 1 `camera_id` = 1 channel = 1 แถวใน DB เหมือนเดิม; ทำให้แค่ชั้น CONNECTION เท่านั้นที่รู้จัก device** ทุกอย่างที่อยู่หลัง `ingestEvent` (INSERT DB, `pg_notify`, alertEngine, MQTT snapshot topic, `publishEdgeEvent`, `last_seen`) ใช้ `cam.camera_id` เป็น key เหมือนเดิมไม่เปลี่ยน — เปลี่ยนแค่ชั้น HTTP connection ที่จะ group config entry ของ Dahua ตาม device (`ip:port:user` หรือ `device_id` ที่ระบุเอง) แล้วเปิด eventManager **1 เส้น** + snapManager **1 เส้น** ต่อ NVR จริง 1 ตัว จากนั้น route event ไปแต่ละ channel ด้วย `index=N`

**แนวทางที่ไม่เลือก:** เปิด stream แยกต่อ channel (16 entries → 32 concurrent CGI session บน NVR ที่มี VMS client อื่นต่ออยู่แล้ว — เสี่ยงชนขีดจำกัด concurrent session ของ NVR); ทำ config แบบ nested `channels:[]` (ทำลายคุณสมบัติ config แบบ flat ที่ push จาก central ไป edge ได้โดยไม่ต้องแก้ transport และ schema ตาราง `cameras` ที่เป็น flat table)

## Field ใหม่ใน config (แบบ flat, 1 entry ต่อ 1 channel)

```jsonc
{
  "camera_id": "hdy-nvr1-ch0",
  "vendor": "dahua",
  "ip_address": "172.17.22.10",
  "username": "admin", "password": "…",
  "nvr_channel": 0,                  // ใหม่ — เริ่มที่ 0, ตรงกับ index=N ใน eventManager
  "device_id": "hdy-nvr1",           // ใหม่ (optional) — key สำหรับ group device เอง
  "capture_categories": ["face"]     // ใหม่ (optional) — allow-list; ไม่ใส่ = เอาทุก type ที่ map ไว้
}
```
Backward-compatible: entry ที่ไม่มี `nvr_channel` = device channel เดียว (พฤติกรรมเดิมเป๊ะ ไม่กระทบของเก่า)

## ตาราง Category → Dahua code

```
face     → FaceRecognition, FaceDetection, FaceAttribute, FaceAnalysis
anpr     → TrafficJunction
vehicle  → VehicleDetect, SmartMotionVehicle
nonmotor → NonMotorDetect
person   → HumanTrait, SmartMotionHuman
rule     → CrossLineDetection, CrossRegionDetection, LeftDetection, TakenAwayDetection, VideoBlind
```
กรอง 2 ชั้น: subscription ของทั้ง device = union ของ code ที่ทุก channel ต้องการ; หลังรับ event มาแล้วกรองอีกชั้นตาม channel เพื่อตัด code ที่ channel นั้นไม่ได้ขอ

## งาน Implementation (Phase 1)

- **`src/ingesters/dahua-protocol.js`** (pure function) — parse `index=N`, เอาไปรวมใน dedupKey; ขยาย `DAHUA_EVENT_MAP` เพิ่มโค้ด AI ของ NVR; helper ใหม่ `deviceKey`, `codesForCategories`, `channelAllowsCode`
- **`src/ingesters/dahua-cgi.js`** — ทำ device registry (`_devices: deviceKey → {channels: Map<nvr_channel, cam>}`); `connectCamera`→`connectDevice`; snapManager ต่อ device (เอา hardcode `channel=1` ออก); `parseDahuaEvent` resolve channel cam + กรองตาม filter; `cameraConfigSignature`/`syncCameras`/reconnect ทำงานระดับ device; snapshot/`_eventSnaps`/`waitForEventSnapshot` รู้จัก channel
- **`src/media-recorder.js`** — Dahua RTSP `buildRtspUrl`: ใช้ `channel=(nvr_channel||0)+1` แทน hardcode `channel=1`
- **`src/routes/cameras.js`** — `POST /api/cameras` บันทึก `nvr_channel` + `capture_categories` ลง config entry
- **Tests** — เพิ่มใน `test/dahua-parser.test.js` (index/dedup/category/deviceKey/ความครบของ map) + test แยก snapshot ตาม channel

## Phase 2 และ 3 (ยังไม่ทำรอบนี้)

- **Phase 2:** adapter `parseDahuaTrafficJunction()` → branch `preParsed` ใน `ingestLprPush` → เข้า `license_plates` (ต้องดู payload `TrafficJunction` จริงก่อน เพื่อรู้ว่าจะเอารูป plate crop มาจากไหน)
- **Phase 3:** เพิ่ม DB column `cameras.nvr_channel`/`capture_categories` + ทำ UI ใน `page-camera-settings.js` (ลอกแบบ checkbox ของ `ignore_event_types` เดิม)

## แผน Verify

1. Unit test เขียวก่อน (pure module ไม่ยิงไป NVR จริง)
2. Dry-run channel เดียว: เปิดแค่ ch0 Face → เช็คว่า NVR มี eventManager session เดียว + snapManager session เดียวจริง, `camera_id`/`index`/snapshot ถูกต้อง
3. เพิ่ม ch1 → เช็คว่ายังเป็น 1+1 session ไม่ใช่ 2+2 (กันชนขีดจำกัด session — NVR ตัวนี้มี VMS client อื่นต่ออยู่แล้ว)
4. เก็บ raw event line ของ `TrafficJunction` ไว้ 1 อัน เพื่อ lock schema ของทะเบียนรถไว้ใช้ทำ Phase 2

## ความเสี่ยง

ขีดจำกัด concurrent session (เสี่ยงสุด — ออกแบบให้คงที่ 2 session/device); index เริ่มที่ 0 vs channel RTSP/CGI snapshot เริ่มที่ 1 (ต้องบวก 1 ให้ถูกจุด); snapshot ผิด channel ถ้า snap part ไม่ tag channel มา (fallback ไป RTSP buffer ที่ channel ถูกต้องอยู่แล้ว); dedup ชนกันข้าม channel ถ้าไม่ใส่ channel ใน key; `event_type` ใหม่อาจยังไม่มี alert rule จนกว่าจะ seed เพิ่ม

---

*อ้างอิงเพิ่มเติม: [`docs/LOGIC_dahua-ingester.md`](../../LOGIC_dahua-ingester.md), Claude Code plan file `mighty-dazzling-twilight.md` (แผนฉบับเต็มที่ Advisor review แล้ว มีเลขบรรทัดโค้ดชัดเจน)*
