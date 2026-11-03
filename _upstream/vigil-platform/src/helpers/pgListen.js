// ============================================================
// Vigil Platform — Postgres LISTEN that survives a dropped connection
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// เหตุจริง 2026-09-26 17:21: ดิสก์เขียน WAL ไม่สำเร็จ → Postgres crash แล้วกู้ตัวเอง
// client ของ LISTEN ทุกตัวหลุดพร้อมกัน ตัวที่มีแค่ on('error', log) ไม่ต่อกลับเลย
// ws-bridge ของ api-server จึงไม่ดัน event สดขึ้น dashboard ~29 ชม. จนมีคน restart (GOTCHAS #217)
//
// ตัวนี้: ต่อ + LISTEN ทุก channel · หลุด (error หรือ end) → ทิ้ง client เดิม แล้วต่อใหม่แบบ backoff
// 1 → 2 → 4 … สูงสุด maxDelayMs · ต่อครั้งแรกไม่ติดก็ลองใหม่แบบเดียวกัน
// ⚠️ NOTIFY ไม่ทนทาน: ระหว่างหลุดข้อความหายไป ใครต้องการไม่ให้หายต้องมี outbox/cursor (Codex OPT-07)
'use strict';

/**
 * @param {object} o
 * @param {string}   o.label          ป้ายใน log
 * @param {string[]} o.channels       channel ที่ LISTEN
 * @param {(msg) => void} o.onNotification
 * @param {() => object} o.makeClient  สร้าง pg.Client ใหม่ (เทสต์ฉีดตัวปลอมได้)
 * @returns {{ stop: () => Promise<void>, isConnected: () => boolean }}
 */
function listenForever({ label, channels, onNotification, makeClient, minDelayMs = 1000, maxDelayMs = 30_000 }) {
  let client = null, stopped = false, connected = false, delay = minDelayMs, timer = null;

  const schedule = () => {
    if (stopped || timer) return;
    timer = setTimeout(() => { timer = null; connect(); }, delay);
    if (timer.unref) timer.unref();
    delay = Math.min(delay * 2, maxDelayMs);
  };

  const drop = (c, why) => {
    if (c !== client) return;            // error + end ยิงคู่กัน — จัดการครั้งเดียว
    client = null;
    if (connected) console.error(`[${label}] LISTEN connection lost: ${why} — reconnecting`);
    connected = false;
    c.removeAllListeners('notification');
    c.end().catch(() => {});
    schedule();
  };

  async function connect() {
    if (stopped) return;
    const c = makeClient();
    client = c;
    c.on('error', (e) => drop(c, e.message));
    c.on('end', () => drop(c, 'ended'));
    c.on('notification', onNotification);
    try {
      await c.connect();
      for (const ch of channels) await c.query(`LISTEN ${ch}`);
      if (c !== client) return;            // หลุดระหว่างต่อ — drop จัดการไปแล้ว
      connected = true;
      delay = minDelayMs;
      console.log(`[${label}] LISTEN ${channels.join(' + ')}`);
    } catch (e) {
      console.warn(`[${label}] LISTEN connect failed: ${e.message} — retry in ${Math.round(delay / 1000)}s`);
      drop(c, e.message);
    }
  }

  connect();
  return {
    isConnected: () => connected,
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      const c = client; client = null; connected = false;
      if (c) await c.end().catch(() => {});
    },
  };
}

module.exports = { listenForever };
