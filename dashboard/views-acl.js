// ============================================================
// Vigil Platform — View ACL (client side)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// สิทธิ์ "เห็นหน้า/แท็บไหน" ของผู้ใช้คนที่ล็อกอินอยู่ ดึงจาก `GET /api/views` ครั้งเดียว
// ตอน bootstrap (decision #250-#251)
//
// ⚠️ ไฟล์นี้เป็น **ความสะดวก ไม่ใช่ความปลอดภัย** — การกันจริงอยู่ที่ allowlist ฝั่ง
// server (`src/helpers/viewGuard.js`) ซึ่งตอบ 403 ให้ทุก request ที่เกินสิทธิ์อยู่แล้ว
// สิ่งที่ไฟล์นี้ทำคือกันไม่ให้หน้าจอวิ่งไปชน 403 เอง แล้วขึ้น error ที่ผู้ใช้ไม่เข้าใจ
// ห้ามใช้ค่าจากไฟล์นี้เป็นเหตุผลว่า "ปลอดภัยแล้ว" เด็ดขาด

'use strict';

const ViewsACL = (() => {
  let _allowed = null;    // null = ไม่จำกัด · array = รายการ view key
  let _landing = null;
  let _message = 'อยู่ระหว่างการปรับปรุงการให้บริการ';
  let _views = [];
  let _loaded = false;

  async function load() {
    try {
      const r = await fetch(`${API}/api/views`, { credentials: 'include' });
      if (!r.ok) return false;
      const d = await r.json();
      _views   = Array.isArray(d.views) ? d.views : [];
      _allowed = Array.isArray(d.allowed) ? d.allowed : null;
      _landing = d.landing || null;
      if (d.message) _message = d.message;
      _loaded = true;
      return true;
    } catch {
      // อ่านสิทธิ์ไม่ได้ = ถือว่าไม่จำกัด (พฤติกรรมเดิม) — server ยังกันให้อยู่ดี
      // ถ้า fail closed ตรงนี้ ผู้ใช้ปกติจะเจอจอว่างเปล่าเมื่อ network สะดุดครั้งเดียว
      return false;
    }
  }

  /** ผู้ใช้คนนี้ถูกจำกัดสิทธิ์อยู่หรือเปล่า */
  function restricted() { return Array.isArray(_allowed); }

  /**
   * เห็น view นี้ได้ไหม — รับได้ทั้ง 'traffic' และ 'traffic:helmet'
   * • ได้ทั้งหน้า → ได้ทุกแท็บในหน้านั้นด้วย
   * • ได้แค่แท็บใดแท็บหนึ่ง → เข้าหน้าแม่ได้ (ไม่งั้นจะไม่มีทางไปถึงแท็บตัวเอง)
   */
  function allowed(key) {
    if (!Array.isArray(_allowed) || !key) return true;
    if (_allowed.includes(key)) return true;
    if (key.includes(':')) return _allowed.includes(key.split(':')[0]);
    return _allowed.some(k => k.startsWith(key + ':'));
  }

  /** แท็บแรกที่ผู้ใช้เข้าได้ (ใช้แทนแท็บที่ hardcode ไว้ตอนเปิดหน้า) */
  function firstTab(pageKey, tabKeys, fallback) {
    const hit = (tabKeys || []).find(t => allowed(`${pageKey}:${t}`));
    return hit || fallback || (tabKeys || [])[0] || null;
  }

  /** กรองรายการแท็บให้เหลือเฉพาะที่เข้าได้ */
  function filterTabs(pageKey, tabKeys) {
    if (!Array.isArray(_allowed)) return tabKeys;
    return (tabKeys || []).filter(t => allowed(`${pageKey}:${t}`));
  }

  /** หน้าใน sidebar ที่ผู้ใช้คนนี้ไม่มีสิทธิ์ — ส่งต่อให้ applyNavVisibility() ซ่อน */
  function hiddenPages() {
    if (!Array.isArray(_allowed)) return [];
    return [...document.querySelectorAll('.sidebar .nav-item[data-page]')]
      .map(n => n.dataset.page)
      .filter(p => !allowed(p));
  }

  return {
    load, restricted, allowed, firstTab, filterTabs, hiddenPages,
    landing: () => _landing,
    message: () => _message,
    views:   () => _views,
    loaded:  () => _loaded,
  };
})();
