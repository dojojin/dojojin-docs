# REF_face-recognition — Face Recognition Plan

> **Status: PLANNED — ยังไม่ได้ implement**
> บันทึกแผนงาน, สถาปัตยกรรม, hardware sizing, และขั้นตอนพัฒนาไว้เป็น reference
> สำหรับ session ที่จะเริ่มทำจริง
>
> Last updated: 2026-05-29 · v1.5.0
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

<sub>REF_face-recognition.md · Vigil Platform v1.5.0 · Planned feature · 2026-05-29</sub>
