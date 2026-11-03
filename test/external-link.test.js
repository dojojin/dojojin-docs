// Vigil Platform — allowlist ปลายทางลิงก์ภายนอก (helpers/externalLink.js · migration 287)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTarget } = require('../src/helpers/externalLink');

test('allowed: Google Drive / Docs / OneDrive / 1drv / OneDrive for Business', () => {
  for (const [u, p] of [
    ['https://drive.google.com/file/d/1AbC/view?usp=sharing', 'gdrive'],
    ['https://docs.google.com/spreadsheets/d/1x/edit', 'gdrive'],
    ['https://onedrive.live.com/?id=ABC', 'onedrive'],
    ['https://1drv.ms/b/s!Abc', 'onedrive'],
    ['https://contoso-my.sharepoint.com/personal/a_b/Documents/x.pdf', 'onedrive'],
    ['https://DRIVE.GOOGLE.COM/file/d/1/view', 'gdrive'],          // ตัวพิมพ์ใหญ่ — URL ทำเป็นตัวเล็กให้
    ['https://drive.google.com:443/file/d/1/view', 'gdrive'],      // พอร์ตปริยาย = ไม่มีพอร์ต
  ]) {
    const r = normalizeTarget(u);
    assert.equal(r.ok, true, u);
    assert.equal(r.provider, p, u);
  }
  assert.equal(normalizeTarget('https://drive.google.com:443/x').url, 'https://drive.google.com/x');
  assert.equal(normalizeTarget('  https://drive.google.com/x  ').host, 'drive.google.com');
});

test('blocked: look-alikes, credentials, http, ports, other sharepoint, IPs', () => {
  for (const u of [
    'https://drive.google.com.evil.com/x',
    'https://evil.com/?u=drive.google.com',
    'https://evil.com/drive.google.com',
    'https://user@drive.google.com/x',
    'https://user:pw@drive.google.com/x',
    'https://drive.google.com@evil.com/x',
    'http://drive.google.com/x',
    'ftp://drive.google.com/x',
    'javascript:alert(1)',
    'https://drive.google.com./x',                       // จุดท้าย
    'https://drive.google.com:8443/x',
    'https://xn--drve-google-xyz.com/x',
    'https://drіve.google.com/x',                        // і ซีริลลิก → xn--
    'https://contoso.sharepoint.com/sites/x',
    'https://evil.contoso-my.sharepoint.com/x',
    'https://-my.sharepoint.com.evil.com/x',
    'https://sharepoint.com/x',
    'https://google.com/x',
    'https://142.250.0.1/x',
    'https://[::1]/x',
    '//drive.google.com/x',
    'drive.google.com/x',
    '',
    'https://drive.google.com/' + 'a'.repeat(2048),
  ]) assert.equal(normalizeTarget(u).ok, false, u);
  for (const v of [null, undefined, 42, {}, ['https://drive.google.com/x']]) assert.equal(normalizeTarget(v).ok, false);
  assert.match(normalizeTarget('http://drive.google.com/x').error, /https/);
});
