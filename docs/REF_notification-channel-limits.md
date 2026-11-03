# REF_notification-channel-limits — เพดานและค่าใช้จ่ายของช่องทางแจ้งเตือน (LINE / Telegram)

> Role: `REF_` · สร้าง 2026-09-25 · ตรวจตัวเลขล่าสุด 2026-09-25
> ขอบเขต: ข้อเท็จจริงของ **ผู้ให้บริการ** (ราคา, เพดาน, วิธีนับ) + **วิธีวัด** ปริมาณของเรา + snapshot ตัวเลขที่วัดได้ ณ วันที่ระบุ
> ไม่ใช่ที่อธิบายพฤติกรรมการส่งของระบบเรา → ดู `docs/LOGIC_line-notifications.md` · แผน Telegram → `docs/reports/2026-09-24_telegram-plan.md` (gitignored)
> หน้าอ่านง่าย (HTML, light mode): `docs/reports/2026-09-25_telegram-vs-line-limits.html` (gitignored)

ตัวเลขของผู้ให้บริการเปลี่ยนได้โดยไม่แจ้ง ก่อนอ้างอิงในงานขาย/สัญญา ให้เปิดลิงก์ในหัวข้อ "ที่มา" เช็คอีกรอบ แล้วแก้วันที่ตรวจด้านบน

---

## 1. สรุปสั้น

| | LINE Messaging API (ใช้อยู่) | Telegram Bot API |
|---|---|---|
| ค่าใช้จ่าย | ตามแพ็กเกจ LINE OA (§3.2) | ฟรี |
| วิธีนับ | **ต่อหัวผู้รับ** — push เข้ากลุ่ม N คน = N ข้อความ · reply ไม่นับ | ไม่นับ |
| เพดานที่ผูกมัดจริง | **โควตารายเดือน** | **ความเร็ว**: 20 ข้อความ/นาที ต่อกลุ่ม |
| ชนเพดานแล้วเป็นยังไง | error `monthly limit` ส่งไม่ออกจนสิ้นเดือน | HTTP 429 + `retry_after` รอไม่กี่วินาทีแล้วส่งต่อได้ |

สองเจ้าเพดานคนละแกน: LINE จำกัด "จำนวนต่อเดือน × ขนาดกลุ่ม" ส่วน Telegram จำกัด "ความถี่ต่อนาที" — ห้ามเทียบด้วยตัวเลขเดียว

## 2. Telegram Bot API

### 2.1 ค่าใช้จ่าย
- ส่ง/รับข้อความ รูป อัลบั้ม ไฟล์ ปุ่ม คำสั่ง: **ฟรี** ("bots are able to message their users at no cost" — Bot FAQ)
- ส่งเร็วกว่า ~30 ข้อความ/วินาที (paid broadcast): **0.1 Telegram Star/ข้อความ**, สูงสุด 1,000/วินาที · เงื่อนไข: Stars ≥ 100,000 และผู้ใช้ active ≥ 100,000 คน/เดือน → ไม่เกี่ยวกับเรา
- Local Bot API server: ซอฟต์แวร์ฟรีแต่ต้องรันเอง (ไฟล์ขึ้นได้ถึง 2,000 MB, ดาวน์โหลดไม่จำกัด, webhook ได้ทุกพอร์ต, `max_connections` ถึง 100,000)
- ไม่มี SLA / แพ็กเกจจ่ายเงินสำหรับงานทั่วไป

### 2.2 เพดานความเร็ว (Telegram ระบุว่าเป็นค่า "about")
| ขอบเขต | เพดาน |
|---|---|
| ต่อ 1 แชท | ไม่เกิน ~1 ข้อความ/วินาที |
| ต่อ 1 กลุ่ม | ไม่เกิน 20 ข้อความ/นาที |
| ทุกแชทรวมกัน (ฟรี) | ~30 ข้อความ/วินาที |

### 2.3 เพดานขนาด
| รายการ | เพดาน | ยืนยันกับ |
|---|---|---|
| ไฟล์ที่ bot ส่ง (cloud API) | 50 MB | Bot FAQ ✔ |
| ไฟล์ที่ bot ดาวน์โหลด (`getFile`) | 20 MB | Bot FAQ ✔ |
| ข้อความ (`sendMessage.text`) | 4,096 ตัวอักษร | ค่ามาตรฐาน Bot API — หน้าเอกสารที่ดึงมาถูกตัด ยังไม่ได้เทียบคำต่อคำ |
| caption | 1,024 ตัวอักษร | เช่นเดียวกัน |
| `sendPhoto` | 10 MB, กว้าง+สูง ≤ 10,000 px | เช่นเดียวกัน |
| `sendMediaGroup` | 2–10 ชิ้น | เช่นเดียวกัน |
| `callback_data` | 1–64 bytes | เช่นเดียวกัน |

