# REF_face-recognition — Face Recognition Plan

> **Status: ✅ FR.1–FR.2 IMPLEMENTED (2026-06-17)**
> FR.1 (Hikvision camera-side recognition + ingestion) ✅ ทำงานแล้ว.
> FR.2 (body appearance + Face Capture merge) ✅ ทำงานแล้ว.
> FR.3 (server-side ML / InsightFace vector search) = ยังไม่ implement.
> ไฟล์นี้ยังเป็น reference สำหรับ §3 (Option B InsightFace) เมื่อถึงเวลา.
>
> Last updated: 2026-06-17 · v1.5.3
> Load when: วางแผน / เริ่มทำ Face Recognition feature ใดก็ตาม

---

## §1 — สิ่งที่มีอยู่แล้ว (Foundation)

### Hikvision Face Capture — ทำงานอยู่แล้ว

`src/ingesters/hikvision-isapi.js` รองรับ `faceCapture` event ครบแล้ว:

- **face crop JPEG** — ใบหน้าที่ crop มาจาก bounding box (gallery thumbnail)
- **full-frame background JPEG** — ภาพเต็มเฟรม (context modal)
- ทั้งสองบันทึกใน `snapshots/` และ pointer ใน `events.raw_json._snapshot` / `._snapshot_full`
- ฟิลด์ demographic จาก Hikvision: `age`, `gender`, `glass`, `mask`, `hat`, `faceExpression`, `faceScore`
- Multipart synchronization: รอ crop + background พร้อมกัน (pending map + 8s timeout)

### Dahua — ตั้งใจไม่รองรับ Face Detection

Dahua Face Detection = bounding box ระดับ SD ไม่ใช่ Face Capture engine จริง
→ ไม่มี face crop, demographics ไม่น่าเชื่อถือ → `dahua-cgi.js` ตั้งใจ exclude

### ข้อมูลที่พร้อมใช้เป็น input ของ recognition engine

```sql
-- face crop ที่พร้อม query
SELECT e.id, e.camera_id, e.event_time,
       e.raw_json->>'_snapshot'      AS face_crop,
       e.raw_json->>'_snapshot_full' AS full_frame,
       e.raw_json->'age'             AS age,
       e.raw_json->'gender'          AS gender,
       e.raw_json->'faceScore'       AS score
  FROM events
 WHERE event_type = 'FaceCapture'
   AND has_snapshot = TRUE
 ORDER BY event_time DESC
 LIMIT 20;
```

---

## §2 — ตัวเลือกสถาปัตยกรรม

### ตัวเลือก A — Camera-side (Hikvision built-in)

กล้อง Hikvision Deep Learning รุ่นรองรับมี Face Comparison DB ในตัว — upload รูปคนรู้จัก → กล้อง match เองและส่ง event พร้อม `faceId/name`

| | |
|---|---|
| ข้อดี | ไม่กิน server resource เลย |
| ข้อเสีย | ต้องการ Deep Learning SKU, DB จำกัด (~5,000–10,000 คน), ผูกกับ Hikvision |
| เหมาะกับ | site ที่มีงบซื้อกล้อง Deep Learning อยู่แล้ว |

### ตัวเลือก B — Server-side ML ✅ แนะนำ

Python microservice รับ face crop → extract embedding → เทียบกับ `known_persons` table

```
Face Capture event → face crop JPEG (snapshots/)
        ↓
  face-service.py  (FastAPI + InsightFace/DeepFace)
        ↓
  get_embedding() → 512-dim float32 vector
        ↓
  pgvector cosine similarity → known_persons table
        ↓
  INSERT face_recognition_results
        ↓
  pg_notify('new_face_match') → api-server → WebSocket → Dashboard
```

| | |
|---|---|
| ข้อดี | PDPA-friendly (ข้อมูลอยู่ใน server), ไม่ผูกกับยี่ห้อกล้อง, ใช้ Face Capture ที่มีอยู่ได้เลย |
| ข้อเสีย | ต้องการ CPU/GPU power, Python dependency เพิ่ม |
| เหมาะกับ | ทุก deployment — เริ่ม dev บน Mac ก่อนได้เลย |

### ตัวเลือก C — Cloud API

AWS Rekognition / Azure Face / Google Vision

| | |
|---|---|
| ข้อดี | ง่ายมาก, accuracy สูง |
| ข้อเสีย | **PDPA: ส่งข้อมูลชีวมาตรออกนอกประเทศ**, ค่าใช้จ่ายต่อ request, ต้อง internet |
| เหมาะกับ | prototype เร็ว — ไม่แนะนำ production ไทย |

---

## §3 — DB Schema (ตัวเลือก B)

```sql
-- migration: db/db_migration_031_face_recognition.sql

-- pgvector extension (ต้องติดตั้งก่อน)
CREATE EXTENSION IF NOT EXISTS vector;

-- known persons database
CREATE TABLE IF NOT EXISTS known_persons (
  id                SERIAL PRIMARY KEY,
  name              TEXT        NOT NULL,
  department        TEXT,
  employee_id       TEXT,                    -- optional external ID
  face_embedding    VECTOR(512),             -- InsightFace buffalo_l output
  reference_photo   TEXT,                    -- filename ใน snapshots/
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_known_persons_embedding
  ON known_persons USING hnsw (face_embedding vector_cosine_ops);

-- recognition results
CREATE TABLE IF NOT EXISTS face_recognition_results (
  id              BIGSERIAL PRIMARY KEY,
  event_id        BIGINT      REFERENCES events(id) ON DELETE CASCADE,
  person_id       INT         REFERENCES known_persons(id) ON DELETE SET NULL,
  confidence      NUMERIC(5,4),             -- 0.0000–1.0000
  is_unknown      BOOLEAN     NOT NULL DEFAULT FALSE,
  recognized_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_face_recognition_event
  ON face_recognition_results (event_id);
CREATE INDEX IF NOT EXISTS idx_face_recognition_person_time
  ON face_recognition_results (person_id, recognized_at DESC)
  WHERE person_id IS NOT NULL;
```

> **pgvector sizing:** known_persons 10,000 คน × 512 dim × 4 bytes = ~20 MB data + ~30 MB HNSW index → ไม่กระทบ DB sizing เดิม

