-- ============================================================
-- Vigil Platform — ซ่อน/แสดงเมนูใน sidebar ได้จากหน้าตั้งค่า
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ------------------------------------------------------------
-- เมนูใน sidebar ยาวขึ้นเรื่อย ๆ (17 รายการ) และลูกค้าแต่ละรายไม่ได้ใช้ทุกอัน
-- เดิมซ่อนได้ทางเดียวคือแก้ index.html ซึ่งทำต่อลูกค้าไม่ได้ (white-label —
-- โค้ดชุดเดียวขายหลายราย ดู Notes #10) จึงย้ายมาเก็บเป็น setting
--
-- เก็บเป็น JSON array ของ data-page เช่น ["media","hcp-events"]
-- ค่าเริ่มต้น ["media"] ตามที่เจ้าของสั่ง 2026-08-11
--
-- ⚠️ "settings" ห้ามซ่อนเด็ดขาด — บังคับทั้งฝั่ง validator และฝั่งหน้าจอ
-- เพราะถ้าซ่อนไปแล้วจะไม่มีทางกลับเข้ามาเปิดคืนได้ นอกจากแก้ DB ด้วยมือ
-- ============================================================

INSERT INTO system_settings (key, value, description)
VALUES ('nav_hidden_pages', '["media"]',
        'เมนูใน sidebar ที่ซ่อนไว้ (JSON array ของ data-page) — "settings" ซ่อนไม่ได้')
ON CONFLICT (key) DO NOTHING;
