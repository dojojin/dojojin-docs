// ============================================================
// Vigil Platform — ค้นหาอัจฉริยะ (พิมพ์ไทยอิสระ → AcuSeek)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ผู้ใช้พิมพ์ไทยอิสระ ระบบจับคำแล้วเปลี่ยนเป็นวลีอังกฤษที่เครื่องค้นเข้าใจ
//
// 🔴 หน้าที่สำคัญที่สุดของหน้านี้ไม่ใช่ "ค้นให้เจอ" แต่คือ **กันผู้ใช้เชื่อผลที่ผิด**
// วัดจริง 2026-08-12: "คนถือปืน" ได้คะแนน 97 พร้อมภาพสามใบที่ไม่มีปืนเลย ส่วน
// "รถขายไอศกรีม" ได้ 99 แล้วถูกจริงทั้งสามใบ — คะแนนสองอันนี้แทบไม่ต่างกัน
// ⇒ จอนี้จึงต้อง (ก) โชว์ประโยคอังกฤษที่ส่งจริงและให้แก้ได้ (ข) เตือนก่อนค้นเมื่อ
//    คำถามเป็นรูปที่เครื่องตอบไม่ได้ (ค) ไม่แสดงคะแนนเป็นตัวชี้ว่า "ถูก"
'use strict';

const SSX = {
  tab: 'smart',
  busy: false,
  taskIDs: [],
  timeLabel: null,
  windows: [],
  english: '',
  warnings: [],
  results: [],
  total: 0,
  saturated: false,
  vocab: null,
  showBlocked: false,
};