---

## §4 — Python Service (face-service.py)

### โครงสร้าง

```
src/
  face-service/
    face_service.py     ← FastAPI app + inference logic
    requirements.txt
    Dockerfile
```

### Code หลัก

```python
# face_service.py
import insightface, cv2, numpy as np, os
from fastapi import FastAPI, UploadFile
from pydantic import BaseModel

# 🔧 สลับ provider ด้วย env var เดียว — ไม่ต้องแก้ logic
PROVIDER = os.getenv('INFERENCE_PROVIDER', 'cpu')

_PROVIDER_MAP = {
    'cpu':  ['CPUExecutionProvider'],
    'mps':  ['CoreMLExecutionProvider', 'CPUExecutionProvider'],  # Apple Silicon
    'cuda': ['CUDAExecutionProvider', 'CPUExecutionProvider'],    # NVIDIA GPU
}

_model = insightface.app.FaceAnalysis(
    name='buffalo_l',
    providers=_PROVIDER_MAP.get(PROVIDER, ['CPUExecutionProvider'])
)
_model.prepare(ctx_id=0 if PROVIDER == 'cuda' else -1)

app = FastAPI()

@app.post('/embed')
async def embed(file: UploadFile):
    """รับ face crop JPEG → คืน 512-dim embedding"""
    img = cv2.imdecode(
        np.frombuffer(await file.read(), np.uint8),
        cv2.IMREAD_COLOR
    )
    faces = _model.get(img)
    if not faces:
        return {'embedding': None, 'face_count': 0}
    return {
        'embedding': faces[0].embedding.tolist(),
        'face_count': len(faces),
        'det_score': float(faces[0].det_score),
    }

@app.get('/health')
def health():
    return {'ok': True, 'provider': PROVIDER}
```

### .env ต่อ environment

```bash
# Mac dev (CPU)
INFERENCE_PROVIDER=cpu

# Mac M-series (เร็วกว่า CPU ~3x)
INFERENCE_PROVIDER=mps

# Production + NVIDIA GPU
INFERENCE_PROVIDER=cuda
```

### requirements.txt

```
insightface>=0.7.3
onnxruntime>=1.16        # CPU / Mac
# onnxruntime-gpu>=1.16  # สลับตอน production GPU (คนละ package, import เดิม)
opencv-python-headless>=4.8
fastapi>=0.110
uvicorn[standard]>=0.27
numpy>=1.24
```

---

## §5 — Node.js Integration (ingester side)

เรียก face-service จาก `hikvision-isapi.js` หลัง Face Capture event INSERT เสร็จ:

```javascript
// ใน ingestFaceEvent() หลัง snapshot save + pg_notify
if (snapFile && process.env.FACE_SERVICE_URL) {
  recognizeFace(eventId, cam.camera_id, snapFile).catch(() => {});
}

async function recognizeFace(eventId, cameraId, snapFile) {
  const FACE_SVC = process.env.FACE_SERVICE_URL; // http://localhost:8001
  const THRESHOLD = parseFloat(process.env.FACE_MATCH_THRESHOLD || '0.5');

  // 1. Get embedding from face-service
  const form = new FormData();
  form.append('file', fs.createReadStream(path.join(SNAPSHOT_DIR, snapFile)));
  const embedRes = await fetch(`${FACE_SVC}/embed`, { method: 'POST', body: form });
  const { embedding } = await embedRes.json();
  if (!embedding) return;

  // 2. pgvector cosine similarity search
  const result = await pool.query(
    `SELECT id, name, 1 - (face_embedding <=> $1::vector) AS confidence
       FROM known_persons
      WHERE face_embedding IS NOT NULL
      ORDER BY face_embedding <=> $1::vector
      LIMIT 1`,
    [`[${embedding.join(',')}]`]
  );

  const match = result.rows[0];
  const isMatch = match && match.confidence >= THRESHOLD;

  // 3. Record result
  await pool.query(
    `INSERT INTO face_recognition_results
     (event_id, person_id, confidence, is_unknown)
     VALUES ($1, $2, $3, $4)`,
    [eventId, isMatch ? match.id : null, match?.confidence ?? null, !isMatch]
  );

  if (isMatch) {
    console.log(`  👤 [${cameraId}] Face matched: ${match.name} (${(match.confidence*100).toFixed(1)}%)`);
  }
}
```

### .env ที่ต้องเพิ่ม

```bash
FACE_SERVICE_URL=http://localhost:8001   # ว่างไว้ = ปิด face recognition
FACE_MATCH_THRESHOLD=0.50                # 0.0–1.0; ยิ่งสูงยิ่ง strict
```

> ถ้า `FACE_SERVICE_URL` ไม่ได้ตั้ง = ข้าม recognition ทั้งหมด — ไม่กระทบกล้อง Hikvision ที่ใช้อยู่

---

## §6 — Hardware Sizing

### Performance benchmark (InsightFace buffalo_l)

| Environment | ความเร็ว/ใบหน้า | เหมาะกับ |
|---|---|---|
| MacBook Intel (CPU) | ~300–500 ms | Dev/test เท่านั้น |
| MacBook M-series (MPS) | ~80–150 ms | Dev/test สบาย |
| Production CPU-only | ~300–500 ms | ≤ 5 face cameras |
| NVIDIA RTX 3060 (CUDA) | ~15–30 ms | ≤ 20 face cameras |
| NVIDIA RTX 4060 (CUDA) | ~12–20 ms | ≤ 30 face cameras |
| NVIDIA RTX 4070 (CUDA) | ~8–15 ms | ≤ 60 face cameras |
| NVIDIA A2 datacenter | ~5–10 ms | G3+ / no display needed |

### เพิ่มบน G1–G2 hardware เดิม

| กล้อง Face Cam | ใบหน้า/นาที | สเปคเพิ่ม | ค่าใช้จ่ายเพิ่ม |
|---:|---:|---|---:|
| 1–3 | < 10 | CPU เดิมพอ + 1–2 GB RAM | 0 |
| 4–10 | 10–50 | CPU เดิม + 2–4 GB RAM | 0 (G2 มีอยู่แล้ว) |
| 10–30 | 50–200 | + GPU RTX 3060/4060 | ~10,000–14,000 THB |
| 30+ | > 200 | แยก AI Inference Server | ~80,000–120,000 THB |

