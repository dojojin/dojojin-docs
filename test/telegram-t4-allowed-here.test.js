// ============================================================
// Vigil Platform — Tests: lineCommandRun unstubbed — Telegram sourceIds (T4)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// This file requires the REAL src/helpers/lineCommandRun.js (unlike
// telegram-t4-commands.test.js, which substitutes it in require.cache to
// isolate telegramPoller — node --test runs each file in its own process,
// so the two files' require.cache states never collide).
//
// Goal: prove Telegram's `tg:<chatId>` source ids flow through allowedHere()
// and handleLineText()'s logging exactly like LINE's own ids do — the
// function is generic string comparison already, this just locks the
// behaviour down with a test instead of relying on "it's just strings".
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  allowedHere, loadOperatorByTelegramId, handleLineText,
} = require('../src/helpers/lineCommandRun');

// ============================================================
// allowedHere — pure, no DB
// ------------------------------------------------------------
// 🔴 migration 244 เปลี่ยนพฤติกรรมจริง: ห้อง Telegram (sourceId ขึ้นต้น "tg:") ใช้
// `telegram_allow_in` เสมอ — ไม่ใช้ `allow_in` อีกต่อไป (เดิมทั้งสองห้องแชร์คอลัมน์
// เดียวกัน). ผลคือ op ที่ตั้ง allow_in ไว้จำกัดห้อง LINE แต่ไม่เคยตั้ง telegram_allow_in
// เลย จะ **สั่งได้ทุกห้อง Telegram** (เดิมเคยถูกปฏิเสธเพราะ list ไม่มี "tg:" อยู่ในนั้น)
// — จงใจ ไม่ใช่บั๊ก เพราะสองรายการนี้เป็นคนละชุดที่แอดมินต้องตั้งแยกกัน ดู CLAUDE.md
// Working Agreement #3 (ต้อง verify หลังแก้) และรายงาน AUDIT ของ session นี้
// ============================================================
describe('allowedHere — allow_in (LINE) กับ telegram_allow_in (Telegram) เป็นคนละคอลัมน์กัน', () => {
  it('allow_in ว่าง/ไม่มี → สั่งได้ทุกห้อง LINE (เดิม ไม่เปลี่ยน)', () => {
    assert.equal(allowedHere({ allow_in: null }, 'Ctestroom'), true);
    assert.equal(allowedHere({ allow_in: [] }, 'Ctestroom'), true);
  });

  it('telegram_allow_in ว่าง/ไม่มี → สั่งได้ทุกห้อง Telegram (พฤติกรรมเดียวกับ allow_in ว่าง แค่คนละคอลัมน์)', () => {
    assert.equal(allowedHere({ telegram_allow_in: null }, 'tg:-100777'), true);
    assert.equal(allowedHere({ allow_in: null, telegram_allow_in: [] }, 'tg:-100777'), true);
  });

  it('[พลิกพฤติกรรมเดิมโดยตั้งใจ] allow_in จำกัดห้อง LINE ไว้ → ไม่กระทบห้อง Telegram เลย — '
     + 'ก่อน migration 244 บรรทัดนี้คือ false (allow_in ถูกใช้ตรวจ tg: sourceId ด้วย) '
     + 'ตอนนี้ tg: ใช้ telegram_allow_in เท่านั้น ยังไม่ตั้งอะไรไว้ = ผ่านทุกห้อง', () => {
    assert.equal(allowedHere({ allow_in: ['Croom1'] }, 'tg:-100777'), true);
    // ห้อง LINE เดิมยังถูกจำกัดตามปกติ — allow_in ไม่ได้เพี้ยนไปไหน
    assert.equal(allowedHere({ allow_in: ['Croom1'] }, 'Croom2'), false);
  });

  it('telegram_allow_in มี tg: id ตรงกับห้องที่สั่ง → ผ่าน · ห้องอื่นไม่ผ่าน', () => {
    const op = { telegram_allow_in: ['tg:-100777'] };
    assert.equal(allowedHere(op, 'tg:-100777'), true);
    assert.equal(allowedHere(op, 'tg:-999'), false);
  });

  it('isolation ทิศทางที่ 1: ตั้ง allow_in (LINE) ไว้ ไม่ทำให้ telegram_allow_in ที่ยังว่างถูกจำกัดไปด้วย', () => {
    const op = { allow_in: ['Croom1'], telegram_allow_in: null };
    assert.equal(allowedHere(op, 'tg:-1'), true, 'ห้อง Telegram ใดก็สั่งได้ — allow_in ไม่เกี่ยวกับห้อง Telegram เลย');
    assert.equal(allowedHere(op, 'Croom1'), true);
    assert.equal(allowedHere(op, 'Croom2'), false, 'allow_in ยังจำกัดฝั่ง LINE ตามปกติ ไม่ถูกลบล้าง');
  });

  it('isolation ทิศทางที่ 2: ตั้ง telegram_allow_in ไว้ ไม่ทำให้ allow_in ที่ยังว่างถูกจำกัดไปด้วย', () => {
    const op = { allow_in: null, telegram_allow_in: ['tg:-100777'] };
    assert.equal(allowedHere(op, 'Croom1'), true, 'ห้อง LINE ใดก็สั่งได้ — telegram_allow_in ไม่เกี่ยวกับห้อง LINE เลย');
    assert.equal(allowedHere(op, 'tg:-100777'), true);
    assert.equal(allowedHere(op, 'tg:-999'), false, 'telegram_allow_in ยังจำกัดฝั่ง Telegram ตามปกติ ไม่ถูกลบล้าง');
  });

  it('ตั้งทั้งสองคอลัมน์พร้อมกัน — จำกัดคนละห้อง ทำงานอิสระต่อกันทั้งสองทิศทาง', () => {
    const op = { allow_in: ['Croom1'], telegram_allow_in: ['tg:-100777'] };
    assert.equal(allowedHere(op, 'Croom1'), true);
    assert.equal(allowedHere(op, 'Croom2'), false);
    assert.equal(allowedHere(op, 'tg:-100777'), true);
    assert.equal(allowedHere(op, 'tg:-999'), false);
  });
});