### 2.4 กติกาอื่น
- bot ทักคนก่อนไม่ได้ ผู้ใช้ต้องกด Start หรือเพิ่ม bot เข้ากลุ่มก่อน
- `getUpdates` ≤ 100 รายการ/ครั้ง · update ที่ยังไม่ถูกดึงเก็บไว้ **ไม่เกิน 24 ชม.**
- webhook ได้เฉพาะพอร์ต 443, 80, 88, 8443 · `max_connections` 1–100 (ค่าเริ่ม 40) — เราใช้ long polling ไม่ใช้ webhook

### 2.5 ในโค้ดของเรา
- `src/helpers/telegramSender.js` — cloud API (`api.telegram.org`), `parse_mode: HTML`, long polling
- 429 → รอ `retry_after` (เพดาน 30 วินาที) แล้วลองใหม่ **1 ครั้ง** ถ้ายังโดน = ข้อความตกหล่น

## 3. LINE Messaging API

### 3.1 วิธีนับ (Messaging API pricing)
- "The number of messages is counted by the number of people you send a message to" — ส่งเข้ากลุ่ม 5 คน = 5 ข้อความ **ไม่ขึ้นกับจำนวน message object ในคำขอ**
- reply message ไม่นับ · push / multicast / broadcast / narrowcast นับ
- เกินโควตา: "an error response will be returned and the messages won't be sent"

### 3.2 แพ็กเกจ LINE OA ประเทศไทย (ไม่รวม VAT 7%)
| แพ็กเกจ | ราคา/เดือน | ข้อความที่ได้ | ส่วนเกิน |
|---|---|---|---|
| ฟรี | 0 | 300 | ส่งเกินไม่ได้ |
| Basic | 1,280 บาท | 15,000 | 0.10 บาท/ข้อความ |
| Pro | 1,780 บาท | 35,000 | 0.06 บาท/ข้อความ |

### 3.3 เพดานความเร็ว
เอกสารทางการ (หัวข้อ Rate limits ใน Messaging API reference) ดึงมาไม่ครบ — **ยังไม่ได้ยืนยันตัวเลข** แต่ไม่ใช่ตัวที่เราชน (เราชนโควตารายเดือน)

## 4. วิธีวัดปริมาณของเรา

**ห้าม log / print channel access token** — ทุกวิธีข้างล่างอ่านอย่างเดียว

| อยากรู้ | ใช้ |
|---|---|
| LINE ใช้ไปเท่าไหร่เดือนนี้ / เพดานเท่าไหร่ | `getLineQuota(token)` ใน `src/line-sender.js` (เรียก `/v2/bot/message/quota` + `/quota/consumption`) · หน้าตั้งค่า `/api/line-config/quota` · ตัวเลข consumption ของ LINE ไม่ real-time (ดู header ของ `src/helpers/lineQuotaWatch.js`) |
| LINE นับไปกี่ข้อความต่อวัน | `GET /v2/bot/insight/message/delivery?date=YYYYMMDD` (เวลาไทย, ข้อมูลวันก่อนหน้าพร้อมหลังเที่ยงคืน) — รวมฟิลด์ `apiPush`, `apiMulticast`, `apiBroadcast`, `apiNarrowcast`, `broadcast`, `targeting` |
| ขนาดกลุ่มที่ส่งหา | `GET /v2/bot/group/{groupId}/members/count` |
| ระบบยิงแจ้งเตือนกี่ครั้ง / ถี่สุดต่อนาที | SQL ด้านล่าง (ไม่รวมรายงานตามเวลา ซึ่งไม่ลง `alert_logs`) |
| โดน `monthly limit` กี่ครั้ง | `alert_logs.error_message` / `recipients_json` ILIKE `'%monthly limit%'` |