> **RAM เพิ่มสำหรับ Python service:** InsightFace model load ~500 MB, Python runtime ~300 MB, ต่อ request ~100 MB

### pgvector resource

```
10,000 known_persons × 512 dim = ~20 MB data + ~30 MB HNSW index
Query time: < 5 ms (HNSW index)
→ ไม่กระทบ DB sizing เดิมเลย
```

---

## §7 — Dev Setup บน Mac

### ขั้นตอนเริ่มต้น

```bash
cd vigil-platform

# 1. สร้าง Python venv
python3 -m venv src/face-service/.venv
source src/face-service/.venv/bin/activate

# 2. ติดตั้ง dependencies
pip install insightface onnxruntime opencv-python-headless fastapi "uvicorn[standard]" psycopg2-binary pgvector

# 3. รัน face-service
cd src/face-service
INFERENCE_PROVIDER=cpu uvicorn face_service:app --port 8001 --reload

# 4. ทดสอบกับ face crop ที่มีอยู่
curl -F "file=@snapshots/<cam_id>_<event_id>_ts.jpg" http://localhost:8001/embed
# → {"embedding": [0.123, ...512 values...], "face_count": 1, "det_score": 0.98}
```

### Apple Silicon — ใช้ MPS สำหรับเร็วขึ้น

```bash
INFERENCE_PROVIDER=mps uvicorn face_service:app --port 8001
```

> InsightFace ใช้ ONNX Runtime — CoreML provider ทำงานบน M-series ผ่าน MPS โดยอัตโนมัติ

---

## §8 — Migration Path: CPU → GPU (Production)

**แก้แค่ 2 จุด ไม่กระทบ logic เลย:**

```bash
# 1. สลับ env var
INFERENCE_PROVIDER=cuda   # เปลี่ยนจาก cpu

# 2. สลับ Python package
pip uninstall onnxruntime
pip install onnxruntime-gpu  # ชื่อ import เหมือนเดิม: import onnxruntime
```

**ทุกส่วนนี้ไม่ต้องเปลี่ยน:**
- DB schema (`known_persons`, `face_recognition_results`)
- pgvector similarity query
- Node.js ingester integration
- API interface (`/embed`, `/health`)
- Dashboard UI

---

## §9 — PDPA Considerations

ข้อมูลชีวมาตร (biometric) อยู่ภายใต้ PDPA มาตรา 26 — ข้อมูลอ่อนไหว

| ประเด็น | แนวทาง |
|---|---|
| Consent | ต้องมี explicit consent หรือ legal basis ที่ชัดเจน (เช่น สัญญาจ้าง, ความปลอดภัยสาธารณะ) |
| Data minimization | เก็บเฉพาะ embedding (vector) ไม่เก็บ raw photo ของ known_persons ถ้าไม่จำเป็น |
| Retention | กำหนด retention policy สำหรับ `face_recognition_results` — แนะนำ 90 วัน |
| Access control | `known_persons` table — admin only, ไม่ expose ผ่าน viewer/auditor role |
| Cloud ban | ห้าม Option C (Cloud API) สำหรับลูกค้าที่มี PDPA concern — ข้อมูลชีวมาตรต้องอยู่ใน server ลูกค้า |
| เอกสาร | ต้องมี ROPA entry สำหรับ face recognition processing purpose |

---

## §10 — สิ่งที่ต้องทำเมื่อจะเริ่ม Implement

### Phase FR.1 — Foundation (Dev on Mac)
- [ ] สร้าง `src/face-service/face_service.py` + `requirements.txt`
- [ ] migration `db/db_migration_031_face_recognition.sql` (pgvector + tables)
- [ ] ทดสอบ embed กับ face crops ที่มีอยู่ใน `snapshots/`
- [ ] ยืนยัน pgvector cosine search ทำงานถูกต้อง

### Phase FR.2 — Integration
- [ ] เพิ่ม `recognizeFace()` ใน `hikvision-isapi.js` (fire-and-forget)
- [ ] เพิ่ม `FACE_SERVICE_URL` / `FACE_MATCH_THRESHOLD` ใน `.env.example`
- [ ] API endpoints: `GET /api/known-persons`, `POST /api/known-persons` (admin only)
- [ ] i18n keys: `fr.*` (th+en)

### Phase FR.3 — Dashboard UI
- [ ] หน้า "Face Recognition" ใน Settings หรือ sub-section ของ Face Gallery
- [ ] Manage known_persons (add/edit/delete + upload reference photo)
- [ ] Face event list แสดง match result + confidence badge
- [ ] Unknown face alert integration กับ alert-engine

### Phase FR.4 — Production Hardening
- [ ] Docker container สำหรับ face-service
- [ ] `docker-compose.yml` เพิ่ม `face-service` service
- [ ] GPU support (INFERENCE_PROVIDER=cuda + onnxruntime-gpu)
- [ ] PDPA audit log สำหรับ known_persons access

---

## §11 — Libraries เปรียบเทียบ

| Library | Accuracy | Speed CPU | Installation | แนะนำสำหรับ |
|---|---|---|---|---|
| **InsightFace** | ⭐⭐⭐⭐⭐ | ปานกลาง | ปานกลาง | Production |
| **DeepFace** | ⭐⭐⭐⭐ | ปานกลาง | ง่าย | เริ่มต้น/prototype |
| face_recognition (dlib) | ⭐⭐⭐ | เร็ว (เบา) | ยาก (dlib compile) | เบา/simple use case |

> **แนะนำ:** เริ่มด้วย DeepFace (เร็วได้ผล) → migrate เป็น InsightFace เมื่อต้องการ accuracy สูงขึ้น logic เหมือนกันทั้งคู่

---

## §12 — Pilot FR-P (ตัดสิน 2026-08-09) — ทำเองบน edge hkt

> เจ้าของสั่งให้บันทึกไว้ก่อนเริ่ม · **ยังไม่เริ่มลงมือ**

