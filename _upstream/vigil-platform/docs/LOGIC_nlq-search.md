# LOGIC_nlq-search — Natural Language Query (NLQ) for Unified Forensic Search

> Feature spec + implementation handoff for the NLQ layer.
> Status: **PLANNED** — backend largely ready; NLQ layer not yet built.
> Last updated: 2026-06-08 · Author: Prakasit Rochanavipart (Dojo-mAn)

---

## 1. Overview

Allow operators to search across all event data types (appearances, events/LPR, faces)
using natural Thai language. The LLM translates text → structured JSON filter;
the JSON filter drives existing parameterized SQL endpoints. **The LLM never touches
SQL directly — it only emits a JSON filter object.**

### Two-path architecture (same interface, swappable backend)

| Phase | LLM Backend | Why |
|---|---|---|
| POC | Claude Haiku API (`@anthropic-ai/sdk`) | Fast to iterate, $0.001–0.002/query, no local setup |
| Production | Ollama + Typhoon2 (local) | On-Prem, PDPA-safe, no recurring API cost, matches sales USP |

The `POST /api/nlq/parse` endpoint is **identical** for both paths —
only the internal LLM client changes. The JSON output shape is the same.

---

## 2. Unified Forensic Search — New Page

A **new nav item** separate from the existing "ค้นหาบุคคล" (appearances-only) tab.
Working name: "ค้นหาขั้นสูง" or "Forensic Search".

Scope of the new page:

| Data type | Backend endpoint | Status |
|---|---|---|
| Appearances | `GET /api/appearances/search` (`api-server.js:4821`) | ✅ exists; needs multi-camera (`camera_ids[]`) — Phase 0 gap |
| Events (all cameras) | `GET /api/events` (`api-server.js:2526`) | ✅ exists; full filter support |
| LPR plate search | *(no endpoint)* | ❌ missing — only DELETE at `api-server.js:2076`; `license_plates` table + index exist |
| Face recognition | *(future)* | ⏳ deferred — see `docs/REF_face-recognition.md` |

### Prerequisite before building

Run this query on production to establish baseline coverage:

```sql
SELECT
  COUNT(*)                    AS total_appearances,
  COUNT(DISTINCT camera_id)   AS cameras_with_data,
  MIN(detected_at)            AS earliest,
  MAX(detected_at)            AS latest
FROM appearances;
```

If `cameras_with_data` is low (e.g. only 1–2 Bosch cameras with IVA Pro),
prioritise the events+LPR path first — those cover all cameras.

---

## 3. NLQ Parse Endpoint

### Request

```
POST /api/nlq/parse
Content-Type: application/json
Authorization: Bearer <session_token>

{
  "query": "หาบุคคลเพศชาย ใส่แจ็คเก็ตสีแดง ไม่ใส่แว่น เมื่อวานบ่ายโมงครึ่ง บริเวณประตูทางเข้าอาคาร A"
}
```

### Response

```json
{
  "filter": {
    "type": "appearance",
    "gender": "Male",
    "upper_color": "Red",
    "glasses": false,
    "from": "2026-06-03T13:30:00+07:00",
    "to": "2026-06-03T14:30:00+07:00",
    "location_hint": "ประตูทางเข้าอาคาร A",
    "camera_ids": ["CAM_ENTRANCE_A"]
  },
  "confidence": "high",
  "raw_llm": "..."
}
```

`camera_ids` is resolved in Phase 2 (location resolver). Until then, `camera_ids` is `null`
and the UI prompts the user to select cameras manually.

### Filter types

| type | Drives | Key fields |
|---|---|---|
| `appearance` | `GET /api/appearances/search` | `gender`, `upper_color`, `lower_color`, `top_category`, `glasses`, `helmet`, `bag` |
| `event` | `GET /api/events` | `camera_id`, `rule`, `event_type`, `object_class`, `q` (free text) |
| `lpr` | `GET /api/events?tab=lpr` + future LPR search endpoint | `plate` |

---

## 4. Implementation Phases

### Phase 0 — Multi-camera appearances (prerequisite)

**File:** `src/api-server.js:4821`