```sql
-- status ที่นับว่า "ส่งแล้ว" มี 2 ค่า: 'sent' และ 'success' (นับแค่ค่าเดียวจะขาด)
WITH s AS (SELECT sent_at FROM alert_logs
           WHERE status IN ('sent','success') AND sent_at > now() - interval '30 days'),
m AS (SELECT date_trunc('minute', sent_at) k, count(*) c FROM s GROUP BY 1),
d AS (SELECT date_trunc('day', sent_at AT TIME ZONE 'Asia/Bangkok') k, count(*) c FROM s GROUP BY 1)
SELECT (SELECT count(*) FROM s)                                              AS pushes_30d,
       (SELECT max(c) FROM m)                                                AS peak_per_min,
       (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY c) FROM d)::int  AS median_per_day,
       (SELECT max(c) FROM d)                                                AS peak_per_day;
```

## 5. Snapshot ที่วัดได้ (2026-09-25 02:23 น.)

| ตัวชี้วัด | ค่า |
|---|---|
| LINE quota | `type=limited`, เพดาน **19,000**/เดือน, ใช้ไป **16,664** (88%) |
| LINE นับต่อวัน 1–23 ก.ย. | รวม 15,897 · ค่ากลาง 606 · เฉลี่ย 691 · สูงสุด 1,498 (15 ก.ย.) · ต่ำสุด 10 (21 ก.ย.) |
| งบเฉลี่ยต่อวันถ้าจะไม่เกินเพดาน | 19,000 ÷ 30 = 633 |
| คาดการณ์ | เหลือ 2,336 ÷ 691/วัน ≈ 3.4 วัน → **หมดราว 28 ก.ย.** |
| `monthly limit` error ใน ก.ย. | 4 ครั้ง ระหว่าง 20 ก.ย. 19:09 ถึง 24 ก.ย. 13:26 (เหตุ 24 ก.ย. กับกลุ่ม 185 คนคือที่มาของ `lineQuotaWatch.js`) |
| กลุ่ม LINE ที่ส่งหา | 6 กลุ่ม รวม 274 คน (ใหญ่สุด 185 คน) |
| ยิงแจ้งเตือน 30 วัน (`alert_logs`) | 173 ครั้ง · ค่ากลาง 6/วัน · สูงสุด 15/วัน, 5/ชม., **2/นาที** · ไม่มีนาทีไหน ≥ 5 |
| Telegram | ตั้งค่า 2 ห้อง · กฎแจ้งเตือน 0 จาก 7 ส่งทาง Telegram |

อ่านผล: ช่วงปกติ LINE ใช้ 96% ของงบรายวัน ช่วงพีคใช้ 2.4 เท่า → LINE ชนเพดาน · ถ้าย้ายปริมาณเท่าเดิมไป Telegram พีค 2 ครั้ง/นาที = 10% ของเพดานต่อกลุ่ม และไม่มีค่าใช้จ่าย

## 6. คำถามที่ยังเปิดอยู่
1. เพดาน 19,000 ของบัญชี LINE มาจากแพ็กเกจ/การตั้งเพดานส่วนเกินแบบไหน (ไม่ตรงกับ 300 / 15,000 / 35,000) — เช็คใน LINE Official Account Manager
2. คอมเมนต์ `src/line-sender.js` (`buildFlexAlert`) บอกว่า "LINE bills by `messages[]` length, so a Flex bubble halves the quota cost" แต่หน้าราคาของ LINE เขียนว่านับตามจำนวนผู้รับ ไม่ขึ้นกับจำนวน message object — ต้องทดสอบจริงก่อนแก้คอมเมนต์หรือโค้ด
3. เพดานความเร็วต่อวินาทีของ LINE (§3.3)
4. ปริมาณรายงานตามเวลา (report-worker / health report) ที่ส่ง LINE — ไม่อยู่ใน `alert_logs` จึงยังไม่ได้แยกนับ

## 7. ที่มา
- Telegram Bot FAQ — https://core.telegram.org/bots/faq (ค่าใช้จ่าย, เพดานความเร็ว, paid broadcast, 50/20 MB)
- Telegram Bot API — https://core.telegram.org/bots/api (`getUpdates`, webhook, local server)
- LINE Messaging API pricing — https://developers.line.biz/en/docs/messaging-api/pricing/
- LINE OA ประเทศไทย — https://lineforbusiness.com/th/service/line-oa-features/broadcast-message

## ประวัติการแก้
- 2026-09-25 — สร้างไฟล์ (Telegram limits + เทียบ LINE + snapshot ก.ย. 2026)