### ทำไมถึงคุ้มที่จะลอง — มาจากปัญหาที่เจอจริง ไม่ใช่ความอยากได้เทคโนโลยี

หน้า **ค้นใบหน้าด้วยรูป (HC2)** ใช้ HCP เป็นเครื่องค้น แล้วเอาผลมาจับคู่กับเหตุการณ์ของเรา
**ด้วยเวลา** — ซึ่งพิสูจน์แล้วว่าเชื่อไม่ได้:

- `captureSearch.captureTime` = เวลาที่ HCP ประมวลผลเสร็จ **ไม่ใช่เวลาที่กล้องจับ**
  (เคสจริง: OSD/NVR/ระบบเรา = `16:09:52` · HCP = `16:36:08` ห่าง 26 นาที)
- ชดเชยด้วย offset คงที่ไม่ได้ (cross-correlation ไม่มียอดแหลม)
- กล้องยิงหน้าใหม่ทุก 2-15 วินาที ⇒ จับคู่ด้วยเวลาได้คนอื่นง่ายมาก
- ทางออกปัจจุบัน = **ให้คนเลือกภาพเอง** (ใช้งานได้ แต่เป็นภาระคน)

⇒ **ถ้าเราฝัง embedding เองได้ ปัญหานี้หายทั้งชุด** เพราะเทียบด้วย *ใบหน้า* ไม่ใช่ *เวลา*

### หน้าตาที่ตกลงกันแล้ว — ใช้หน้าเดิม เพิ่มตัวเลือก engine

**ไม่สร้างหน้าใหม่** · ใช้ `dashboard/page-hcp-face-search.js` เป็น front-end เดียว
แล้วเพิ่มตัวเลือกในฟอร์ม:

```
เครื่องค้นหา : ( ) HCP        ← ค่าเริ่มต้นวันนี้
               ( ) Edge Engine ← ของเราเอง (ระหว่าง pilot ให้ใช้ได้เฉพาะ hkt)
```

- เลือก **HCP** → เส้นทางเดิม `POST /api/hcp/face-search` (ไม่แตะ)
- เลือก **Edge Engine** → เส้นทางใหม่ ยิงไป face-service บน edge
- ผลลัพธ์ใช้ **โครงเดียวกัน** (similarity · เวลา · กล้อง · ภาพ) เพื่อให้ตาราง/ภาพย่อ/โมดัล
  เดิมแสดงได้ทันทีโดยไม่ต้องเขียนหน้าจอใหม่
- ข้อดีที่ได้ฟรี: **เทียบสองเครื่องมือด้วยรูปเดียวกันบนหน้าจอเดียว** — วัดได้ว่าใครเจออะไรที่อีกฝั่งไม่เจอ

### ฐานที่วัดไว้แล้ว (2026-08-09)

| | ค่า |
|---|---|
| FaceCapture ที่ hkt | **124,708 ภาพ/24 ชม.** · 34 กล้อง = **1.44 ภาพ/วินาที** |
| คลังเทียบ (จาก HCP) | **1,497 รูป** พร้อมใช้แล้วใน `blacklist-photos/14/` |
| เฉลยสำหรับวัดความแม่น | **ผล match ของ HCP 538 แถว** (HC1) |
| edge hkt | i7-12700K · 20 เธรด · RAM 15 GB (ว่าง 12) · load 0.25 |
| GPU | **T400 4GB มีอยู่ แต่ยังเป็น nouveau** — เฟสแรกไม่ต้องใช้ |

ภาระที่ประเมิน: ฝัง embedding จากรูปที่**ครอปมาแล้ว** ~20-40 ms/ภาพ บน CPU ⇒ 1.44 ภาพ/วินาที
ใช้ราว 1 คอร์ · เทียบกับคลัง 1,497 คน = cosine 1,497×512 ไม่ถึงมิลลิวินาที · โมเดล ~250 MB

### ขั้นตอน

| ขั้น | งาน | เกณฑ์เสร็จ |
|---|---|---|
| **FR-P1** | face-service บน edge hkt (CPU) + ฝัง embedding คลัง 1,497 รูป | ฝังครบ · เก็บ embedding ได้ · ไม่แตะ pipeline เดิม |
| **FR-P2** | ป้อนภาพย้อนหลัง 7 วันของกล้องที่ HCP เคยแจ้ง match | ได้ผลจับคู่ของเราเอง พร้อม similarity |
| **FR-P3** | **วัดกับเฉลย 538 แถวของ HCP** | บอกได้เป็นตัวเลข: ตรงกันกี่ % · เราเจอเพิ่มกี่ราย · เตือนผิดกี่ราย · กราฟ threshold |
| **FR-P4** | ตัวเลือก engine บนหน้า HC2 (HCP / Edge Engine) | ค้นรูปเดียวกันได้ทั้งสองเครื่อง เทียบผลกันบนหน้าจอเดียว |

**ข้อบังคับระหว่าง pilot:** hkt เท่านั้น · **อ่านอย่างเดียว ไม่แจ้งเตือน** · ไม่แตะ ingest ที่ใช้งานอยู่
· ไม่ลงไดรเวอร์ GPU (งานแยก ต้องรีบูต) · PDPA — ดู §9 ก่อนเก็บ embedding ถาวร

**ตัดสินใจต่อจากตัวเลข FR-P3** ว่าจะเดินเป็นระบบสดตาม FR.1-FR.4 (§10) หรือหยุดแค่นี้

---

### ผล pilot จริง — รันบน edge hkt 2026-08-09 (CPU ล้วน · nice 15 · ingest ไม่สะดุด)

**FR-P1 · ฝังคลัง** — `insightface buffalo_l` + `onnxruntime` CPU ลงใน `~/face-pilot/lib`
(ไม่มี venv เพราะ `python3-venv` ต้อง sudo · ใช้ `pip install --target` แทน ลบทิ้งง่าย)

```
ฝังสำเร็จ 1,486/1,497 (99.3%) · ตรวจไม่พบใบหน้า 11 · 456 ms/รูป (det 640) · gallery.npz 2.9 MB
```

