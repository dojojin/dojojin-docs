// ============================================================
// Vigil Platform — จับคู่ช่องบน AcuSeek กับกล้องในระบบเรา
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// ปัญหา: AcuSeek **รับภาพจาก NVR ไม่ใช่กล้องโดยตรง** (ยืนยันครบทั้ง 72 ช่อง —
// ต้นทางเป็น DS-96128NI-M8 พอร์ต 8000 จำนวน 8 ตัว ไม่มีกล้องต่อตรงแม้แต่ช่องเดียว)
// ⇒ IP ที่ AcuSeek บอกคือ IP ของ NVR ซึ่งไม่ตรงกับ cameras.ip_address ของเราสักตัว
//
// ทางแก้: ถาม NVR อีกหนึ่งชั้น เพราะ NVR รู้อยู่แล้วว่าช่องไหนคือกล้อง IP อะไร
//
//   AcuSeek channelID
//     → InputProxy/channels ของ AcuSeek   ได้ (NVR ip, srcInputPort)
//     → InputProxy/channels ของ NVR ตัวนั้น  ได้ IP กล้องจริง
//     → cameras.ip_address ของเรา
//
// วัดจริง 2026-08-12: ได้ IP กล้องครบ 72/72 · จับคู่กับกล้องในระบบเราได้ 68
// (อีก 4 เป็นกล้องที่ระบบเราไม่ได้ ingest) · **ไม่ต้องกรอกมือแม้แต่แถวเดียว**
//
// 🔴 ห้ามจับคู่ด้วยเลข `C##` จากชื่อกล้อง — พิสูจน์แล้วว่าให้ผลผิด: `C28-WIC-SB-18`
// ของ AcuSeek คือ 10.2.100.28 ซึ่งไม่มีในระบบเรา แต่ระบบเรามี "แยกบ่อปลาตากแดด (C28)"
// อยู่คนละ IP ⇒ แมปด้วยชื่อจะได้กล้องผิดตัวโดยไม่มีอะไรเตือน
'use strict';

const http = require('http');
const { parseChallenge, buildDigestHeader } = require('./digestAuth');

function _get(host, port, path, user, pass, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const go = (auth) => {
      const r = http.request({ host, port, path, method: 'GET',
        headers: auth ? { Authorization: auth } : {}, timeout: timeoutMs }, (rs) => {
        const chunks = [];
        rs.on('data', (c) => chunks.push(c));
        rs.on('end', () => {
          const txt = Buffer.concat(chunks).toString('utf8');
          if (rs.statusCode === 401 && !auth) {
            const wa = rs.headers['www-authenticate'] || '';
            if (/digest/i.test(wa)) return go(buildDigestHeader(user, pass, 'GET', path, parseChallenge(wa)));
          }
          resolve({ code: rs.statusCode, txt });
        });
      });
      r.on('timeout', () => { r.destroy(); resolve({ code: 0, txt: '' }); });
      r.on('error', () => resolve({ code: 0, txt: '' }));
      r.end();
    };
    go(null);
  });
}

/** ช่องของ NVR หนึ่งตัว → { ช่องที่เท่าไร: IP กล้อง } */
async function _nvrChannels(ip, user, pass) {
  const r = await _get(ip, 80, '/ISAPI/ContentMgmt/InputProxy/channels', user, pass);
  const map = new Map();
  if (r.code !== 200) return map;
  for (const m of r.txt.matchAll(/<InputProxyChannel[^>]*>([\s\S]*?)<\/InputProxyChannel>/g)) {
    const b = m[1];
    const f = (t) => (b.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [])[1] || '';
    const id = Number(f('id'));
    if (Number.isFinite(id)) map.set(id, { ip: f('ipAddress'), name: f('name') });
  }
  return map;
}

/**
 * เติม `cameraIp` ให้ทุกช่องของ AcuSeek โดยถาม NVR ต้นทาง
 * NVR แต่ละตัวถูกถามครั้งเดียวแม้จะมีหลายช่องชี้มาที่มันก็ตาม
 */
async function resolveCameraIps(channels, user, pass) {
  const nvrs = [...new Set(channels.map((c) => c.nvrIp).filter(Boolean))];
  const byNvr = new Map();
  // ถามทีละตัวไม่ขนาน — NVR เป็นเครื่องบันทึกที่ทำงานจริงอยู่ ไม่ควรยิงพร้อมกัน 8 ตัว
  for (const ip of nvrs) byNvr.set(ip, await _nvrChannels(ip, user, pass));

  return channels.map((c) => {
    const src = byNvr.get(c.nvrIp)?.get(Number(c.srcPort)) || null;
    return { ...c, cameraIp: src ? src.ip : null, nvrChannelName: src ? src.name : null };
  });
}

module.exports = { resolveCameraIps };
