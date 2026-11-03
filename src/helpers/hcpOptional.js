// ============================================================
// Vigil Platform — HC-R · ความสามารถที่ "ต่อได้แล้ว แต่ปิดสวิตช์ไว้"
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// เจ้าของสั่งไว้ว่า 5 กลุ่มนี้ให้ "เขียนโค้ดและพิสูจน์ว่าต่อได้ แต่ default ปิด ·
// เปิดได้ด้วยสวิตช์เดียวโดยไม่ต้องเขียนใหม่" — ไฟล์นี้คือสวิตช์นั้น
//
//   `HCP_OPTIONAL` ใน .env ของ edge · คั่นด้วย , · ว่าง = ปิดทุกอย่าง (ค่าปริยาย)
//   ตัวอย่าง: HCP_OPTIONAL=lpr_all,regions
//
// **ทุกอย่างที่นี่อ่านอย่างเดียว** — HCP เป็นระบบของตำรวจที่มีคนอื่นใช้อยู่จริง
// การ subscribe/แก้ค่า/ลบ ถือเป็นการเขียน จึงมีแค่ `subscription_view` (ดูว่ามีใคร
// subscribe อะไรไว้) ส่วนตัว subscribe จริง **จงใจไม่เขียน** ไม่ใช่ลืม
// ============================================================
'use strict';

const { hcpCall } = require('./hcpPage');
const { hcpTime } = require('./hcpTime');

const CAPS = {
  // Ⓐ ป้ายทะเบียนทั้งหมดที่ HCP เห็น (เรามี LPR ของตัวเองอยู่แล้ว — เปิดอันนี้แปลว่า
  // ยอมรับข้อมูลสองชุดที่อาจไม่ตรงกัน ต้องตั้งใจเปิด)
  lpr_all: {
    label: 'ป้ายทะเบียนทั้งหมดจาก HCP',
    // ชื่อพารามิเตอร์เวลาคือ `startTime`/`endTime` เฉย ๆ — ไม่ใช่ `crossRecordStartTime`
    // ตามที่ชื่อฟิลด์ในผลลัพธ์ชวนให้เดา (ยิงจริงถึงรู้: code 2 [startTime parameter error])
    // **ถามได้ทีละกล้องเท่านั้น** — ไม่มีโหมด "ทุกกล้อง" · ใครเปิดใช้ต้องวนเอง
    // และคิดเรื่องจำนวนคำขอเอง (วัดไว้แล้ว 4 กล้อง = 140k-348k แถว/ตัว)
    run: (p = {}) => hcpCall('/artemis/api/pms/v1/crossRecords/page', {
      pageNo: 1, pageSize: Math.min(500, Number(p.pageSize) || 10),
      cameraIndexCode: String(p.camera || ''),
      startTime: hcpTime(p.since ? new Date(p.since) : new Date(Date.now() - 86400000)),
      endTime: hcpTime(p.until ? new Date(p.until) : new Date()),
    }),
  },
  // Ⓑ เหตุการณ์ทั้งหมด **รวมหมวดที่ HC5 ตัดออก** (130/131/49697)
  events_all: {
    label: 'เหตุการณ์ทั้งหมด รวมหมวดที่ HC5 ตัดออก',
    run: (p = {}) => hcpCall('/artemis/api/eventService/v1/eventRecords/page', {
      pageNo: 1, pageSize: Math.min(500, Number(p.pageSize) || 10),
      startTime: hcpTime(p.since ? new Date(p.since) : new Date(Date.now() - 86400000)),
      endTime: hcpTime(p.until ? new Date(p.until) : new Date()),
      eventTypes: String(p.types || '130,131,49697'),
      srcType: 'camera', srcIndexs: String(p.cameras || ''),
    }),
  },
  // Ⓒ ดูว่ามีใคร subscribe อะไรไว้ — **อ่านอย่างเดียว** (ดูหมายเหตุหัวไฟล์)
  subscription_view: {
    label: 'ดูรายการ push subscription ที่มีอยู่ (อ่านอย่างเดียว)',
    // code 66 = "ยังไม่มีใคร subscribe" ซึ่งเป็นสภาพปกติของเรา (เราไม่เคย subscribe
    // เพราะการ subscribe คือการเขียนลง HCP) — ตอบว่าไม่มี ไม่ใช่โยน error
    run: async () => {
      try { return await hcpCall('/artemis/api/eventService/v1/eventSubscriptionView', {}); }
      catch (e) { if (/code=66/.test(e.message)) return { list: [], total: 0, note: 'ยังไม่มี subscription' }; throw e; }
    },
  },
  // วิดีโอสด/ย้อนหลัง — คืน URL ของสตรีม ไม่ได้ดึงวิดีโอมาเก็บ
  video_url: {
    label: 'ลิงก์วิดีโอสด/ย้อนหลัง',
    run: (p = {}) => hcpCall('/artemis/api/video/v1/cameras/previewURLs', {
      cameraIndexCode: String(p.camera || ''), streamType: 0, protocol: 'rtsp', transmode: 1,
    }),
  },
  // พื้นที่ / บุคคล ที่ HCP จัดโครงสร้างไว้
  regions: {
    label: 'พื้นที่ (region) ของ HCP',
    run: (p = {}) => hcpCall('/artemis/api/resource/v1/regions', { pageNo: 1, pageSize: Math.min(500, Number(p.pageSize) || 10) }),
  },
  persons: {
    label: 'ทะเบียนบุคคลของ HCP',
    run: (p = {}) => hcpCall('/artemis/api/resource/v1/person/personList', { pageNo: 1, pageSize: Math.min(500, Number(p.pageSize) || 10) }),
  },
};

const enabledSet = () => new Set(String(process.env.HCP_OPTIONAL || '')
  .split(',').map((x) => x.trim()).filter(Boolean));

function listCaps() {
  const on = enabledSet();
  return Object.entries(CAPS).map(([k, v]) => ({ cap: k, label: v.label, enabled: on.has(k) }));
}

// คืน { off: true } เมื่อสวิตช์ปิด — ให้คนเรียกตอบ 403 เอง · ไม่ throw เพราะ
// "ปิดอยู่" ไม่ใช่ความผิดพลาด
async function runCap(cap, params) {
  if (!CAPS[cap]) return { error: 'unknown capability', cap };
  if (!enabledSet().has(cap)) return { off: true, cap, hint: `เปิดด้วย HCP_OPTIONAL=${cap} ใน .env ของ edge` };
  return { ok: true, cap, data: await CAPS[cap].run(params || {}) };
}

module.exports = { CAPS, listCaps, runCap, enabledSet };