**🔴 ข้อจำกัดที่เจอทันที: รูปในคลัง HCP เป็น thumbnail ขนาดคงที่ `135×189` ทุกใบ**
(ตรวจ 500 ใบ ไม่มีใบไหนต่างเลย) ⇒ ส่วนที่เป็นใบหน้าจริงเหลือราว 80×100 px ซึ่ง**เล็กกว่า
อินพุตของโมเดล (112×112)** ต้องขยายก่อนใช้ = เสียรายละเอียด · **นี่คือเพดานความแม่นที่แก้ได้**

**FR-P2a · เห็นตรงกับ HCP ไหม** — ป้อน "ภาพที่ HCP จับคู่ได้เอง" 172 ใบเข้าเครื่องเรา
(ไม่ต้องพึ่งการจับคู่ด้วยเวลาเลย) แล้วถามว่าเราตอบชื่อเดียวกันไหม · 221 ms/ภาพ (det 320)

| ความมั่นใจของ HCP | จำนวน | เราตอบชื่อเดียวกันเป็นอันดับ 1 | คะแนนของเรา (มัธยฐาน) |
|---|---|---|---|
| 0.75–0.85 | 129 | **55.0%** | 0.270 |
| 0.85–0.95 | 32 | **81.2%** | 0.354 |
| 0.95–1.00 | 8 | **100%** | 0.552 |

⇒ **สองเครื่องเห็นตรงกันเกือบสมบูรณ์ตรงที่ HCP มั่นใจ และแยกทางกันตรงที่ HCP ไม่มั่นใจ**

**การวินิจฉัยที่สำคัญที่สุด** — เทียบภาพกล้อง↔ภาพกล้องของ "คนเดียวกันตามที่ HCP บอก":

```
ภาพกล้อง ↔ ภาพกล้อง (คนเดียวกันตาม HCP) : มัธยฐาน 0.236   ← ต่ำผิดปกติ
ภาพกล้อง ↔ รูป thumbnail ในคลัง          : มัธยฐาน 0.288
```
ถ้าเป็นคนเดียวกันจริง ภาพกล้อง↔ภาพกล้องต้องได้ 0.5+ ⇒ **ผล match ของ HCP ที่ระดับ
0.75–0.85 (ซึ่งเป็น 76% ของทั้งหมด) จำนวนมากไม่ใช่คนเดียวกัน** — "เฉลย" ที่เราใช้วัดมีสัญญาณรบกวนสูง

**FR-P2b · เตือนผิด** — สุ่มใบหน้าคนทั่วไปจากกล้องเรา 2,805 ใบ (36 ชม.)

```
คนทั่วไป : มัธยฐาน 0.218 · p90 0.291 · p99 0.352 · p99.9 0.410 · สูงสุด 0.434
เกณฑ์ 0.45 → เตือนผิด 0 จาก 2,805 ภาพ
เกณฑ์ 0.40 → 14.3 ครั้ง/หมื่นภาพ ≈ 178 ครั้ง/วัน ที่ปริมาณจริง (124,708 ภาพ/วัน)
เกณฑ์ 0.35 → 107 ครั้ง/หมื่นภาพ ≈ 1,334 ครั้ง/วัน
```

**FR-P3 · อ่านผลรวม**

- **ที่ 0.45 ขึ้นไป ไม่มีการเตือนผิดเลยใน 2,805 ภาพ** และคู่ที่ HCP มั่นใจ ≥0.95 ของเราได้
  มัธยฐาน **0.552** ⇒ **คู่ที่เป็นคนเดียวกันจริงแยกออกจากคนทั่วไปได้ชัด**
- ตัวเลข "recall เทียบ HCP" ที่ดูต่ำ (8.9% ที่เกณฑ์ 0.45) **ไม่ใช่ตัววัดเครื่องของเรา**
  แต่เป็นตัววัดว่าเฉลยของ HCP มีของปลอมปนอยู่มาก
- เพดานที่แก้ได้จริงคือ **คลังเป็น thumbnail 135×189**

**สิ่งที่ควรทำต่อ (เรียงตามผลตอบแทน)**

1. **หารูปคลังความละเอียดสูงกว่านี้** — ถามผู้ดูแล HCP ว่าดึงต้นฉบับได้ไหม หรือให้เจ้าหน้าที่
   อัปโหลดใหม่ · ถ้าไม่ได้ ให้ **เสริมคลังด้วยภาพจากกล้องที่ยืนยันแล้ว** (คนละใบกับ thumbnail)
2. **สร้างเฉลยที่สะอาด** — ให้คนยืนยันสัก 50-100 คู่ แทนการเชื่อ match ของ HCP ทั้งหมด
3. ทดสอบโมเดลที่ใหญ่กว่า (antelopev2 / r100) เทียบกับ buffalo_l บนเฉลยชุดเดียวกัน
4. ถ้าจะรันสด: 221 ms/ภาพ × 124,708 ภาพ/วัน = **7.6 ชม.ของ 1 โปรเซส** ⇒ 4 โปรเซส ≈ 2 ชม./วัน
   บน CPU · **GPU T400 จะลดเหลือหลักนาที** (ต้องลงไดรเวอร์ + รีบูต — งานที่ต้องมีคนอยู่)

**ยังไม่ได้ทำ (ตั้งใจ):** ไม่แตะ pipeline ที่ใช้งานอยู่ · ไม่มีการแจ้งเตือน · ไม่ลงไดรเวอร์ GPU
· ไม่เขียน embedding ลงฐานข้อมูลกลาง (ยังอยู่ในไฟล์บน edge เท่านั้น)

---

## 13. FR-P4 — ตัวเลือก "HCP / เครื่องของเรา" บนหน้าค้นใบหน้า

หน้าเดิม (HC2) ยังเป็น front-end ตัวเดียว เพิ่มแค่ปุ่มสลับเครื่องค้น · ผลลัพธ์คืนรูปทรง
เดียวกันทั้งสองทาง ตาราง/ภาพย่อ/modal จึง render ด้วยโค้ดชุดเดิม

### เส้นทางข้อมูล

