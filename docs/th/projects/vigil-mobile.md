---
title: Vigil Mobile
description: แอปมือถือ iOS และ Android สำหรับ Vigil Platform — ติดตามกล้องแบบ real-time, ฟีด event, สถิติ, แผนที่, และ push notification พร้อม biometric login
---

# Vigil Mobile

Vigil Mobile คือแอปมือถือสำหรับ iOS และ Android ที่ทำงานร่วมกับ Vigil Platform โดยเชื่อมต่อกับ API และ WebSocket endpoint เดียวกับ web dashboard — ไม่มี backend แยกสำหรับมือถือโดยเฉพาะ

แอปออกแบบสำหรับทีมปฏิบัติการรักษาความปลอดภัยที่ต้องการเข้าถึงสถานะกล้อง, event แบบ real-time, สถิติ, และแผนที่ขณะอยู่นอกห้องควบคุม ข้อมูลทั้งหมดในแอปมือถือเป็นข้อมูล live เดียวกับที่แสดงใน web dashboard

**สถานะปัจจุบัน:** Phase 1–6 เสร็จสมบูรณ์ ทุก tab ทำงานได้เต็มรูปแบบบนทั้งสองแพลตฟอร์ม

---

## ความสามารถแยกตาม Tab

### Cameras

แท็บ Cameras คือมุมมองหลักสำหรับการปฏิบัติการ:

- แถว KPI แสดงจำนวนกล้องที่ online, offline, กล้องที่มี alert, และจำนวน event ของวันนี้
- ปุ่มกรองตามกลุ่ม (Group filter pills) แบบ horizontal scroll สำหรับสลับ zone ได้รวดเร็ว
- แถบค้นหาพร้อม filter chips ตามสถานะ (ทั้งหมด / Alert / Offline / Online)
- Layout 3 แบบ: List, Grid, Spacious — สลับได้โดยไม่เสียตำแหน่ง scroll
- **ลำดับความสำคัญ** — alert ขึ้นก่อน ตามด้วย offline และ online — กล้องที่วิกฤตจะขึ้นมาด้านบนอัตโนมัติ
- Live snapshot พร้อม lazy loading — ไม่โหลด snapshot ของการ์ดที่อยู่นอกหน้าจอ
- Badge ต่อกล้องแสดงสถานะ online/offline, ตัวบ่งชี้การบันทึก, และจำนวน alert ที่ยังไม่ได้อ่าน
- หน้า Camera Detail พร้อม snapshot แบบเต็มจอ, สถิติต่อกล้อง, และ event timeline
- รองรับกล้อง 100 ถึง 3,000 ตัวด้วย windowed list rendering

iPad และ tablet ขนาดใหญ่แสดงผลแบบ two-pane master/detail split view

### Alerts

แท็บ Alerts แสดง feed ของ event ที่เข้ามาแบบ real-time ผ่าน WebSocket มีตัวบ่งชี้สถานะการเชื่อมต่อว่า WebSocket กำลัง connected, reconnecting, หรือ offline

### Events

แท็บ Events ให้เข้าถึงประวัติ event ทั้งหมดแบบ paginated:

- filter 4 ประเภท: ทั้งหมด, Snapshot, Clip, Face
- ค้นหาและสลับมุมมอง list/grid พร้อม thumbnail แบบ inline
- Modal รายละเอียด event แสดง snapshot, metadata, และเล่นวิดีโอ clip (pre-alarm clip ในกรณีที่มี)
- แท็บ Face พร้อมแกลเลอรี่รูปใบหน้าและตัวเลือกบันทึกภาพลงอัลบั้มรูปในเครื่อง

### Stats

แท็บ Stats นำเสนอ analytics ของ event:

- KPI card แยกตามหมวดหมู่ event
- กราฟหลายเส้น (multi-line chart) พร้อม tap-to-tooltip และ crosshair
- ตัวกรองตามยี่ห้อกล้องและช่วงเวลา (วันนี้, 7 วัน, 30 วัน)
- Legend ที่แตะได้เพื่อเปิด/ปิดเส้น