// ============================================================
// loadOperatorByTelegramId — mirrors loadOperator()'s enabled/user checks
// ============================================================
function makeOpPool(row) {
  return { query: async () => ({ rows: row ? [row] : [] }) };
}

describe('loadOperatorByTelegramId', () => {
  it('ไม่มี telegramUserId → null ทันที ไม่ query', async () => {
    let queried = false;
    const pool = { query: async () => { queried = true; return { rows: [] }; } };
    assert.equal(await loadOperatorByTelegramId(pool, null), null);
    assert.equal(queried, false);
  });

  it('ไม่พบแถว → null', async () => {
    assert.equal(await loadOperatorByTelegramId(makeOpPool(null), 999), null);
  });

  it('พบแถวแต่ enabled=false → null (ปิดสิทธิ์แล้ว)', async () => {
    const row = { line_user_id: 'Uabc', enabled: false, user_id: 5, user_enabled: true };
    assert.equal(await loadOperatorByTelegramId(makeOpPool(row), 999), null);
  });

  it('user_id เป็น null (บัญชีถูกลบ) → null แม้ enabled=true', async () => {
    const row = { line_user_id: 'Uabc', enabled: true, user_id: null, user_enabled: null };
    assert.equal(await loadOperatorByTelegramId(makeOpPool(row), 999), null);
  });

  it('บัญชีที่ยืมสิทธิ์ถูกปิด (user_enabled=false) → null แม้ operator enabled=true', async () => {
    const row = { line_user_id: 'Uabc', enabled: true, user_id: 5, user_enabled: false };
    assert.equal(await loadOperatorByTelegramId(makeOpPool(row), 999), null);
  });

  it('enabled ครบทั้งสองชั้น → คืนแถวนั้น', async () => {
    const row = { line_user_id: 'Uabc', enabled: true, user_id: 5, user_enabled: true, role: 'admin' };
    assert.deepEqual(await loadOperatorByTelegramId(makeOpPool(row), 999), row);
  });

  // 🔴 ล็อก SELECT ไว้ตรงๆ — ถ้าลืมเพิ่มคอลัมน์นี้ allowedHere() จะเห็น
  // telegram_allow_in เป็น undefined เสมอ (= อนุญาตทุกห้อง) แบบเงียบๆ ไม่มี error ให้เห็น
  it('query ต้องดึงคอลัมน์ telegram_allow_in มาด้วยเสมอ', async () => {
    let sqlSeen = '';
    const pool = { query: async (sql) => { sqlSeen = sql; return { rows: [] }; } };
    await loadOperatorByTelegramId(pool, 999);
    assert.match(sqlSeen, /telegram_allow_in/);
  });
});

