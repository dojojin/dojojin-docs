// ============================================================
// Vigil Platform — Tests: /api/settings secret redaction
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// `GET /api/settings` เปิดให้ทุกคนที่ล็อกอิน (กันแต่การเขียน) — จนถึง 2026-08-12
// มันคืน `license_key` (Ed25519 JWT) และ `mapbox_token` เป็น plaintext ให้ viewer
// ซึ่งเป็น token ตัวเดียวกับที่ SEC-017 ตั้งใจไม่ส่งออกทาง `/api/config`

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { redactSettings, SECRET_SETTING_KEYS, PUBLIC_SETTING_KEYS } = require('../src/routes/settings');

const ROWS = [
  { key: 'nav_hidden_pages', value: '[]', description: null, updated_at: null },
  { key: 'brand_name',   value: 'Vision Meta Hub', description: null, updated_at: null },
  { key: 'license_key',  value: 'eyJhbGciOiJFZERTQSJ9.aaa.bbb', description: null, updated_at: null },
  { key: 'mapbox_token', value: 'pk.eyJ1IjoieCJ9.zzz', description: null, updated_at: null },
  { key: 'empty_secret', value: null, description: null, updated_at: null },
];

describe('redactSettings', () => {
  it('ผู้ใช้ทั่วไปได้เฉพาะ key ที่อยู่ใน allowlist — นอกนั้นไม่ส่งออกไปเลย', () => {
    const out = redactSettings(ROWS, false);
    assert.deepEqual(Object.keys(out), ['nav_hidden_pages'], 'key นอก allowlist ต้องไม่ติดมาด้วย');
    assert.equal(out.nav_hidden_pages.value, '[]');
    assert.ok(!('license_key' in out) && !('mapbox_token' in out) && !('brand_name' in out));
  });

  it('key ลับต้องไม่อยู่ใน allowlist (กันเผลอเติมวันหน้า)', () => {
    for (const k of SECRET_SETTING_KEYS) {
      assert.ok(!PUBLIC_SETTING_KEYS.has(k), `${k} ห้ามอยู่ใน PUBLIC_SETTING_KEYS`);
    }
  });

  it('ถ้ามีคนเผลอเติม key ลับลง allowlist จริง ค่ายังถูกปิดบังอยู่ดี (ชั้นที่สอง)', () => {
    PUBLIC_SETTING_KEYS.add('license_key');
    try {
      const out = redactSettings(ROWS, false);
      assert.ok(!String(out.license_key.value).includes('eyJ'));
      assert.equal(out.license_key.redacted, true);
    } finally { PUBLIC_SETTING_KEYS.delete('license_key'); }
  });

  it('admin / internal token เห็นครบทุก key และเป็นค่าจริง', () => {
    const out = redactSettings(ROWS, true);
    assert.equal(Object.keys(out).length, ROWS.length, 'หน้าตั้งค่าของ admin ต้องได้ครบเหมือนเดิม');
    assert.equal(out.license_key.value, 'eyJhbGciOiJFZERTQSJ9.aaa.bbb');
    assert.equal(out.mapbox_token.value, 'pk.eyJ1IjoieCJ9.zzz');
    assert.equal(out.license_key.redacted, undefined);
  });

  it('ค่าที่ยังไม่ได้ตั้ง (null) ไม่ถูกแปลงเป็นดาว — ไม่งั้นหน้าจอจะคิดว่ามีค่าแล้ว', () => {
    PUBLIC_SETTING_KEYS.add('license_key');
    try {
      const out = redactSettings([{ key: 'license_key', value: null }], false);
      assert.equal(out.license_key.value, null);
    } finally { PUBLIC_SETTING_KEYS.delete('license_key'); }
  });

  it('ทุก key ใน allowlist ต้องมีหน้าฝั่ง viewer อ่านจริง (ไม่ใช่เดาใส่)', () => {
    const fs = require('fs'), path = require('path');
    const DASH = path.join(__dirname, '..', 'dashboard');
    // ไม่นับหน้า Settings — เป็น admin-only อยู่แล้ว ถ้านับจะผ่านทุก key
    const ADMIN_ONLY = new Set(['page-system.js', 'page-lpr-settings.js', 'page-map-settings.js',
      'page-camera-settings.js', 'page-branding.js', 'page-categories.js',
      'page-integrations.js', 'page-user-mgmt.js']);
    const src = fs.readdirSync(DASH).filter(f => f.endsWith('.js') && !ADMIN_ONLY.has(f))
      .map(f => fs.readFileSync(path.join(DASH, f), 'utf8')).join('\n');
    for (const k of PUBLIC_SETTING_KEYS) {
      assert.ok(src.includes(k), `${k} อยู่ใน allowlist แต่ไม่มีหน้าไหนของ viewer อ่านเลย`);
    }
  });

  it('รายการ key ลับไม่ว่าง (กันโดนลบทิ้งโดยไม่ตั้งใจ)', () => {
    assert.ok(SECRET_SETTING_KEYS.has('license_key'));
    assert.ok(SECRET_SETTING_KEYS.has('mapbox_token'));
  });
});
