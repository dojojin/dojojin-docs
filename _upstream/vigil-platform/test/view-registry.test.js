// ============================================================
// Vigil Platform — Tests: view registry
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// เทสต์นี้ไม่ได้เช็คว่า "เขียน registry ครบไหม" แต่เช็คว่า `enforceable` ของแต่ละแท็บ
// **ตรงกับ endpoint ที่แท็บนั้นเรียกจริง** โดยเดินกราฟการเรียกฟังก์ชันใน dashboard/*.js
// — ค่าที่ติดธงด้วยมือแล้วผิด (บอกว่ากันได้ทั้งที่กันไม่ได้) จะทำให้แอดมินเข้าใจผิดว่า
// ปลอดภัยกว่าความจริง ซึ่งขัดกับเจตนาข้อ 2 ของเจ้าของ (กันคนร้ายที่ได้บัญชีไปแล้ว)
//
// ข้อจำกัดที่ยอมรับ: dashboard เป็น plain script ทั้งชุด (ไม่มี module system) จึงเดินกราฟ
// ด้วย heuristic — ตัดที่ความลึก 2 สำหรับ "endpoint ของแท็บตัวเอง" และ 3 สำหรับ "ของแท็บอื่น"
// ตั้งใจให้ฝั่งเปรียบเทียบกว้างกว่า เพราะพลาดไปทาง `enforceable: false` (กันได้แค่ UI)
// ไม่อันตราย แต่พลาดไปทาง true อันตราย

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const registry = require('../src/view-registry');

const DASH = path.join(__dirname, '..', 'dashboard');

// ── call graph ─────────────────────────────────────────────
// top-level function ในโค้ดชุดนี้ปิดด้วย `}` ที่คอลัมน์ 0 เสมอ — ใช้ตัด body ได้โดยไม่ต้อง parser
function buildIndex() {
  const fns = new Map();
  for (const f of fs.readdirSync(DASH).filter(n => n.endsWith('.js'))) {
    const lines = fs.readFileSync(path.join(DASH, f), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/) ||
                lines[i].match(/^(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(?[^=]*\)?\s*=>/);
      if (!m) continue;
      let j = i + 1;
      while (j < lines.length && !/^\}/.test(lines[j])) j++;
      fns.set(m[1], lines.slice(i, j + 1).join('\n'));
    }
  }
  return fns;
}

const SEG = '(?:\\$\\{[^}]*\\}|[A-Za-z0-9_\\-\\/.{}])';
function apiPaths(rawSrc) {
  // ตัด comment ก่อน — คอมเมนต์ในโค้ดชุดนี้อ้าง endpoint บ่อยมาก ("Backend: POST /api/services")
  // ถ้านับด้วยจะได้ allowlist ที่กว้างเกินจริงโดยไม่มีใครเรียกจริงสักที
  const src = rawSrc.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Set();
  for (const re of [new RegExp('\\/api\\/' + SEG + '*', 'g'),
                    new RegExp('\\/(?:snapshots|media)\\/' + SEG + '*', 'g')]) {
    for (const m of src.matchAll(re)) {
      const p = m[0].replace(/\$\{[^}]*\}/g, ':p').replace(/[?&].*$/, '')
        .replace(/[/.]+$/, '').replace(/([^/]):p$/, '$1');
      if (p.length > 5) out.add(p);
    }
  }
  return out;
}

// path ที่ดึงจากโค้ดอาจเป็น `:p` (มาจาก `${fmt}`) ส่วนที่ประกาศไว้อาจเจาะจง (`/pdf`)
// — ถือว่าครอบถ้า segment เท่ากันและทุกช่องตรงกันหรือมีฝั่งใดฝั่งหนึ่งเป็น `:p`
function covered(patterns, found) {
  const f = found.split('/');
  return patterns.some(p => {
    const a = p.split('/');
    return a.length === f.length && a.every((seg, i) => seg === f[i] || seg === ':p' || f[i] === ':p');
  });
}