```
เบราว์เซอร์ → central POST /api/hcp/face-search {engine:"edge"}
            → edge  POST /face-engine-search        (Bearer เดิม ทางเดียวกับ HCP)
            → 127.0.0.1:8791 /search                (บริการ Python ไม่เปิดออกนอกเครื่อง)
            → คืนชื่อไฟล์ + คะแนน
            ← central join events.snapshot_filename = ชื่อไฟล์  ⇒ ได้เหตุการณ์จริง 1:1
```

**ตัวเชื่อมคือ `events.snapshot_filename`** ไม่ใช่เวลา ⇒ ไม่มีปัญหา "หยิบผิดรูป" แบบฝั่ง HCP
เวลาที่แสดงยึด `event_time` เสมอ (epoch ในชื่อไฟล์ช้ากว่าเหตุการณ์จริง 5-8 วินาที เพราะตั้งตอน
เขียนลงดิสก์) ⇒ ส่งช่วงเวลาไป edge เผื่อ ±60 วินาที แล้วตัดให้ตรงด้วย `event_time` ตอน join

### สิ่งที่อยู่บน edge (ไม่มีในรีโป — `~/face-pilot/`)

| ไฟล์ | หน้าที่ |
|---|---|
| `serve.py` | บริการค้น ฟัง 127.0.0.1:8791 · รันใต้ pm2 (ชื่อ app `face-engine`) · โมเดลค้างในหน่วยความจำ · โหลด shard ใหม่เองเมื่อไฟล์เปลี่ยน · **ยังเป็น CPU ล้วน** (ไม่ได้แตะใน A8 — ตั้งใจจำกัดผลกระทบ ดู §14) |
| `build_index.py` | ฝัง embedding · รับรายชื่อไฟล์ทาง stdin ไม่ผูกกับวันอีกต่อไป (ดู §14 เรื่อง 1 วัน=1 process) · ทำต่อจากเดิมได้ ข้ามทั้งไฟล์ที่ฝังแล้ว **และไฟล์ที่ตรวจแล้วไม่มีหน้า** (คีย์ `misses` ในแต่ละ shard, เพิ่ม 2026-08-09) |
| `run_index.sh` | ตัวคุมสาย **CPU** — ยิงทีละ N ชิ้นงานพร้อมกัน (เดิม N วัน ก่อนพบบั๊กหั่นงาน §14) |
| `run_gpu.sh` | ตัวคุมสาย **GPU** (เพิ่ม 2026-08-09) — `FR_PROVIDER=auto` ต่อ worker, ตกไป CPU เองถ้า GPU ใช้ไม่ได้ |
| `make_work.py` | หั่นแต่ละวันเป็นชิ้นละ ~10,000 ภาพ (`work/<วัน>.pNN.txt`) โดยตัดภาพที่ฝังแล้วออกก่อน |
| `lib/` , `lib-gpu/` | Python env แยกกันคนละชุด — `lib-gpu/` มี `onnxruntime-gpu==1.20.0` + `nvidia-*-cu12` (~3.4GB) |
| `index/<YYYY-MM-DD>[.pNN].npz` | เวกเตอร์ (float16) + ชื่อไฟล์ + กล้อง + epoch + `misses` (ชื่อไฟล์ที่ลองแล้วไม่มีหน้า) |
| `man/<YYYY-MM-DD>.txt` | รายชื่อไฟล์รายวันที่ export มาจากฐานข้อมูลกลาง — เป็นตัวหารความครอบคลุมเสมอ ไม่ใช่ COUNT ในฐานข้อมูล |

การสร้าง manifest (รันที่ central):
```sql
SELECT e.snapshot_filename FROM events e
  JOIN cameras c ON c.id=e.camera_id JOIN sites s ON s.id=c.site_id
 WHERE s.code='hkt' AND e.event_type IN ('FaceRecognition','FaceCapture')
   AND e.snapshot_filename LIKE 'face/%';
```
แล้วแยกรายวันด้วย `awk -F/ '{print > "man/" $2 ".txt"}'` ก่อน scp ไป edge

### 🔴 GOTCHA — onnxruntime กินทั้งเครื่อง แม้จะสั่ง taskset

เหตุการณ์จริง 2026-08-09 บน edge hkt · **load แตะ 158 · ssh เข้าเครื่องไม่ได้หลายนาที**
(ตัวรับข้อมูลจากกล้องไม่สะดุด เพราะ nice 15 — ยืนยันจาก event rate 350-500/นาที ตลอดช่วง)

รากของปัญหาเป็นชั้น ๆ กว่าจะเจอ:

1. onnxruntime ตั้ง `intra_op_num_threads` = **จำนวนคอร์ทั้งเครื่อง (20)** ต่อ 1 session
   ⇒ 1 process = 23-61 เธรด · 6 process พร้อมกัน = ~120 เธรดแย่งคอร์กันเอง
2. ตั้ง `OMP_NUM_THREADS=1` **ไม่ได้ผล** — onnxruntime ใช้ thread pool ของตัวเอง
3. `os.sched_setaffinity()` ใน worker **ไม่ได้ผล** และ `taskset -c` **ก็ไม่ได้ผล** —
   onnxruntime เรียก `sched_setaffinity` ผูกเธรดของมันเองไปคอร์อื่น เห็นได้จริงใน
   `/proc/<pid>/task/<tid>/status`: สั่ง `taskset -c 19` แต่เธรดลูกไปนั่ง 2-3, 4-5, 6-7 …
4. ส่ง `sess_options=` ผ่าน `FaceAnalysis(...)` **ก็ยังไม่ได้ผล** — `model_zoo.get_model()`
   ส่งต่อให้ session แค่ `providers` กับ `provider_options` **ทิ้ง sess_options เงียบ ๆ**
   (`model_zoo.py:96`) · ตรวจได้ด้วย `session.get_session_options().intra_op_num_threads`
   ซึ่งยังเป็น `0` (อัตโนมัติ) ทั้งที่ตั้งไปแล้ว

**วิธีที่ได้ผลจริง** — แทน `__init__` ของคลาสฐาน ซึ่ง `PickableInferenceSession` เรียกผ่าน
`super()` อยู่แล้ว จึงครอบทุก session ที่ insightface สร้าง (ดู `_onnx_single_core()`
ในทั้ง `build_index.py` และ `serve.py`) · ต้องเรียก **ก่อน** สร้าง `FaceAnalysis`

