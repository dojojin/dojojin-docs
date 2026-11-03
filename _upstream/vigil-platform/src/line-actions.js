// ============================================================
// Vigil Platform — ทะเบียน "คำสั่งที่ลงมือทำ" ของบอท LINE
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// คนละทะเบียนกับ line-answer-sources.js โดยตั้งใจ: ตัวนั้น "ถาม" ตัวนี้ "ทำ"
// ของที่ทำแล้วออกไปข้างนอกองค์กร (ส่งเข้ากลุ่มตำรวจ) เรียกคืนไม่ได้ ⇒ ต้องมี
// จังหวะให้ยั้ง (confirm) และต้องบันทึกว่าใครสั่ง
//
// งานจริงที่ทำให้ต้องมีตัวนี้ (เจ้าของเล่า 2026-09-08):
//   ป้ายรถทดสอบ 1กอ88 อยู่กลุ่ม "รถทดสอบระบบ" ส่วนกลุ่ม Phuket Eyes Police-VSS
//   ตั้งไว้ให้รับเฉพาะ suspect/warrant ⇒ ตำรวจไม่ได้รับ (ถูกต้องแล้ว ไม่งั้นโดน
//   รบกวนทุกครั้งที่ทดสอบ) แต่พอเป็นเคสจริงที่ต้องแจ้ง เจ้าของต้องเปิดหน้าจอกดส่งเอง
//   ซึ่งหลายครั้งไม่ได้อยู่หน้าจอและไม่ได้ล็อกอิน
//
// ตัวส่งไม่ได้เขียนใหม่ — เรียก `POST /api/lpr/alerts/:id/notify` ตัวเดียวกับปุ่มใน
// หน้าจอ (force ข้ามตัวกัน · ติดป้าย "ส่งด้วยตนเองโดย …" · ลง alert_logs เป็น
// sent_manual) ⇒ พฤติกรรมตรงกับที่เจ้าของทำเองทุกประการ
// ============================================================
'use strict';

const TH_OFFSET_MS = 7 * 3600000;
const hhmm = (iso) => new Date(new Date(iso).getTime() + TH_OFFSET_MS).toISOString().slice(11, 16);

// การแจ้งเตือนที่เก่ากว่านี้ ไม่ควรถูก "ส่งต่อ" ด้วยคำว่า "อันนี้" — คนพูดถึงของที่เพิ่งเห็น
const RECENT_HOURS = 6;

/** หา "การแจ้งเตือนที่หมายถึง" — ใช้ร่วมกันทั้งส่งต่อและรับทราบ */
async function pickAlert(deps, { slots, op, fetchAsUser }) {
  const out = await fetchAsUser(deps, op.user_id, '/api/lpr/alerts', { period: 'today', limit: 50 });
  if (!out.ok) return { error: out.status === 403 ? 'no_permission' : 'fetch_failed' };
  const all = Array.isArray(out.body) ? out.body : [];
  const cutoff = Date.now() - RECENT_HOURS * 3600000;
  const fresh = all.filter((r) => new Date(r.event_time).getTime() >= cutoff);
  const want = String(slots.plate || '').replace(/\s/g, '');
  const list = want
    ? fresh.filter((r) => String(r.plate_number || '').replace(/\s/g, '') === want)
    : fresh;
  if (!list.length) return null;
  list.sort((a, b) => new Date(b.event_time) - new Date(a.event_time));
  const plates = new Set(list.map((r) => r.plate_number));
  if (!want && plates.size > 1) return { many: list.slice(0, 5) };
  return { alert: list[0] };
}

