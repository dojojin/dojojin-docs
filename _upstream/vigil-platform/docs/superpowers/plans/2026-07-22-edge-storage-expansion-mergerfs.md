# Edge Storage Expansion Plan — mergerfs Disk Pooling (Site Edge)

**Status:** 📋 READY — เขียนไว้ล่วงหน้า ยังไม่ execute (รอดิสก์ใหม่มาถึงจริง)
**Trigger:** เมื่อ site edge ใดใช้ storage เกิน ~90-95% หรือมีดิสก์ใหม่มาติดตั้งเพิ่ม
**Date:** 2026-07-22
**Scope:** เพิ่มดิสก์ตัวที่ 2 (หรือมากกว่า) เข้า pool เดียวกับดิสก์เดิม โดยไม่ต้องแก้โครงสร้างโฟลเดอร์/โค้ด ingest/retention
**Author:** Prakasit Rochanavipart (Dojo-mAn)
**Applies to:** hdy-edge, vss-edge, และ site edge ใหม่ในอนาคต (เช่น Phuket vss2)

---

## Problem Statement (ข้อเท็จจริงที่วัดไว้ ณ วันที่เขียนแผน — hdy-edge)

- Disk รวม 938GB, เหลือว่าง 350GB, ใช้จริง ~115GB/วัน → **เหลือแค่ ~3 วัน** ก่อนดิสก์เต็ม
- Inode ratio ปัจจุบัน = ext4 default (~16KB/inode) — ต่ำกว่าขนาดไฟล์เฉลี่ยจริงมาก (~191KB/ไฟล์) → **inode ไม่ใช่คอขวดบนดิสก์ปัจจุบัน** (จะเหลือใช้ได้ ~93 วันถ้าดิสก์มีที่ว่างพอ) แต่ **จะกลายเป็นคอขวดทันทีถ้าดิสก์ใหม่ก้อนใหญ่ format ด้วย default ratio เดิม**
- โครงสร้างไฟล์ (`snapshots/events/<date>/<camera>/<hour>/`) เองไม่มีปัญหาสเกล — ปัญหาอยู่ที่ปริมาณ byte/inode สะสมเท่านั้น
- เป้าหมาย: เมื่อดิสก์เดิมใกล้เต็ม ให้เขียนไฟล์ใหม่ไปดิสก์ที่ 2 โดยอัตโนมัติ **โดยแอปมองเห็น path เดียวเหมือนเดิม** ไม่ต้องแก้ ingester/retention/proxy-fetch

## แนวทางที่เลือก: mergerfs (union filesystem)

เหตุผลที่เลือกทางนี้แทนเขียน threshold-switch logic เอง — ดูสรุปเหตุผลเต็มใน conversation 2026-07-22 (session นี้): `SNAPSHOT_DIR` hardcode กระจาย 3+ จุดในโค้ด, ถ้าทำ level แอปต้องแก้ ingester + retention pruner + central proxy-fetch (CEN-006) พร้อมกันหมด เสี่ยงบั๊กจุดบอด — mergerfs แก้ที่ระดับ OS จุดเดียว โค้ดแอปไม่ต้องรู้เรื่องเลย

---

## Phase 0 — เตรียมล่วงหน้า (ทำได้เลยตอนนี้ ไม่ต้องรอดิสก์ ไม่กระทบของเดิม)

**ทำให้ `SNAPSHOT_DIR` อ่านจาก env ได้ทั้ง 3 จุดที่ hardcode อยู่** (ตอนนี้มีแค่ `src/edge/bridge.js` ที่รองรับ):

- `src/edge-config-agent.js:31`
- `src/ingesters/dahua-cgi.js:102`
- `src/ingesters/hikvision-isapi.js:44`

เปลี่ยนจาก:
```js
const SNAPSHOT_DIR = path.join(__dirname, '..', 'snapshots');
```
เป็น (mirror `edge/bridge.js` ที่มีอยู่แล้ว):
```js
const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR || path.join(__dirname, '..', 'snapshots');
```

**ผลกระทบตอนนี้ = ศูนย์** (ไม่ตั้ง env ก็ทำงานเหมือนเดิมทุกอย่าง) — ทำให้พร้อมสลับ path ได้ทันทีตอน Phase 2 โดยไม่ต้องแก้โค้ดตอนนั้น (ตอนนั้นเป็นช่วง cutover ที่อยากให้เปลี่ยนน้อยที่สุด)

---

## Phase 1 — ตอนดิสก์ใหม่มาถึง (ทำที่ site edge ที่ต้องการขยาย)

### 1.1 ต่อดิสก์ใหม่ + format
```bash
# หา device name ดิสก์ใหม่ (ระวังเลือกผิดตัว — เช็คด้วย lsblk ก่อนเสมอ)
lsblk

# format ด้วย inode ratio ~128KB (ใกล้เคียงขนาดไฟล์เฉลี่ยจริง ~191KB, กันปัญหา
# default 16KB ที่จะทำให้ inode หมดก่อนดิสก์เต็มถ้าดิสก์ใหญ่มาก)
sudo mke2fs -t ext4 -i 131072 -L vigil-disk2 /dev/sdX1

# mount ชั่วคราวเพื่อเช็ค
sudo mkdir -p /mnt/vigil-disk2
sudo mount /dev/sdX1 /mnt/vigil-disk2
df -h /mnt/vigil-disk2
df -i /mnt/vigil-disk2   # ยืนยัน inode ratio ใหม่ตรงตามตั้งใจ
```