**อาการข้างเคียงที่ต้องรู้:** เธรดของ onnxruntime เป็นแบบ spin-wait ⇒ `serve.py` ที่ยังไม่ได้
แก้มี 99 เธรดหมุนรอ **ทำให้ load ค้างอยู่ที่ ~20 ทั้งที่ CPU แทบไม่ถูกใช้** (`/proc/loadavg`
บอก `1/775` runnable · ไม่มี process ใน D state · io pressure ~0) — หลังแก้เหลือ 1 เธรด
load ตกลงทันที

### ตัวเลขจริง (วัดหลังแก้)

```
322 ms/ภาพ ต่อ 1 process (1 เธรด · det 320 · nice 15)
ดัชนีทั้งหมด 893,417 ภาพ (29 วัน) → 6 process พร้อมกัน ≈ 13 ชั่วโมง (ใช้ 6 จาก 20 คอร์)
ค้น 1 ครั้ง ≈ 480 ms (ฝังรูปที่อัปโหลด ~250 ms + คูณเมทริกซ์)
หน่วยความจำ: 892k เวกเตอร์ = 0.9 GB (float16 บนดิสก์) / 1.8 GB (float32 ตอนค้น)
```

**ต้องลงไดรเวอร์ NVIDIA ไหม** — ย่อหน้านี้เดิมสรุปว่า "ไม่ต้องสำหรับงานนี้" ตอนวันที่เขียน (แค่
ตามให้ทันงานสด ไม่ถึงครึ่งคอร์ก็พอ) **แต่ภายในวันเดียวกันเจ้าของขอสลับมาใช้ GPU เพื่อปิดแผน
การไล่ย้อนหลังให้ไวขึ้น** — ลงจริงแล้ว รายละเอียดทั้งหมดอยู่ที่ §14 ด้านล่าง ห้ามอ้างอิงย่อหน้า
นี้เป็นสถานะปัจจุบันอีกต่อไป

### สิ่งที่ยังไม่ได้ทำ

- `pm2 save` บน edge — บริการ `face-engine` รันอยู่ใต้ pm2 แล้ว แต่ **ยังไม่บันทึกลงรายการ
  ที่สตาร์ทตอนบูต** เพราะเป็นการแก้รายการ process ของเครื่อง production (รอเจ้าของสั่ง)
- `serve.py` (บริการค้นสด) ยังเป็น CPU ล้วน — GPU ใช้เฉพาะการไล่ย้อนหลัง (`build_index.py`)
  เท่านั้น ยังไม่ได้ตัดสินใจว่าจะทำ GPU ให้ฝั่งค้นสดด้วยหรือไม่ (ดู §14)
- ดัชนียังไล่ไม่ครบ — หน้าจอบอกเปอร์เซ็นต์ความครอบคลุมจริงไว้แล้ว ไม่ได้ทำเป็นค้นครบ
- FR-P (PDPA/ความปลอดภัยของไฟล์ดัชนี) — ยังไม่ทำ เสนอไว้ใน §14 รอไฟเขียว
- ยังไม่ได้ทำหน้า Settings สำหรับสลับ engine/CPU-GPU ("(Internal Test Only)") — วางแผนไว้
  แต่ยังไม่เริ่มเขียน

---

## 14. GPU backfill (A8, 2026-08-09) — เร่งการไล่ย้อนหลังบน edge hkt

ทำบน edge hkt เท่านั้น (T400 4GB) เพื่อปิดการไล่ย้อนหลัง 893k ภาพให้ไวขึ้น หลัง §13 ประเมินว่า
"ไม่คุ้มลง GPU" ตอนงานสด — เจ้าของตัดสินใจว่าคุ้มสำหรับงานย้อนหลังครั้งนี้ ยอมรีบูตเครื่องได้
("ระบบเราเป็น backup ข้อมูลหายบ้างไม่เป็นไร") โมเดลเดิม (buffalo_l) — **ใบอนุญาต non-commercial/
research only ตาม official README ของ InsightFace** (โค้ด MIT แต่ pretrained weights แยก
ใบอนุญาต) ⇒ ทุกจุดที่ผู้ใช้เห็น engine นี้ต้องมีป้าย "(Internal Test Only)" กำกับเสมอ

### 🔴 GOTCHA — "หนึ่งวัน = หนึ่ง process" ทำให้เวลาทั้งงานติดที่วันใหญ่สุด

เดิม `build_index.py` รับได้ทีละวัน วันที่มี 125,263 ภาพ × 520 ms = 18 ชั่วโมงบน 1 คอร์ **ต่อให้
เพิ่มคอร์เป็นร้อยก็ไม่เร็วขึ้น** เพราะไม่มีใครมาช่วยวันนั้นได้ (เห็นชัดจาก 17 วันเล็กจบเร็วแล้ว
ปล่อยคอร์ว่างทิ้งไว้เฉย ๆ) — แก้ด้วย `FR_SHARD` env override + `make_work.py` หั่นแต่ละวันเป็น
ชิ้นละ ~10,000 ภาพ (ตัดภาพที่ฝังแล้วออกก่อนหั่น) ⇒ วันใหญ่กระจายงานได้จริง

### ติดตั้งไดรเวอร์

`sudo ubuntu-drivers install` (เจ้าของรันเอง, ตรวจแล้วก่อนรีบูต) → รีบูต → ยืนยันด้วย
`nvidia-smi` (T400, driver 595-open, prebuilt kernel module ไม่ใช่ DKMS) ไม่กระทบ LPR/ingest
(ยืนยันด้วย event rate ปกติหลังรีบูต)

### 🔴 GOTCHA — pip `--target` ปฏิเสธเขียนไฟล์ใหม่ลง namespace package เดิมเงียบ ๆ

