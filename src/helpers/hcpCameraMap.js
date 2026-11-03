// ============================================================
// Vigil Platform — HC0 · เทียบแมปกล้อง HCP ระหว่าง edge กับฐานข้อมูล
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// `src/hcp-camera-map.json` บน edge เป็นไฟล์ที่ **ก๊อปมือ** มาจากตาราง
// `hcp_camera_map` (ผ่าน `hcp-setup.js --export-map`) และ gitignored — ไม่มีอะไร
// บังคับให้สองฝั่งตรงกัน
//
// ผลของการดริฟต์คือ HC1 เอา camera_id ผิดไปตั้งชื่อไฟล์รูป ส่วน central resolve
// camera_id จากฐานข้อมูลของมันเอง → รูปกับเหตุการณ์แยกกันคนละกล้อง **เงียบ ๆ**
// ============================================================
'use strict';

// dbMap / edgeMap = { hcp_index: camera_id }
function diffCameraMap(dbMap, edgeMap) {
  const db = dbMap || {}, edge = edgeMap || {};
  const missing_on_edge = [];   // มีในฐานข้อมูล แต่ edge ไม่มี → HC1 ตั้งชื่อรูปไม่ได้
  const extra_on_edge = [];     // edge มี แต่ฐานข้อมูลไม่มีแล้ว → แมปที่ถูกลบไปแล้ว
  const changed = [];           // มีทั้งคู่แต่ชี้คนละกล้อง → อันตรายที่สุด
  for (const k of new Set([...Object.keys(db), ...Object.keys(edge)])) {
    if (!(k in edge)) missing_on_edge.push(k);
    else if (!(k in db)) extra_on_edge.push(k);
    else if (String(db[k]) !== String(edge[k])) changed.push({ hcp_index: k, db: db[k], edge: edge[k] });
  }
  return {
    in_sync: !(missing_on_edge.length || extra_on_edge.length || changed.length),
    db_count: Object.keys(db).length, edge_count: Object.keys(edge).length,
    missing_on_edge, extra_on_edge, changed,
  };
}

module.exports = { diffCameraMap };