### Map

แท็บ Map แสดงตำแหน่งกล้องบนแผนที่จริง:

- Pin กล้องแสดงสีตามสถานะ online (เขียว) / offline (แดง) พร้อม badge จำนวน event
- แตะ pin เพื่อเปิด bottom sheet พร้อม live snapshot ของกล้องนั้น
- ปุ่ม refresh ลอยตัว

---

## Push Notification

Vigil Mobile รับ push notification สำหรับ security event และการตรวจจับใบหน้า ผ่าน Apple Push Notification service (APNs) บน iOS และ Firebase Cloud Messaging (FCM) บน Android

**Alert push** — เมื่อ alert engine ของ Vigil Platform ประมวลผล event ที่ตรงกับ alert rule จะส่ง push ไปยังอุปกรณ์ที่ลงทะเบียนไว้ของผู้ใช้ที่เปิดใช้ rule นั้น โดยมี cooldown 20 วินาทีต่อกล้อง และใช้การตั้งค่า quiet hours เดียวกับ LINE alert

**Face push** — event ตรวจจับใบหน้าส่งเป็น notification stream แยกต่างหาก ไม่ขึ้นกับ alert rule

**การกรอง 3 ชั้น:**
1. ระดับ rule — alert rule ต้องมีผู้ใช้อยู่ในรายการ push recipient
2. Cooldown — กล้องเดิมไม่สามารถ trigger push ซ้ำภายใน 20 วินาที
3. ระดับอุปกรณ์ — ผู้ใช้สามารถปิด alert หรือ face notification บนอุปกรณ์ของตนเองได้

การแตะ notification จะนำทางตรงไปยัง event หรือหน้า face detail ที่เกี่ยวข้อง

---

## ความปลอดภัย

**Authentication** — Vigil Mobile ใช้ Bearer token ที่เก็บใน native secure credential store ของอุปกรณ์ (iOS Keychain / Android Keystore) token ไม่ถูกเก็บในไฟล์ที่อ่านได้ทั่วไป

**Biometric login** — รองรับ Face ID และ fingerprint authentication บนทั้งสองแพลตฟอร์ม แอปจะขอ re-authenticate ทุกครั้งที่กลับมาจาก background

**Custom server URL** — ที่อยู่ server ตั้งค่าได้จากหน้า login และเก็บใน secure store รองรับการ deploy แบบ white-label ที่หลายองค์กรใช้ app เดียวกันชี้ไปยัง server ต่างกัน

**ไม่มี backend กลางเก็บข้อมูล** — Vigil Mobile ดึงข้อมูลโดยตรงจาก Vigil Platform server ของลูกค้า ไม่มีข้อมูล event, snapshot, หรือข้อมูลส่วนบุคคลผ่านหรือถูกเก็บโดยบริการตัวกลางใด ๆ

**Map tiles** — คำขอ tile ถูก proxy ผ่าน Vigil Platform server เมื่อมีการตั้งค่า tile provider เชิงพาณิชย์ — API token ไม่เคยถูกส่งไปยัง mobile client

---

## สถานะฟีเจอร์แต่ละแพลตฟอร์ม

| ฟีเจอร์ | iOS | Android |
|---|---|---|
| Authentication (Bearer + secure store) | ✓ | ✓ |
| Custom server URL | ✓ | ✓ |
| Biometric login (Face ID / fingerprint) | ✓ | ✓ |
| Real-time WebSocket feed | ✓ | ✓ |
| สลับภาษาไทย / อังกฤษ | ✓ | ✓ |
| iPad / tablet two-pane layout | ✓ | ✓ |
| Dark / light / auto theme | ✓ | ✓ |
| แท็บ Cameras (เต็มรูปแบบ) | ✓ | ✓ |
| แท็บ Alerts | ✓ | ✓ |
| แท็บ Events | ✓ | ✓ |
| แท็บ Stats | ✓ | ✓ |
| แท็บ Map | ✓ | ✓ |
| Push notification (Alert) | ✓ | ✓ |
| Push notification (Face) | ✓ | ✓ |