// ============================================================
// handleLineText — log ลง line_command_log ด้วย source_type='telegram' เหมือน LINE
// ทุกประการ (op ฉีดเข้ามาเอง — แพตเทิร์นเดียวกับ POST /api/line/commands/test)
// ============================================================
function makeHandleTextPool({ pendingAsk = null } = {}) {
  const inserted = [];
  return {
    inserted,
    query: async (sql, args) => {
      if (/FROM line_commands WHERE enabled/.test(sql)) return { rows: [] };
      if (/SELECT code, name, name_th FROM sites/.test(sql)) return { rows: [] };
      if (/FROM line_pending_asks/.test(sql)) return { rows: pendingAsk ? [pendingAsk] : [] };
      if (/INSERT INTO line_command_log/.test(sql)) { inserted.push(args); return { rows: [] }; }
      if (/UPDATE line_operators SET last_used_at/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
}

describe('handleLineText — source_type "telegram" ถูก log เหมือน LINE ทุกประการ', () => {
  const op = { line_user_id: 'Uabc', display_name: 'ทดสอบ', user_id: 5, role: 'admin', enabled: true, allow_in: null };

  it('ไม่มีคำสั่งไหนในระบบ (no_match) → log source_type=telegram, source_id=tg:<id>, status=no_match', async () => {
    const pool = makeHandleTextPool();
    const r = await handleLineText({ pool },
      { text: 'สวัสดีจ้า', lineUserId: op.line_user_id, sourceType: 'telegram', sourceId: 'tg:-100777', op });
    assert.equal(r.action, 'ignore');
    assert.equal(r.status, 'no_match');
    assert.equal(pool.inserted.length, 1);
    // logRun() INSERT column order: line_user_id, operator_name, source_type, source_id, text_in, ...
    assert.equal(pool.inserted[0][2], 'telegram');
    assert.equal(pool.inserted[0][3], 'tg:-100777');
    assert.equal(pool.inserted[0][8], 'no_match');
  });

  it('telegram_allow_in ไม่อนุญาตห้อง Telegram นี้ → denied, log source_type=telegram เหมือนกัน '
     + '(migration 244: ห้อง Telegram เช็คกับ telegram_allow_in ไม่ใช่ allow_in อีกต่อไป — '
     + 'allow_in ที่ตั้งไว้ในเทสต์นี้ต้อง "ไม่มีผล" กับห้อง tg: เลย, ดูเทสต์ถัดไป)', async () => {
    const pool = makeHandleTextPool();
    const restrictedOp = { ...op, allow_in: ['Croom1'], telegram_allow_in: ['tg:-1'] };
    const r = await handleLineText({ pool },
      { text: 'ช่วยเหลือ', lineUserId: op.line_user_id, sourceType: 'telegram', sourceId: 'tg:-999', op: restrictedOp });
    assert.equal(r.action, 'ignore');
    assert.equal(r.status, 'denied');
    assert.equal(pool.inserted[0][2], 'telegram');
    assert.equal(pool.inserted[0][8], 'denied');
  });

  it('allow_in (ของ LINE) จำกัดไว้ แต่ไม่เคยตั้ง telegram_allow_in เลย → ห้อง Telegram นี้ "ไม่ถูกจำกัด" '
     + '(ตรงข้ามกับพฤติกรรมก่อน migration 244 ที่ allow_in เคยถูกใช้เช็คห้อง Telegram ด้วย)', async () => {
    const pool = makeHandleTextPool();
    const restrictedOp = { ...op, allow_in: ['Croom1'] };
    const r = await handleLineText({ pool },
      { text: 'ช่วยเหลือ', lineUserId: op.line_user_id, sourceType: 'telegram', sourceId: 'tg:-999', op: restrictedOp });
    assert.equal(r.action, 'reply');
    assert.notEqual(r.status, 'denied');
  });

  it('telegram_allow_in อนุญาต tg: id นี้แล้ว + พิมพ์ "ช่วยเหลือ" → ตอบ help text ปกติ (ไม่ถูก denied)', async () => {
    const pool = makeHandleTextPool();
    const allowedOp = { ...op, telegram_allow_in: ['tg:-100777'] };
    const r = await handleLineText({ pool },
      { text: 'ช่วยเหลือ', lineUserId: op.line_user_id, sourceType: 'telegram', sourceId: 'tg:-100777', op: allowedOp });
    assert.equal(r.action, 'reply');
    assert.equal(r.status, 'ok');
    // ไม่มีคำสั่งไหนเปิดในสตับนี้เลย (line_commands ว่าง) — ข้อความนี้พิสูจน์ว่าผ่าน
    // allowedHere() แล้วจริง ๆ ไม่ใช่โดน denied ตัดตั้งแต่ต้น (ต่างจากเทสต์ก่อนหน้า)
    assert.equal(r.text, 'ยังไม่มีคำสั่งที่เปิดใช้งาน');
  });

  it('เปรียบเทียบตรง: sourceType เดิม (user/LINE) ยัง log status/รูปแบบเดียวกันทุกอย่าง ต่างแค่ source_type', async () => {
    const pool = makeHandleTextPool();
    const r = await handleLineText({ pool },
      { text: 'สวัสดีจ้า', lineUserId: op.line_user_id, sourceType: 'user', sourceId: 'Uabc', op });
    assert.equal(r.status, 'no_match');
    assert.equal(pool.inserted[0][2], 'user');
    assert.equal(pool.inserted[0][3], 'Uabc');
  });

  // 🔴 ล็อก SELECT ของ loadCommands() ไว้ — ถ้าลืมเพิ่มคอลัมน์นี้ c.telegram_enabled
  // จะเป็น undefined เสมอ แล้ว `c.telegram_enabled !== false` เป็น true ทุกแถว
  // (= ตัวกรองด้านล่างนี้กลายเป็น no-op แบบเงียบๆ ไม่มี error ให้เห็น)
  it('query ของ loadCommands ต้องดึงคอลัมน์ telegram_enabled มาด้วยเสมอ', async () => {
    let sqlSeen = '';
    const pool = {
      query: async (sql) => {
        if (/FROM line_commands WHERE enabled/.test(sql)) { sqlSeen = sql; return { rows: [] }; }
        return { rows: [] };
      },
    };
    const { loadCommands } = require('../src/helpers/lineCommandRun');
    await loadCommands(pool);
    assert.match(sqlSeen, /telegram_enabled/);
  });
});

// ============================================================
// telegram_enabled — คำสั่งที่ปิดไว้บน Telegram "ไม่มีตัวตน" บนช่องทางนั้นเลย
// (migration 244) · LINE (sourceType='user'/'group') ต้องไม่ถูกกรองอะไรเพิ่มเลย
// ============================================================
function makeVisibilityPool(commands) {
  return {
    query: async (sql) => {
      if (/FROM line_commands WHERE enabled/.test(sql)) return { rows: commands };
      if (/SELECT code, name, name_th FROM sites/.test(sql)) return { rows: [] };
      if (/FROM line_pending_asks/.test(sql)) return { rows: [] };
      if (/INSERT INTO line_command_log/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
}

describe('telegram_enabled — กรองเฉพาะฝั่ง Telegram (migration 244)', () => {
  const commands = [
    { key: 'cmd_on', label: 'คำสั่งเปิดทั้งคู่', action_key: null, source_key: 'x',
      triggers: [], telegram_enabled: true },
    { key: 'cmd_off', label: 'คำสั่งปิดเฉพาะ Telegram', action_key: null, source_key: 'y',
      triggers: [], telegram_enabled: false },
  ];
  const op = { line_user_id: 'Uabc', display_name: 'ทดสอบ', user_id: 5, role: 'admin', enabled: true, allow_in: null };

  it('sourceType=telegram + "ช่วยเหลือ" → help text ไม่มีคำสั่งที่ telegram_enabled=false เลย', async () => {
    const pool = makeVisibilityPool(commands);
    const r = await handleLineText({ pool },
      { text: 'ช่วยเหลือ', lineUserId: op.line_user_id, sourceType: 'telegram', sourceId: 'tg:-1', op });
    assert.equal(r.action, 'reply');
    assert.match(r.text, /คำสั่งเปิดทั้งคู่/);
    assert.doesNotMatch(r.text, /คำสั่งปิดเฉพาะ Telegram/);
  });

  it('sourceType=user (LINE) + "ช่วยเหลือ" → help text มีครบทั้งสองคำสั่ง (ไม่ถูกกรองอะไรเพิ่ม)', async () => {
    const pool = makeVisibilityPool(commands);
    const r = await handleLineText({ pool },
      { text: 'ช่วยเหลือ', lineUserId: op.line_user_id, sourceType: 'user', sourceId: 'Uabc', op });
    assert.equal(r.action, 'reply');
    assert.match(r.text, /คำสั่งเปิดทั้งคู่/);
    assert.match(r.text, /คำสั่งปิดเฉพาะ Telegram/, 'LINE ต้องเห็นคำสั่งนี้ตามปกติ — telegram_enabled ไม่เกี่ยวกับ LINE เลย');
  });
});

// ============================================================
// pending ask/confirm ของผู้สั่ง Telegram ยังทำงานตามปกติ (migration 244 ไม่กระทบ
// เส้นทางนี้เลย — line_pending_asks ยังคีย์ด้วย line_user_id + source_id เหมือนเดิม)
//
// ⚠️ ทดสอบเฉพาะขา "ยกเลิก" (ans === 'no') ซึ่ง runAction คืนค่าและ return ทันที
// โดยไม่แตะ act.run()/fetchAsUser เลย — กันไม่ให้เทสต์นี้มีโอกาสยิงแจ้งเตือนจริง
// (memory: feedback_harness_real_line_send — การ์ดทดสอบเคยหลุดเข้ากลุ่มตำรวจมาแล้ว)
// ============================================================
describe('pending confirm ของผู้สั่ง Telegram ยังทำงานปกติ', () => {
  it('need=confirm ค้างอยู่ (source_id=tg:...) + ตอบ "ยกเลิก" → cancelled ทันที ไม่แตะ act.run เลย', async () => {
    const cmdRow = {
      key: 'ack_alert', label: 'รับทราบการแจ้งเตือน', action_key: 'ack_alert', source_key: null,
      telegram_enabled: true, triggers: [], slots: [], required_slots: [], fixed_params: {},
    };
    const pendingRow = { command_key: 'ack_alert', slots: {}, need: 'confirm', options: [] };
    const inserted = [];
    const pool = {
      query: async (sql, args) => {
        if (/FROM line_commands WHERE enabled/.test(sql)) return { rows: [cmdRow] };
        if (/SELECT code, name, name_th FROM sites/.test(sql)) return { rows: [] };
        if (/FROM line_pending_asks/.test(sql)) return { rows: [pendingRow] };
        if (/DELETE FROM line_pending_asks/.test(sql)) return { rows: [] };
        if (/INSERT INTO line_command_log/.test(sql)) { inserted.push(args); return { rows: [] }; }
        return { rows: [] };
      },
    };
    const op = { line_user_id: 'Uabc', display_name: 'ทดสอบ', user_id: 5, role: 'admin', enabled: true, allow_in: null };
    const r = await handleLineText({ pool },
      { text: 'ยกเลิก', lineUserId: op.line_user_id, sourceType: 'telegram', sourceId: 'tg:-100777', op });
    assert.equal(r.action, 'reply');
    assert.equal(r.status, 'cancelled');
    assert.match(r.text, /ยกเลิกแล้ว/);
    assert.ok(inserted.some((row) => row[8] === 'cancelled'), 'ต้อง log ผล cancelled ลง line_command_log ด้วย');
  });
});
