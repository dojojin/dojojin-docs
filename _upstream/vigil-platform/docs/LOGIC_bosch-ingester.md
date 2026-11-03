# LOGIC_bosch-ingester — Bosch ONVIF Profile M / MQTT Ingester

> บันทึกครบวงจรสำหรับเส้นทาง ingest ของกล้อง Bosch ใน `src/mqtt-subscriber.js`
> เป้าหมาย: AI agent อ่านไฟล์นี้แล้ววิเคราะห์หรือต่องานได้ทันที ไม่ต้องไล่อ่านโค้ดใหม่ทั้งหมด
> Last updated: 2026-08-06
>
> **เอกสารต้นทางของผู้ผลิต:**
> `docs/vendor/bosch/ONVIF_Profile_M_MQTT_Event_Broker_TechNote.pdf` (24 หน้า, Bosch, 2021-11-12)
> — สเปก **JSON schema ของ event ที่กล้องส่งผ่าน MQTT** = ตรงกับสิ่งที่ไฟล์นี้อธิบาย
> `docs/vendor/bosch/RCP_doc_9_41_0019.pdf` (1,380 หน้า) — RCP+ v3 คนละเรื่อง เป็นโปรโตคอล
> **ควบคุม/อ่านสถานะอุปกรณ์** — ใช้จริงแล้วผ่าน CGI ใน `helpers/boschRcp.js` (ดู §9.5)

---

## สารบัญ

