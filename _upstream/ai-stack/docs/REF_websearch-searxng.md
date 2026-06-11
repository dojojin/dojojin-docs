# REF_websearch-searxng — Web Search (SearXNG) + Open WebUI บน Bazzite

> ตั้งค่าให้ Open WebUI สรุป "ข่าววันนี้" / ตอบจากข้อมูลสดได้ ผ่าน SearXNG (self-host).
> เครื่องนี้เป็น **Bazzite/Kinoite (immutable)** — ไม่มี docker → ใช้ **podman quadlet** แทน docker-compose.
> โหลดเมื่อ: ตั้ง/แก้ web search, embedding, หรือ debug ว่า search ไม่เข้า context.
> Incident ที่เกี่ยวข้อง: GOTCHAS #15–#19.

---

## สถาปัตยกรรม

```
ผู้ใช้ถาม (เปิด 🌐 Web Search, โมเดล qwen3:4b ตรง ๆ)
  → Open WebUI (container) สร้าง search query (TASK_MODEL=qwen2.5-coder:3b)
  → SearXNG (container, เครือข่าย podman 'ai-stack', ชื่อ host = searxng:8080)
  → ผลค้น (snippet) inject เข้า prompt ตรง ๆ (bypass embed/retrieve)
  → qwen3:4b สรุป
```

ทุกอย่างรันบน host เดียว, containers อยู่บน **podman network `ai-stack`** (คุยกันด้วยชื่อ container).
Ollama รันบน host (systemd) — container เข้าถึงผ่าน `host.containers.internal` / `host.docker.internal`.

---

## Containers (podman quadlet, รันเป็น system service)

| service | quadlet | หน้าที่ |
|---|---|---|
| `ollama.service` | `/etc/systemd/system/ollama.service` (เขียนเอง — ดู REF_commands) | LLM engine (host, ไม่ใช่ container) |
| `openwebui.service` | `/etc/containers/systemd/openwebui.container` | หน้าแชต :3000 |
| `searxng.service` | `/etc/containers/systemd/searxng.container` | metasearch :8888 (host) / :8080 (in-net) |

### `searxng.container`
```ini
[Unit]
Description=SearXNG (metasearch engine for Open WebUI)
After=network-online.target
Wants=network-online.target
[Container]
Image=docker.io/searxng/searxng:latest
ContainerName=searxng
Network=ai-stack
PublishPort=127.0.0.1:8888:8080
Volume=/var/lib/searxng:/etc/searxng:Z
Environment=SEARXNG_BASE_URL=http://localhost:8888/
[Service]
Restart=always
TimeoutStartSec=300
[Install]
WantedBy=multi-user.target default.target
```

### `/var/lib/searxng/settings.yml` (เจ้าของ uid 977)
```yaml
use_default_settings: true
server:
  secret_key: "<openssl rand -hex 32>"   # อย่า commit ค่าจริง
  limiter: false
search:
  formats: [html, json]   # ⚠️ ต้องเปิด json ไม่งั้น Open WebUI อ่านไม่ได้
```

### `openwebui.container` (ส่วนสำคัญ)
```ini
[Container]
Image=ghcr.io/open-webui/open-webui:main
ContainerName=openwebui
Network=ai-stack
PublishPort=127.0.0.1:3000:8080
Environment=OLLAMA_BASE_URL=http://host.containers.internal:11434
Environment=ENABLE_SIGNUP=false
Environment=WEBUI_SECRET_KEY=<fixed-hex>     # ⚠️ ต้อง pin ไม่งั้น restart=logout (GOTCHAS #18)
Environment=TASK_MODEL=qwen2.5-coder:3b      # query/title gen เร็ว ไม่ thinking (GOTCHAS #19)
Volume=/var/lib/openwebui:/app/backend/data:Z
AddHost=host.containers.internal:host-gateway
```

> สร้าง network ครั้งเดียว: `sudo podman network create ai-stack`
> หลังแก้ quadlet: `sudo systemctl daemon-reload && sudo systemctl restart <svc>`

---

## ตั้งค่าใน Open WebUI (เก็บใน DB `config` — ตั้งผ่าน GUI หรือแก้ DB)

**Admin → Settings → Documents (Embedding):**
- Embedding Model Engine = `Ollama`
- Embedding Model = `bge-m3` (⚠️ ระวังพิมพ์ผิดมีสระไทยติด เช่น `ิbge-m3`)

**Admin → Settings → Web Search:**
| ค่า | ตั้งเป็น | เหตุผล |
|---|---|---|
| Enable Web Search | on | |
| Engine | `searxng` | |
| Searxng Query URL | `http://searxng:8080/search?q=<query>` | ชื่อ container ใน network ai-stack |
| Searxng Language | `all` | **ห้าม** `th,en` (list) → 400 (GOTCHAS #15) |
| Bypass Web Loader | **on** | ใช้ snippet ไม่โหลดทั้งหน้า (เร็ว) |
| Bypass Embedding and Retrieval | **on** | inject ผลค้นตรง ๆ — กัน retrieve ได้ 0 (GOTCHAS #16,#17) |
| Result Count | 5 | |

แก้ผ่าน DB ก็ได้ (path: `rag.web.search.*`, `rag.embedding_engine/model`):
```bash
sudo systemctl stop openwebui     # กัน race ตอน app เขียน config ทับ
sudo python3 -c "import sqlite3,json; db='/var/lib/openwebui/webui.db'; c=sqlite3.connect(db); \
r=c.execute('select id,data from config order by id desc limit 1').fetchone(); d=json.loads(r[1]); \
w=d['rag']['web']['search']; w['searxng_language']='all'; w['bypass_web_loader']=True; \
w['bypass_embedding_and_retrieval']=True; w['result_count']=5; d['rag']['embedding_model']='bge-m3'; \
c.execute('update config set data=? where id=?',(json.dumps(d),r[0])); c.commit()"
sudo systemctl start openwebui
```

---

## วิธีใช้ (สำคัญ)

1. **โมเดลต้องเป็น direct** (`qwen3:4b`) — **ไม่ใช่ "🔀 Model Router"** (pipe ไม่รับ web-search context, GOTCHAS #16)
2. เปิด 🌐 **Web Search** ในช่องพิมพ์
3. เติม **`/no_think`** ท้ายคำถามเพื่อความเร็ว (ปิด thinking ของ qwen3, GOTCHAS #19)
   ```
   สรุปข่าวไอทีวันนี้ /no_think
   ```

---

## Debug "search ไม่เข้า / ตอบข่าวเก่า"

```bash
# 1) SearXNG ถูกค้นไหม + 200 หรือ 400?
sudo podman logs --since 5m searxng | grep -iE "search|400|language"
# 2) Open WebUI ดึง+embed/inject สำเร็จไหม
sudo podman logs --since 5m openwebui | grep -iE "web_search|embedding|collection|error"
# 3) context เข้าโมเดลจริงไหม → ดู usage.input_tokens ของคำตอบใน DB
#    ~400 = ไม่เข้า, พัน ๆ = เข้าแล้ว (GOTCHAS #17)
```

หมายเหตุ: โหมด `bypass_embedding_and_retrieval=on` จะ**ไม่ใช้ bge-m3** สำหรับ web search (ฉีดตรง).
bge-m3 ยังใช้กับ RAG เอกสารที่อัปโหลดเอง (Knowledge) อยู่.

---

*ai-stack · REF_websearch-searxng · 2026-06-09*
