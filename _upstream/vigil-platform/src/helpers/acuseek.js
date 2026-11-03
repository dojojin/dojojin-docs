// ============================================================
// Vigil Platform — ตัวเชื่อมกับเครื่องค้นวิดีโอด้วยข้อความ (AcuSeek)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// รันบน **edge ที่ภูเก็ตเท่านั้น** — central ไปไม่ถึง 10.0.10.12 (ยิง :80 ไม่ตอบ)
// เหมือนกรณี HCP ที่ 10.0.10.9 ทุกประการ
//
// ── สิ่งที่วัดมาแล้วและกำหนดรูปร่างของไฟล์นี้ (2026-08-12) ─────────────────
// • เครื่องรับ **ภาษาอังกฤษเท่านั้น** — แปลก่อนถึงที่นี่ (helpers/acuseekPhrase.js)
// • ผลสูงสุด **500 ต่อ 1 task** · ขอเกินลำดับ 500 ตอบ 400
// • ช่วงเวลาต่อครั้ง 7 วันผ่าน · 30 วันตอบ 403 PicSyncSearchTimeRangeLimit
// • ค้น 7 วันเสร็จใน 3-4 วินาที · ยิงพร้อมกัน 4 งานเครื่องไม่กระเทือน (CPU 8-13%)
// • ผลแต่ละใบเป็น **วัตถุเดี่ยวที่ครอปมาแล้ว** — เป็นเหตุผลของคำเตือนใน acuseekPhrase
'use strict';

const http = require('http');
const { parseChallenge, buildDigestHeader } = require('./digestAuth');

const HOST = process.env.ACUSEEK_HOST || '10.0.10.12';
const PORT = Number(process.env.ACUSEEK_PORT || 80);
// เพดานของเครื่อง ไม่ใช่ค่าที่เราเลือก — ขอเกินนี้เครื่องตอบ 400
const MAX_RESULTS = 500;

function _req(method, path, body, user, pass, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const go = (auth) => {
      const headers = auth ? { Authorization: auth } : {};
      if (body) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(body);
      }
      const r = http.request({ host: HOST, port: PORT, path, method, headers, timeout: timeoutMs }, (rs) => {
        const chunks = [];
        rs.on('data', (c) => chunks.push(c));
        rs.on('end', () => {
          const txt = Buffer.concat(chunks).toString('utf8');
          if (rs.statusCode === 401 && !auth) {
            const wa = rs.headers['www-authenticate'] || '';
            // ⚠️ ห้ามเขียน digest เอง — ล็อกบัญชีกล้อง production ได้ (GOTCHAS: hik digest lockout)
            if (/digest/i.test(wa)) return go(buildDigestHeader(user, pass, method, path, parseChallenge(wa)));
          }
          let json = null;
          try { json = JSON.parse(txt); } catch { /* เครื่องตอบ XML ในบางเส้นทาง */ }
          resolve({ code: rs.statusCode, json, txt });
        });
      });
      r.on('timeout', () => { r.destroy(); reject(new Error('acuseek timeout')); });
      r.on('error', reject);
      if (body) r.write(body);
      r.end();
    };
    go(null);
  });
}

/**
 * สั่งค้น — คืน taskID
 * @param {{text,startTime,endTime,channelList?,similarity?}} q  text ต้องเป็นภาษาอังกฤษแล้ว
 */
async function submit(q, user, pass) {
  const payload = {
    startTime: q.startTime,
    endTime: q.endTime,
    text: String(q.text || '').slice(0, 384),   // เพดานของเครื่อง
    language: 'English',
    similarity: Number.isFinite(+q.similarity) ? +q.similarity : 0,
    timeSortType: 'reverse',
  };
  if (Array.isArray(q.channelList) && q.channelList.length) {
    payload.channelList = q.channelList.slice(0, 512).map(Number).filter(Number.isFinite);
  }
  const r = await _req('POST', '/ISAPI/ContentMgmt/AsynSearchByTextTask?format=json',
    JSON.stringify(payload), user, pass);

  // 403 + sensitiveWords = คำต้องห้ามของเครื่อง · แยกออกมาให้ผู้เรียกบอกผู้ใช้ได้ตรง ๆ
  if (r.code === 403 && /SensitiveWords/i.test(r.txt)) {
    return { ok: false, reason: 'sensitive', code: 403 };
  }
  if (r.code === 403 && /TimeRangeLimit/i.test(r.txt)) {
    return { ok: false, reason: 'range', code: 403 };
  }
  if (r.code !== 200 || !r.json?.taskID) {
    return { ok: false, reason: 'device', code: r.code, error: (r.json?.errorMsg || r.txt || '').slice(0, 200) };
  }
  return { ok: true, taskID: r.json.taskID };
}

/** ถามความคืบหน้า + ดึงผล · position เริ่มที่ 1 (ไม่ใช่ 0) */
async function status(taskID, position, maxResults, user, pass) {
  const pos = Math.max(1, Math.min(MAX_RESULTS, Number(position) || 1));
  const n = Math.max(1, Math.min(MAX_RESULTS, Number(maxResults) || 40));
  const r = await _req('POST', '/ISAPI/ContentMgmt/SearchTextTaskStatus?format=json',
    JSON.stringify({ taskID: String(taskID), searchResultPosition: pos, maxResults: n }), user, pass);
  if (r.code !== 200 || !r.json) {
    return { ok: false, code: r.code, error: (r.json?.errorMsg || r.txt || '').slice(0, 200) };
  }
  const j = r.json;
  return {
    ok: true,
    runStatus: j.runStatus,            // searching | completed | abnormal
    progress: j.progress,
    // ⚠️ อิ่มตัวที่ 500 — ผู้เรียกต้องแสดงเป็น "500 หรือมากกว่า" ไม่ใช่ "500 พอดี"
    total: j.totalMatches,
    saturated: j.totalMatches >= MAX_RESULTS,
    results: (j.matchResults || []).map((m) => ({
      time: m.time,
      similarity: Number(m.similarity),
      targetType: m.targetType,         // human | vehicle | animal (animal ไม่มีในเอกสาร แต่เครื่องคืนจริง)
      channelID: m.channelID,
      imageUUID: m.imageUUID,
      rect: m.targetRect || null,
      // ส่ง URL ดิบต่อไปให้ central ตัดสินใจ — ตัว proxy รูปมีด่านตรวจรูปแบบของตัวเองอยู่แล้ว
      fullUrl: m.image?.filePath || null,
      cropUrl: m.targetImage?.filePath || null,
    })),
  };
}

/** รายการช่องที่เครื่องนี้รับภาพอยู่ (ใช้ทำแมป channel → กล้องของเรา) */
async function channels(user, pass) {
  const r = await _req('GET', '/ISAPI/ContentMgmt/InputProxy/channels', null, user, pass, 30000);
  if (r.code !== 200) return { ok: false, code: r.code };
  const out = [];
  for (const m of r.txt.matchAll(/<InputProxyChannel[^>]*>([\s\S]*?)<\/InputProxyChannel>/g)) {
    const b = m[1];
    const f = (t) => (b.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [])[1] || '';
    out.push({ id: Number(f('id')), name: f('name'), online: f('online') === 'true',
               nvrIp: f('ipAddress'), srcPort: Number(f('srcInputPort')) });
  }
  return { ok: true, channels: out };
}

module.exports = { submit, status, channels, MAX_RESULTS, HOST, PORT };
