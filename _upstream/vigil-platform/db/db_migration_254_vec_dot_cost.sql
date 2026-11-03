-- ============================================================
-- Vigil Platform — Migration 254: vec_dot() บอก planner ว่าแพง → ค้นหาใบหน้าทำขนานได้ (O12)
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ------------------------------------------------------------
-- ค้นหาใบหน้า Lab Test (POST /api/hcp/face-search engine=edge) เรียก vec_dot() ทุกแถวของช่วง
-- (124k แถว/วัน) · COST เริ่มต้นของ PL/pgSQL = 100 ⇒ planner คิดว่าถูกจึงไม่ทำขนานในช่วงสั้น
-- ตั้ง 10000 (ใกล้ต้นทุนจริง ~40 µs/แถว · 512 คูณ-บวก) ⇒ เลือก Parallel plan เอง
-- วัด 2026-10-06 ด้วยสำเนาใน pg_temp (ผลเท่ากันทุกไบต์ · md5 ของ 40 อันดับตรงกัน):
--   1 วัน 5.3 วิ → 1.6 วิ · 7 วัน 12.3 → 10.8 วิ · 30 วัน 28.8 วิ (+ worker 4 ใน route: 17.7 วิ)
-- ไม่เปลี่ยนตัวคำนวณ: นิพจน์ SQL 512 พจน์ inline ได้แต่ช้ากว่า 25 เท่า (detoast array ทุก subscript)
--   และแบบ SQL subquery คือตัวที่ migration 132 เอาออกเพราะช้า 100 วิ
-- เปลี่ยนแค่ metadata ของฟังก์ชัน — ไม่ rewrite ไม่ล็อกตาราง · รันซ้ำได้
-- ============================================================

ALTER FUNCTION vec_dot(real[], real[]) COST 10000;