### 1.2 ติดตั้ง mergerfs
```bash
sudo apt update
sudo apt install -y mergerfs
mergerfs --version
```

### 1.3 เตรียม branch เดิม + mount point ใหม่
```bash
# ดิสก์เดิม (มีข้อมูลอยู่แล้ว) = branch1 — ไม่แตะ/ไม่ย้ายอะไรในนี้เลย
# ดิสก์ใหม่ = branch2

sudo mkdir -p /mnt/vigil-pool

# ทดสอบ mount มือก่อน (ยังไม่ persist)
sudo mergerfs \
  -o defaults,allow_other,use_ino,category.create=epmfs,minfreespace=5G \
  /home/<edge-user>/vigil-platform/snapshots:/mnt/vigil-disk2 \
  /mnt/vigil-pool

ls /mnt/vigil-pool/events/   # ต้องเห็นวันที่เดิมทั้งหมดจากดิสก์เก่า — ยืนยันว่า pool มองเห็นของเดิมครบ
```

**Policy ที่เลือก: `category.create=epmfs`** (existing-path, most-free-space) — เหตุผล: ถ้าโฟลเดอร์วันนั้น (`events/2026-07-22/...`) มีอยู่แล้วในดิสก์ไหน ให้เขียนต่อดิสก์นั้นก่อน (กันไฟล์ของวันเดียวกันกระจายคนละดิสก์แบบสะเปะสะปะ) พอขึ้นวันใหม่ (path ยังไม่มีในดิสก์ไหนเลย) ถึงเลือกดิสก์ที่ว่างมากกว่า

**`minfreespace=5G`** — เผื่อ margin กันดิสก์เต็มเป๊ะ 0 byte พอดี (กันปัญหา write fail ตอนดิสก์ใกล้เต็มสุดขีด)

### 1.4 Persist ผ่าน `/etc/fstab` (auto-mount ตอน boot)
```
/home/<edge-user>/vigil-platform/snapshots:/mnt/vigil-disk2 /mnt/vigil-pool fuse.mergerfs defaults,allow_other,use_ino,category.create=epmfs,minfreespace=5G,nofail 0 0
```
เพิ่ม `/dev/sdX1 /mnt/vigil-disk2 ext4 defaults,nofail 0 2` (mount ดิสก์จริงก่อน mergerfs จะ pool ได้)

Reboot ทดสอบ 1 ครั้งว่า mount กลับมาเองถูกต้อง (`df -h`, `ls /mnt/vigil-pool/events/`)

---

## Phase 2 — Cutover (สลับให้แอปใช้ pool แทน path เดิม)

**หยุด service ที่เขียน snapshot ก่อน (กัน race ระหว่างสลับ):**
```bash
pm2 stop dahua hikvision edge-config-agent edge-bridge
```

**ตั้ง env ให้ชี้ path ใหม่** — แก้ `src/.env` (หรือ ecosystem.edge.config.js env block):
```
SNAPSHOT_DIR=/mnt/vigil-pool
```

**Restart:**
```bash
pm2 restart dahua hikvision edge-config-agent edge-bridge lpr-receiver
```

## Verify (ต้องผ่านครบทุกข้อก่อนถือว่าเสร็จ — ตาม WA#3)

1. `pm2 logs` ทุกตัวไม่มี error เรื่อง path/permission
2. เขียนไฟล์ใหม่จริง (รอ event เข้าเอง หรือ trigger manual capture) → เช็คว่าไฟล์ไปโผล่ใน `/mnt/vigil-pool/events/<วันนี้>/...` และไปจริงบนดิสก์ไหน (`df -h /mnt/vigil-disk2` ขยับไหม)
3. Retention pruner (`snapshot-retention.js`) ยังลบวันเก่าได้ถูกต้อง — เช็ค log `[edge-prune]` รอบถัดไป
4. ฝั่ง central: proxy-fetch รูปเก่า (ก่อน cutover) + รูปใหม่ (หลัง cutover) ทั้งคู่ต้องดึงได้ปกติ (ทดสอบผ่านหน้า gallery จริง)
5. `unstable_restarts = 0` ทุก process หลัง restart

## Rollback (ถ้ามีปัญหาระหว่าง cutover)

ลบ/comment บรรทัด `SNAPSHOT_DIR=` ใน `.env` ออก → restart → กลับไปใช้ path เดิม (ดิสก์เก่า) ทันที ข้อมูลที่เขียนไปดิสก์ใหม่ระหว่างทดสอบยังอยู่ครบ ไม่หาย (ไฟล์ยัง reachable ผ่าน mount `/mnt/vigil-disk2` โดยตรงถ้าต้องกู้)

---

## หมายเหตุสำหรับ site edge ใหม่ในอนาคต (เช่น Phuket vss2)

ถ้า site ใหม่คาดว่าจะมีปริมาณ traffic สูงตั้งแต่แรก (ระดับเดียวกับ hdy) — แนะนำ format ดิสก์แรกด้วย `-i 131072` (128KB/inode) ตั้งแต่ตอน install เลย ไม่ต้องรอ pool ทีหลัง (ดู `docs/REF_edge-install.md` ประกอบ — ยังไม่ได้เพิ่ม note นี้เข้าไปในคู่มือ install หลัก ถ้าจะทำให้เป็น default ถาวรต้องแก้ที่นั่นด้วย เป็นงานแยกจาก plan นี้)
