// ============================================================
// Vigil Mobile — Thai strings
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// ============================================================

const th = {
  // ── Tabs ───────────────────────────────────────────────────
  tabs: {
    cameras:  'กล้อง',
    events:   'เหตุการณ์',
    map:      'แผนที่',
    stats:    'สถิติ',
    alerts:   'แจ้งเตือน',
  },

  // ── Tab headers ────────────────────────────────────────────
  headers: {
    cameras:   'Cameras',
    events:    'Live Events',
    map:       'Map View',
    stats:     'Analytics',
    alerts:    'Alerts',
    settings:  'ตั้งค่า',
  },

  // ── Auth ───────────────────────────────────────────────────
  auth: {
    username:         'Username',
    password:         'Password',
    login:            'เข้าสู่ระบบ',
    loginError:       'กรุณากรอกข้อมูล',
    loginErrorDetail: 'ต้องการ Username และ Password',
    version:          'Vigil Mobile · v1.0.0',
  },

  // ── Server setup ───────────────────────────────────────────
  server: {
    title:          'ตั้งค่า Server',
    description:    'กำหนด URL ของ Vigil server ที่ต้องการเชื่อมต่อ\nระบบจะทดสอบการเชื่อมต่อก่อนบันทึก',
    currentLabel:   'ใช้งานอยู่',
    newUrlLabel:    'URL ใหม่',
    placeholder:    'https://your-server.example.com',
    saveBtn:        'ทดสอบ & บันทึก',
    resetLink:      'รีเซ็ตเป็นค่าเริ่มต้น (dashboard.dojojin.tech)',
    connectOk:      'เชื่อมต่อได้ ✓ กำลังบันทึก…',
    connectFail:    'เชื่อมต่อไม่ได้ — ตรวจสอบ URL และการเชื่อมต่อ',
  },

  // ── Camera screen ──────────────────────────────────────────
  cameras: {
    selectHint:   'เลือกกล้องเพื่อดูรายละเอียด',
    loading:      'กำลังโหลดข้อมูลกล้อง…',
    retry:        'แตะเพื่อลองใหม่',
    allFilter:    'ทั้งหมด',
    searchPlaceholder: 'ค้นหากล้อง...',
    updatedAt:    'อัปเดต %{time}',
    emptySearch:  'ไม่พบกล้องที่ตรงกับ "%{query}"',
    emptyAlert:   'ไม่มีกล้องที่มี Alert วันนี้',
    emptyOffline: 'ทุกกล้อง Online อยู่',
    emptyOnline:  'ไม่มีกล้อง Online',
    emptyGroup:   'ไม่มีกล้องในกลุ่มนี้',
    emptyNone:    'ยังไม่มีกล้องในระบบ',
  },

  // ── KPI labels ─────────────────────────────────────────────
  kpi: {
    total:   'ทั้งหมด',
    online:  'Online',
    offline: 'Offline',
    alert:   'Alert',
  },

  // ── Status filter chips ────────────────────────────────────
  filter: {
    all:     'ทั้งหมด',
    alert:   'Alert',
    offline: 'Offline',
    online:  'Online',
  },

  // ── Camera detail ──────────────────────────────────────────
  cameraDetail: {
    eventsToday:   'Event วันนี้',
    lastSeen:      'Last seen',
    lastAlert:     'Last alert',
    fullSnapshot:  'ภาพเต็ม',
    mapBtn:        'แผนที่',
    activity:      'กิจกรรมล่าสุด',
    activityCount: '%{count} รายการ',
    noActivity:    'ไม่มีกิจกรรมล่าสุด',
    cameraInfo:    'ข้อมูลกล้อง',
    ipAddress:     'IP Address',
    vendor:        'Vendor',
    group:         'กลุ่ม',
    sdCard:        'SD Card',
    notes:         'หมายเหตุ',
    status:        'สถานะ',
    offline:       'Offline',
    online:        'Online',
    notFound:      'ไม่พบข้อมูลกล้อง',
    back:          'กลับ',
    locked:        'กล้อง Offline',
    liveLoading:   'กำลังโหลด…',
  },

  // ── Events screen ──────────────────────────────────────────
  events: {
    tabAll:    'ทั้งหมด',
    tabSnap:   'รูปภาพ',
    tabClip:   'คลิป',
    tabFace:   'ใบหน้า',
    count:     '%{total} รายการ',
    noResults: 'ไม่พบรายการ',
    tryFilter: 'ลองเปลี่ยน filter ดู',
    noData:    'ยังไม่มีข้อมูลในระบบ',
    noFaces:   'ไม่พบใบหน้า',
    allShown:  'แสดงครบทุกรายการแล้ว',
    search:    'ค้นหากล้อง, ประเภท, กฎ…',
  },

  // ── Event detail modal ─────────────────────────────────────
  eventDetail: {
    noImage:     'ไม่มีภาพ',
    watchVideo:  'ดู Video',
    watchImage:  'ดูภาพนิ่ง',
    saveImage:   'บันทึกรูปภาพ',
    saving:      'กำลังบันทึก…',
    saved:       'บันทึกแล้ว',
    saveFailed:  'บันทึกไม่ได้',
    faceDetail:  'รายละเอียดใบหน้า',
    saveFace:    'บันทึกรูปภาพ',
    savedFace:   'บันทึกแล้ว',
    saveFailedFace: 'บันทึกไม่สำเร็จ',
  },

  // ── Event type labels ──────────────────────────────────────
  eventType: {
    motion:     'ตรวจพบการเคลื่อนไหว',
    crossed:    'ข้ามเส้นกำหนด',
    intruder:   'ตรวจพบผู้บุกรุก',
    loitering:  'พฤติกรรมต้องสงสัย',
    crowd:      'ฝูงชนผิดปกติ',
    face:       'ตรวจพบใบหน้า',
    tailgating: 'ติดตามเข้ามา',
  },

  // ── Alerts screen ──────────────────────────────────────────
  alertsScreen: {
    noAlerts:     'ไม่มีการแจ้งเตือน',
    noAlertsHint: 'การแจ้งเตือนแบบ Real-time จะปรากฏที่นี่',
    wsLive:       'Live',
    wsConnecting: 'กำลังเชื่อมต่อ…',
    wsDisconnected: 'ไม่ได้เชื่อมต่อ',
  },

  // ── Map screen ─────────────────────────────────────────────
  map: {
    loading:        'กำลังโหลดแผนที่…',
    noLocation:     'ไม่มีพิกัดกล้อง',
    noLocationHint: 'กล้องยังไม่ได้ตั้งค่าตำแหน่งบนแผนที่',
    refresh:        'แตะเพื่อลองใหม่',
    cameraOffline:  'กล้องออฟไลน์ — ไม่มีภาพสด',
    events24h:      '%{count} เหตุการณ์ (24 ชม.)',
  },

  // ── Stats screen ───────────────────────────────────────────
  statsScreen: {
    noData:     'ยังไม่มีข้อมูล',
    retry:      'แตะเพื่อลองใหม่',
    vendorAll:  'ALL',
    rangeToday: 'วันนี้',
    range7d:    '7 วัน',
    range30d:   '30 วัน',
    chartTitle: 'แนวโน้มเหตุการณ์ตามหมวด',
  },

  // ── Settings ───────────────────────────────────────────────
  settings: {
    title:          'ตั้งค่า',
    security:       'ความปลอดภัย',
    user:           'ผู้ใช้',
    role:           'สิทธิ์',
    pushToggle:     'Push แจ้งเตือน',
    pushNote:       'แจ้งเตือนแม้ปิดแอปอยู่',
    bioUnavailable: 'ไม่พร้อมใช้งาน',
    bioSetupHint:   'ต้องตั้งค่า Face ID / ลายนิ้วมือในเครื่องก่อน',
    biometric:   'ปลดล็อกด้วย %{label}',
    push:        'การแจ้งเตือน',
    pushAlerts:  'Alert',
    pushFaces:   'ใบหน้า',
    appearance:  'การแสดงผล',
    themeAuto:   'อัตโนมัติ',
    themeLight:  'สว่าง',
    themeDark:   'มืด',
    language:    'ภาษา',
    langAuto:    'อัตโนมัติ (เครื่อง)',
    langTh:      'ภาษาไทย',
    langEn:      'English',
    account:     'บัญชี',
    logout:      'ออกจากระบบ',
    logoutConfirmTitle: 'ออกจากระบบ',
    logoutConfirmMsg:   'ต้องการออกจากระบบใช่ไหม?',
    logoutCancel:       'ยกเลิก',
    logoutConfirm:      'ออกจากระบบ',
    pushStatusOk:    'เปิดการแจ้งเตือนแล้ว',
    pushErrPerm:     'ไม่ได้รับอนุญาตแจ้งเตือน — เปิดใน Settings ของเครื่อง',
    pushErrBuild:    'การแจ้งเตือนใช้ได้เฉพาะ production build',
    pushErrDevice:   'ใช้ได้เฉพาะอุปกรณ์จริง (ไม่ใช่ simulator)',
    pushErrGeneral:  'เปิดการแจ้งเตือนไม่สำเร็จ',
  },

  // ── Biometric lock screen ──────────────────────────────────
  lock: {
    title:   'Vigil ถูกล็อก',
    sub:     'ยืนยันตัวตนเพื่อเข้าใช้งาน',
    unlock:  'ปลดล็อก',
    logout:  'ออกจากระบบ',
    prompt:  'ปลดล็อก Vigil',
    cancel:  'ยกเลิก',
    confirmLogoutTitle: 'ออกจากระบบ',
    confirmLogoutMsg:   'ต้องการออกจากระบบใช่ไหม?',
  },

  // ── Time helpers ───────────────────────────────────────────
  time: {
    justNow:     'เมื่อกี้',
    secondsAgo:  '%{count} วิที่แล้ว',
    minutesAgo:  '%{count} นาทีที่แล้ว',
    hoursAgo:    '%{count} ชม.ที่แล้ว',
    sAgo:        '%{count}s ago',
    mAgo:        '%{count}m ago',
    hAgo:        '%{count}h ago',
    dAgo:        '%{count}d ago',
  },

  // ── Face attributes ────────────────────────────────────────
  face: {
    gender:     'เพศ',
    age:        'อายุโดยประมาณ',
    expression: 'อารมณ์',
    mask:       'หน้ากาก',
    hat:        'หมวก',
    glasses:    'แว่นตา',
    faceScore:  'Face score',
    male:       'ชาย',
    female:     'หญิง',
    wearing:    'สวมใส่',
  },
};

export default th;
export type TranslationKeys = typeof th;
