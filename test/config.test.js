// ============================================================
// Vigil Platform — Tests: src/config.js (ทะเบียน env กลาง)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// ทะเบียนนี้ถือ default ของทั้งระบบไว้ที่เดียว — ถ้า coercion เพี้ยน ทุกโปรเซส
// เพี้ยนพร้อมกัน · เทสต์จึงตั้ง/ลบ env เองทุกครั้ง ไม่พึ่งค่าที่บังเอิญอยู่ใน .env
'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const env = require('../src/config');

const TOUCHED = new Map();
function set(name, value) {
  if (!TOUCHED.has(name)) TOUCHED.set(name, process.env[name]);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
afterEach(() => {
  for (const [k, v] of TOUCHED) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  TOUCHED.clear();
});

/** เก็บ console.warn ระหว่างรัน fn */
function captureWarn(fn) {
  const out = [];
  const orig = console.warn;
  console.warn = (...a) => out.push(a.join(' '));
  try { fn(); } finally { console.warn = orig; }
  return out;
}

describe('config.int', () => {
  it('อ่านตัวเลขจาก env', () => {
    set('FACE_COUNT_TIMEOUT_MS', '750');
    assert.equal(env.int('FACE_COUNT_TIMEOUT_MS'), 750);
  });

  it('ไม่ได้ตั้ง / ตั้งเป็นค่าว่าง → ใช้ default', () => {
    set('FACE_COUNT_TIMEOUT_MS', undefined);
    assert.equal(env.int('FACE_COUNT_TIMEOUT_MS'), 500);
    set('FACE_COUNT_TIMEOUT_MS', '');
    assert.equal(env.int('FACE_COUNT_TIMEOUT_MS'), 500);
  });

  it('ค่าไม่ใช่ตัวเลข → default + เตือน (ครั้งเดียวต่อโปรเซส)', () => {
    set('FACETS_QUERY_TIMEOUT_MS', 'สองวิ');
    const warns = captureWarn(() => {
      assert.equal(env.int('FACETS_QUERY_TIMEOUT_MS'), 8000);
      assert.equal(env.int('FACETS_QUERY_TIMEOUT_MS'), 8000);   // เรียกซ้ำ ต้องไม่เตือนซ้ำ
    });
    assert.equal(warns.length, 1);
    assert.match(warns[0], /FACETS_QUERY_TIMEOUT_MS/);
  });

  it('ต่ำกว่าขั้นต่ำ → ถูกดันขึ้นเป็นขั้นต่ำ + เตือน', () => {
    set('HCP_LIVE_POLL_SEC', '2');                              // DEFS: min 15
    const warns = captureWarn(() => {
      assert.equal(env.int('HCP_LIVE_POLL_SEC'), 15);
    });
    assert.equal(warns.length, 1);
  });
});

describe('config.bool', () => {
  it('รับ 1/true/yes/on เป็นจริง และ 0/false/no/off เป็นเท็จ', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on']) {
      set('BLACKLIST_PUSH_LIVE', v);
      assert.equal(env.bool('BLACKLIST_PUSH_LIVE'), true, v);
    }
    for (const v of ['0', 'false', 'no', 'off']) {
      set('DASHBOARD_BUNDLE', v);
      assert.equal(env.bool('DASHBOARD_BUNDLE'), false, v);
    }
  });

  it('ไม่ได้ตั้ง → default ของแต่ละตัว (ไม่ใช่ false เสมอ)', () => {
    set('DASHBOARD_BUNDLE', undefined);
    set('BLACKLIST_PUSH_LIVE', undefined);
    assert.equal(env.bool('DASHBOARD_BUNDLE'), true);
    assert.equal(env.bool('BLACKLIST_PUSH_LIVE'), false);
  });

  it('ค่าที่ไม่ใช่ boolean → default + เตือน', () => {
    set('LINE_FACE_FULL_FRAME', 'maybe');
    const warns = captureWarn(() => assert.equal(env.bool('LINE_FACE_FULL_FRAME'), false));
    assert.equal(warns.length, 1);
  });
});