function reachable(fns, entries, maxDepth) {
  const seen = new Set(), apis = new Set();
  const queue = entries.filter(Boolean).map(e => [e, 0]);
  while (queue.length) {
    const [name, d] = queue.shift();
    if (seen.has(name) || d > maxDepth) continue;
    seen.add(name);
    const body = fns.get(name);
    if (!body) continue;
    for (const a of apiPaths(body)) apis.add(a);
    for (const m of body.matchAll(/\b([A-Za-z0-9_$]+)\s*\(/g)) {
      if (fns.has(m[1]) && !seen.has(m[1])) queue.push([m[1], d + 1]);
    }
  }
  return apis;
}

const FNS = buildIndex();

describe('view-registry — โครงสร้าง', () => {
  it('key ไม่ซ้ำ', () => {
    const keys = registry.allKeys();
    assert.equal(keys.length, new Set(keys).size);
  });

  it('ทุก entry ที่ประกาศไว้มีอยู่จริงใน dashboard/*.js', () => {
    const missing = [];
    for (const v of registry.VIEWS) {
      for (const e of v.entries || []) if (!FNS.has(e)) missing.push(`${v.key} → ${e}`);
      for (const t of v.tabs || []) if (t.entry && !FNS.has(t.entry)) missing.push(`${v.key}:${t.key} → ${t.entry}`);
    }
    assert.deepEqual(missing, [], 'entry ที่หายไป (ฟังก์ชันถูกเปลี่ยนชื่อ/ลบ?)');
  });

  it('parent ที่อ้างถึงมีอยู่จริง · alias ชี้ไปหน้าที่ลงทะเบียนแล้ว', () => {
    for (const v of registry.VIEWS) if (v.parent) assert.ok(registry.get(v.parent), v.key);
    for (const [from, to] of Object.entries(registry.PAGE_ALIASES)) {
      assert.ok(registry.get(to), `alias ${from} → ${to}`);
      assert.equal(registry.get(from), null, `${from} ต้องไม่ถูกลงทะเบียนซ้ำกับ alias`);
    }
  });

  it('clientRegistry ไม่หลุด routes/entries ออกไปฝั่ง client', () => {
    const json = JSON.stringify(registry.clientRegistry());
    assert.ok(!json.includes('/api/'), 'ห้ามมี route path ใน payload ที่ส่งให้ client');
    assert.ok(!json.includes('entries'));
  });

  it('/api/views อยู่ใน CORE_ROUTES', () => {
    // ถ้าไม่อยู่ user ที่ถูกจำกัดจะโดน default-deny ตัวเอง จนไม่มีเมนูอะไรเลย
    assert.ok(registry.CORE_ROUTES.includes('/api/views'));
  });
});

describe('view-registry — enforceable คำนวณจาก endpoint จริง', () => {
  for (const page of registry.VIEWS.filter(v => v.tabs && v.tabs.length)) {
    it(`${page.key}: ธง enforceable ตรงกับที่คำนวณได้`, () => {
      const own = {}, wide = {};
      for (const t of page.tabs) {
        own[t.key]  = reachable(FNS, [t.entry], 2);
        wide[t.key] = reachable(FNS, [t.entry], 3);
      }
      for (const t of page.tabs) {
        const others = new Set();
        for (const o of page.tabs) if (o.key !== t.key) for (const a of wide[o.key]) others.add(a);
        const clash = [...own[t.key]].filter(a => others.has(a));
        const computed = own[t.key].size > 0 && clash.length === 0;
        assert.equal(t.enforceable, computed,
          `${page.key}:${t.key} — endpoint ของตัวเอง [${[...own[t.key]]}] ` +
          `ชนกับแท็บอื่น [${clash}]`);
      }
    });

    it(`${page.key}: แท็บ enforceable ประกาศ routes ครบตามที่เรียกจริง`, () => {
      for (const t of page.tabs.filter(t => t.enforceable)) {
        const granted = registry.routesFor([`${page.key}:${t.key}`]);
        for (const a of reachable(FNS, [t.entry], 2)) {
          assert.ok(granted.includes(a),
            `${page.key}:${t.key} เรียก ${a} แต่ไม่ได้ประกาศใน routes → P4 จะ 403 ใส่ตัวเอง`);
        }
      }
    });
  }
});

describe('view-registry — routes ครอบ endpoint ที่หน้านั้นเรียกตอนเปิด', () => {
  for (const page of registry.VIEWS.filter(v => (v.entries || []).length)) {
    it(page.key, () => {
      const granted = registry.routesFor([page.key]);
      const missing = [...reachable(FNS, page.entries, 2)].filter(a => !covered(granted, a));
      assert.deepEqual(missing, [],
        `หน้า ${page.key} เรียก endpoint ที่ไม่ได้อยู่ใน allowlist ของตัวเอง`);
    });
  }
});

describe('view-registry — routesFor semantics', () => {
  it('แท็บที่กันได้จริง ให้เฉพาะ route ของตัวเอง ไม่พ่วง route ของหน้า', () => {
    const r = registry.routesFor(['traffic:helmet']);
    assert.ok(r.includes('/api/traffic/helmet-series'));
    assert.ok(!r.includes('/api/traffic/enforcement'), 'สมชายต้องไม่ได้ข้อมูลแท็บอื่น');
  });

  it('แท็บ ui-only ต้องพ่วง route ของหน้า ไม่งั้นโหลดไม่ขึ้น', () => {
    assert.ok(registry.routesFor(['lpr:search']).includes('/api/lpr'));
  });

  it('ให้ทั้งหน้า = ได้ route ของทุกแท็บด้วย', () => {
    const r = registry.routesFor(['traffic']);
    assert.ok(r.includes('/api/traffic/enforcement') && r.includes('/api/traffic/helmet-series'));
  });

  it('key ที่ไม่รู้จักไม่ให้สิทธิ์อะไรเกิน CORE', () => {
    assert.deepEqual(registry.routesFor(['ไม่มีจริง']).sort(), [...registry.CORE_ROUTES].sort());
  });

  it('ไม่มีสิทธิ์เลย ([]) ยังได้ CORE เพื่อ logout/เปลี่ยนรหัสได้', () => {
    assert.ok(registry.routesFor([]).includes('/api/auth/logout'));
  });
});

describe('view-registry — matches() ต้องเทียบทีละ segment ห้าม prefix', () => {
  const { matches, pathAllowed } = registry;

  it('prefix ไม่นับว่าตรง — ไม่งั้น CORE /api/cameras แจก status-log ให้ทุกคน', () => {
    assert.ok(matches('/api/cameras', '/api/cameras'));
    assert.ok(!matches('/api/cameras', '/api/cameras/status-log'));
    assert.ok(!matches('/api/cameras', '/api/cameras/status-current'));
    // ผลลัพธ์จริงที่ต้องได้: แท็บ history:camera-status ยังเป็น boundary จริง
    assert.ok(!pathAllowed(registry.CORE_ROUTES, '/api/cameras/status-log'));
  });

  it(':p กิน 1 segment ไม่กินข้าม /', () => {
    assert.ok(matches('/api/users/:p', '/api/users/42'));
    assert.ok(!matches('/api/users/:p', '/api/users/42/reset-password'));
    assert.ok(!matches('/api/users/:p', '/api/users'));
    assert.ok(!matches('/api/users/:p', '/api/users/'), 'segment ว่างไม่นับ');
  });

  it('query string ไม่ทำให้ไม่ตรง', () => {
    assert.ok(matches('/api/traffic/helmet-series', '/api/traffic/helmet-series?date=2026-08-11'));
  });

  it('map tile ของจริงยิงผ่าน pattern ที่ประกาศไว้', () => {
    assert.ok(pathAllowed(registry.routesFor(['map']), '/api/map/tiles/mapbox/light/12/3200/1400.png'));
  });

  it('ไม่มี pattern ไหนที่เผลอกลายเป็น prefix ของตัวเอง (ยกเว้น `**` ที่ตั้งใจ)', () => {
    for (const p of registry.routesFor(registry.allKeys())) {
      if (p.endsWith('/**')) continue;
      assert.ok(!matches(p, p + '/x'), `${p} ไม่ควรตรงกับ path ที่ยาวกว่า`);
    }
  });

  it('`/**` กินได้หลาย segment แต่ต้องมีอย่างน้อย 1 และตรง prefix จริง', () => {
    assert.ok(matches('/snapshots/**', '/snapshots/events/2026-08-11/cam1/1/a.jpg'));
    assert.ok(matches('/snapshots/**', '/snapshots/preview/cam1.jpg'));
    assert.ok(!matches('/snapshots/**', '/snapshots'), 'ต้องมีอย่างน้อย 1 segment');
    assert.ok(!matches('/snapshots/**', '/snapshot/x.jpg'), 'prefix ต้องตรงเป๊ะ');
    assert.ok(!matches('/snapshots/**', '/media/x.mp4'));
  });
});

// route pattern ที่พิมพ์ผิดจะเงียบมาก — P4 เป็น default-deny ผู้ใช้จะเจอ 403 บนฟีเจอร์
// ที่ควรใช้ได้ โดยไม่มี error ที่ไหนเลย → เทียบกับ route ที่ express ลงทะเบียนไว้จริง
describe('view-registry — ทุก route ที่ประกาศมีอยู่จริงใน express', () => {
  function expressRoutes() {
    const SRC = path.join(__dirname, '..', 'src');
    const files = [
      ...fs.readdirSync(SRC).filter(f => f.endsWith('.js')).map(f => path.join(SRC, f)),
      ...fs.readdirSync(path.join(SRC, 'routes')).map(f => path.join(SRC, 'routes', f)),
    ];
    const out = new Set();
    for (const f of files) {
      const s = fs.readFileSync(f, 'utf8');
      for (const m of s.matchAll(/\b(?:app|router)\.(?:get|post|put|patch|delete|all|use)\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
        // `/:y.png` → `:p` — ตัวสุดท้ายของ route tile มีนามสกุลติดมากับ param
        out.add(m[1].replace(/:[A-Za-z0-9_]+/g, ':p').replace(/:p\.\w+$/, ':p').replace(/\/+$/, ''));
      }
    }
    return out;
  }

  it('ไม่มี route กำพร้าใน registry', () => {
    const express = expressRoutes();
    const declared = new Set(registry.routesFor(registry.allKeys()));
    // `/**` เทียบแบบ prefix — จุดประสงค์ของเทสต์คือจับ "พิมพ์ผิด / ถูกลบไปแล้ว"
    // ไม่ใช่บังคับให้ทุก pattern เป็น path ตรงตัว · ก่อนหน้านี้ทุก `/**` เป็น
    // /snapshots/** ซึ่งหลุดตัวกรอง startsWith('/api/') ไปโดยบังเอิญ พอมี
    // /api/traffic/helmet-top/** เข้ามาเทสต์เลยฟ้องผิด ทั้งที่ registry ถูกแล้ว
    const alive = (r) => {
      if (!r.endsWith('/**')) return express.has(r);
      const prefix = r.slice(0, -2);            // '/api/x/**' → '/api/x/'
      return [...express].some(e => e.startsWith(prefix) && e.length > prefix.length);
    };
    const orphans = [...declared].filter(r => r.startsWith('/api/') && !alive(r));
    assert.deepEqual(orphans, [], 'route ที่ประกาศไว้แต่ไม่มีใน express (พิมพ์ผิด? ถูกลบไปแล้ว?)');
  });

  it('`/**` ที่ชี้ไปยัง prefix ที่ไม่มีอะไรอยู่เลย ต้องถูกจับได้', () => {
    const express = expressRoutes();
    const prefix = '/api/ไม่มีจริง/';
    assert.ok(![...express].some(e => e.startsWith(prefix)),
      'เทสต์นี้จะไร้ความหมายถ้ามี route ขึ้นต้นแบบนี้จริง');
  });
});

// ชนิดข้อความ WS ที่ไม่มีใน WS_TYPE_ROUTE จะเงียบหายไปสำหรับผู้ใช้ที่ถูกจำกัดสิทธิ์
// (fail closed — ปลอดภัย แต่ผู้ใช้จะไม่รู้ว่าทำไมหน้าไม่อัปเดต) เทสต์นี้ทำให้เห็นตอนเพิ่มชนิดใหม่
describe('view-registry — WS_TYPE_ROUTE ครบตามชนิดที่ broadcast() ส่งจริง', () => {
  it('ทุกชนิดที่มีในโค้ดถูก map ไว้ และ route ตัวแทนต้องมีจริงใน registry', () => {
    const SRC = path.join(__dirname, '..', 'src');
    const files = [
      ...fs.readdirSync(SRC).filter(f => f.endsWith('.js')).map(f => path.join(SRC, f)),
      ...fs.readdirSync(path.join(SRC, 'routes')).map(f => path.join(SRC, 'routes', f)),
    ];
    const types = new Set();
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/broadcast\(\s*\{[^}]*type:\s*'([a-z_]+)'/g)) types.add(m[1]);
    }
    assert.ok(types.size >= 4, `หาชนิดข้อความไม่เจอ (${types.size}) — regex เพี้ยน?`);
    const unmapped = [...types].filter(t => !registry.WS_TYPE_ROUTE[t]);
    assert.deepEqual(unmapped, [], 'ชนิดข้อความ WS ที่ยังไม่ได้ map');

    const all = new Set(registry.routesFor(registry.allKeys()));
    for (const [t, r] of Object.entries(registry.WS_TYPE_ROUTE)) {
      assert.ok(all.has(r), `${t} → ${r} ไม่มีใน route ของ view ไหนเลย = ไม่มีใครได้รับข้อความชนิดนี้`);
    }
  });
});

