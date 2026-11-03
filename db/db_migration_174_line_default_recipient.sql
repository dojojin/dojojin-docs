-- ============================================================
-- Vigil Platform — migration 174: ผู้รับ LINE เริ่มต้น
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- ============================================================
--
-- 2026-08-24:
-- เดิม "ไม่ระบุผู้รับ" แปลว่า "ส่งให้ทุกคนที่เปิดใช้งาน" ทั้งในตารางส่งรายงาน
-- (report-worker.js) และใน /api/health/report/send-now ค่า default แบบนั้นทำให้
-- ตารางทดสอบที่ปล่อยช่องผู้รับว่างไว้ยิงรายงาน 2 ใบเข้าผู้รับจริงครบทั้ง 7 ราย
-- รวมกลุ่มลูกค้าและกลุ่มตำรวจ (23 ส.ค. 2569 เวลา 23:36 น.)
--
-- ตอนนี้ "ไม่ระบุ" = ส่งให้ผู้รับเริ่มต้นรายเดียวที่ตั้งไว้ที่นี่
-- ตั้งเป็นค่าว่าง = ไม่มีผู้รับเริ่มต้น การส่งจะล้มเหลวพร้อมข้อความ ไม่ใช่ broadcast
-- เก็บเป็น setting ไม่ใช่ฝังใน source เพราะระบบเป็น white-label ขายหลายลูกค้า
-- ID ส่วนตัวใน source จะติดไปทุกที่ที่ deploy

INSERT INTO system_settings (key, value, description)
VALUES ('line_default_recipient', 'U0ee506e05ee15d8c6ab29c72340c1304',
        'LINE recipient id ที่ใช้เมื่อไม่ได้ระบุผู้รับ (ว่าง = ไม่ส่ง ไม่ใช่ส่งทุกคน)')
ON CONFLICT (key) DO NOTHING;