const _ssxEsc = (s) => (typeof escapeHtml === 'function' ? escapeHtml(String(s ?? ''))
  : String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

function ssxTab(el) {
  const t = el?.dataset?.tab;
  if (!t || t === SSX.tab) return;
  SSX.tab = t;
  document.querySelectorAll('#page-hcp-face-search .trf-tab').forEach((n) => {
    n.classList.toggle('on', n.dataset.tab === t);
  });
  document.getElementById('ssxSmart').hidden = t !== 'smart';
  document.getElementById('ssxFace').hidden = t !== 'face';
  // แท็บใบหน้าโหลดตัวเองครั้งแรกที่ถูกเปิด (hfsInit ปลอดภัยต่อการเรียกซ้ำ)
  if (t === 'face' && typeof hfsInit === 'function') hfsInit();
}

// ── หน้าแรก · โครงคงที่ ────────────────────────────────────────────────
function ssxInit() {
  const el = document.getElementById('ssxBody');
  if (!el || el.dataset.ready) return;
  el.dataset.ready = '1';
  el.innerHTML = `
    <p class="hfs-hint">พิมพ์สิ่งที่ต้องการหาเป็นภาษาไทยได้เลย เช่น
      <b>คนขี่มอเตอร์ไซค์ไม่สวมหมวก</b> · <b>รถเข็นขายของ</b> · <b>รถขายไอศกรีม</b>
      · ระบบจะแปลงเป็นคำที่เครื่องค้นเข้าใจให้เอง</p>

    <div class="ssx-form">
      <input id="ssxText" class="ssx-input" type="text" maxlength="200" autocomplete="off"
             placeholder="เช่น คนขี่มอเตอร์ไซค์ไม่สวมหมวก เมื่อวานบ่ายโมง" aria-label="คำค้นภาษาไทย">
      <button class="btn" id="ssxGo" data-action="ssxSearch">ค้นหา</button>
    </div>

    <!-- ตัวกรองซ่อนไว้โดยตั้งใจ (2026-08-12) — เดิมโชว์ตลอดแล้วชนกับเวลาที่พิมพ์ในข้อความ
         จนผู้ใช้ไม่รู้ว่าอันไหนมีผล · ค่าเริ่มต้นคือ "ใช้ตามที่พิมพ์" เท่านั้น -->
    <div class="ssx-advline">
      <button class="btn-mini ghost" data-action="ssxToggleAdv" id="ssxAdvBtn">ตั้งค่าตัวกรองเอง</button>
      <span class="dim" id="ssxAdvHint">ปกติไม่ต้องตั้ง — ระบบอ่านวันและเวลาจากที่พิมพ์ให้เอง</span>
    </div>

    <div class="ssx-adv" id="ssxAdv" hidden>
      <label>ย้อนหลัง
        <select id="ssxDays" class="ssx-sel">
          <option value="1">1 วัน</option><option value="3">3 วัน</option><option value="7">7 วัน</option>
        </select></label>
      <label>ช่วงเวลาในวัน
        <select id="ssxBand" class="ssx-sel">
          <option value="all">ทั้งวัน</option>
          <option value="day">กลางวัน 06–18</option>
          <option value="night">กลางคืน 18–06</option>
          <option value="morning">ช่วงเช้า 06–12</option>
          <option value="beforenoon">ก่อนเที่ยง 10–12</option>
          <option value="afternoon1">หลังเที่ยง 12–13</option>
          <option value="afternoon">ช่วงบ่าย 12–18</option>
          <option value="lateaftn">บ่ายแก่ ๆ 14–15</option>
          <option value="evening">ตอนเย็น 16–18</option>
          <option value="dawn">เช้ามืด 04–06</option>
          <option value="latenight">ดึก 00–05</option>
          <option value="custom">ระบุช่วงเอง…</option>
        </select></label>
      <span id="ssxRange" class="ssx-range" hidden>
        <input id="ssxFrom" class="ssx-time" type="time" value="14:00" aria-label="ตั้งแต่เวลา">
        <span class="dim">ถึง</span>
        <input id="ssxTo" class="ssx-time" type="time" value="16:00" aria-label="ถึงเวลา">
      </span>
      <label>ความเข้มงวด
        <select id="ssxSim" class="ssx-sel">
          <option value="90">เข้มงวดมาก</option>
          <option value="80" selected>ปานกลาง</option>
          <option value="60">กว้าง</option>
        </select></label>
    </div>

    <div id="ssxPrep"></div>
    <div id="ssxOut"></div>
    <div id="ssxHelp" class="ssx-help"></div>`;

  document.getElementById('ssxBand')?.addEventListener('change', (e) => {
    document.getElementById('ssxRange').hidden = e.target.value !== 'custom';
  });

  const input = document.getElementById('ssxText');
  input?.addEventListener('input', () => ssxPreview());
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') ssxSearch(); });
  ssxLoadVocab();
}

async function ssxLoadVocab() {
  try {
    const r = await fetch(`${API}/api/acuseek/vocab`, { credentials: 'include' });
    SSX.vocab = await r.json();
  } catch { SSX.vocab = null; }
  ssxRenderHelp();
}

// ── แสดงคำเตือน + ประโยคอังกฤษ ก่อนกดค้น ────────────────────────────────
// เรียกทุกครั้งที่พิมพ์ · ทำงานฝั่งเบราว์เซอร์ล้วน ไม่ยิง API
function ssxPreview() {
  const box = document.getElementById('ssxPrep');
  const text = document.getElementById('ssxText')?.value || '';
  if (!box) return;
  if (!text.trim()) { box.innerHTML = ''; return; }

  const v = SSX.vocab;
  const warn = (v?.unsupported || []).filter((u) => _ssxHits(text, u.id));
  const blocked = _ssxBlockedHit(text);

  box.innerHTML = [
    blocked ? `<div class="ssx-note bad">
        <b>คำนี้เครื่องค้นไม่รับ</b> — “${_ssxEsc(blocked.word)}” อยู่ในกลุ่ม ${_ssxEsc(blocked.group)}
        ที่ผู้ผลิตปิดไว้ (ค้นคนจากคุณลักษณะที่ได้รับการคุ้มครอง)
        ${blocked.hint ? `<br>ลองใช้คำนี้แทน: <b>${_ssxEsc(blocked.hint)}</b>` : ''}
      </div>` : '',
    ...warn.map((u) => `<div class="ssx-note warn">
        <b>เรื่อง “${_ssxEsc(u.th)}” เครื่องอาจให้ผลไม่ตรง</b> — ${_ssxEsc(u.why)}
        <br><span class="dim">${_ssxEsc(u.proof)}</span>
      </div>`),
  ].join('');
}

// ตารางคำต้องห้ามมาจาก server (แหล่งเดียวกับที่ดักจริง) — ที่นี่แค่จับคู่คำเพื่อเตือนล่วงหน้า
function _ssxBlockedHit(text) {
  const t = text.toLowerCase();
  for (const row of SSX.vocab?.blocked || []) {
    const w = row.words.find((x) => t.includes(String(x).toLowerCase()));
    if (w) return { word: w, group: row.group, hint: row.hint || null };
  }
  return null;
}

// คำใบ้ฝั่งจอสำหรับเตือนล่วงหน้า — ตัวตัดสินจริงอยู่ที่ server เสมอ
const SSX_HINT_RE = {
  relation:    /จูงมือ|จับมือ|กอด|จูบ|ชนกัน|ปะทะ|ข้างรถ|ยืนข้าง|ตามหลัง/,
  count:       /สองคน|2 ?คน|สามคน|3 ?คน|ซ้อนสาม|หลายคน|กี่คน/,
  spatial:     /บนทางเท้า|ขึ้นทางเท้า|นอกทางม้าลาย|ในเลน|ผิดเลน|หน้าร้าน|ในซอย/,
  tinyobject:  /ปืน|อาวุธ|มีด|บุหรี่|สูบ|เข็ม|ยาเสพติด|ขวด|ธนบัตร/,
  finegrained: /ผูกเชือกรองเท้า|ก้มเก็บ|ล้วงกระเป๋า|กินข้าว|กินบะหมี่|ดื่ม/,
  brand:       /โลโก้|ยี่ห้อ|แบรนด์|liverpool|ลิเวอร์พูล|ป้ายชื่อ|ตัวหนังสือ/i,
};
const _ssxHits = (text, id) => SSX_HINT_RE[id]?.test(text) || false;

function ssxRenderHelp() {
  const el = document.getElementById('ssxHelp');
  if (!el || !SSX.vocab) return;
  const rows = (SSX.vocab.blocked || []).map((r) =>
    `<tr><td>${_ssxEsc(r.group)}</td><td class="dim">${r.words.map(_ssxEsc).join(' · ')}</td></tr>`).join('');
  el.innerHTML = `
    <button class="btn-mini ghost" data-action="ssxToggleBlocked">
      ${SSX.showBlocked ? 'ซ่อน' : 'ดู'}คำที่เครื่องค้นไม่รับ</button>
    <div id="ssxBlockedBox" ${SSX.showBlocked ? '' : 'hidden'}>
      <p class="dim ssx-help-p">ผู้ผลิตปิดการค้นคนด้วยคุณลักษณะที่ได้รับการคุ้มครองไว้ที่ตัวเครื่อง
        พิมพ์คำเหล่านี้จะค้นไม่ได้ · เลี่ยงได้ด้วยการบรรยายเสื้อผ้าแทนตัวบุคคล
        (เช่น ใช้ “คนใส่จีวรสีส้ม” แทนคำว่า “พระ”)</p>
      <div class="ssx-tablewrap"><table class="ssx-table">
        <thead><tr><th>กลุ่ม</th><th>ตัวอย่างคำ</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
}

// ตัวกรองเป็นของเสริม — เปิดแล้วค่าในนั้นถึงจะถูกส่ง · ปิดอยู่ = ใช้ตามที่พิมพ์ล้วน
function ssxToggleAdv() {
  const box = document.getElementById('ssxAdv');
  const on = box.hidden;
  box.hidden = !on;
  document.getElementById('ssxAdvBtn').textContent = on ? 'ปิดตัวกรอง' : 'ตั้งค่าตัวกรองเอง';
  document.getElementById('ssxAdvHint').hidden = on;
}

function ssxToggleBlocked() {
  SSX.showBlocked = !SSX.showBlocked;
  ssxRenderHelp();
}

// ── ค้นจริง ────────────────────────────────────────────────────────────
async function ssxSearch() {
  if (SSX.busy) return;
  const text = (document.getElementById('ssxText')?.value || '').trim();
  if (!text) return;
  // ปิดตัวกรองอยู่ = ไม่ส่งค่าอะไรเลย ให้สิ่งที่พิมพ์เป็นตัวกำหนดทั้งหมด
  const adv = !document.getElementById('ssxAdv')?.hidden;
  const days = adv ? (document.getElementById('ssxDays')?.value || '1') : '1';
  const band = adv ? (document.getElementById('ssxBand')?.value || 'all') : 'all';
  const from = adv && band === 'custom' ? (document.getElementById('ssxFrom')?.value || '') : '';
  const to   = adv && band === 'custom' ? (document.getElementById('ssxTo')?.value || '') : '';
  const sim = adv ? (document.getElementById('ssxSim')?.value || '80') : '80';
  const out = document.getElementById('ssxOut');
  SSX.busy = true;
  document.getElementById('ssxGo').disabled = true;
  out.innerHTML = `<div class="ssx-note">กำลังค้น…</div>`;

  try {
    const r = await fetch(`${API}/api/acuseek/search`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, days: Number(days), band, from, to, similarity: Number(sim),
                             ...(SSX.english && SSX.englishFor === text ? { english: SSX.english } : {}) }),
    });
    const d = await r.json();
    if (!r.ok || d.ok === false) return ssxShowFail(d);
    SSX.taskIDs = d.taskIDs || []; SSX.english = d.english; SSX.englishFor = text;
    SSX.warnings = d.warnings || []; SSX.unknown = d.unknown || []; SSX.timeLabel = d.timeLabel || null;
    // คนละตัวกับ SSX.dropped (จำนวนผลที่ถูกซ่อนเพราะสิทธิ์กล้อง จาก /status)
    SSX.droppedWords = d.dropped_words || [];
    SSX.timeSource = d.timeSource || null; SSX.windows = d.windows || [];
    await ssxPoll();
  } catch (e) {
    out.innerHTML = `<div class="ssx-note bad">ค้นไม่สำเร็จ: ${_ssxEsc(e.message)}</div>`;
  } finally {
    SSX.busy = false;
    const b = document.getElementById('ssxGo'); if (b) b.disabled = false;
  }
}

function ssxShowFail(d) {
  const out = document.getElementById('ssxOut');
  const msg = {
    blocked: 'คำที่พิมพ์มีคำที่เครื่องค้นไม่รับ',
    unknown: 'ยังไม่รู้จักคำที่พิมพ์ — ลองบอกให้ตรงขึ้น เช่น “คนใส่เสื้อแดง” หรือ “รถกระบะสีขาว”',
    noCameras: 'บัญชีนี้ยังไม่ได้รับสิทธิ์ดูกล้องที่เครื่องค้นครอบคลุม',
    sensitive: 'เครื่องค้นปฏิเสธคำนี้ (คำที่ผู้ผลิตปิดไว้)',
    range: 'ช่วงเวลากว้างเกินที่เครื่องรับได้ — ลองย่นช่วงลง',
    // ขอช่วงที่ยังมาไม่ถึง (เช่น ระบุวันที่ในอนาคต) — เดิมระบบเงียบแล้วค้นทั้งวันแทน
    futureWindow: 'ช่วงเวลาที่เลือกยังมาไม่ถึง จึงยังไม่มีภาพให้ค้น — ลองเลือกวันหรือช่วงเวลาที่ผ่านมาแล้ว',
  }[d.reason] || d.error || 'ค้นไม่สำเร็จ';
  out.innerHTML = `<div class="ssx-note bad">${_ssxEsc(msg)}</div>`;
}

async function ssxPoll() {
  const out = document.getElementById('ssxOut');
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 900 : 1800));
    const r = await fetch(`${API}/api/acuseek/status`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskIDs: SSX.taskIDs, maxResults: 30 }),
    });
    const d = await r.json();
    if (!r.ok || d.ok === false) {
      out.innerHTML = `<div class="ssx-note bad">${_ssxEsc(d.error || 'ถามผลไม่สำเร็จ')}</div>`;
      return;
    }
    if (d.runStatus === 'searching') {
      out.innerHTML = `<div class="ssx-note">กำลังค้น… ${Number(d.progress) || 0}%</div>`;
      continue;
    }
    SSX.results = d.results || []; SSX.total = d.total; SSX.saturated = d.saturated;
    SSX.dropped = d.dropped_by_scope || 0;
    return ssxRenderResults();
  }
  out.innerHTML = `<div class="ssx-note bad">ค้นนานผิดปกติ ลองใหม่อีกครั้ง</div>`;
}

function ssxRenderResults() {
  const out = document.getElementById('ssxOut');
  const n = SSX.results.length;
  const totalTxt = SSX.saturated ? `${SSX.total}+` : String(SSX.total ?? 0);

  const head = `
    ${SSX.unknown?.length ? `<div class="ssx-note warn">
        <b>ระบบยังไม่รู้จักคำว่า “${SSX.unknown.map(_ssxEsc).join('”, “')}”</b>
        — ส่วนนี้ไม่ได้ถูกส่งไปให้เครื่องค้น
        <br>ถ้าผลไม่ตรงที่ต้องการ แก้ประโยคภาษาอังกฤษข้างล่างเองได้เลย แล้วกดค้นใหม่
      </div>` : ''}
    ${/* คนละอาการกับข้างบน: คำพวกนี้ระบบ **อ่านออก** แต่ตอนประกอบประโยคกลับไม่ได้ใช้
          จึงไม่เคยโผล่ใน unknown เลย ("คนจูงหมา" → `a dog` · "หมวกกันน็อคสีขาว" ทิ้งขาว)
          เป็นความพังที่เงียบที่สุด เพราะผลลัพธ์ยังได้คะแนนสูงและดูน่าเชื่อ */ ''}
    ${(SSX.droppedWords || []).map((d) => `<div class="ssx-note warn">
        <b>คำค้นที่ส่งไปจริงไม่ครบตามที่พิมพ์</b> — ${_ssxEsc(d.note)}
        <br>แก้ประโยคภาษาอังกฤษข้างล่างให้ตรงที่ต้องการ แล้วกดค้นใหม่
      </div>`).join('')}
    ${/* คำเตือน "เครื่องตอบไม่ได้" ที่ server ส่งมาพร้อมผล — ต้องอยู่ **เหนือผลลัพธ์**
          เพราะจุดที่อันตรายคือตอนคนกำลังอ่านผลที่ได้คะแนน 95 อยู่ ไม่ใช่ตอนพิมพ์
          กล่องพรีวิวตอนพิมพ์ใช้ regex ไทยฝั่ง client ซึ่งไม่เห็นประโยคอังกฤษที่ผู้ใช้
          แก้เอง · อันนี้คือชุดที่ผ่านด่านจริงฝั่ง server มาแล้วทั้งไทยและอังกฤษ */ ''}
    ${(SSX.warnings || []).map((w) => `<div class="ssx-note warn">
        <b>ผลด้านล่างอาจมีภาพที่ใกล้เคียง แต่เรื่อง “${_ssxEsc(w.th)}” เครื่องอาจให้ผลไม่ตรง</b>
        — ${_ssxEsc(w.why)}
        <br><span class="dim">${_ssxEsc(w.proof)}</span>
      </div>`).join('')}
    <div class="ssx-sent">
      <span class="dim">ส่งให้เครื่องค้นว่า</span>
      <input id="ssxEn" class="ssx-en" value="${_ssxEsc(SSX.english)}" spellcheck="false"
             aria-label="ข้อความภาษาอังกฤษที่ส่งให้เครื่องค้น">
      <button class="btn-mini" data-action="ssxRerun">ค้นใหม่ด้วยข้อความนี้</button>
    </div>
    <div class="ssx-sum">พบ <b>${_ssxEsc(totalTxt)}</b> รายการ · แสดง ${n}
      ${SSX.timeLabel ? `<span class="ssx-chip">${SSX.timeSource === 'typed'
          ? 'อ่านเวลาจากคำที่พิมพ์' : 'ช่วงเวลา'}: ${_ssxEsc(SSX.timeLabel)}</span>` : ''}
      ${SSX.windows?.length > 1 ? `<span class="dim">· ซอยเป็น ${SSX.windows.length} ช่วงแล้วรวมผล</span>` : ''}
      ${SSX.saturated
        ? '<span class="dim">· ยังตันเพดาน 500 ต่อช่วง — เลือกช่วงเวลาให้แคบลงเพื่อให้ได้จำนวนที่แน่นอน</span>'
        : '<span class="dim">· เป็นจำนวนจริง ไม่ได้ตันเพดาน</span>'}
      ${SSX.dropped ? `<span class="dim">· ซ่อน ${SSX.dropped} รายการจากกล้องที่บัญชีนี้ไม่มีสิทธิ์</span>` : ''}
    </div>`;

  if (!n) {
    out.innerHTML = head + `<div class="ssx-note">ไม่พบรายการที่ตรง — ลองลดความเข้มงวด หรือเปลี่ยนคำ</div>`;
    return;
  }

  const cards = SSX.results.map((r, i) => {
    const pic = r.cropUrl || r.fullUrl;
    const t = r.time ? new Date(r.time).toLocaleString('th-TH', { hour12: false }) : '-';
    return `<figure class="ssx-card" data-action="ssxOpen" data-i="${i}" tabindex="0" role="button">
      ${pic ? `<img loading="lazy" src="${API}/api/acuseek/picture?u=${encodeURIComponent(pic)}" alt="">`
            : '<div class="ssx-noimg">ไม่มีภาพ</div>'}
      <figcaption>
        <b>${_ssxEsc(r.camera_name || `ช่อง ${r.channelID}`)}</b>
        <span class="dim">${_ssxEsc(t)}</span>
      </figcaption>
    </figure>`;
  }).join('');

  out.innerHTML = head + `<div class="ssx-grid">${cards}</div>
    <p class="ssx-foot dim">เรียงตามความใกล้เคียงที่เครื่องประเมิน — <b>ไม่ใช่ลำดับความถูกต้อง</b>
      กรุณาดูภาพก่อนสรุปทุกครั้ง</p>`;
}

// ── ภาพใหญ่ + รายละเอียด ────────────────────────────────────────────────
// โครงเดียวกับโมดัลรูปพรรณบุคคล — ซ้ายภาพครอปเป้าหมาย ขวาภาพเต็มเฟรมพร้อมกรอบ
// วาดกรอบทับภาพเต็มด้วย targetRect (normalized) เพื่อให้เห็นว่าระบบชี้ที่ใคร
// ไม่งั้นภาพถนนที่มีคน 10 คนจะบอกไม่ได้เลยว่าผลนี้หมายถึงคนไหน
function ssxOpen(el) {
  const r = SSX.results[Number(el?.dataset?.i)];
  if (!r) return;
  const pic = (u) => `${API}/api/acuseek/picture?u=${encodeURIComponent(u)}`;
  const rect = r.rect || null;
  const box = rect ? `<div class="ssx-mbox" style="left:${(+rect.x * 100).toFixed(2)}%;top:${(+rect.y * 100).toFixed(2)}%;`
    + `width:${(+rect.width * 100).toFixed(2)}%;height:${(+rect.height * 100).toFixed(2)}%"></div>` : '';
  const typeTh = { human: 'คน', vehicle: 'ยานพาหนะ', animal: 'สัตว์', face: 'ใบหน้า' }[r.targetType] || r.targetType || '-';

  document.getElementById('ssxModalTime').textContent =
    r.time ? new Date(r.time).toLocaleString('th-TH', { hour12: false }) : '';
  document.getElementById('ssxModalBody').innerHTML = `
    <div class="ssx-mgrid">
      <div class="lm-box">
        <span class="lm-cap">เป้าหมาย</span>
        ${r.cropUrl ? `<img class="ssx-mcrop" src="${pic(r.cropUrl)}" alt="">` : '<div class="dim">ไม่มีภาพ</div>'}
      </div>
      <div class="lm-box">
        <span class="lm-cap">ภาพเต็มเฟรม</span>
        ${r.fullUrl ? `<div class="ssx-mfull"><img src="${pic(r.fullUrl)}" alt="">${box}
          <button class="ssx-zoom" type="button" title="เปิดไฟล์ภาพขนาดเต็ม"
                  data-action="openUrl" data-url="${pic(r.fullUrl)}">
            <svg aria-hidden="true"><use href="#icon-search"/></svg></button></div>`
                    : '<div class="dim">ไม่มีภาพ</div>'}
      </div>
    </div>
    <table class="ssx-mtable"><tbody>
      <tr><th>กล้อง</th><td>${_ssxEsc(r.camera_name || '(ไม่ได้เชื่อมกับกล้องในระบบ)')}</td></tr>
      <tr><th>เวลา</th><td>${_ssxEsc(r.time ? new Date(r.time).toLocaleString('th-TH', { hour12: false }) : '-')}</td></tr>
      <tr><th>ชนิดเป้าหมาย</th><td>${_ssxEsc(typeTh)}</td></tr>
      <tr><th>ความใกล้เคียง</th><td>${_ssxEsc(r.similarity)}
        <span class="dim">— เป็นความมั่นใจของเครื่อง <b>ไม่ใช่ความถูกต้อง</b> กรุณาดูภาพประกอบเสมอ</span></td></tr>
      <tr><th>ช่องบนเครื่องค้น</th><td>${_ssxEsc(r.channelID)}</td></tr>
    </tbody></table>`;
  document.getElementById('ssxModal').style.display = 'flex';
}

function ssxCloseModal() {
  const m = document.getElementById('ssxModal');
  if (m) m.style.display = 'none';
}

// แก้ประโยคอังกฤษเองแล้วค้นซ้ำ — ทางออกเมื่อระบบแปลไม่ตรงใจ
function ssxRerun() {
  const en = document.getElementById('ssxEn')?.value?.trim();
  if (!en) return;
  SSX.english = en;
  SSX.englishFor = (document.getElementById('ssxText')?.value || '').trim();
  ssxSearch();
}