const ACTIONS = {
  forward_alert: {
    label: 'ส่งการแจ้งเตือนให้กลุ่มอื่น',
    accepts: ['plate'],
    // ต้องตั้ง fixed_params.to = [id ผู้รับ] อย่างน้อยหนึ่งคน (ตั้งในหน้าตั้งค่า)
    needsTargets: true,

    pick: pickAlert,

    /** ข้อความยืนยันก่อนส่ง — ต้องบอกให้ครบว่าจะส่ง "อะไร" ไป "ที่ไหน" */
    confirmText(alert, targetNames) {
      return [
        `จะส่งการแจ้งเตือนนี้ให้ ${targetNames.join(', ')}`,
        `ป้าย ${alert.plate_number}${alert.region ? ` ${alert.region}` : ''}`,
        `${alert.camera_name || alert.camera_id} เวลา ${hhmm(alert.event_time)}`,
        'พิมพ์ ใช่ เพื่อส่ง หรือ ไม่ เพื่อยกเลิก',
      ].join('\n');
    },

    async run(deps, { alert, targets, op, fetchAsUser }) {
      const out = await fetchAsUser(deps, op.user_id, '/api/lpr/alerts/' + alert.id + '/notify',
        {}, { method: 'POST', body: { recipient_ids: targets } });
      if (!out.ok) {
        return { ok: false, text: out.status === 403
          ? 'บัญชีที่ผูกไว้ไม่มีสิทธิ์ส่งการแจ้งเตือน'
          : 'ส่งไม่สำเร็จ ลองใหม่อีกครั้ง' };
      }
      const sent = out.body?.result?.sentCount ?? out.body?.result?.recipients?.length;
      return {
        ok: true,
        text: `ส่งแล้ว: ${alert.plate_number} (${alert.camera_name || alert.camera_id} `
            + `${hhmm(alert.event_time)})${sent ? ` ถึงผู้รับ ${sent} ราย` : ''}`,
      };
    },
  },

  // ── รับทราบการแจ้งเตือน ─────────────────────────────────────
  // ปลอดภัยที่สุดในบรรดาคำสั่งที่ "ทำ" — ไม่ปิดเสียงอะไร แค่บอกว่ามีคนเห็นแล้ว
  // จึงไม่ต้องยืนยัน (ทำผิดก็แค่กดซ้ำได้)
  ack_alert: {
    label: 'รับทราบการแจ้งเตือน',
    accepts: ['plate'],
    needsTargets: false,
    noConfirm: true,
    pick: pickAlert,
    async run(deps, { alert, op, fetchAsUser }) {
      const out = await fetchAsUser(deps, op.user_id, `/api/lpr/alerts/${alert.id}/ack`,
        {}, { method: 'POST', body: {} });
      if (!out.ok) {
        return { ok: false, text: out.status === 403
          ? 'บัญชีที่ผูกไว้ไม่มีสิทธิ์รับทราบการแจ้งเตือน' : 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง' };
      }
      return { ok: true,
        text: `รับทราบแล้ว: ${alert.plate_number} (${alert.camera_name || alert.camera_id} `
            + `${hhmm(alert.event_time)})` };
    },
  },

  // ── หยุดแจ้งเตือนป้ายนี้ชั่วคราว ──────────────────────────────
  // ⚠️ มีวันหมดอายุเสมอ — ถาวรทำได้เฉพาะในแดชบอร์ดที่มีชื่อคนกด
  mute_plate: {
    label: 'หยุดแจ้งเตือนป้ายนี้ชั่วคราว',
    accepts: ['plate', 'hours'],
    needsTargets: false,
    requiresPlate: true,
    async run(deps, { slots, op, fetchAsUser }) {
      const plate = slots.plate;
      const hours = Math.min(Math.max(parseInt(slots.hours, 10) || 24, 1), 168);
      const out = await fetchAsUser(deps, op.user_id,
        `/api/lpr/watchlist/${encodeURIComponent(plate)}/mute`, {},
        { method: 'POST', body: { hours, source: 'line' } });
      if (!out.ok) {
        return { ok: false, text: out.status === 403
          ? 'บัญชีที่ผูกไว้ไม่มีสิทธิ์แก้รายการเฝ้าระวัง' : 'ตั้งค่าไม่สำเร็จ ลองใหม่อีกครั้ง' };
      }
      const until = out.body?.muted_until ? hhmm(out.body.muted_until) : '';
      const d = out.body?.muted_until
        ? new Date(new Date(out.body.muted_until).getTime() + TH_OFFSET_MS).toISOString().slice(5, 10)
        : '';
      return { ok: true,
        text: `หยุดแจ้งเตือน ${plate} แล้ว ${hours} ชั่วโมง (ถึง ${d} ${until})\n`
            + 'พิมพ์ "เปิดแจ้งเตือน ' + plate + '" เพื่อเปิดกลับก่อนเวลา' };
    },
  },

  // ── เปิดแจ้งเตือนกลับ ───────────────────────────────────────
  unmute_plate: {
    label: 'เปิดแจ้งเตือนป้ายนี้กลับ',
    accepts: ['plate'],
    needsTargets: false,
    requiresPlate: true,
    noConfirm: true,
    async run(deps, { slots, op, fetchAsUser }) {
      const plate = slots.plate;
      const out = await fetchAsUser(deps, op.user_id,
        `/api/lpr/watchlist/${encodeURIComponent(plate)}/mute`, {}, { method: 'DELETE' });
      if (!out.ok) {
        return { ok: false, text: out.status === 403
          ? 'บัญชีที่ผูกไว้ไม่มีสิทธิ์แก้รายการเฝ้าระวัง' : 'ตั้งค่าไม่สำเร็จ ลองใหม่อีกครั้ง' };
      }
      // 🔴 รายงาน "สถานะจริง" ไม่ใช่สิ่งที่เพิ่งเขียนลงไป — ป้ายอาจยังเงียบอยู่เพราะ
      // ช่องทางหรือกลุ่มถูกปิด ซึ่งเป็นคนละสวิตช์กัน (ลำดับใน suppressionReason)
      const st = out.body?.state || {};
      const why = {
        not_watched: 'แต่ป้ายนี้ไม่ได้อยู่ในรายการเฝ้าระวัง จึงไม่มีการแจ้งเตือนอยู่แล้ว',
        line_disabled: 'แต่ระบบแจ้งเตือน LINE ถูกปิดอยู่ทั้งระบบ',
        channel_disabled: 'แต่ช่องทางแจ้งเตือนป้ายทะเบียนถูกปิดอยู่',
        group_muted: `แต่กลุ่ม "${st.groupName || '-'}" ถูกปิดเสียงอยู่`,
        plate_muted: 'แต่ป้ายนี้ถูกปิดเสียงถาวรไว้ในแดชบอร์ด',
      }[st.reason];
      return { ok: true,
        text: why ? `เปิดแจ้งเตือน ${plate} แล้ว — ${why}`
                  : `เปิดแจ้งเตือน ${plate} แล้ว ระบบจะแจ้งตามปกติ` };
    },
  },
};

const getAction = (key) => ACTIONS[key] || null;
const actionKeys = () => Object.keys(ACTIONS);

module.exports = { ACTIONS, getAction, actionKeys, RECENT_HOURS };
