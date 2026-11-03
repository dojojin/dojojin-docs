// ============================================================
// Vigil Platform — HCP integration scope (MOCKUP data)
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// ขอบเขตที่เจ้าของสั่ง 2026-08-08 — เรียงตามลำดับความสำคัญที่ระบุมา
// สถานะ endpoint มาจากการสำรวจ HCP ของภูเก็ตวันเดียวกัน (231 ความสามารถ
// เต็มอยู่ที่ index.html) หน้านี้ตัดเหลือเฉพาะที่โจทย์ต้องใช้จริง
//
// want:true  = เอา (1–5)  ·  want:false = รองรับไว้ ยังไม่เปิด (A–C)
// ready      = ok/proven จากการสำรวจ · param = มีอยู่ ต้องหาพารามิเตอร์เพิ่ม
// ============================================================
window.HCP_SCOPE = {
  groups: [
    {
      id: 'want', name: 'เอา — เปิดใช้จริง', want: true,
      sub: 'เรียงตามลำดับความสำคัญที่เจ้าของกำหนด 2026-08-08',
      items: [
        {
          rank: 1, id: 'facematch', name: 'ผลเปรียบเทียบใบหน้า + แจ้งเตือน',
          why: 'ภูเก็ตมี 34 กล้องจับหน้าแต่ match = 0 เพราะตั้งเป็น mixedTargetDetection — HCP คือแหล่งเดียวของ face match ที่นั่น',
          eps: [
            ['aiapplication/v1/face/faceMatchRecord', 'ready', '556 รายการ/120 วัน · 61 กล้อง · มี similarity 90–95%'],
            ['frs/v1/application/picture', 'ready', 'รูปหน้าครอป + ภาพฉากเต็ม · คืน base64 ตรง ๆ'],
            ['frs/v1/face/groupList', 'ready', 'ชื่อคลัง 17 กลุ่ม — ใช้ตั้ง fd_lib_name'],
          ],
          dest: 'events (FaceRecognition) → หน้า Face Recognition เดิม + LINE',
          build: [
            'importer ไล่เป็นก้อน 31 วัน (เพดานของ HCP)',
            'ตารางแมป cameraIndexCode ↔ camera_id',
            'หาร similarity ด้วย 100 (เรา 0–1 · เขา 0–100)',
            'อนุมาน listType จากชื่อกลุ่ม (Whitelist → whiteList)',
            'กฎแจ้งเตือน LINE — ใช้ alert-engine เดิม ไม่สร้างสายใหม่',
          ],
        },
        {
          rank: 2, id: 'facesearch', name: 'ค้นหาใบหน้าด้วยรูป',
          why: 'อัปโหลดรูป → HCP ค้นย้อนหลังให้ · ปิดช่องที่รูปฝั่งเราหายหลัง 14 วัน (HCP เก็บ 93 วัน)',
          eps: [
            ['frs/v1/application/pictureRecognitionModel', 'param', 'รูป → model data · ต้องส่ง pictureData'],
            ['frs/v1/application/captureSearch', 'param', 'ค้นหน้าที่จับได้ ตามช่วงเวลา/กล้อง'],
            ['frs/v1/application/oneToMany', 'param', 'เทียบกับคลัง 17 กลุ่ม — บอกว่าเป็นใคร'],
          ],
          dest: 'หน้าค้นหาใหม่ + join กับ appearances ของเราด้วย camera + เวลา ±N',
          build: [
            'แกะพารามิเตอร์ captureSearch ให้ได้ก่อน (ยังติดอยู่)',
            'วัดความคลาดเคลื่อนเวลา HCP ↔ ของเรา ก่อนเลือก ±N',
            'audit ว่าใครค้นด้วยรูปอะไรเมื่อไหร่ (PDPA)',
          ],
        },
        {
          rank: 3, id: 'blacklist', name: 'Blacklist ทั้งหมด แยกกลุ่มตาม HCP',
          why: 'HCP ถือ blacklist ที่เรายังไม่มี — ใบหน้า 17 กลุ่มแยกตามพื้นที่ตรงกับ site เรา',
          eps: [
            ['frs/v1/face/groupList', 'ready', '17 กลุ่ม: CTL 65 · TCC 51 · KAT 12 · ชป เมือง 10 · Whitelist'],
            ['frs/v1/face', 'ready', 'ใบหน้าในคลัง — ชื่อ เพศ รูป'],
            ['resource/v1/vehicleGroup/vehicleGroupList', 'ready', '3 กลุ่ม: Blacklist · Whitelist · VIP list'],
            ['resource/v1/vehicle/vehicleList', 'ready', 'ทะเบียนในกลุ่ม — Blacklist 3 คัน'],
          ],
          dest: 'blacklist.sources (hcp) → source_records → master → bridge → lpr_watchlist',
          build: [
            'ลงทะเบียน source hcp (BL_TYPES มี hcp เตรียมไว้แล้ว wiredTypes ว่าง)',
            'เลขบัตรต้องผ่าน encryptPii ห้าม plaintext',
            'merge กับ roster เดิมด้วย plate_hash / id_hash ไม่สร้าง master ซ้ำ',
          ],
        },
        {
          rank: 4, id: 'devices', name: 'สถานะอุปกรณ์ทั้งหมด',
          why: 'เห็นอุปกรณ์ที่ HCP ดูแลอยู่ ซึ่งเรามองไม่เห็นจากฝั่งเรา',
          eps: [
            ['resource/v1/cameras', 'ready', '756 กล้อง'],
            ['resource/v1/encodeDevice/encodeDeviceList', 'ready', '33 เครื่องบันทึก'],
            ['resource/v1/recordServer/recordServerList', 'ready', '1 recording server'],
            ['resource/v1/intelligentServer/intelligentServerList', 'ready', '4 intelligent server'],
            ['resource/v1/streamServer/streamServerList', 'ready', '0 streaming server'],
            ['resource/v1/videoManagementServer', 'ready', 'ข้อมูลเซิร์ฟเวอร์กลาง'],
            ['resource/v1/alarmInputs', 'ready', '1,472 สัญญาณเข้า'],
            ['resource/v1/alarmOutputs', 'ready', '138 สัญญาณออก'],
            ['resource/v1/recordServer/recordStatus', 'param', 'สถานะบันทึกรายกล้อง — ต้องระบุ server'],
          ],
          dest: 'ระบบสถานะ (Health Check) — แท็บใหม่ "อุปกรณ์จาก HCP"',
          build: ['แท็บใหม่ในหน้า Health Check', 'ตารางแมปกล้องเพื่อบอกว่าตัวไหนเราก็ดูแลอยู่'],
        },
        {
          rank: 5, id: 'events', name: 'เหตุการณ์ของ HCP (ยกเว้น LPR/Face)',
          why: 'เหตุการณ์ที่ HCP ตรวจได้แต่กล้องเราไม่ได้ส่งมา',
          eps: [
            ['eventService/v1/eventRecords/page', 'ready', '7 วัน: Parking 46 · Vehicle Matched 34 · หมวดอื่น 0'],
            ['eventService/v1/image_data', 'param', 'รูปของเหตุการณ์ — ต้องระบุ picUri'],
          ],
          dest: 'หน้าใหม่ "เหตุการณ์จาก HCP"',
          build: [
            'ตัดหมวด LPR (130/131) และ Face (49697) ออก ตามโจทย์',
            'ต้องส่ง eventTypes เป็น String + srcType + srcIndexs (กล้องจำกัด 1024 ตัวอักษร → แบ่ง batch)',
            'HCP เปิด analytic rule ไว้น้อยมาก — ได้ข้อมูลน้อยจนกว่าจะไปเปิดเพิ่ม',
          ],
        },
      ],
    },
    {
      id: 'ready', name: 'รองรับไว้ — ยังไม่เปิด', want: false,
      sub: 'เขียนโค้ดรองรับ ทดสอบว่าต่อได้ แต่สวิตช์ปิดไว้ · เปิดได้ทันทีเมื่อต้องการ',
      items: [
        {
          rank: 'A', id: 'lprall', name: 'ป้ายทะเบียนทั้งหมดจากระบบ',
          why: 'เรารับตรงจากกล้องอยู่แล้ว — เก็บไว้เผื่อไซต์ที่ต่อกล้องตรงไม่ได้',
          eps: [
            ['pms/v1/crossRecords/page', 'ready', '140k–348k แถว/กล้อง · มี crossRecordSyscode เป็นคีย์'],
            ['pms/v1/image', 'param', 'รูปรถ — ต้องระบุ picUri'],
          ],
          dest: '(ปิดไว้) — ถ้าเปิดจะเข้า license_plates เหมือน ingester ปกติ',
          build: ['ต้องระบุ cameraIndexCode ทีละตัว ไม่มี query รวม'],
        },
        {
          rank: 'B', id: 'eventsall', name: 'เหตุการณ์ทั้งหมด (รวม LPR/Face)',
          why: 'เป็นซูเปอร์เซ็ตของข้อ 5 — เปิดเมื่อไหร่ก็ได้ แค่เอาตัวกรองออก',
          eps: [['eventService/v1/eventRecords/page', 'ready', 'endpoint เดียวกับข้อ 5 ไม่ต้องเขียนใหม่']],
          dest: '(ปิดไว้)',
          build: ['สวิตช์เดียว — เอา filter หมวด LPR/Face ออก'],
        },
        {
          rank: 'C1', id: 'push', name: 'ให้ HCP push มาแทนการ poll',
          why: 'ลดหน่วงจากนาทีเหลือวินาที · HCP cache ให้ 500 event นาน 1 วันถ้าเราล่ม',
          eps: [
            ['eventService/v1/eventSubscriptionByEventTypes', 'param', 'สมัครรับตามหมวด'],
            ['eventService/v1/eventUnSubscriptionByEventTypes', 'param', 'ยกเลิก'],
          ],
          dest: '(ปิดไว้) — ต้องมีปลายทางที่ HCP ยิงถึง',
          build: ['ต้องเปิดปลายทางให้ HCP ยิงเข้า edge ได้', 'จัดการ dedup กับ poll ไม่ให้ซ้ำ'],
        },
        {
          rank: 'C2', id: 'video', name: 'ภาพสด / ย้อนหลัง / จับภาพ',
          why: 'ดูภาพจากกล้องที่ HCP ดูแลโดยไม่ต้องต่อกล้องตรง',
          eps: [
            ['video/v1/cameras/previewURLs', 'param', 'URL สตรีมสด'],
            ['video/v1/cameras/playbackURLs', 'param', 'URL ย้อนหลัง'],
            ['video/v1/camera/capture', 'param', 'จับภาพนิ่งทันที'],
          ],
          dest: '(ปิดไว้) — เชื่อมกับหน้ากล้องเดิมได้',
          build: ['ตรวจว่า URL ที่ได้ใช้ได้จากเครือข่ายไหน'],
        },
        {
          rank: 'C3', id: 'org', name: 'พื้นที่ · ไซต์ · บุคคล',
          why: 'ใช้ประกอบการแมปกล้องและอ่านโครงสร้างที่ HCP จัดไว้',
          eps: [
            ['resource/v1/regions', 'ready', '38 พื้นที่'],
            ['resource/v1/person/personList', 'ready', '2 บุคคล'],
          ],
          dest: '(ปิดไว้) — ใช้ภายในตอนแมปกล้อง',
          build: [],
        },
      ],
    },
  ],
};
