// ============================================================
// Vigil Platform — ตัวเลขหมวกนิรภัยต้องมาจากแหล่งเดียวและเกณฑ์เดียว
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 ... All Rights Reserved.
// @license Proprietary
// ============================================================
//
// เจ้าของเจอ 2026-08-27: สามหน้าให้เลขต่างกัน 1,451 / 1,473 / 1,393 จากข้อมูลชุดเดียวกัน
// reproduce แล้วแยกได้ 2 สาเหตุอิสระ อย่างละ ~13 แถว
//   (ก) helmet-top มีเกณฑ์ของตัวเอง เพดานคิดจาก 24 ชม. แทนที่จะเป็น 30 วันของเกณฑ์กลาง
//   (ข) บางหน้าอ่านตารางสรุป บางหน้าคิดสด ⇒ ตามหลังกัน 15 นาทีตลอดเวลา
//
// เทสนี้ยิงที่ **ซอร์ส** ไม่ใช่ที่ฐานข้อมูล เพราะสิ่งที่ต้องกันคือ "มีใครเขียนเกณฑ์
// ของตัวเองขึ้นมาใหม่อีก" ซึ่งเป็นสิ่งที่เกิดซ้ำมาแล้วสองรอบ (2026-08-22 และรอบนี้)
// การเทียบตัวเลขจาก DB จะผ่านหรือไม่ผ่านตามข้อมูลของวันนั้น ไม่ได้กันสิ่งนี้

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (...f) => fs.readFileSync(path.join(__dirname, '..', ...f), 'utf8');
// อ่านไฟล์ที่แยกออกไปด้วย (2026-09-07, decision #277) — ไม่งั้นการย้ายโค้ด
// ข้ามไฟล์ทำให้ guard ตัวนี้กลายเป็นของว่างเปล่าโดยไม่มีใครรู้
const TRAFFIC = read('src', 'routes', 'traffic.js')
              + read('src', 'routes', 'traffic-report-pdf.js');
const LPRQ    = read('src', 'routes', 'lpr-query.js')
              + read('src', 'routes', 'lpr-list.js');
const CRIT    = read('src', 'helpers', 'helmetCriteria.js');

test('ห้ามมีเพดาน confidence ที่คิดจากหน้าต่างอื่นนอกจากเกณฑ์กลาง', () => {
  // CTE `scale` เดิมใช้ 24 ชม. — เป็นตัวที่ทำให้หน้าอันดับเพี้ยนมาตลอด
  assert.ok(!/max\(confidence\)[\s\S]{0,200}interval '24 hours'/.test(TRAFFIC),
    'traffic.js กลับไปคิดเพดานเองจาก 24 ชม. อีกแล้ว');
  assert.ok(!/max\(confidence\)/.test(LPRQ), 'lpr-query.js ไม่ควรคิดเพดานเอง');
  // มีที่เดียวที่คิดเพดานได้ คือ helmetCriteria
  assert.ok(/max\(confidence\)/.test(CRIT), 'เกณฑ์กลางต้องเป็นคนคิดเพดาน');
  assert.ok(/CEILING_DAYS = 30/.test(CRIT), 'หน้าต่างเพดานต้องเป็น 30 วัน');
});

test('ค่าคงที่ของเกณฑ์ต้องมาจาก helmetCriteria ไม่ใช่พิมพ์ซ้ำ', () => {
  // ตัวเลข/regex ที่พิมพ์ซ้ำคือจุดที่สองไฟล์จะเพี้ยนจากกันในอนาคต
  const m = TRAFFIC.match(/const (PLATE_OK|CONF_RATIO)\s*=\s*(.+);/g) || [];
  assert.ok(m.length >= 2, 'หาไม่เจอ');
  for (const line of m) {
    assert.ok(/helmet\.(PLATE_OK|CONF_RATIO)/.test(line),
      `เกณฑ์ถูกพิมพ์ซ้ำแทนที่จะอ้างเกณฑ์กลาง: ${line}`);
  }
});