ลง `nvidia-{curand,cufft,cusparse,cusolver,nvjitlink}-cu12` เข้า `lib-gpu/` — pip ตอบ
"Successfully installed" แต่ `find ... -name "*.so*"` ไม่เจอไฟล์จริงเลยสักไฟล์ เพราะโฟลเดอร์
`nvidia/` มีอยู่แล้วจากแพ็กเกจอื่นที่ลงไปก่อน ⇒ pip ไม่ยอมเขียนทับไดเรกทอรี namespace เดิมถ้าไม่
ใส่ `--upgrade` · ลองแก้แบบ `--upgrade --target` เฉพาะแพ็กเกจที่ขาด → **ลบ** โฟลเดอร์ `cudnn`/
`cuda_runtime` ที่เคยลงถูกไปด้วย (side effect จาก dependency ที่ใช้ร่วมกัน) → ทางแก้จริงคือลง
ทั้ง 9 แพ็กเกจ `nvidia-*-cu12` พร้อมกันในคำสั่งเดียว แล้วตรวจนับไฟล์ `.so` ให้ครบก่อนเชื่อ

**เวอร์ชันที่ใช้ได้จริง:** `onnxruntime-gpu` รุ่นล่าสุด (1.28.0) ต้องการ CUDA 13 ซึ่งแพ็กเกจ pip
ของ `nvidia-cublas-cu13` ยังเป็นแค่ stub (เวอร์ชัน 0.0.1) ใช้จริงไม่ได้ → ปักหมุด
`onnxruntime-gpu==1.20.0` (CUDA 12) แทน ซึ่งแพ็กเกจ `nvidia-*-cu12` ครบสมบูรณ์

### ตัวเลขจริง (วัดด้วย `build_index.py` ตัวจริง ไม่ใช่ bench แยก)

```
1 process บน GPU  = 16.4 ภาพ/วินาที
2 process พร้อมกัน = 24.1 ภาพ/วินาที รวม (+47%)
3 process พร้อมกัน = 27.6 ภาพ/วินาที รวม (+14% จาก 2 เท่านั้น — ผลตอบแทนลดลงชัดเจน)
VRAM ใช้ไม่ถึง 1 GB จาก 4 GB ทั้งสามกรณี — คอขวดคือคอร์ประมวลผลของการ์ด (384 CUDA core) ไม่ใช่หน่วยความจำ
เวกเตอร์ GPU vs CPU cosine similarity = 1.000000 (พิสูจน์ว่าผลลัพธ์เหมือนกันทุกประการ ต่างแค่ความเร็ว)
```

⇒ ค่าเริ่มต้น **2 worker พร้อมกัน** คือจุดคุ้มค่าที่สุด · `FR_PROVIDER=auto` ต่อ worker (ไม่ใช่
`gpu` ตรง ๆ) เพื่อให้ worker ที่เริ่มใหม่ (เช่นหลัง GPU พังกลางทาง) ตกไปใช้ CPU เองอัตโนมัติแทนที่
จะหยุดทั้งคิว — นี่คือ "CPU เป็นสำรอง" ตามที่ตกลงกันไว้ ยืนยันด้วยการสร้าง `InferenceSession`
CUDA จริงเพื่อเช็คว่า provider ใช้งานได้จริง ไม่ใช่แค่เช็คว่าไฟล์มีอยู่ (pip เคยรายงาน "Successfully
installed" ทั้งที่ไม่ได้คัดลอกไฟล์จริงมาก่อนแล้ว — ดูย่อหน้าบน)

### 🔴 GOTCHA — coverage ไม่มีวันถึง 100% เพราะภาพที่ไม่มีใบหน้าถูกลองซ้ำตลอดไป (พบ+แก้ 2026-08-09)

`build_index.py` เดิมนับ "ทำแล้ว" เฉพาะภาพที่ฝัง embedding ได้ (`have = set(files)`) —
ภาพที่ตรวจแล้วไม่พบใบหน้า (มีจริงเป็นปกติ ~10-35% ต่อวัน) ไม่เคยถูกบันทึกว่า "ลองแล้ว" ⇒ ทุก
รอบที่สั่งทำต่อ ภาพกลุ่มนี้ถูกดึงมาประมวลผลซ้ำใหม่ทุกครั้งโดยไม่มีทางจบ และ `serve.py`
(`_day_map()`) นับ `indexed` จาก `len(files)` เท่านั้น ⇒ วันไหนมีภาพไม่มีหน้าปนอยู่ (ทุกวันจริง ๆ)
แถบความครอบคลุมจะค้างต่ำกว่า 100% ตลอดไป ทั้งที่ภาพนั้นถูกตรวจครบแล้วจริง ๆ

**แก้:** เพิ่มคีย์ `misses` ใน shard (`np.savez(..., misses=...)`), resume ใช้
`have = set(files) | set(misses)`, `_day_map()` นับ `indexed = len(files) + len(misses)`
(shard เก่าก่อนแก้ไม่มีคีย์นี้ → fallback เป็น `len(files)` เหมือนเดิม ไม่ทำให้ error) — ตรวจแล้วว่า
ชิ้นงานจริงจาก backfill ที่กำลังวิ่งอยู่ (`2026-08-07.p07.npz`) มี `misses: 734` หลัง deploy โค้ด
ใหม่ และรอบสองของการทดสอบแยกต่างหาก (5 ภาพสุ่ม, 1 miss) ยืนยันว่าภาพที่ miss ไปแล้วไม่ถูก
ดึงมาลองซ้ำอีก (`ต้องฝัง 0`)

### สถานะรัน (บันทึกไว้ ณ เวลาที่เขียน — ดูของจริงที่ `pm2 logs`/`ss -tlnp`)

Backfill จริงกำลังวิ่งด้วย `run_gpu.sh ~/face-pilot/work 2 8` (2 worker, core 8-9) · ยืนยันไม่
กระทบ ingest สด (event rate ~226-417/นาทีระหว่างรัน, `/proc/loadavg` ต่ำกว่า 3 ตลอด) ·
`index.log` ถูกแยกไฟล์ตามเวลาเริ่มรันทุกครั้งแล้ว (`run_gpu.sh`/`run_index.sh`) กันบรรทัดค้าง
จากรอบก่อนทำให้เข้าใจผิดว่า process ค้าง

---

<sub>REF_face-recognition.md · Vigil Platform v1.5.0 · Planned feature · 2026-06-08</sub>
