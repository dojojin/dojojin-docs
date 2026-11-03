// ============================================================
// Vigil Platform — แยกโปรแกรม/เบราว์เซอร์/ระบบ/อุปกรณ์จาก user agent (อ่านตอนแสดงผล ไม่ใช่ตอนบันทึก)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

// DB เก็บ UA ดิบ (public_file_clicks.user_agent) — ตัวแยกนี้แก้ได้ทุกเมื่อโดยประวัติไม่เสีย
// ponytail: regex ล้วน ไม่ลาก ua-parser เข้ามา · เจอ UA ที่แยกผิดให้เพิ่มแถวในตาราง APPS/BROWSERS พร้อมเทสต์
// ⚠️ ตัวดึงพรีวิวลิงก์ของแอปแชต (ยิงก่อนคนกด) ยังไม่ได้วัดจากของจริง — รายการ BOT ด้านล่างเป็นรูปแบบทั่วไป
//    เมื่อเห็น UA จริงในตารางคลิก ให้เพิ่มที่นี่ (เจ้าของสั่งทดสอบส่งลิงก์ใน LINE/Messenger)

const BOT = /bot\b|bot\/|crawler|spider|preview|facebookexternalhit|facebookcatalog|slurp|curl\/|wget\/|python-requests|python-urllib|go-http-client|node-fetch|axios\/|headlesschrome|okhttp\/|java\//i;

// แอปที่เปิดลิงก์ด้วยเบราว์เซอร์ในตัว — ลำดับสำคัญ (Messenger มี FBAN ด้วย)
const APPS = [
  ['LINE', /\bLine\/\d/i],
  ['Messenger', /FB_IAB\/MESSENGER|FBAN\/Messenger|MessengerForiOS|Orca-Android/i],
  ['Facebook', /FBAN|FBAV|FB_IAB|FB4A/i],
  ['Instagram', /Instagram/i],
  ['TikTok', /musical_ly|TikTok|BytedanceWebview/i],
  ['Telegram', /Telegram/i],
  ['WhatsApp', /WhatsApp/i],
  ['WeChat', /MicroMessenger/i],
  ['Outlook', /Outlook|ms-office/i],
  ['Microsoft Teams', /Teams\//i],
  ['Slack', /Slack/i],
];
const BROWSERS = [
  ['Edge', /Edg(A|iOS)?\//],
  ['Samsung Internet', /SamsungBrowser\//],
  ['Opera', /OPR\/|Opera/],
  ['Firefox', /Firefox\/|FxiOS\//],
  ['Chrome', /Chrome\/|CriOS\//],
  ['Safari', /Version\/[\d.]+.*Safari\//],
];
const OSES = [
  ['iOS', /iPhone|iPad|iPod/],
  ['Android', /Android/],
  ['Windows', /Windows NT/],
  ['macOS', /Mac OS X|Macintosh/],
  ['ChromeOS', /CrOS/],
  ['Linux', /Linux/],
];
const first = (list, ua) => (list.find(([, re]) => re.test(ua)) || [null])[0];

function uaInfo(ua) {
  const s = String(ua || '');
  if (!s) return { bot: true, app: null, browser: null, os: null, device: null };
  const bot = BOT.test(s);
  const app = first(APPS, s);
  const os = first(OSES, s);
  // ค่าเป็นคีย์ภาษาอังกฤษ หน้าจอแปลเอง (i18n fsvc.dev_*)
  const device = /iPad|Tablet/i.test(s) || (/Android/.test(s) && !/Mobile/.test(s)) ? 'tablet'
    : /Mobi|iPhone|iPod|Android/i.test(s) ? 'mobile' : (os ? 'desktop' : null);
  return { bot, app, browser: app ? null : first(BROWSERS, s), os, device };
}

module.exports = { uaInfo };
