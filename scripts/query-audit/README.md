# เครื่องมือตรวจคิวรีทุกหน้า (query audit)

ใช้ครั้งแรก 25–26 ต.ค. 2569 ตอนตรวจคิวรีทุกหน้า (336 กรณี เจอต้นเหตุ 9 ข้อ ดู GOTCHAS #235–#238)
ส่วนการวัดอัตโนมัติทุกคืนอยู่ที่ `scripts/query-probe.js` (cron 01:15) ซึ่งเป็นชุดย่อย 49 กรณี

## ⚠️ ก่อนใช้

- **รันช่วง 01:00–03:00 เท่านั้น** (backup เริ่ม 03:04) — งานนี้ยิงคิวรีหนักจริงบน prod
  ถ้าต้องทำกลางวัน ให้บอกเจ้าของล่วงหน้าว่า perfWatch เย็นนั้นจะเตือน (เกิดจริง 25 ต.ค.)
- ทุกตัวปิด `pg_stat_statements` ของ session ตัวเอง · คำขอเป็น `user=internal` ซึ่ง perfWatch ไม่นับ
- **ห้าม** รันงานที่เขียนตารางสรุปใน transaction ยาว — ถือ lock ให้ refresher ตัวจริงรอ (ช้าสุด 100 วิ ที่ 25 ต.ค.)
- token ภายในอ่านจาก config ไม่พิมพ์ออกหน้าจอ · endpoint ที่ติดต่อ HCP / LINE / Telegram / กล้อง
  หรือเขียน audit_log ไม่อยู่ในชุดกรณี

## ขั้นตอน

| ขั้น | คำสั่ง | ได้อะไร |
|---|---|---|
| 1. สร้างชุดกรณี | `node scripts/query-audit/gen-cases.js /tmp/x/cases.json` | ทุกหน้า × ทุกไซต์ (ไซต์/กล้องจาก DB) · ช่วงปกติ + ช่วงกว้างสุด |
| 2. ยิง | `STOP_AT=02:50 node scripts/query-audit/replay.js /tmp/x/cases.json /tmp/x/results.jsonl` | เวลาแต่ละกรณี (รอบเย็น + รอบเลื่อน 1 วิ) + ทุกคิวรีที่ route ยิงจาก `pg_stat_statements` |
| 3. แผนของคิวรีที่ช้า | `node scripts/query-audit/slowlog.js /tmp/x/results.jsonl /tmp/x/explain.jsonl` | SQL + พารามิเตอร์จาก slow log (≥2 วิ) → `EXPLAIN (ANALYZE, BUFFERS)` แบบ READ ONLY |
| 4. หลังแก้: เทียบผล | `CMP_TIMEOUT=300s node scripts/query-audit/compare-routes.js /tmp/x/cmp.json` | route เดิม (git HEAD) กับไฟล์ใหม่ รันคู่ใน REPEATABLE READ เดียวกัน · บอก SAME/DIFF + index ที่คิวรีใหม่ใช้ |

`compare-routes.js` รองรับ route `events` / `faces` (case: `{id, route, path, query}`) — route อื่นต้องเพิ่ม deps ในฟังก์ชัน `sqlsFor`

## บทเรียนที่ต้องจำ

- **วัดทุกไซต์แยกกัน** รวม "ไซต์ที่ไม่มีข้อมูลประเภทนั้น" (แพงที่สุดของการเดินตามเวลา + LIMIT) และ "ไซต์ข้อมูลแน่น"
- **ลำดับกรณีมีผล**: กรณีก่อนหน้าอุ่น cache ให้กรณีถัดไป — เทียบก่อน/หลังต้องยิงซ้ำติดกันหรือวัดทั้งรอบเย็นและอุ่น
- **สร้าง index แล้วต้องวัดคิวรีอื่นด้วย** — index ใหม่เปลี่ยนแผนของคิวรีที่ไม่ได้ถูกแก้ได้ (faces/counts VSS หลัง 279)
- คิวรีเดิมที่ช้าจนเทียบไม่ได้ → SQL เดิมตัวเดิม + `SET LOCAL enable_indexscan = off` (ความหมายเดิม แค่วิธีหาต่าง)
- backup 03:04–04:19 ทำให้เวลาช่วงนั้นช้ากว่าจริง 2–4 เท่า