describe('config.list', () => {
  it('ตัดคอมมา trim และทิ้งตัวว่าง', () => {
    set('ALLOWED_ORIGINS', ' https://a.example , ,https://b.example,');
    assert.deepEqual(env.list('ALLOWED_ORIGINS'), ['https://a.example', 'https://b.example']);
  });

  it('ไม่ได้ตั้ง → ใช้ default ของทะเบียน', () => {
    set('ALLOWED_ORIGINS', undefined);
    assert.deepEqual(env.list('ALLOWED_ORIGINS'), []);
    set('LPR_DIAG_WATCH', undefined);
    assert.deepEqual(env.list('LPR_DIAG_WATCH'), ['vehileSubLogoRecog', 'vehileModel']);
  });
});

describe('ชื่อที่ไม่ได้ลงทะเบียน', () => {
  it('throw ทันที (บั๊กของโปรแกรมเมอร์ ไม่ใช่ของ deployment)', () => {
    for (const fn of ['str', 'int', 'bool', 'list']) {
      assert.throws(() => env[fn]('NOT_A_REAL_VIGIL_ENV'), /ไม่ได้ลงทะเบียน/);
    }
  });
});

describe('config.summary', () => {
  it('บอกได้ว่าค่าไหนมาจาก env ค่าไหนเป็น default', () => {
    set('SNAPSHOT_PROXY_DOMAIN', 'example.test');
    set('ACUSEEK_HOST', undefined);
    const by = Object.fromEntries(env.summary().map((r) => [r.name, r]));
    assert.equal(by.SNAPSHOT_PROXY_DOMAIN.source, 'env');
    assert.equal(by.SNAPSHOT_PROXY_DOMAIN.value, 'example.test');
    assert.equal(by.ACUSEEK_HOST.source, 'default');
    assert.equal(by.ACUSEEK_HOST.value, '10.0.10.12');
  });

  it('ปิดบังค่า secret — ค่าจริงต้องไม่โผล่', () => {
    set('SESSION_SECRET', 'super-secret-value-1234567890');
    const row = env.summary().find((r) => r.name === 'SESSION_SECRET');
    assert.equal(row.masked, true);
    assert.equal(row.value, '***');
    assert.equal(JSON.stringify(env.summary()).includes('super-secret-value'), false);
  });

  it('ครอบคลุมทุกชื่อในทะเบียน', () => {
    assert.equal(env.summary().length, env.names().length);
    assert.ok(env.names().length > 100);
  });
});

describe('config.db', () => {
  it('คืนรูปทรงเดียวกับที่ pg Pool/Client ต้องการ', () => {
    set('DB_HOST', 'db.test');
    set('DB_PORT', '6543');
    set('DB_NAME', 'vigil_test');
    set('DB_USER', 'u');
    set('DB_PASSWORD', 'p');
    assert.deepEqual(env.db(), {
      host: 'db.test', port: 6543, database: 'vigil_test', user: 'u', password: 'p',
    });
  });

  it('ไม่ได้ตั้ง = undefined (ปล่อยให้ pg ใช้ PG* / ค่า default ของมันเอง)', () => {
    set('DB_HOST', undefined);
    set('DB_PORT', undefined);
    assert.equal(env.db().host, undefined);
    assert.equal(env.db().port, undefined);
  });
});

describe('อ่านตอนเรียก ไม่ใช่ตอน require', () => {
  it('env ที่ตั้งหลัง require ต้องเห็น (api-server ตั้ง APP_NAME หลัง require)', () => {
    set('APP_NAME', undefined);
    assert.equal(env.str('APP_NAME'), undefined);
    set('APP_NAME', 'api-server');
    assert.equal(env.str('APP_NAME'), 'api-server');
  });
});
