// ============================================================
// Vigil Platform — HC4 · สถานะอุปกรณ์ที่ HCP ดูแล
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// HCP ที่ภูเก็ตดูแลอุปกรณ์มากกว่าที่เราเห็นจากฝั่งเราหลายเท่า (กล้อง 756 ตัว ในขณะที่
// เราแมปไว้ 83) — แท็บนี้มีไว้ตอบคำถามเดียว: **ตัวไหนเราดูแลอยู่ด้วย ตัวไหน HCP
// ดูแลอยู่ตัวเดียว** เพราะตัวหลังคือจุดบอดของเราเวลามีเหตุ
//
// รันบน edge เท่านั้น (central ไปไม่ถึง HCP) · อ่านอย่างเดียวทุกเส้น
// สถานะของ HCP ทุกชนิดใช้เลขชุดเดียวกัน: 0=ไม่ทราบ · 1=ออนไลน์ · 2=ออฟไลน์
// (สนาม status บางชนิดตอบค่านอกชุดนี้ เช่น alarmOutputs ตอบ -1 จริง — bucket
// เป็น unknown เหมือนกัน ไม่ throw)
//
// ทุกชนิด (รวมสัญญาณเข้า 1,472 ตัว) ต้องเดินเพจครบอยู่แล้วเพื่อนับยอดรวม —
// การเก็บ index/name/status ต่อแถวไว้ด้วยจึงไม่เพิ่มจำนวนคำขอไปหา HCP เลย
// เพิ่มแค่ payload JSON (2026-08-11, ตามคำขอ HC4 badge → คลิกดูราย device)
// ============================================================
'use strict';

const { hcpCall, hcpPageAll } = require('./hcpPage');

const STATUS = { 0: 'unknown', 1: 'online', 2: 'offline' };
const _tally = () => ({ total: 0, online: 0, offline: 0, unknown: 0 });
const _state = (v) => STATUS[Number(v)] || 'unknown';
const _count = (t, v) => { t.total++; t[_state(v)]++; };

async function fetchHcpDevices() {
  const out = { cameras: _tally(), encodeDevices: _tally(), recordServers: _tally(),
                intelligentServers: _tally(), streamServers: _tally(),
                alarmInputs: _tally(), alarmOutputs: _tally() };
  const cameras = [];
  const encodeDevices = [];
  const recordServers = [];
  const intelligentServers = [];
  const alarmInputs = [];
  const alarmOutputs = [];

  await hcpPageAll('/artemis/api/resource/v1/cameras', {}, (c) => {
    _count(out.cameras, c.status);
    cameras.push({ index_code: String(c.cameraIndexCode), name: c.cameraName,
                   status: Number(c.status), encode_dev: String(c.encodeDevIndexCode || ''),
                   capability: c.capabilitySet || null });
  });
  await hcpPageAll('/artemis/api/resource/v1/encodeDevice/encodeDeviceList', {}, (d) => {
    _count(out.encodeDevices, d.status);
    encodeDevices.push({ index_code: String(d.encodeDevIndexCode), name: d.encodeDevName,
                         ip: d.encodeDevIp || null, status: Number(d.status) });
  });
  // recordServer/alarmInputs ใช้ชื่อฟิลด์สถานะของตัวเอง (networkStatus) ไม่ใช่ status
  await hcpPageAll('/artemis/api/resource/v1/recordServer/recordServerList', {}, (r) => {
    _count(out.recordServers, r.networkStatus);
    recordServers.push({ index_code: String(r.recordServerIndexCode), name: r.recordServerName,
                          ip: r.recordServerIp || null, status: Number(r.networkStatus) });
  });
  await hcpPageAll('/artemis/api/resource/v1/intelligentServer/intelligentServerList', {}, (r) => {
    _count(out.intelligentServers, r.status);
    intelligentServers.push({ index_code: String(r.intelligentServerIndexCode), name: r.intelligentServerName,
                               ip: r.intelligentServerIp || null, status: Number(r.status) });
  });
  await hcpPageAll('/artemis/api/resource/v1/streamServer/streamServerList', {}, (r) => _count(out.streamServers, r.status));
  // alarmInputName/alarmOutputName เป็นแค่ "A1", "A2" ฯลฯ — devIndexCode ต่อกับ
  // encoder ตัวไหนแยกไม่ออกจนกว่า central จะ join กับ encodeDevices (routes/hcp.js)
  await hcpPageAll('/artemis/api/resource/v1/alarmInputs', {}, (r) => {
    _count(out.alarmInputs, r.networkStatus);
    alarmInputs.push({ index_code: String(r.alarmInputIndexCode), name: r.alarmInputName,
                        dev_index_code: String(r.devIndexCode || ''), status: Number(r.networkStatus) });
  });
  await hcpPageAll('/artemis/api/resource/v1/alarmOutputs', {}, (r) => {
    _count(out.alarmOutputs, r.status);
    alarmOutputs.push({ index_code: String(r.alarmOutputIndexCode), name: r.alarmOutputName,
                         dev_index_code: String(r.devIndexCode || ''), status: Number(r.status) });
  });

  let vms = null;
  try {
    const d = await hcpCall('/artemis/api/resource/v1/videoManagementServer', {});
    vms = { ip: d.ip, port: d.port, cpu: d.cpu, status: Number(d.status) };
  } catch (e) { vms = { error: e.message }; }

  return { ok: true, summary: out, vms, cameras, encodeDevices,
            recordServers, intelligentServers, alarmInputs, alarmOutputs };
}

module.exports = { fetchHcpDevices, STATUS };
