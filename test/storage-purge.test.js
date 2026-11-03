// ============================================================
// Vigil Platform — Tests: storage purge helper
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
// helper นี้ลบไฟล์จริงบนดิสก์ทั้ง central และ edge ด้วยโค้ดก้อนเดียวกัน จึงไม่มี
// ทางทดสอบทีหลังได้ — ตอนแปลงเป็น async (2026-09-06) จึงต้องมีตาข่ายรับไว้ก่อน
// สิ่งที่ต้องไม่พังคือ **ชุดไฟล์ที่ถูกเลือก** และด่าน confirmFiles ที่กันไม่ให้ลบ
// เมื่อดิสก์เปลี่ยนไประหว่างที่คนกำลังอ่านตัวเลขจาก dry-run
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { planPurge, executePurge } = require('../src/helpers/storagePurge');

const DAY = 86400;                       // utimesSync รับ **วินาที** ไม่ใช่ ms
const nowSec = () => Date.now() / 1000;

let tmp, oldFiles, newFiles;

// bytesDisk = st.blocks * 512 (บล็อกที่จับจอง) ไม่ใช่ st.size — ไฟล์ 10 ไบต์ได้ 4096
// บน ext4 และอาจได้ 0 บน fs ที่ inline ไฟล์เล็ก ค่าคาดหวังจึงต้อง derive จากดิสก์จริง
const blocksOf = (files) => files.reduce((a, f) => a + fs.statSync(f).blocks * 512, 0);

describe('storagePurge', () => {
  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vigil-purge-'));
    // ต้องเป็น <tmp>/events/... เพราะ planPurge ประกอบ path จาก PURGEABLE เอง
    // ไฟล์ที่วางไว้ที่ราก tmp จะได้ files:0 แล้ว assertion ผ่านแบบว่างเปล่า
    const day = path.join(tmp, 'events', '2026-08-01', 'cam-1');
    fs.mkdirSync(day, { recursive: true });

    const write = (name, contents, ageDays) => {
      const p = path.join(day, name);
      fs.writeFileSync(p, contents);
      const t = nowSec() - ageDays * DAY;
      fs.utimesSync(p, t, t);
      return p;
    };
    oldFiles = [write('old-a.jpg', 'a'.repeat(3000), 30), write('old-b.jpg', 'b'.repeat(9000), 45)];
    newFiles = [write('new-a.jpg', 'c'.repeat(3000), 1), write('new-b.jpg', 'd'.repeat(3000), 6)];
  });

  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('เลือกเฉพาะไฟล์ที่เก่ากว่า cutoff และรวมขนาดบล็อกถูกต้อง', async () => {
    const plan = await planPurge(tmp, 'events', 7);
    assert.equal(plan.rejected, undefined);
    assert.equal(plan.files, oldFiles.length);
    // victims/sample เรียงตาม readdir ไม่ได้ sort — เทียบแบบ set
    assert.deepEqual(plan.victims.map(([f]) => f).sort(), [...oldFiles].sort());
    assert.equal(plan.bytesDisk, blocksOf(oldFiles));
    assert.deepEqual(
      plan.sample.sort(),
      oldFiles.map((f) => path.relative(tmp, f)).sort()
    );
  });

  it('ปฏิเสธหมวดที่ลบไม่ได้ และ days นอกช่วง — ก่อนแตะดิสก์', async () => {
    assert.equal((await planPurge(tmp, 'blacklist-photos', 7)).rejected, 'category not purgeable');
    assert.equal((await planPurge(tmp, 'events', 0)).rejected, 'days out of range');
    assert.equal((await planPurge(tmp, 'events', 9999)).rejected, 'days out of range');
  });

  it('confirmFiles ไม่ตรงแผน = ไม่ลบอะไรเลยสักไฟล์', async () => {
    const r = await executePurge(tmp, 'events', 7, oldFiles.length + 1);
    assert.equal(r.rejected, 'confirm mismatch');
    // ค่าที่คืนพิสูจน์แค่ว่า branch ทำงาน — สิ่งที่ต้องพิสูจน์จริงคือดิสก์ยังครบ
    for (const f of [...oldFiles, ...newFiles]) assert.ok(fs.existsSync(f), `${f} ถูกลบทั้งที่ confirm ไม่ตรง`);
  });

  it('confirmFiles ตรงแผน = ลบเฉพาะไฟล์เก่า ไฟล์ใหม่อยู่ครบ', async () => {
    const plan = await planPurge(tmp, 'events', 7);
    const expectedBytes = blocksOf(oldFiles);
    const r = await executePurge(tmp, 'events', 7, plan.files);
    assert.equal(r.rejected, undefined);
    assert.deepEqual(r, { files: oldFiles.length, deleted: oldFiles.length, bytesDisk: expectedBytes });
    for (const f of oldFiles) assert.ok(!fs.existsSync(f), `${f} ควรถูกลบแล้ว`);
    for (const f of newFiles) assert.ok(fs.existsSync(f), `${f} ใหม่เกินไป ไม่ควรถูกแตะ`);
    // เดินซ้ำต้องว่าง — กันกรณีลบแล้วแต่ยังนับซ้ำ
    assert.equal((await planPurge(tmp, 'events', 7)).files, 0);
  });

  it('ไดเรกทอรีที่ยังไม่มี = ศูนย์ ไม่ใช่ error', async () => {
    const plan = await planPurge(tmp, 'lpr', 7);
    assert.deepEqual(plan, { files: 0, bytesDisk: 0, sample: [], victims: [] });
  });
});