Current: `GET /api/appearances/search?camera_id=X` — single camera only.
Need: `camera_ids[]=X&camera_ids[]=Y` (array), builds `WHERE camera_id = ANY($N)`.

This is the only backend change needed before POC works end-to-end.

```js
// api-server.js — modify /api/appearances/search handler
// current (single):
const cameraId = req.query.camera_id;
// replace with (multi):
const rawIds = [].concat(req.query['camera_ids[]'] || req.query.camera_id || []);
// ... add to WHERE clause: AND (rawIds.length === 0 OR camera_id = ANY($N))
```

### Phase 1 — NLQ parse endpoint

**New file:** `src/routes/nlq.routes.js`  
**Register in:** `src/api-server.js` (add `app.use('/api/nlq', require('./routes/nlq.routes'))`)

The route:
1. Validates input (non-empty query string)
2. Calls LLM adapter (API or local — swappable via env var `NLQ_BACKEND=api|local`)
3. Returns structured JSON filter

### Phase 2 — Location resolver (text → camera_ids)

Fuzzy match `location_hint` against `cameras.location_label` (DB column) and
`camera_groups.name` (DB table `camera_groups`).

```sql
-- Simple fuzzy resolution
SELECT id FROM cameras
WHERE location_label ILIKE '%' || $1 || '%'
   OR name ILIKE '%' || $1 || '%'
LIMIT 10;
```

For Thai phonetics / abbreviations, consider pg_trgm or a small lookup table
maintained by operators in Settings.

---

## 5. LLM Adapter — API Path (POC)

**Package:** `@anthropic-ai/sdk` (already in ecosystem or add via `npm install @anthropic-ai/sdk`)  
**Model:** `claude-haiku-4-5` (exact string — no date suffix)  
**Cost:** ~$0.001–$0.002/query uncached; ~$0.0007/query with prompt caching

```js
// src/services/nlq-api.js
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a CCTV search query parser for a Thai security dashboard.
Extract structured search filters from natural Thai language.
Output ONLY a JSON object — no prose, no markdown fences.

Available filter fields:
- type: "appearance" | "event" | "lpr"
- gender: "Male" | "Female" | null
- upper_color: "Red"|"Blue"|"Green"|"Yellow"|"Black"|"White"|"Gray"|"Orange"|"Purple"|"Brown"|"Pink" | null
- lower_color: same values as upper_color | null
- top_category: "ShortSleeve"|"LongSleeve"|"Dress"|"Suit"|"Uniform" | null
- glasses: true | false | null
- helmet: true | false | null
- bag: true | false | null
- from: ISO8601 datetime with +07:00 offset | null
- to: ISO8601 datetime with +07:00 offset | null
- location_hint: verbatim location text from the query | null
- plate: license plate text | null
- q: free-text keyword for event search | null

Rules:
- Relative time ("เมื่อวาน", "วันนี้", "2 ชั่วโมงที่แล้ว") → absolute ISO8601 based on current time provided
- If type is ambiguous, prefer "appearance" when person attributes are mentioned
- Use "lpr" when a license plate is mentioned
- Use "event" when no person attributes are mentioned
- If a field is not mentioned, use null`;