// 2026-09-08: `/api/stats/kpi` ไม่ได้อยู่ใน view ไหนเลยตั้งแต่ต้น ⇒ บัญชีที่ถูกจำกัด
// ยิงแล้วได้ 403 VIEW_NOT_ALLOWED เงียบ ๆ (แดชบอร์ดไม่เรียก endpoint นี้ ผู้ใช้จริง
// คือแอปมือถือ จึงไม่มีใครสังเกตเห็น) · เจอตอนตรวจสิทธิ์ auditor
describe('endpoint ที่มีแต่แอปมือถือเรียก ต้องอยู่ใน view ด้วย', () => {
  it('viewer ที่ได้ "สถิติ" หรือ "สรุปภาพรวม" ยิง /api/stats/kpi ได้', () => {
    for (const key of ['stats', 'summary']) {
      assert.ok(registry.pathAllowed(registry.routesFor([key]), '/api/stats/kpi'),
        `view ${key} ต้องเข้าถึง /api/stats/kpi ได้`);
    }
  });

  it('view ที่ไม่เกี่ยวยังเข้าไม่ได้ — ไม่ได้เปิดกว้างเกินจำเป็น', () => {
    assert.equal(registry.pathAllowed(registry.routesFor(['map']), '/api/stats/kpi'), false);
  });
});
