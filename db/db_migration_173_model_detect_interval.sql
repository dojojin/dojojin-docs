-- ============================================================
-- Vigil Platform — migration 173: ตั้งเวลาตรวจรุ่น/firmware ซ้ำ
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- ============================================================
--
-- 2026-08-24:
-- เดิม triggerModelDetect ถูกเรียกตอนกด Save เท่านั้น ค่า model/firmware จึงค้าง
-- อยู่ที่ตอนตั้งกล้องครั้งแรกตลอดไป (วันนี้ 97 จาก 144 ตัวเก่ากว่า 7 วัน) กล้องที่ถูก
-- อัป firmware หลังติดตั้งจะรายงานเลขเก่า ซึ่งเกือบทำให้เอกสารที่ส่งผู้ผลิตระบุผิด
--
-- คีย์นี้เป็นสวิตช์ของรอบตรวจอัตโนมัติ · '0' = ปิด · อ่านผ่าน getSystemSetting
-- ซึ่ง cache 60 วินาที เปลี่ยนค่าแล้วมีผลภายใน 1 นาที ไม่ต้อง restart

INSERT INTO system_settings (key, value, description)
VALUES ('model_detect_interval_hours', '6',
        'ชั่วโมงระหว่างรอบตรวจรุ่น/firmware ของกล้องอัตโนมัติ (0 = ปิด)')
ON CONFLICT (key) DO NOTHING;