1. [ภาพรวม Architecture](#1-ภาพรวม-architecture)
2. [Transport: MQTT + ONVIF Profile M](#2-transport-mqtt--onvif-profile-m)
3. [Topic Structure & Routing](#3-topic-structure--routing)
4. [JSON Payload Shape](#4-json-payload-shape)
5. [Category: RuleEngine](#5-category-ruleengine)
6. [Category: IVA](#6-category-iva)
7. [Category อื่น ๆ (VideoSource / Device / RecordingConfig)](#7-category-อื่น-ๆ)
8. [Snapshot จาก MQTT (base64)](#8-snapshot-จาก-mqtt-base64)
9. [Auto-configure Event Broker (ONVIF AddEventBroker)](#9-auto-configure-event-broker)
9.5 [RCP+ over CGI — storage/recording](#95-rcp-over-cgi--อ่านสถานะ-storagerecording-จากกล้อง)
9.6 [`CONF_ACTIVE_CONNECTION_LIST` — มีจริงแต่ยังไม่ได้ใช้](#96-conf_active_connection_list--มีจริงแต่ยังไม่ได้ใช้)
9.7 [ONVIF Metadata Track (RTSP) — มีอะไรอยู่ในนั้นบ้าง](#97-onvif-metadata-track-rtsp--มีอะไรอยู่ในนั้นบ้าง)
10. [ปัญหาที่พบและวิธีแก้ (Incident Log)](#10-ปัญหาที่พบและวิธีแก้-incident-log)
11. [งานที่ยังค้างอยู่](#11-งานที่ยังค้างอยู่)
12. [Related Files](#12-related-files)

---

## 1. ภาพรวม Architecture

Bosch เป็น vendor **ตั้งต้น** ของระบบนี้ — ต่างจาก Hikvision/Dahua ที่เพิ่มเข้ามาทีหลังและมี
ingester แยกไฟล์ (`src/ingesters/*.js`) **Bosch ไม่มีไฟล์ ingester ของตัวเอง** โค้ดอยู่ใน
`src/mqtt-subscriber.js` ซึ่งเป็น MQTT consumer กลางที่ใช้ร่วมกับทุก vendor ที่ส่งผ่าน MQTT

```
กล้อง Bosch ──(ONVIF Profile M / MQTT publish)──► MQTT broker ──► mqtt-subscriber ──► Postgres
                                                  (EMQX central /
                                                   NanoMQ ที่ edge)
```

**ต่างจาก Hikvision/Dahua ตรงที่:** เราไม่ได้ "ดึง" (pull) จากกล้อง — กล้อง **publish เอง**
ตามสเปก ONVIF Profile M ไม่มี connection ค้างจากฝั่งเราไปที่กล้องเลย

| | Bosch | Hikvision | Dahua |
|---|---|---|---|
| Transport | MQTT (publish) | ISAPI alertStream (pull) / Alarm Server (push) | CGI (pull) |
| ไฟล์ | `src/mqtt-subscriber.js` (ใช้ร่วม) | `src/ingesters/hikvision-isapi.js` | `src/ingesters/dahua-*.js` |
| Payload | JSON | multipart (XML + JSON + JPEG) | multipart / CGI text |

**เวอร์ชันเฟิร์มแวร์ขั้นต่ำ:** ONVIF Profile M + MQTT รองรับบน CPP6 / CPP7 / CPP7.3
ตั้งแต่เฟิร์มแวร์ **7.81.0060** ขึ้นไป (ระบุใน TechNote §1.1)

---

## 2. Transport: MQTT + ONVIF Profile M

- กล้องเชื่อมด้วย **MQTT 3.11** (TechNote §1.3)
- กล้อง 1 ตัวตั้ง broker ได้สูงสุด **4 ตัว** — แต่ละ broker = Metadata RTSP stream เพิ่ม 1 เส้น
  → ยิ่งหลาย broker ยิ่งกินโหลดกล้อง (TechNote §2.2)
- รองรับ QoS 0/1/2 — **ระบบเราตั้ง QoS 0** ทั้งฝั่ง subscribe (`mqtt-subscriber.js`)
  และฝั่ง `AddEventBroker` (`lpr-receiver.js`)
- TechNote ระบุว่า Address รองรับเฉพาะ **IP address** ไม่รองรับ hostname/cloud broker URL

---

## 3. Topic Structure & Routing

รูปแบบตามสเปก: `<TopicPrefix>/onvif-ej/<Category>/<...>`

`TopicPrefix` = **`camera_id` ของเรา** (ตั้งตอน `AddEventBroker` — ดู §9)
ส่วน `onvif-ej` เป็นค่าคงที่ของ Bosch

```
BOSCH_3100i_02/onvif-ej/RuleEngine/LineDetector/Crossed/&1/Crossing line 2
BSH-HDY-4038/onvif-ej/IVA/CrossingLine/Crossing_line_2/&1
```

**`&1` = video source number** — กล้องส่วนใหญ่มี source เดียว แต่รุ่นอย่าง MIC IP fusion 9000i
และ FLEXIDOME multi 7000i มีหลาย source (`&2`, `&3`, `&4`)

### Subscription list (`src/mqtt-subscriber.js`)

```js
['+/onvif-ej/RuleEngine/#', '+/onvif-ej/VideoSource/#',
 '+/onvif-ej/Device/#',     '+/onvif-ej/RecordingConfig/#',
 'projects/+/#']
```

> ⚠️ **จุดที่เข้าใจผิดง่าย:** 4 บรรทัดแรก **ไม่มี `IVA`** — แต่ IVA event เข้าระบบได้ปกติ
> เพราะกล้อง Bosch ทุกตัวตอนนี้อยู่ที่ edge site (hdy/vss) และ topic ของ edge ทั้งหมด
> ถูกครอบด้วย wildcard **`projects/+/#`** (ยืนยันจาก DB: IVA 46,155 แถว)
> **ถ้าวันใดมีกล้อง Bosch ต่อ broker กลางตรง ๆ** (ไม่ผ่าน edge) topic จะเป็น
> `<camId>/onvif-ej/IVA/...` ซึ่ง **ไม่ตรง 4 pattern แรก → จะหายจริง**
> ปัจจุบันยังไม่มีกล้องแบบนั้น (ตรวจ 2026-08-05: Bosch ทั้ง 6 ตัวอยู่ hdy/vss)

### Site prefix strip

edge bridge ส่งต่อ topic ใต้ `projects/<site>/…` → ตัดออกก่อน process:

```js
function _stripSitePrefix(topic) {
  if (!topic.startsWith('projects/')) return topic;
  return topic.split('/').slice(2).join('/');
}
```
→ `projects/hdy/BSH-HDY-4038/onvif-ej/...` กลายเป็น `BSH-HDY-4038/onvif-ej/...`

### Event ที่ถูกทิ้งเสมอ (`IGNORED_EVENT_TYPES`)

`MotionAlarm` (noise มาก) · `JobState` (ใช้ ONVIF poll แทน) · `heartbeat` (touchCamera อย่างเดียว)

---

## 4. JSON Payload Shape

โครงสร้างมาตรฐานทุก category (TechNote §3):

```json
{
  "UtcTime": "2026-08-05T15:19:01.813Z",
  "Source":  { "VideoSource": "1", "Rule": "Crossing line 2" },
  "Data":    { "State": "false" }
}
```

| field | หมายเหตุ |
|---|---|
| `UtcTime` | **UTC อยู่แล้ว** ไม่ต้องแปลง timezone — เก็บเป็น ISO string ตรง ๆ |
| `Source.VideoSource` | RuleEngine ใช้ชื่อนี้ |
| `Source.Source` | **IVA ใช้ชื่อนี้แทน** — โค้ดอ่านทั้ง 2 แบบ: `msg.Source?.VideoSource \|\| msg.Source?.Source` |
| `Source.Rule` | ชื่อ rule ที่ตั้งบนกล้อง → `events.rule_name` |
| `Data` | เนื้อหาต่างกันตาม category — ดูหัวข้อถัดไป |

> **ชื่อ rule ที่มีเว้นวรรค:** ใน topic ของ IVA เว้นวรรคถูกแทนด้วย `_`
> (`"Crossing line 2"` → `Crossing_line_2`) แต่ใน `Source.Rule` ยังเป็นเว้นวรรคปกติ

---

## 5. Category: RuleEngine

`Data` ต่างกันตาม detector — **แต่การดึง object payload (`Data.Object.Object`) ไม่ได้ gate
เฉพาะ `ObjectDetection`** โค้ดดึงให้ทุก detector ที่มี field นี้แนบมา รวมถึง `LineDetector`
(ยืนยันจริง 2026-08-18 — ดูหัวข้อ "LineDetector มี object_class จริง" ด้านล่าง):

| detector | field ที่อ่าน | เก็บลง |
|---|---|---|
| `CountAggregation` | `Data.Count` | `count` (ใน raw_json) |
| `FieldDetector` | `Data.Status` หรือ `Data.IsInside` | `event_state` |
| `LineDetector` | `Data.Object.Object` (ถ้ากล้องแนบมา) | object_class / likelihood — ดูด้านล่าง |
| `Recognition` | `Data.LicensePlateInfo.*` (LPR) | plate + snapshot |
| `ObjectDetection` | `Data.Object.Object` | object_class / likelihood / geo |

### Object payload (สำคัญ)

```js
const obj = msg.Data?.Object?.Object   // ← Bosch canonical (8100i/3100i, IVA Basic)
         || msg.Data?.Object           // ← ONVIF ทั่วไป (non-Bosch) fallback
```

ดึงออกมา: `@ObjectId` · `Appearance.Class.Type.#text` (class) · `@Likelihood` ·
`Behaviour.Speed` · `Appearance.GeoLocation.@lat/@lon/@elevation`

> **แก้ไข 2026-08-18 — ข้อความเดิมผิด:** เคยเขียนว่า object_class/likelihood **ต้อง**ทำ
> Camera + Object Calibration ก่อนถึงจะมา ไม่งั้น null เสมอ — **ไม่จริงเสมอไป** ยืนยันสดจาก
> `BH5100i_RMUTR-V_01` (rmutr-v): rule "Vehicle Count" ยิง 2 topic คู่ขนาน — `IVA/CrossingLine/…`
> (payload แค่ `{State: bool}` ไม่มี class เลยโดยโครงสร้าง ไม่เกี่ยวกับ calibration) กับ
> `RuleEngine/LineDetector/Crossed/…/Vehicle Count` ที่ **มี `Class.Type="Car"` likelihood 0.97-1.0
> จริง โดยไม่ทราบว่าทำ calibration ไว้หรือยัง** — DB ยืนยัน `object_class` ลงถูกทั้ง Car/Motorcycle
> **บทสรุปที่แม่นกว่า:** class พื้นฐาน (Car/Person/Motorcycle) มาได้แม้ไม่ calibrate — calibration
> น่าจะจำเป็นเฉพาะบาง field/บาง class ละเอียดกว่านั้น (เช่น speed, geo, แยก Truck/Bus ที่ต้องรู้
> ขนาดจริง) ตรงกับ hint บนหน้ากล้องเองที่เขียนว่า "**Some** classes are only available for
> calibrated cameras" — คำว่า *some* ไม่ใช่ *all*
>
> **สิ่งที่ยังคงจริง:** topic คนละอันมี payload คนละแบบ — ถ้าจะเอา class ต้องอ่านจาก
> `RuleEngine/LineDetector/Crossed` ไม่ใช่ `IVA/CrossingLine` (topic หลังไม่มีทางมี class
> ไม่ว่ากรณีไหน เพราะ Bosch ออกแบบให้เป็น pulse ล้วน)

---

## 6. Category: IVA

Bosch ส่ง IVA rule บน **topic tree ของตัวเอง แยกจาก RuleEngine** (TechNote §3.2)
— เหตุการณ์เดียวกันอาจมาทั้ง 2 ทางคู่ขนาน (เห็นจริงกับ `BSH-HDY-4038`: มาทั้ง
`IVA/CrossingLine/…` และ `RuleEngine/LineDetector/Crossed/…`)

### 9 rule ที่เอกสารระบุ

`ObjectInField` · `Loitering` · `CrowdDetection` · `EnteringField` · `LeavingField` ·
`IdleObject` · `RemovedObject` · `FollowRoute` · `Counter`

**ทั้ง 9 ใช้ payload รูปเดียวกันหมด:** `Data: { State: <bool> }`

### ที่พบจริงใน production (2026-08-05)

| camera | event_type | จำนวน |
|---|---|---|
| `BSH-HDY-4038` | `CrossingLine/Crossing_line_2/&1` | 27,381 |
| `BOSCH_3100i_02` | `ObjectInField/Detect_moving_objects/&1` | 17,961 |
| `BSH-HDY-4038` | `ObjectInField/Object_in_field_1/&1` | 813 |

> 🔴 **`CrossingLine` ไม่มีอยู่ในรายการ 9 ตัวของเอกสาร** แต่มาจริงมากที่สุด (27k แถว)
> → **ห้ามเขียนโค้ดแบบ enumerate ชื่อ rule** ใช้การอ่าน `Data.State` แบบ generic เท่านั้น
> (โค้ดปัจจุบันทำแบบ generic แล้ว)

rule ที่เหลือยังไม่เคยเห็นเพราะ**ยังไม่มีกล้องตัวไหนตั้ง rule เหล่านั้น** — ไม่ใช่เพราะรับไม่ได้

---

## 7. Category อื่น ๆ

| category | field | หมายเหตุ |
|---|---|---|
| `VideoSource` | `Data.State` | MotionAlarm (ถูก ignore), SignalLoss, GlobalSceneChange, ImageTooDark/Bright/Blurry |
| `Device` | `Data.LogicalState` | Trigger/Relay (`active`/`inactive`), Trigger/DigitalInput (`true`/`false`) |
| `RecordingConfig` | `Data.State` | JobState — **ถูก ignore** ใช้ ONVIF poll แทน |

---

## 8. Snapshot จาก MQTT (base64)

Bosch แนบภาพ base64 มากับ event ได้ — chain การหา (เรียงตามลำดับที่ลอง):

```js
_str(obj?.Appearance?.Image)        // Bosch IVA Pro FW 9.x — string ล้วน (ไม่ใช่ object)
|| obj?.Appearance?.Image?.Data     // IVA Pro 3D (object form)
|| obj?.Appearance?.Image?.['#text']// XML-style ONVIF
|| _str(obj?.Appearance?.Snapshot)  // firmware เก่า
```
แล้ว fallback ต่อที่ระดับ `msg.Data.Image` / `.Snapshot` / `.Picture.Data`

> ต้องเช็ค **string ก่อน object** เพราะ FW 9.80.106 ส่ง `Appearance.Image` เป็น
> base64 string ล้วน ถ้าเช็ค object ก่อนจะ miss
> base64 ถูก strip ออกก่อนเก็บ `raw_json` (`stripLargeStrings`) กัน DB บวม

---

## 9. Auto-configure Event Broker

`POST /event-broker-configure` (`src/lpr-receiver.js`) — สั่งกล้องให้ push มาที่ broker ของ
edge เอง โดยไม่ต้องเปิด Bosch Configuration Manager

- ใช้ ONVIF SOAP operation ชื่อ **`AddEventBroker`** (ไม่ใช่ `CreateEventBroker` ซึ่งไม่มีจริง
  ใน ONVIF Events WSDL — เป็นสาเหตุที่ Phase 0 เคยล้มเหลว)
- **additive เท่านั้น** — broker อื่นที่ตั้งไว้จาก Configuration Manager ไม่ถูกแตะ
- match ด้วย **Address + TopicPrefix ทั้งคู่** — ถ้า prefix ผิด (เช่นพิมพ์มือไว้)
  `mqtt-subscriber` จะ route ไม่เจอ (มัน match `parts[0] === camera_id`) แล้ว event
  จะหายเงียบ ๆ ทั้งที่หน้าจอกล้องขึ้นว่า Connected
- ตั้ง `QoS=0`

---

## 9.5 RCP+ over CGI — อ่านสถานะ storage/recording จากกล้อง

`src/helpers/boschRcp.js` · รันที่ **edge** (`edge-config-agent` `pollSdStatusOnce`)
ไม่ใช่ที่ central เพราะกล้องอยู่หลัง LAN ของไซต์

**ไม่ใช่ binary protocol** — ใช้ RCP+ ที่ tunnel ผ่าน CGI (`/rcp.xml`, spec §1.7)
เป็น HTTP ธรรมดา + digest auth (`helpers/digestAuth` ที่มีอยู่แล้ว) ตอบกลับเป็น XML
**ไม่ต้องแตะ TCP 1756 / TPKT / client registration เลย**

```
GET /rcp.xml?command=0x0b89&type=T_WORD&direction=READ&num=1
→ <rcp>…<result><hex>0x0001</hex></result></rcp>
```

### ⚠️ เลขใน TOC ของเอกสารเป็น "เลขหน้า" ไม่ใช่ tag code

กับดักที่เสียเวลาไปจริง — ต้องเปิดหน้าของคำสั่งนั้นถึงจะเจอ tag code
เดาจาก TOC จะได้ `err 0x40` (invalid command)

### tag code ที่ probe แล้วใช้ได้จริง (2026-08-05)

| คำสั่ง | tag | หน้า | ได้อะไร |
|---|---|---|---|
| `CONF_SD_CARD_STATUS` | `0x0b89` | 929 | bit0 = มีการ์ด · bit1 = SD/CF |
| `CONF_SD_CARD_LIFE_SPAN_STATUS` | `0x0c5a` | 926 | ยี่ห้อ/รุ่น/ความจุ(NUM_BLOCKS×512)/serial/อายุ% |
| `CONF_STORAGE_REPORT` | `0x09cf` | 1056 | availability · access RW/RO · IO error · throughput |
| `CONF_STORAGE_MEDIUM_AVAIL` | `0x09d4` | 1053 | ชนิด storage ที่มี |
| `CONF_STORAGE_LOAD` | `0x0bba` | 1052 | **%used** — ดูข้อจำกัดด้านล่าง |
| `CONF_RECORDING_STATUS` | `0x0a9b` | 896 | OFFLINE/PEND/**RUNNING**/ERROR + datarate |
| `CONF_RECORDING_RETENTION_TIME` | `0x0a30` | 894 | retention (วินาที) |
| `CONF_ACTIVE_CONNECTION_LIST` | `0xffc1` | 76 | RCP+ media session — **ดู §9.6** |

`0x0a9b` ต้องส่ง payload: `camera(1) + recIdx(1) + reserved(50)` — camera=1 ใช้ได้ทั้ง 2 รุ่นที่ทดสอบ

### ข้อจำกัดที่เจอจากของจริง (ไม่ใช่จากเอกสาร)

- **`STORAGE_LOAD` ใช้ไม่ได้ทุกรุ่น** — เอกสารระบุ CPP6/7/7.3 = yes, **CPP13/CPP14 = no**
  ตรงกับที่ probe: `BSH-HDY-4038` (fw 7.93) ตอบ 4% ส่วน `BOSCH_3100i` (fw 09.82) ตอบ `err 0x40`
  → UI ต้องซ่อน used/free เมื่อไม่มีค่า **ห้ามคำนวณเป็น 0** (เคยพลาดมาแล้ว — incident #3)
- **`LIFE_SPAN_PERCENT_DONE` การ์ดส่วนใหญ่ไม่รายงาน** — spec p.928 "only for supported cards"
  Sandisk SN256/SC64G ทั้งคู่ไม่มี → ต้องเช็ค null ไม่ใช่ default 0
- **datarate ใน `0x0a9b` ไม่มีหน่วยระบุในเอกสาร** → เก็บเป็น `bosch_datarate_raw`
  **ห้าม map เป็น bitrate_kbps** เพราะจะโชว์เลขผิดหน่วยบนหน้าจอ
- **HTTP 200 ไม่ได้แปลว่าสำเร็จ** — กล้องตอบ 200 พร้อม `<err>0x40</err>` เมื่อรุ่นนั้นไม่รองรับ
  `parseRcpXml()` จึงเช็ค `<err>` ก่อนเสมอ

### ทำไม output ถึงหน้าตาเหมือน Hikvision

`buildBoschSdDetail()` จงใจคืน shape เดียวกับ `helpers/hikStorage.js buildSdDetail()`
→ `dashboard/page-cameras.js recBoxHik()` render ได้เลยโดยไม่ต้องเขียน UI ใหม่
(เงื่อนไขที่บรรทัด ~1174 เปิดให้ `vendor === 'bosch'` เข้าด้วย)

## 9.6 `CONF_ACTIVE_CONNECTION_LIST` — มีจริงแต่ยังไม่ได้ใช้

`0xffc1` (24 bytes/entry: dest IP · coder/line · flags · session · TX/RX channels)
รองรับครบทุก CPP และตอบข้อมูลจริง **แต่ไม่ตอบคำถาม "ใครกำลังดูอยู่"**

probe กับ `BSH-HDY-4038` (2026-08-05): ดึง JPEG จาก edge → list ไม่เปลี่ยน ·
เปิด RTSP → list ไม่เปลี่ยน · เห็นแต่ 3 entry นิ่ง ๆ ที่ `127.0.0.1`
(น่าจะเป็น session ภายในที่เขียนลง SD — กล้อง Bosch ที่ไม่ได้บันทึกลง SD รายงาน 0 entry)

→ มันนับเฉพาะ **RCP+ native media session** ไม่นับ RTSP/HTTP ที่ระบบเราใช้จริง
**อย่าเอาขึ้น UI** จนกว่าจะพิสูจน์ได้ว่าเลขที่ได้มีความหมายกับ operator

> 🟡 ข้อจำกัดของการทดสอบนั้น: RTSP client ที่ใช้เขียนเองแบบง่าย ไม่ได้ยืนยันว่า PLAY สำเร็จ
> ผลฝั่ง RTSP จึงยังไม่ฟันธง 100% ส่วนฝั่ง HTTP ชัดเจน

---

## 9.7 ONVIF Metadata Track (RTSP) — มีอะไรอยู่ในนั้นบ้าง

> probe จริงบน `BH5100i_RMUTR-V_01` (FW 9.40.0132) จาก vss3 · 2026-08-19/20
> เอกสารนี้บันทึก **สิ่งที่กล้องส่งมาจริง** ไม่ใช่สิ่งที่สเปกบอกว่าควรมี

กล้อง Bosch ประกาศ track ที่สามใน SDP นอกเหนือจาก video/audio และ **SETUP แยกได้**
โดยไม่ต้องขอ track วิดีโอเลย — ระบบเราใช้ช่องนี้หา bounding box ของวัตถุ
(`src/helpers/onvifMetaTrack.js`, migration 164)

```
m=application 0 RTP/AVP 107
a=rtpmap:107 vnd.onvif.metadata/90000
a=control:rtsp://<ip>/rtsp_tunnel?p=0&line=1&inst=1&vcd=2&stream=meta
```

**ต้นทุนที่วัดได้ (ต่อ 1 กล้อง) — แปรตามจำนวนวัตถุในเฟรมอย่างมาก:**

| | กลางคืน (ถนนว่าง) | กลางวัน (รถหนาแน่น) |
|---|---|---|
| แบนด์วิดท์ | 1.2–2.5 KB/s | **91 KB/s** |
| ต่อวัน | ~100 MB | **~7.7 GB** |
| CPU | 0.20% ของ 1 core | **1.4%** |
| เอกสาร/วินาที | 1.2 | **14.9** |
| วัตถุใน ring พร้อมกัน | 1–4 | **12** |

⚠️ **ตัวเลขกลางคืนต่ำกว่าความจริงถึง 74 เท่า — อย่าใช้ประเมินตอนจะเปิดกล้องเพิ่ม**
ปริมาณหลักมาจาก `tt:Polygon` (เส้นรอบรูป ~17 จุด ต่อวัตถุ ต่อเฟรม ที่ 15 Hz)
**แต่เป็นทราฟฟิกใน LAN ของไซต์เท่านั้น** — ที่ส่งขึ้น central คือ crop ใบเล็กกับตัวเลขไม่กี่ตัว
RAM ~57 MB · อัตราสุ่มต่อวัตถุ **~15 Hz** · ทดสอบต่อ–ตัด 12 รอบติดกันไม่มี session ค้าง
**ครบทั้ง 7 กล้อง Bosch ในระบบมี track นี้** (probe แล้ว 4 รุ่น: 3100i · 8000i · 8100iX · 5100i · payload type 107 เหมือนกันหมด)

### สตรีมนี้มี 2 ชนิดปนกัน

**ก. VideoAnalytics — ข้อมูลวัตถุที่ติดตามอยู่ (`tt:Frame` → `tt:Object`)**

| ฟิลด์ | ค่าตัวอย่างจริง | MQTT event มีไหม |
|---|---|---|
| `tt:Object[@ObjectId]` | `13385` | **มี** — คีย์เดียวกัน ใช้จับคู่ event ↔ วัตถุได้ |
| `tt:Object[@UUID]` | `08dae221-…-4d848a35e0d4` | มี (prefix ร่วม + running counter) |
| `tt:Frame[@UtcTime]` | `2026-08-19T18:19:45.263Z` | — (นาฬิกากล้อง ดู ⚠️ ล่าง) |
| `tt:Frame[@Colorspace]` | `RGB` | — |
| `tt:BoundingBox` | `bottom .28 top .45 right -.12 left -.16` | **ไม่มี** ← เหตุผลที่ต้องเปิด track นี้ |
| `tt:CenterOfGravity` | `x -.14 y .38` | ไม่มี |
| `tt:Polygon` | 2,517 จุดใน 5 นาที | ไม่มี — เส้นรอบรูปจริง ไม่ใช่สี่เหลี่ยม |
| `tt:Appearance[@velocity]` / `tt:Speed` | `11.13` `13.84` `14.63` | มี แต่ **ค่าเดียวตอน trigger** · ที่นี่ได้ ~15 ค่า/วินาที ตลอดที่วัตถุอยู่ในเฟรม |
| `tt:Appearance[@area]` | `1.21` `1.07` | ไม่มี |
| `tt:ColorCluster` × 3 | `X/Y/Z 95.63` + `Weight 0.48` | มี |
| `tt:Class` / `tt:ClassCandidate` | `Vehical` · `Motorcycle` + `Likelihood 0.11–0.39` | มี |
| `tt:Image` | base64 JPEG · **กลาง 32×67 px** | มีบางครั้ง (ดู §8) |
| `tt:VehicleInfo` | `<tt:Type Likelihood="0.92">Motorcycle</tt:Type>` | ซ้ำกับ `object_class` ที่ MQTT ให้ |

**ข. ONVIF Event notification — สถานะตัวกล้อง (`wsnt:NotificationMessage`)**
คนละเรื่องกับวัตถุ · มาปนในสตรีมเดียวกัน

```xml
<wsnt:Topic …>tns1:VideoSource/MotionAlarm</wsnt:Topic>
<tt:Message UtcTime="…" PropertyOperation="Initialized">
  <tt:Source><tt:SimpleItem Name="Source" Value="1"/></tt:Source>
  <tt:Data><tt:SimpleItem Name="State" Value="false"/></tt:Data>
```
เห็นจริง: `MotionAlarm` (State true/false) · `RelayToken=Output_1` · `LogicalState=inactive`
`PropertyOperation` = `Initialized` (ตอนต่อครั้งแรก) หรือ `Changed`
→ ได้สถานะ digital I/O + relay แบบ push โดยไม่ต้อง poll — **ยังไม่ได้ใช้**

### ⚠️ ข้อควรระวังที่เจอจากของจริง

**1. พิกัดหลุดกรอบ `[-1,1]` ได้** — วัดได้ต่ำสุด `-1.47` สูงสุด `1.17` ตอนวัตถุออกนอกเฟรม
กล้อง extrapolate ต่อให้ **ต้อง clamp เสมอ** ก่อนแปลงเป็นพิกเซล
แกน y ชี้**ขึ้น** origin กลางภาพ (`top` > `bottom`) — ตรงข้ามกับพิกัดภาพ

**2. อย่า key ด้วย `Frame[@UtcTime]`** — เป็นนาฬิกากล้อง และ skew ต่างกันมากตามไซต์:
vss3 = **31 ms** แต่ hdy = **316 ms** (ต่างกัน 10 เท่า) ที่ 316 ms มอเตอร์ไซค์เพี้ยนไป ~2.5 เมตร
ระบบเราจึง key ring buffer ด้วย `Date.now()` ตอนรับ RTP แทน (cf. GOTCHAS #103)

**3. การถือ connection ค้างทำให้กล้องยิง `Profile/ActiveConnections` ทุก ~10 วินาที**
กล้องตัวนี้ไม่เคยส่ง event ชนิดนี้เลยจนกระทั่งเปิด metadata track — แล้วขึ้นเป็น ~6/นาที
(**~8,600 event/วัน ต่อกล้อง**) และยัง**แย่งรูป**จาก detection ข้างเคียงผ่านกติกา ±250 ms
ของ `saveEdgeSnapshot` ด้วย → ปิดด้วย `ignore_event_types` (มี checkbox ในหน้า Camera Settings แล้ว)
**เปิด `meta_crop` กล้องไหน ควรติ๊กปิด event ชนิดนี้พร้อมกัน**
(เกี่ยวกับ §9.6 แต่คนละอย่าง: §9.6 คือ RCP+ `CONF_ACTIVE_CONNECTION_LIST` ซึ่งนับเฉพาะ
RCP+ native session ไม่นับ RTSP ของเรา — ส่วนนี้คือ *event* ที่กล้องยิงออกมาเอง)

### สองคำถามที่เคยค้าง — probe แล้ว 2026-08-20 กลางวัน (269 วัตถุ / 10 นาที)

**`tt:VehicleInfo` = ชนิดยานพาหนะที่จำแนกละเอียดแล้ว + ค่าความมั่นใจ เท่านั้น**
```xml
<tt:VehicleInfo><tt:Type Likelihood="0.92">Motorcycle</tt:Type></tt:VehicleInfo>
<tt:VehicleInfo><tt:Type Likelihood="1.00">Car</tt:Type></tt:VehicleInfo>
```
ไม่มีสี ไม่มีป้ายทะเบียน ไม่มียี่ห้อ · **ซ้ำกับ `object_class` ที่ MQTT event ให้อยู่แล้ว**
→ ไม่มีอะไรให้เก็บเพิ่ม
*(หมายเหตุ: regex ของเราหยิบ `tt:Type` ตัวแรกซึ่งอยู่ใน `ClassCandidate` = คำกว้าง
`Vehical` ส่วนค่าละเอียดอยู่ที่นี่ — กระทบแค่บรรทัด log ไม่กระทบข้อมูลที่เก็บ)*

**`tt:Image` มาถี่มาก แต่เล็กกว่าที่เราตัดเอง 5 เท่า → ทางตัน**

| | `tt:Image` (กล้องตัดเอง) | crop ที่เราตัดจาก 1080p |
|---|---|---|
| ความครอบคลุม | **267/269 วัตถุ = 99%** | ~78% ของ event ที่มี ObjectId |
| ขนาดกลาง | **32 × 67 px = 2,128 พิกเซล** | **72 × 147 = 10,934 พิกเซล** |
| ไฟล์ | 1.5 KB | 4.7 KB |

กล้องส่งภาพให้เกือบทุกวัตถุ (กลาง 2 ใบ/วัตถุ มากสุด 15) แต่เป็น thumbnail เล็กเสมอ
ไม่ว่าจะส่งทาง MQTT (51×60 = 2,889 พิกเซล) หรือทาง metadata stream (32×67 = 2,128)
→ **การตัดเองจากเฟรม 1080p ยังเป็นทางที่ดีที่สุด** ไม่ต้องเปลี่ยนสถาปัตยกรรม

**`area` = ตารางเมตร (ปิดเรื่องหน่วยแล้ว)** — วัดเทียบของจริง: คน 0.69–0.83 ·
มอเตอร์ไซค์ 1.1–1.4 · รถยนต์ 3.4–5.9 · รถบรรทุก 13.7 · อัตราส่วนคน:รถบรรทุก 16.5 เท่า
ตรงกับของจริง ~16 เท่า และ `velocity` ใน element เดียวกันพิสูจน์แล้วว่าเป็น m/s จริง
(ตรงกับ OSD ของ Configuration Manager: object 22033 อ่านได้ 34 km/h ทั้งสองทาง)

### วิธี probe ซ้ำ

ไม่มีสคริปต์ถาวรในรีโป — ตัวที่ใช้ได้จริงคือ `MetaTrackClient` ใน
`src/helpers/onvifMetaTrack.js` (ต่อ metadata track อย่างเดียว จัดการ digest/reassembly/
TEARDOWN ให้ครบแล้ว) เขียน harness สั้น ๆ เรียก `metaTrack.ensure()` แล้วดัมพ์ XML ดิบ
· `node src/helpers/onvifMetaTrack.js` รัน self-check ของตัวมันเองได้

---

## 10. ปัญหาที่พบและวิธีแก้ (Incident Log)

### #1 — IVA event มี state ว่างทั้งหมด (2026-08-05) ✅ แก้แล้ว

**อาการ:** IVA row 21,766 แถว/สัปดาห์ มี `event_state` ว่างทุกแถว ทั้งที่ `raw_json`
มี `{"Data":{"State":"false"}}` ชัดเจน

**สาเหตุ:** `processMessage` มี branch แยกเฉพาะ `RuleEngine` / `VideoSource` / `Device` /
`RecordingConfig` — **ไม่มี branch ของ `IVA`** → row ถูก INSERT ปกติแต่ `state` ไม่เคยถูกดึง
ผลคือทุกอย่างที่ filter/alert/report ตาม `event_state` มองไม่เห็น IVA เลย

**แก้:** เพิ่ม `else if (category === 'IVA')` อ่าน `msg.Data?.State` แบบ generic

**บทเรียน:** เขียน branch แบบ generic ตาม**โครงสร้าง payload** ไม่ใช่ enumerate ชื่อ rule
— production ส่ง `CrossingLine` ซึ่งไม่มีในเอกสารเลย ถ้า enumerate จะ miss

### #3 — `null / 238.3 GB · 0%` บนกล้องที่การ์ดปกติ (2026-08-06) ✅ แก้แล้ว

**อาการ:** `BOSCH_3100i` แสดงความจุเป็นตัวอักษร `null` และแถบ 0% ทั้งที่การ์ด 238 GB บันทึกอยู่ปกติ

**สาเหตุ:** ตั้งใจให้ `used_mb = null` เมื่อกล้องไม่รองรับ `STORAGE_LOAD` แต่ `recBoxHik()`
เช็คแค่ `card.capacity_mb` → `null` หลุดเข้า template และ `Math.round(null/x)` = **0**

**แก้:** แยก branch — รู้ทั้งคู่แสดงคู่ + แถบ · รู้แค่ขนาดแสดงขนาดอย่างเดียว + "ไม่ทราบว่าใช้ไปเท่าไร" ไม่มีแถบ

**บทเรียน:** commit ก่อนหน้าเขียนเองว่า *"renders as an absent row rather than a zero"* — **ไม่จริง**
เพราะไม่ได้เปิดดู path นั้นจริง เจ้าของจับได้จากหน้าจอ

### #4 — RCP+ สำเร็จแต่โดนทิ้งเพราะ ONVIF ล้ม (2026-08-06) ✅ แก้แล้ว

**อาการ:** `BOSCH_8000i` ขึ้น `unreachable` ทั้งที่ online (last_seen 42 วินาที)

**สาเหตุ:** message เดียวมี 2 ผลตรวจ แต่ `applySdStatusResult` เช็ค `r.ok` ของ **ONVIF ก่อน**
พอ ONVIF ตอบ HTTP 400 (รุ่นนี้ไม่รองรับ GetRecordingSummary) ก็ตีตรา unreachable แล้วทิ้ง detail ทั้งชุด

**แก้:** ถ้ามี `r.detail` ให้ใช้เลยแม้ `r.ok=false` · เก็บ error ของ ONVIF ไว้ใน `sd_error` ไม่ทิ้ง

**บทเรียน:** เมื่อ message มีหลายแหล่ง **อย่าให้แหล่งเดียวล้มแล้วทิ้งทั้งหมด** — 8000i, 8100iX_02,
3100i_02 ตอบ RCP+ ได้ปกติทั้งหมด (`no_card` ถูกต้อง) มีแค่ ONVIF ที่ 400

### #5 — คอมเมนต์ที่อ้าง protocol ผิด ทำให้ประเมินงานพลาด (2026-08-06) ✅ แก้แล้ว

`mqtt-subscriber.js` เคยมีคอมเมนต์ `// SD status poller (Bosch RCP+ 0x0CB5)` — **ผิด 2 ชั้น:**
call chain จริงคือ ONVIF SOAP (`onvifGetRecordingSummary`) และ `0x0CB5` ก็ไม่ใช่ tag ของ SD status
(ตัวจริงคือ `0x0b89`) · grep ทั้ง repo แล้ว `0x0CB5` ปรากฏแค่ในคอมเมนต์นั้นที่เดียว ไม่มีโค้ดยิงจริง

**ผลเสียจริง:** ตอนประเมินขอบเขตงาน อ่านคอมเมนต์นี้แล้วสรุปว่า "เราพูด RCP+ ได้อยู่แล้ว 1 คำสั่ง"
→ ประเมินงานต่ำกว่าจริงไปทั้ง transport

**บทเรียน:** คอมเมนต์ที่ระบุ protocol/tag เจาะจง ถ้าไม่ตรงกับโค้ด **อันตรายกว่าไม่มีคอมเมนต์**

### #2 — ความเข้าใจผิดเรื่อง subscription (บันทึกกัน regression)

ระหว่างตรวจเรื่อง #1 เคยสรุปผิดว่า "ไม่ได้ subscribe IVA → event หาย 5 ประเภท"
**ผิด** — `projects/+/#` ครอบ edge ทั้งหมดอยู่แล้ว ตรวจ DB ยืนยันมี IVA 46,155 แถว
→ **ก่อนสรุปว่า topic ไหนหาย ต้องเช็ค DB จริงเสมอ** ไม่ใช่ดูแค่ subscription list

---

## 11. งานที่ยังค้างอยู่

| # | เรื่อง | ที่มา |
|---|---|---|
| B6 | ขยายการใช้ **RCP+** ต่อจาก storage — reboot / PTZ / อ่าน-เขียน config | RCP+ doc |
| — | `0x0cb5` คืออะไร ยังไม่รู้ — probe แล้วตอบ tagged payload จริง (3100i 51B / 4038 68B) แต่ยังไม่ได้หาในเอกสาร | §9.5 |
| — | `CONF_UPLOAD_HISTORY` (system.status) ยังไม่ได้ probe — น่าจะเทียบเคียง uploads ของ Hikvision | TOC p.55 |
| — | เพิ่ม `+/onvif-ej/IVA/#` ใน subscription list เผื่อวันที่มีกล้อง Bosch ต่อ central ตรง | §3 |

### ตรวจแล้ว "ไม่ต้องทำ" — อย่าหยิบกลับมาโดยไม่อ่านเหตุผล (2026-08-06)

ทั้ง 3 ข้อนี้เคยอยู่ในรายการงานค้าง **ผมเป็นคนเสนอเอง** แล้วพอลงไปวัดของจริงพบว่า
เหตุผลที่ใช้เสนอตั้งอยู่บนสมมติฐานผิด — บันทึกไว้กันคนหลัง (หรือผมเอง) เสนอซ้ำ

**B3 — QoS 0 → 1: ไม่ต้องทำ**
เหตุผลเดิมที่ผมเขียน *"at-most-once ยอมให้ event หายตอนเน็ตสะดุด"* — **ผิด**
ไล่ทั้งสายแล้ว hop ที่เสี่ยงจริง (edge → central ข้ามอินเทอร์เน็ต) **เป็น QoS 1 + คิวบนดิสก์อยู่แล้ว**
(`src/edge/bridge.js` publish qos 1 / subscribe qos 1) — นี่คือกลไกที่กันข้อมูลหายตอน vss หลุด 17 นาที

QoS 0 ที่เหลือ 2 จุดเป็น hop สั้น: กล้อง→NanoMQ (LAN เดียวกัน) และ EMQX→mqtt-subscriber (**localhost**)
ช่องโหว่จริงที่เหลือคือ `clean:true` + `qos:0` ทำให้ event หายระหว่าง restart `mqtt-subscriber`
(~3-6 event/ครั้ง ที่ ~75 event/นาที) **แต่ยอมรับได้** เพราะ:
- CIB ไม่กระทบ — ส่งผ่าน `lpr-receiver` คนละสาย มี spool 6 ชม.ของตัวเอง
- หายเฉพาะตอน restart ที่เราสั่งเอง ไม่ใช่ตอนเน็ตล่ม
- แก้แล้วได้ประโยชน์น้อยแต่เพิ่มความเสี่ยงใหม่ (persistent session ทำ EMQX queue บวมถ้า subscriber ดับนาน)

> จะกลับมาทำก็ต่อเมื่อเจ้าของกำหนดว่า "ป้ายทะเบียนใน DB ต้องครบ 100% ห้ามขาดแม้ใบเดียว"
> ตอนนั้นแก้ฝั่งเราอย่างเดียวพอ (`clean:false` + `qos:1`) **ไม่ต้องแตะกล้อง**

**B4 — Publish filter: ไม่ต้องทำ**
เหตุผลเดิม *"ลด bandwidth ที่ edge เกี่ยวกับปัญหาคิว ANPR/ดิสก์"* — **ผิด 2 ชั้น**
คิว ANPR ที่เคยตันคือเส้น HTTP forward ไป CIB ไม่ใช่ MQTT · และวัด traffic จริงแล้ว (65 วิ, 2026-08-06):

```
รวม 278 KB/นาที
  RuleEngine/anprAlarm     243.1 KB  (87%)  ← Hikvision/Dahua พร้อมภาพ ไม่ใช่ Bosch
  RuleEngine/FaceCapture    47.0 KB
  Device/preview + heartbeat  8.1 KB
  ⚠️ MotionAlarm (เราทิ้ง)    0.4 KB  (0.13%)  ← สิ่งเดียวที่ filter จะช่วย
  IVA + LineDetector (Bosch)  0.6 KB
```
Bosch ทั้งหมดรวมกัน **~1% ของ traffic** และของที่เราทิ้งอยู่ (MotionAlarm) **0.13%**
→ ต้องยิงคำสั่งเขียนค่าใส่กล้อง production ทุกตัว เพื่อประหยัด 0.13% — ไม่คุ้มอย่างชัดเจน

**B5 — `RecordingConfig/JobState`: ไม่ต้องทำ**
เหตุผลเดิมอ้างว่าแก้ปัญหา `sd_status` ของ hkt เป็น null — **ผิด 2 ชั้น**: hkt เป็นกล้อง
**Hikvision** ส่วน JobState เป็น event ของ **Bosch** (คนละยี่ห้อ) และปัญหานั้น**ถูกแก้ไปแล้ว**
ตั้งแต่ commit `4840970`/`6a02ffa` (ตรวจ 2026-08-05: hkt มีค่าจริงครบ ไม่มี null)

และตัว JobState เองอ่อนกว่าของที่มี — TechNote §3.5 ระบุ *"No message will be generated when
the recording **stops**, nor any error messages"* → ยิงตอนเริ่มบันทึกเท่านั้น ตอบไม่ได้ว่าตอนนี้บันทึกอยู่ไหม
ขณะที่ ONVIF `GetRecordingSummary` + RCP+ `RECORDING_STATUS` ตอบได้ตรงกว่า

---

## 12. Related Files

- `src/mqtt-subscriber.js` — ingester หลัก (`processMessage`, `_stripSitePrefix`)
- `src/lpr-receiver.js` — `AddEventBroker` / `GetEventBrokers` (ONVIF SOAP)
- `src/helpers/boschRcp.js` — RCP+ over CGI (storage/recording) · `test/bosch-rcp.test.js`
- `src/edge-config-agent.js` — `pollSdStatusOnce` (ONVIF + RCP+ ในข้อความเดียว)
- `docs/vendor/bosch/` — เอกสารผู้ผลิต (TechNote + RCP+)
- `docs/LOGIC_camera-ingesters.md` — ภาพรวม multi-vendor
- `docs/LOGIC_edge-ingester-divergence.md` — ทำไม edge กับ central ต่างกัน
- `docs/superpowers/plans/2026-07-24-bosch-mqtt-broker.md` — แผน AddEventBroker
- `BOSCH_IVA_Appearance.MD` — แผน Appearance (คนละเรื่องกับไฟล์นี้)
