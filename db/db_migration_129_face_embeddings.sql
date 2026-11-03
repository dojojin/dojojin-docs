-- ============================================================
-- Migration 129: Face embeddings (AuraFace-v1 pilot, Internal Test Only)
-- ============================================================
-- ตาราง embedding แบบ real-time สำหรับ Phase 1 ของแผน AuraFace-v1 —
-- ไม่ใช้ pgvector: ตรวจแล้ว (2026-08-10) ว่า image `postgres:16-alpine` ที่ใช้จริง
-- ไม่มี extension "vector" ให้เลย (ไม่ใช่แค่ยังไม่ enable — ไม่มีในลิสต์
-- pg_available_extensions เลย) เปลี่ยน image ฐานข้อมูล production เป็นเรื่องใหญ่
-- ที่ต้องขอ confirm แยกต่างหาก ไม่ใช่งานของ migration นี้ ⇒ เก็บ embedding เป็น
-- float4[] ธรรมดา เทียบ cosine ด้วยโค้ด (dot product ตรงๆ เพราะ normed_embedding
-- ยาว 1 หน่วยอยู่แล้ว) ปริมาณข้อมูลระดับหมื่นแถวยังเร็วพอแบบ brute-force —
-- ค่อยพิจารณา pgvector ทีหลังถ้าข้อมูลโตจนช้าจริง
--
-- model_name เก็บไว้เสมอ เพราะถ้าวันหน้าเปลี่ยนโมเดล (เช่นเจอ recognition model
-- ที่ license สะอาดกว่า) เวกเตอร์ AuraFace-v1 เก่ากับโมเดลใหม่เทียบกันตรงๆ ไม่ได้
-- (คนละ vector space) ต้องแยกได้ว่าแถวไหนมาจากโมเดลไหน
--
-- face_embed_queue = คิวสำหรับ enqueue-then-worker (ไม่ embed สด ๆ ใน ingest
-- hot path) — ingester เขียนแถว events ตามปกติ แล้วต่อคิวนี้แยกต่างหาก worker
-- (นอก process ingester) ค่อยดึงไปเรียก /embed เอง ⇒ ถ้า embed service ล่ม/ช้า
-- ไม่กระทบการรับ event สด (fail-open) — เจ้าของ ingest จริงยัง 350-500
-- event/นาที ห้ามมีอะไรมาหน่วงเส้นทางนั้น

-- events เป็น partitioned table (range by event_time) ⇒ PK จริงคือ (id, event_time)
-- แบบ composite ไม่ใช่ id เดี่ยวๆ — REFERENCES events(id) เฉยๆ จะพังด้วย
-- "no unique constraint matching given keys" (เจอจริงตอนรัน migrate, ตรวจแล้ว)
-- ต้องพ่วง event_time เข้าไปในทุกตารางที่จะ FK กลับไปหา events

CREATE TABLE IF NOT EXISTS face_embeddings (
  id           BIGSERIAL PRIMARY KEY,
  event_id     BIGINT NOT NULL,
  event_time   TIMESTAMPTZ NOT NULL,
  model_name   VARCHAR(50) NOT NULL,        -- เช่น 'auraface-v1' — กันเทียบข้ามโมเดลผิด
  dim          INT NOT NULL,                -- ยืนยันจากของจริงแล้ว = 512 (glintr100.onnx)
  embedding    REAL[] NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),

  FOREIGN KEY (event_id, event_time) REFERENCES events(id, event_time) ON DELETE CASCADE,
  UNIQUE(event_id, model_name)  -- 1 event ต่อ 1 โมเดล ไม่ฝังซ้ำ
);
CREATE INDEX IF NOT EXISTS idx_face_embeddings_event_id ON face_embeddings(event_id);
CREATE INDEX IF NOT EXISTS idx_face_embeddings_model_name ON face_embeddings(model_name);

CREATE TABLE IF NOT EXISTS face_blacklist (
  id           BIGSERIAL PRIMARY KEY,
  site_id      VARCHAR(50) DEFAULT 'hkt' NOT NULL,
  label        VARCHAR(255) NOT NULL,       -- ชื่อ/หมายเลขอ้างอิงคน (ไม่ใช่ PII เต็ม)
  model_name   VARCHAR(50) NOT NULL,
  dim          INT NOT NULL,
  embedding    REAL[] NOT NULL,
  active       BOOLEAN DEFAULT TRUE NOT NULL,
  created_by   VARCHAR(100),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_face_blacklist_site_active
  ON face_blacklist(site_id, active);

CREATE TABLE IF NOT EXISTS face_embed_queue (
  id           BIGSERIAL PRIMARY KEY,
  event_id     BIGINT NOT NULL,
  event_time   TIMESTAMPTZ NOT NULL,
  rel_path     TEXT NOT NULL,               -- snapshot_filename สัมพัทธ์ (ป้อนให้ /embed)
  model_name   VARCHAR(50) NOT NULL,
  status       VARCHAR(20) DEFAULT 'pending' NOT NULL,  -- pending | done | failed
  attempts     INT DEFAULT 0 NOT NULL,
  last_error   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,

  FOREIGN KEY (event_id, event_time) REFERENCES events(id, event_time) ON DELETE CASCADE,
  UNIQUE(event_id, model_name)
);
CREATE INDEX IF NOT EXISTS idx_face_embed_queue_status
  ON face_embed_queue(status) WHERE status = 'pending';
