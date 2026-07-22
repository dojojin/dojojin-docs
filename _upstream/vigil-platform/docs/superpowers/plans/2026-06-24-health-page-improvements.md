# Health Check Page — Improvements Plan

> วันที่วางแผน: 2026-06-24
> ไฟล์ที่เกี่ยวข้อง: `src/routes/health.js`, `dashboard/page-health.js`
> Baseline: commit `de3888b` (face/LPR image breakdown + snapshot undercount fix)

## ภาพรวม

หลัง commit `de3888b` หน้า Health Check แสดง breakdown รูปภาพ Face/LPR ครบแล้ว
งานที่เหลือแบ่งเป็น 3 กลุ่มตามความสำคัญ

---

## กลุ่ม A — ทำแน่ (gap จริง)

### A1. เพิ่ม `lpr-receiver` ใน Service Management

**สถานะ:** ❌ pending

**ปัญหา:** `lpr-receiver` เป็น PM2 process จริง (online, restarts: 0) แต่ไม่อยู่ใน
`_SVC_NAMES` และ `TRACKED` array ใน `health.js` → restart ไม่ได้จาก UI

**ไฟล์ที่แก้:** `src/routes/health.js`

```js
// บรรทัด ~20 — เพิ่ม 'lpr-receiver' ใน _SVC_NAMES
const _SVC_NAMES = new Set([..., 'lpr-receiver']);

// บรรทัด ~262 — เพิ่มใน TRACKED array
const TRACKED = [..., 'lpr-receiver'];
```

**เกณฑ์เสร็จ:** Service Management card บน Health Check แสดง lpr-receiver พร้อม
Restart/Stop/Start buttons; restart จาก UI ได้จริง

---

### A2. Spool stats ใน Storage card

**สถานะ:** ❌ pending

**ปัญหา:** ไม่มี visibility ว่า CIB forward queue สะสมเท่าไหร่
(ตอน CIB 403 มี 95 items ค้าง — ไม่รู้จนกว่าจะเปิด terminal)

**Spool dirs ที่ต้อง monitor:**
- `spool/lpr-forward-api-server/`
- `spool/lpr-forward-lpr-receiver/`

**Backend:** เพิ่มใน `result.storage`:
```js
// รวม spool count+size จาก 2 dirs
spool_files: 0, spool_mb: 0
```

**Frontend:** เพิ่มแถวใน Storage card:
```
['LPR forward spool', `${n} items · ${mb} MB`]  // badge warn ถ้า > 0
```

**เกณฑ์เสร็จ:** Storage card แสดง spool count; badge เปลี่ยนเป็น warn เมื่อ > 0

---

## กลุ่ม B — มีประโยชน์ (tradeoff)

### B1. ปุ่ม "Clear Spool" (admin only)

**สถานะ:** ❌ pending

**Use case:** CIB down นาน + operator ไม่ต้องการ backlog เก่า (plate PII จะถูกลบ)

**Backend:** endpoint ใหม่
```
DELETE /api/lpr/spool/clear   (admin only)
→ fs.rm(spoolDir, { recursive: true, force: true })
→ log to audit_log
```

**Frontend:** ปุ่มแสดงเฉพาะเมื่อ `spool_files > 0`; มี confirmation dialog ก่อน
("ลบข้อมูลป้ายทะเบียนที่ยังไม่ได้ส่ง N รายการ ยืนยัน?")

**เกณฑ์เสร็จ:** ปุ่มกด → confirm → spool ว่าง → badge กลับ ok; บันทึกใน audit_log

**Constraint:** CLAUDE.md #12 — endpoint ใหม่ใน `/api/lpr/…` ไม่ใช่ health route

---

### B2. ลบ stale spool dir

**สถานะ:** ❌ pending (cleanup ครั้งเดียว ไม่ต้องแก้โค้ด)

```bash
rm -rf /Users/dojojin/vigil-platform/spool/lpr-forward-ProcessContainerFork
```

Dir นี้เกิดก่อน procTag fix (commit `fbbc0b9`) — ไม่มี process เขียนลงไปอีกแล้ว

---

## กลุ่ม C — Roadmap (ยังไม่ทำ)

### C1. Forward health indicator
แสดง last successful forward time + consecutive fail count
→ ต้องแก้ `lpr-forward.js` ให้เก็บ stat → complexity เพิ่ม

### C2. Spool age (oldest item)
แสดงว่า item เก่าสุดค้างนานแค่ไหน → ชี้ว่า forward target down มาตั้งแต่เมื่อไหร่
→ scan file mtime → overhead เล็กน้อย

---

## ลำดับที่แนะนำ

1. **B2** — cleanup terminal 1 คำสั่ง ไม่มีความเสี่ยง
2. **A1** — 2 บรรทัดใน health.js แก้เร็ว
3. **A2** — backend + frontend scan spool dirs
4. **B1** — endpoint ใหม่ + confirmation UI (complexity สูงสุด)