// 2026-09-18 กลับด้านจากเดิม: เลิกอุ่นเพดานแล้ว เพราะเลิกมีเพดานที่ขยับได้
// เกณฑ์ถูกตัดสินตอน INSERT แล้วตรึงไว้ (migration 234) ⇒ สิ่งที่ต้องกันตอนนี้คือ
// "มีใครกลับไปคำนวณเกณฑ์ตอน query อีก" ไม่ใช่ "ลืมอุ่น cache"
test('ห้ามคำนวณเกณฑ์ตอน query — ต้องอ่านผลที่ตรึงไว้เท่านั้น', () => {
  const { evidenceSql } = require('../src/helpers/helmetCriteria');
  assert.equal(evidenceSql('lp'), ' AND lp.plate_identified');
  assert.ok(!/await helmet\.ensure\(/.test(TRAFFIC), 'ไม่ต้องอุ่นอะไรแล้ว — ถ้ายังมีแปลว่าย้อนกลับไปของเดิม');
  assert.ok(!/helmet\.ceilingSql\(/.test(TRAFFIC), 'ceilingSql ถูกถอดออกแล้ว');
});

test('ตัวเลขหัวการ์ดต้องอ่านตารางสรุป ไม่ใช่คิดสด', () => {
  // สองหน้าที่อ่านคนละแหล่งจะไม่มีวันเท่ากัน เพราะตารางสรุปตามหลัง 15 นาทีเสมอ
  assert.ok(/total_hits/.test(TRAFFIC));
  const m = TRAFFIC.match(/\(SELECT COALESCE\(sum\(t\.n_no_helmet_ok\)[\s\S]{0,200}AS total_hits/);
  assert.ok(m, 'total_hits ต้องมาจาก traffic_hourly_stats');
  assert.ok(/traffic_hourly_stats/.test(m[0]));
  // ฝั่ง LPR: today ต้องใช้ rollup ด้วย
  assert.ok(/const helmetRollup = period === 'today'/.test(LPRQ),
    'today ของหน้าป้ายทะเบียนต้องอ่าน rollup ไม่งั้นนำหน้าหน้าอื่น 15 นาที');
});

test('ป้ายกำกับต้องไม่มีคำว่า "หลักฐาน" — เราไม่ใช่คนตัดสิน', () => {
  const { LABELS } = require('../src/helpers/helmetCriteria');
  for (const lang of ['th', 'en']) {
    assert.ok(LABELS[lang].metric, `${lang}.metric หาย`);
    // ⚠️ ไม่มี `scope` แล้ว — เจ้าของถอด 2026-08-27 เพราะคำว่า "ชัดพอ" คือการที่
    // เราตัดสินแทนคนอ่าน · ถ้ามีใครใส่กลับมา เทสนี้ต้องดัง
    assert.equal(LABELS[lang].scope, undefined, `${lang} ไม่ควรมีคำอธิบายใต้เลข`);
    assert.ok(!/หลักฐาน|evidence/i.test(LABELS[lang].metric), `${lang} ยังมีคำว่าหลักฐาน`);
  }
  assert.ok(LABELS.th.metric.includes('ทะเบียน'), 'ชื่อต้องบอกว่ากรองด้วยการอ่านทะเบียน');
  // และต้องไม่มีคำเก่าเหลือในหน้าจอ
  // ห้ามมีคำที่เราตัดสินแทนเจ้าหน้าที่หลงเหลือในข้อความที่ผู้ใช้เห็น
  // (คอมเมนต์ในโค้ดยังพูดถึงได้ เพราะอธิบายว่าทำไมถึงถอดออก)
  for (const f of ['page-traffic.js', 'page-lpr.js']) {
    const src = read('dashboard', f);
    const visible = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    for (const w of ['ใช้เป็นหลักฐานได้', 'ชัดพอ']) {
      assert.ok(!visible.includes(w), `${f} ยังมีคำว่า "${w}" ในข้อความที่ผู้ใช้เห็น`);
    }
  }
});

test('การ์ด Realtime: กราฟคิดสดได้ แต่ยอดต้องมาจากตารางสรุป', () => {
  // กราฟเป็นสล็อต 30 นาที ซึ่งตารางสรุปรายชั่วโมงทำไม่ได้ ⇒ ต้องคิดสด
  // แต่ของสดนำหน้าตารางสรุปได้ถึง 15 นาที (วัดจริง: กราฟ 2,396 vs ยอด 2,356)
  // ถ้าเอาผลรวมแท่งมาเป็นยอด การ์ดนี้จะไม่มีวันเท่ากับหน้าอื่น
  // ⚠️ query ถูกประกาศ *ก่อน* จุดที่เอาไปใช้ (อยู่ใน Promise.all) — เทสรุ่นแรก
  // หาไปข้างหน้าจากชื่อฟิลด์เลยไม่เจอ ทั้งที่โค้ดถูก · ต้องไล่ผ่านตัวแปรแทน
  const use = TRAFFIC.match(/realtime_total_ok:\s*num\((\w+)\./);
  assert.ok(use, 'endpoint ต้องส่งยอดจากตารางสรุปมาด้วย');
  const varName = use[1];
  const decl = TRAFFIC.match(new RegExp(`const \\[[^\\]]*\\b${varName}\\b[^\\]]*\\]`));
  assert.ok(decl, `${varName} ต้องมาจาก Promise.all ของ endpoint นี้`);
  // และก้อน query ที่ตามมาต้องอ่านตารางสรุป ไม่ใช่ license_plates
  const after = TRAFFIC.slice(TRAFFIC.indexOf(decl[0]));
  const q = after.match(/ยอดวันนี้จากตารางสรุป[\s\S]{0,400}?FROM (\w+)/);
  assert.ok(q, 'หา query ของยอดวันนี้ไม่เจอ');
  assert.equal(q[1], 'traffic_hourly_stats', 'ยอดต้องมาจากตารางสรุป ไม่ใช่คิดสด');

  const UI = read('dashboard', 'page-traffic.js');
  assert.ok(/realtime_total_ok != null[\s\S]{0,160}_trfHelmetOverallOk\(bySlot\)/.test(UI),
    'หน้าจอต้องใช้ค่าจาก server ก่อน แล้วค่อยตกกลับไปรวมแท่ง');
});

test('ช่วง 3/5/7 วัน ต้องยึดวันเดียวกันทั้งสองหน้า', () => {
  // เจ้าของเลือก 2026-08-27: ยึด **วันนี้** ทั้งคู่
  // เดิมหน้าสถิติยึด maxDate (= เมื่อวาน) ⇒ 7 วัน = 08-20→08-26
  //     ส่วนหน้าอันดับยึดวันนี้      ⇒ 7 วัน = 08-21→08-27
  // เลื่อนกันหนึ่งวันตลอด ทั้งที่ปุ่มเขียนเหมือนกัน
  const UI = read('dashboard', 'page-traffic.js');

  const bounds = UI.match(/function _trfHelmetRangeBounds\(\)[\s\S]*?\n\}/);
  assert.ok(bounds, 'หา _trfHelmetRangeBounds ไม่เจอ');
  assert.ok(/TRF_HELMET\.todayDate \|\| maxDate/.test(bounds[0]),
    'ปุ่มสำเร็จรูปต้องยึด todayDate');
  assert.ok(!/_trfHelmetDateAdd\(maxDate, -\(TRF_HELMET\.rangeDays - 1\)\)/.test(bounds[0]),
    'ยังยึด maxDate อยู่');

  // ฝั่ง server ของหน้าอันดับยึดวันนี้อยู่แล้ว — ตรึงไว้ไม่ให้เปลี่ยนข้างเดียว
  assert.ok(/since: _addDays\(today, -\(TOP_PRESET_DAYS\[raw\] - 1\)\)/.test(TRAFFIC),
    'หน้าอันดับต้องยึด today');

  // ⚠️ การ์ด "24 ชั่วโมง" ต้องยังยึด maxDate — เจ้าของสั่งไม่ให้แตะ
  assert.ok(/max="\$\{escapeHtml\(TRF_HELMET\.maxDate \|\| ''\)\}" data-change="trfHelmetDateChange"/.test(UI),
    'ช่องวันที่ของการ์ด 24 ชม. ต้องคงเพดานเป็น maxDate');
});

test('รายเดือนต้องเป็นวันที่ 1 ถึงวันสุดท้ายจริงของเดือน', () => {
  const UI = read('dashboard', 'page-traffic.js');
  const fn = UI.match(/function _trfHelmetMonthRange\(ym\)[\s\S]*?\n\}/);
  assert.ok(fn, 'หา _trfHelmetMonthRange ไม่เจอ');
  // eslint-disable-next-line no-eval
  const _trfHelmetMonthRange = eval(`(${fn[0]})`);
  const cases = {
    '2026-01': ['2026-01-01', '2026-01-31'],
    '2026-02': ['2026-02-01', '2026-02-28'],
    '2024-02': ['2024-02-01', '2024-02-29'],   // ปีอธิกสุรทิน
    '2026-04': ['2026-04-01', '2026-04-30'],
  };
  for (const [ym, want] of Object.entries(cases)) {
    assert.deepEqual(_trfHelmetMonthRange(ym), want, ym);
  }
  // หน้าอันดับ: รายเดือน = วันที่ 1 ของเดือนปัจจุบัน ไม่ใช่ "ย้อนหลัง 30 วัน"
  assert.ok(/getUTCFullYear\(\), d\.getUTCMonth\(\), 1\)/.test(TRAFFIC),
    'หน้าอันดับต้องเริ่มวันที่ 1 ของเดือน');
});

test('หน้าสถิติ: endpoint ที่แพงที่สุดต้องไม่กักหน้าทั้งหน้า', () => {
  // เจ้าของเจอ 2026-08-27: หน้า Event Statistics ว่างเปล่าให้ viewer คนหนึ่ง
  // ไม่มี error ทั้งใน UI และ console — เพราะ Promise.all รอทุกตัว และ breakdown-v2
  // ค้างจนครบ statement_timeout 120 วิ (ต้นเหตุจริงคือ transaction ค้าง 34 ชม.
  // ของบัญชี integration ทำให้ vacuum เก็บ dead tuple ไม่ได้ ตารางบวม)
  //
  // กราฟหลักพร้อมภายในไม่กี่ร้อย ms — ไม่มีเหตุผลให้มันรอตารางย่อย
  // (stats redesign 2026-08) หน้าใหม่ถือ invariant เดิมคนละรูป: ก้อน Promise.all
  // หลักมีเฉพาะของเบา (categories/timeline/extras) — ของแพง (pattern-heatmap
  // 28 วัน · dwell window function) อยู่ในส่วน BI ที่ยิงหลัง render ผ่าน renderBI()
  const UI = read('dashboard', 'page-stats.js');
  const batch = UI.match(/const \[catsCur[\s\S]*?\]\);/);
  assert.ok(batch, 'หา Promise.all หลักของหน้าสถิติไม่เจอ');
  assert.ok(!/pattern-heatmap|\/api\/stats\/dwell/.test(batch[0]),
    'heatmap/dwell (ของแพง) ต้องไม่อยู่ในก้อนที่ await รวมกัน');
  // render หลักต้องจบก่อน แล้ว BI ค่อยเติมทีหลังแบบไม่ block
  assert.ok(/_esLastData = d;[\s\S]{0,120}_esRenderBI\(\)/.test(UI),
    '_esRenderBI ต้องถูกเรียกหลังวาดหน้าหลักเสร็จ');
  assert.ok(/_esBiHeatCells\([\s\S]{0,140}?\.then\(_esRenderHeat\)/.test(UI),
    'heatmap ต้องเติมเมื่อข้อมูลมาถึง (.then) ไม่ใช่ await กักหน้า');
});