async function parseQuery(queryText, nowISO) {
  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Current time: ${nowISO}\n\nQuery: ${queryText}`
      }
    ]
  });

  const raw = message.content[0].text.trim();
  return JSON.parse(raw); // throws if LLM returns non-JSON — caller handles
}

module.exports = { parseQuery };
```

**Prompt caching** (add after POC is validated):
Add `cache_control: { type: "ephemeral" }` to the system prompt block.
Requires beta header `anthropic-beta: prompt-caching-2024-07-31`.
Reduces input cost ~90% after first call (5-min TTL).

**Environment variables to add to `.env`:**
```
# NLQ feature
NLQ_BACKEND=api           # "api" or "local"
ANTHROPIC_API_KEY=sk-ant-...
```

---

## 6. LLM Adapter — Local Path (Production / On-Prem)

**Tool:** [Ollama](https://ollama.com) — lightweight LLM runtime, runs as a local HTTP server  
**Model:** Typhoon2-Instruct (SCB10X) — Thai-native, better Thai comprehension than LLaMA

### Installation (on the vigil server)

```bash
# 1. Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# 2. Pull Typhoon2 7B (Thai-native, ~4GB download)
ollama pull typhoon2:7b-instruct

# 3. Verify
ollama run typhoon2:7b-instruct "สวัสดี"

# 4. Ollama runs as a systemd service by default on Linux
#    or: ollama serve &   (for macOS dev)
# Default port: 11434
```

**Hardware requirements:**
- RAM: 8GB minimum (model ~4GB + OS), 16GB recommended
- GPU: optional but 2–5x faster (any CUDA-capable GPU); CPU-only is fine for low-query-volume use
- Storage: ~5GB for model weights

### Local adapter code

```js
// src/services/nlq-local.js
const http = require('http');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'typhoon2:7b-instruct';

// Same SYSTEM_PROMPT as API path (copy from nlq-api.js or import from shared constant)

async function parseQuery(queryText, nowISO) {
  const body = JSON.stringify({
    model: OLLAMA_MODEL,
    prompt: `${SYSTEM_PROMPT}\n\nCurrent time: ${nowISO}\n\nQuery: ${queryText}\n\nJSON:`,
    stream: false,
    options: { temperature: 0.1 }  // low temp for deterministic JSON output
  });

  return new Promise((resolve, reject) => {
    const req = http.request(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const result = JSON.parse(data);
        resolve(JSON.parse(result.response.trim()));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { parseQuery };
```

**Environment variables for local path:**
```
NLQ_BACKEND=local
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=typhoon2:7b-instruct
```

---

## 7. Route Handler (shared — backend-agnostic)

```js
// src/routes/nlq.routes.js
const express = require('express');
const router = express.Router();
const auth = require('../auth');

router.post('/parse', auth.requireAuth, async (req, res) => {
  const { query } = req.body;
  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'query is required' });
  }

  const backend = process.env.NLQ_BACKEND === 'local'
    ? require('../services/nlq-local')
    : require('../services/nlq-api');

  const nowISO = new Date().toLocaleString('sv', { timeZone: 'Asia/Bangkok' }).replace(' ', 'T') + '+07:00';

  try {
    const filter = await backend.parseQuery(query.trim(), nowISO);
    res.json({ filter, confidence: 'high' });
  } catch (err) {
    console.error('[NLQ] parse error:', err.message);
    res.status(502).json({ error: 'nlq_parse_failed', detail: err.message });
  }
});

module.exports = router;
```

---

## 8. Known Gaps Before Full Launch

| Gap | Impact | Resolution |
|---|---|---|
| `/api/appearances/search` single-camera only | NLQ can't target multiple cameras | **Phase 0** — add `camera_ids[]` param |
| LPR plate search endpoint missing | NLQ lpr queries have no backend | Add `GET /api/lpr/search?plate=X` (table + index exist already) |
| Location resolver not built | `camera_ids` always null until Phase 2 | Manual camera picker fallback in UI |
| Coverage unknown | Don't know if appearances data is worth surfacing | Run coverage query (§2) before launch |
| Typhoon2 JSON reliability | Small models sometimes emit non-JSON | Wrap `JSON.parse` in retry + schema validation (zod or manual) |

---

## 9. Cost & Model Notes

| Backend | Cost | PDPA | Thai quality |
|---|---|---|---|
| Claude Haiku API | ~$0.001/query (~$0.0007 with cache) | ❌ data leaves building | ★★★★★ |
| Typhoon2 7B local | $0 recurring, ~5–20s/query on CPU | ✅ fully on-prem | ★★★★☆ |
| LLaMA3 8B local | $0 recurring | ✅ | ★★★☆☆ (Thai weaker) |

**Recommended path:**
1. POC with Haiku API on dev machine (fast, iterate on prompts)
2. Validate JSON output quality against 20–30 real Thai queries
3. Switch to Typhoon2 local for production deployment
4. Keep `NLQ_BACKEND` env var as the only code change needed to switch

---

*LOGIC_nlq-search.md · Vigil Platform · 2026-06-08*
