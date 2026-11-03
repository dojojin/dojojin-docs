// ============================================================
// Vigil Platform — Routes: Blacklist sources (connections + import engine)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
//
// แยกออกจาก routes/blacklist-sources.js — route ทั้งหมดในไฟล์นี้ยังลงทะเบียนที่
// ตำแหน่งเดิมเป๊ะ (ลำดับการลงทะเบียนคือพฤติกรรม) โดยไฟล์แม่เรียก factory นี้เป็น
// คำสั่งแรกของตัวเอง — ตัวล้าง last_import_status ค้างตอนบูต และตัวตั้งเวลา
// auto-sync อยู่ในไฟล์นี้ จึงต้องทำงานที่จังหวะเดิมของลำดับการบูต
'use strict';

const https = require('https');
const { edgeProxyBaseUrl } = require('../helpers/edgeProxyBaseUrl');
const { encryptPii, decryptPii } = require('../helpers/blacklist-crypto');
const { runImport } = require('../helpers/blacklistImport');
const { buildPushDiff, pushToSource } = require('../helpers/blacklistPush');
const { pollGsAlarms } = require('../helpers/gsAlarmPoll');

// Fields that must be encrypted at rest and never echoed back to the browser.
const SECRET_FIELDS = new Set(['password', 'apiKey', 'appSecret']);

function encryptConfig(config, prev) {
  const out = { ...(config || {}) };
  for (const k of Object.keys(out)) {
    if (!SECRET_FIELDS.has(k)) continue;
    // Blank / mask means "keep what's already stored" — the edit form never
    // receives the real secret, so a blank field must not wipe it.
    if (out[k] === '' || out[k] === '***' || out[k] == null) {
      if (prev && prev[k]) out[k] = prev[k]; else delete out[k];
    } else if (!String(out[k]).startsWith('enc:v1:')) {
      out[k] = encryptPii(String(out[k]));
    }
  }
  return out;
}

function redactConfig(config) {
  const out = { ...(config || {}) };
  for (const k of Object.keys(out)) {
    if (SECRET_FIELDS.has(k)) out[k] = out[k] ? '***' : '';
  }
  return out;
}

function decryptConfig(config) {
  const out = { ...(config || {}) };
  for (const k of Object.keys(out)) {
    if (SECRET_FIELDS.has(k) && out[k]) {
      try { out[k] = decryptPii(String(out[k])); } catch { /* leave as-is; call will fail loudly */ }
    }
  }
  return out;
}

module.exports = function registerSourcesAndImport(app, pool) {

  // ---------- test connection (proxied through the site's edge) ----------
  app.post('/api/blacklist/sources/test-connection', async (req, res) => {
    try {
      const { source, site_code, config, dataType, source_id } = req.body || {};
      if (!source || !site_code) return res.status(400).json({ error: 'source and site_code required' });

      const { rows } = await pool.query('SELECT code FROM sites WHERE code = $1', [site_code]);
      if (!rows[0]) return res.status(404).json({ error: 'unknown site_code' });

      // Testing a SAVED connection: the browser never holds the secret, so fall
      // back to the stored (encrypted) one when the form field came in blank.
      let effectiveConfig = { ...(config || {}) };
      if (source_id) {
        const s = await pool.query('SELECT config FROM blacklist.sources WHERE id = $1', [source_id]);
        if (s.rows[0]) {
          const stored = decryptConfig(s.rows[0].config || {});
          for (const k of SECRET_FIELDS) {
            if (!effectiveConfig[k] || effectiveConfig[k] === '***') {
              if (stored[k]) effectiveConfig[k] = stored[k];
            }
          }
        }
      }

      const secret = process.env.SNAPSHOT_PROXY_SECRET || '';
      if (!secret) return res.status(500).json({ error: 'SNAPSHOT_PROXY_SECRET not configured' });
      const edgeUrl = edgeProxyBaseUrl(site_code, process.env.SNAPSHOT_PROXY_DOMAIN || 'dojojin.tech');

      const body = JSON.stringify({ source, config: effectiveConfig, dataType });
      const result = await new Promise((resolve, reject) => {
        const preq = https.request(`${edgeUrl}/blacklist-source-test`, {
          method: 'POST', timeout: 30000, agent: false,   // see edgeFetch: stale keepAlive socket => instant CF 502
          headers: {
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        }, (pr) => {
          let data = ''; pr.on('data', d => data += d);
          pr.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('bad edge response')); } });
        });
        preq.on('error', reject);
        preq.on('timeout', () => preq.destroy(new Error('timeout')));
        preq.write(body);
        preq.end();
      });
      res.json(result);
    } catch (e) {
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  // ---------- capability discovery ----------
  // Ask the source what it holds before importing. Exists because the settings
  // page had DSS Pro marked face-only while the same server also served 516
  // blocklisted vehicles — a capability nobody had asked it about.
  app.post('/api/blacklist/sources/discover', async (req, res) => {
    try {
      const { source, site_code, config, source_id } = req.body || {};
      if (!source || !site_code) return res.status(400).json({ error: 'source and site_code required' });
      const sc = await pool.query('SELECT code FROM sites WHERE code = $1', [site_code]);
      if (!sc.rows[0]) return res.status(404).json({ error: 'unknown site_code' });

      let effective = { ...(config || {}) };
      if (source_id) {
        const st = await pool.query('SELECT config FROM blacklist.sources WHERE id = $1', [source_id]);
        if (st.rows[0]) {
          const stored = decryptConfig(st.rows[0].config || {});
          for (const k of SECRET_FIELDS) {
            if (!effective[k] || effective[k] === '***') { if (stored[k]) effective[k] = stored[k]; }
          }
        }
      }

      const secret = process.env.SNAPSHOT_PROXY_SECRET || '';
      if (!secret) return res.status(500).json({ error: 'SNAPSHOT_PROXY_SECRET not configured' });
      const edgeUrl = edgeProxyBaseUrl(site_code, process.env.SNAPSHOT_PROXY_DOMAIN || 'dojojin.tech');
      const body = JSON.stringify({ source, config: effective });
      const result = await new Promise((resolve, reject) => {
        const preq = https.request(`${edgeUrl}/blacklist-source-discover`, {
          method: 'POST', timeout: 60000, agent: false,
          headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        }, (pr) => {
          let d = ''; pr.on('data', x => d += x);
          pr.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('bad edge response')); } });
        });
        preq.on('error', reject);
        preq.on('timeout', () => preq.destroy(new Error('timeout')));
        preq.write(body); preq.end();
      });
      res.json(result);
    } catch (e) { res.status(502).json({ error: e.message }); }
  });

  // ---------- connection instances (CRUD) ----------
  app.get('/api/blacklist/sources', async (req, res) => {
    try {
      // Per-type counts, not just a total: the operator is about to be asked
      // "you removed LPR — what about the 516 rows already imported?", and that
      // question cannot be asked without knowing the number. type_counts also
      // reveals orphans (a type with rows that is in neither data_types nor
      // kept_types), which is how a connection can show 1,473 records while
      // being set to face-only.
      const { rows } = await pool.query(`
        SELECT s.*,
               (SELECT COUNT(*) FROM blacklist.source_records r WHERE r.source_id = s.id) AS record_count,
               COALESCE((SELECT jsonb_object_agg(t.data_type, t.n)
                           FROM (SELECT data_type, COUNT(*) n FROM blacklist.source_records
                                  WHERE source_id = s.id GROUP BY data_type) t), '{}'::jsonb) AS type_counts
        FROM blacklist.sources s ORDER BY s.id`);
      res.json(rows.map(r => {
        const counts = r.type_counts || {};
        const live = new Set([...(r.data_types || []), ...(r.kept_types || [])]);
        return {
          ...r,
          config: redactConfig(r.config),
          record_count: Number(r.record_count),
          type_counts: counts,
          orphan_types: Object.keys(counts).filter(t => !live.has(t)),
        };
      }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/blacklist/sources', async (req, res) => {
    try {
      const { source_type, label, site_code, data_types, config, active } = req.body || {};
      if (!source_type || !label) return res.status(400).json({ error: 'source_type and label required' });
      const { rows } = await pool.query(`
        INSERT INTO blacklist.sources (source_type, label, site_code, data_types, config, active)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [source_type, label, site_code || null, data_types || [],
         JSON.stringify(encryptConfig(config)), active !== false]);
      res.json({ ...rows[0], config: redactConfig(rows[0].config) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // PATCH semantics: only columns actually PRESENT in the body are touched.
  // The previous version assigned site_code and config unconditionally, so a
  // partial update — e.g. sending just {data_types} — silently wiped the site
  // code AND every stored credential. Losing a connection's password because
  // you toggled a checkbox is not an acceptable failure mode.
  app.put('/api/blacklist/sources/:id', async (req, res) => {
    try {
      const prev = await pool.query('SELECT * FROM blacklist.sources WHERE id = $1', [req.params.id]);
      if (!prev.rows[0]) return res.status(404).json({ error: 'not found' });
      const b = req.body || {};
      const sets = [], vals = [req.params.id];
      const set = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };

      if ('source_type' in b) set('source_type', b.source_type);
      if ('label' in b)       set('label', b.label);
      if ('site_code' in b)   set('site_code', b.site_code || null);
      // Deselecting a type used to leave its rows behind silently. The caller
      // now says what should happen to them, and the answer is applied in the
      // same request so there is no window where the choice is half-applied:
      //   'hide'   (default) — rows stay, become invisible. Reversible.
      //   'keep'   — rows stay visible via kept_types, as if still imported.
      //   'delete' — rows are removed. Guarded by a typed confirmation below.
      if ('data_types' in b) {
        const before = prev.rows[0].data_types || [];
        const after  = b.data_types || [];
        const removed = before.filter(t => !after.includes(t));
        const action = b.orphan_action || 'hide';
        const kept = new Set(prev.rows[0].kept_types || []);
        // A type that is selected again is no longer "kept despite removal".
        after.forEach(t => kept.delete(t));

        if (removed.length) {
          if (action === 'delete') {
            if (b.confirm !== 'CONFIRM') {
              return res.status(400).json({ error: 'ต้องพิมพ์ CONFIRM เพื่อยืนยันการลบข้อมูลถาวร' });
            }
            const del = await pool.query(
              `DELETE FROM blacklist.source_records WHERE source_id = $1 AND data_type = ANY($2)`,
              [req.params.id, removed]);
            await pool.query(`DELETE FROM blacklist.master m
              WHERE NOT EXISTS (SELECT 1 FROM blacklist.master_links l WHERE l.master_id = m.id)`);
            await pool.query(
              `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
              [req.user?.id || null, req.user?.username || 'unknown', 'blacklist_records_deleted',
               JSON.stringify({ source_id: Number(req.params.id), types: removed, deleted: del.rowCount })]
            ).catch(() => {});
            removed.forEach(t => kept.delete(t));
          } else if (action === 'keep') {
            removed.forEach(t => kept.add(t));
          } else {
            removed.forEach(t => kept.delete(t));   // hide
          }
        }
        set('data_types', after);
        set('kept_types', Array.from(kept));
      }
      if ('active' in b)      set('active', !!b.active);
      if ('alarm_enabled' in b) set('alarm_enabled', !!b.alarm_enabled);
      // Clamped, not validated-and-rejected: the field is a dropdown, and a
      // nonsense number from a hand-rolled call should land on "off" rather
      // than schedule an import every few seconds against a police system.
      // migration 148 — เก็บเป็นนาที · ยังรับคีย์เก่าเป็นชั่วโมงไว้เผื่อผู้เรียกเก่า
      if ('pull_interval_minutes' in b || 'pull_interval_hours' in b) {
        const m = ('pull_interval_minutes' in b)
          ? Number(b.pull_interval_minutes)
          : Number(b.pull_interval_hours) * 60;
        // เพดาน 7 วัน (10,080 นาที) เท่าเดิม · พื้น 5 นาที = คาบของตัวจับเวลา
        // ตั้งต่ำกว่านั้นไม่ได้ถี่ขึ้นจริง แต่ทำให้คนเข้าใจผิดว่าจะได้
        const v = Number.isFinite(m) ? Math.max(0, Math.min(10080, Math.round(m))) : 0;
        set('pull_interval_minutes', v === 0 ? 0 : Math.max(5, v));
      }
      // Only rewrite config when the caller actually sent one; encryptConfig
      // still carries forward any secret left blank in the form.
      if ('config' in b)      set('config', JSON.stringify(encryptConfig(b.config, prev.rows[0].config)));

      if (!sets.length) return res.json({ ...prev.rows[0], config: redactConfig(prev.rows[0].config) });
      sets.push('updated_at = NOW()');
      const { rows } = await pool.query(
        `UPDATE blacklist.sources SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals);
      res.json({ ...rows[0], config: redactConfig(rows[0].config) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/blacklist/sources/:id', async (req, res) => {
    try {
      const prev = await pool.query('SELECT label FROM blacklist.sources WHERE id = $1', [req.params.id]);
      if (!prev.rows[0]) return res.status(404).json({ error: 'not found' });
      const keep = req.query.keep === '1' || req.body?.keep === true;

      // Deleting a connection used to take its imported rows with it, with one
      // yes/no prompt and no way to say "disconnect but keep what we already
      // have". For watch-list data that can carry evidentiary weight, losing
      // 1,084 records to a mis-click is not an acceptable failure mode, so the
      // caller now chooses — and destroying data needs a typed confirmation,
      // the same bar as deleting records on a type change.
      if (!keep && req.body?.confirm !== 'CONFIRM') {
        return res.status(400).json({ error: 'ต้องพิมพ์ CONFIRM เพื่อยืนยันการลบข้อมูลถาวร (หรือส่ง keep=1 เพื่อเก็บข้อมูลไว้)' });
      }

      if (keep) {
        // Detach: the rows outlive the connection. source_id has ON DELETE
        // CASCADE, so the row must be orphan-proofed BEFORE the source goes —
        // it is moved to a tombstone source that imports nothing, which means
        // the visibility rule hides it unless kept_types says otherwise.
        const t = await pool.query(
          `INSERT INTO blacklist.sources (source_type, label, site_code, data_types, kept_types, config, active)
           SELECT 'archived', label || ' (เก็บไว้หลังลบการเชื่อมต่อ)', site_code,
                  '{}'::text[],
                  ARRAY(SELECT DISTINCT data_type FROM blacklist.source_records WHERE source_id = $1),
                  '{}'::jsonb, FALSE
             FROM blacklist.sources WHERE id = $1 RETURNING id`, [req.params.id]);
        await pool.query('UPDATE blacklist.source_records SET source_id = $1 WHERE source_id = $2',
          [t.rows[0].id, req.params.id]);
      }

      await pool.query('DELETE FROM blacklist.sources WHERE id = $1', [req.params.id]);
      await pool.query(`DELETE FROM blacklist.master m
        WHERE NOT EXISTS (SELECT 1 FROM blacklist.master_links l WHERE l.master_id = m.id)`);
      await pool.query(
        `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
        [req.user?.id || null, req.user?.username || 'unknown', 'blacklist_source_deleted',
         JSON.stringify({ source_id: Number(req.params.id), label: prev.rows[0].label, kept_records: !!keep })]
      ).catch(() => {});
      res.json({ ok: true, kept_records: !!keep });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- orphaned data (types no longer imported) ----------
  // Surfaced as a panel in the connection's own settings rather than only as a
  // prompt at the moment of change: the prompt is easy to dismiss and then the
  // rows sit hidden with nothing to show they exist. This is where an operator
  // can see "LPR — 516 rows, no longer imported" at any time and decide.
  //   keep   → the rows become visible again (kept_types)
  //   delete → the rows are destroyed, and that needs CONFIRM typed out
  app.post('/api/blacklist/sources/:id/orphans', async (req, res) => {
    try {
      const { action, data_type } = req.body || {};
      if (!data_type) return res.status(400).json({ error: 'ต้องระบุ data_type' });
      const prev = await pool.query('SELECT * FROM blacklist.sources WHERE id = $1', [req.params.id]);
      if (!prev.rows[0]) return res.status(404).json({ error: 'not found' });

      const trace = (act) => pool.query(
        `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
        [req.user?.id || null, req.user?.username || 'unknown', 'blacklist_records_visibility',
         JSON.stringify({ source_id: Number(req.params.id), data_type, action: act })]
      ).catch(() => {});

      if (action === 'keep') {
        const kept = new Set(prev.rows[0].kept_types || []);
        kept.add(data_type);
        await pool.query('UPDATE blacklist.sources SET kept_types = $2, updated_at = NOW() WHERE id = $1',
          [req.params.id, Array.from(kept)]);
        await trace('keep');
        return res.json({ ok: true, action: 'keep', data_type });
      }

      if (action === 'hide') {
        const kept = (prev.rows[0].kept_types || []).filter(t => t !== data_type);
        await pool.query('UPDATE blacklist.sources SET kept_types = $2, updated_at = NOW() WHERE id = $1',
          [req.params.id, kept]);
        await trace('hide');
        return res.json({ ok: true, action: 'hide', data_type });
      }

      if (action === 'delete') {
        if (req.body.confirm !== 'CONFIRM') {
          return res.status(400).json({ error: 'ต้องพิมพ์ CONFIRM เพื่อยืนยันการลบข้อมูลถาวร' });
        }
        const del = await pool.query(
          'DELETE FROM blacklist.source_records WHERE source_id = $1 AND data_type = $2',
          [req.params.id, data_type]);
        await pool.query(`DELETE FROM blacklist.master m
          WHERE NOT EXISTS (SELECT 1 FROM blacklist.master_links l WHERE l.master_id = m.id)`);
        const kept = (prev.rows[0].kept_types || []).filter(t => t !== data_type);
        await pool.query('UPDATE blacklist.sources SET kept_types = $2, updated_at = NOW() WHERE id = $1',
          [req.params.id, kept]);
        await pool.query(
          `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
          [req.user?.id || null, req.user?.username || 'unknown', 'blacklist_records_deleted',
           JSON.stringify({ source_id: Number(req.params.id), data_type, deleted: del.rowCount })]
        ).catch(() => {});
        return res.json({ ok: true, action: 'delete', data_type, deleted: del.rowCount });
      }

      res.status(400).json({ error: 'action ต้องเป็น keep | hide | delete' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ---------- run an import ----------
  // Import runs in the BACKGROUND and this replies 202 immediately.
  //
  // It used to await runImport and return the result, which worked while the
  // datasets were small. GuruSquare walks one HTTP round trip per calendar month
  // — 43 windows at ~4.4s measured 2026-07-27, so 75-190s depending on volume —
  // and Cloudflare cuts the connection at ~100s and answers with its own HTML
  // error page. The browser then tried to JSON.parse "<!DOCTYPE" and reported
  // "Import failed" for an import that was still running and would succeed.
  //
  // Progress is reported the way it already was: last_import_status on the source
  // row, which the page polls. 'running' is written before the reply so a second
  // click cannot start a parallel run, and the finally block always clears the
  // in-flight marker — otherwise an api-server restart mid-import leaves the
  // button stuck on "importing" for ever (which happened, 2026-07-27 17:15).
  // A 'running' row only means something while the process that set it is alive.
  // If api-server restarts mid-import — a deploy, a crash, an operator — the row
  // keeps saying running for ever and the page polls a job nobody is doing.
  // Clearing it at boot is correct precisely because _importRunning is in-memory:
  // if this process just started, nothing it knows about is running.
  pool.query(
    `UPDATE blacklist.sources SET last_import_status = 'error',
            last_import_note = COALESCE(last_import_note,'') || ' (ถูกขัดจังหวะ — เซิร์ฟเวอร์รีสตาร์ท)'
      WHERE last_import_status = 'running'`)
    .then(r => { if (r.rowCount) console.warn(`[blacklist-import] cleared ${r.rowCount} stale 'running' row(s) at boot`); })
    .catch(e => console.error('[blacklist-import] stale-running cleanup:', e.message));

  // One in-memory Set, one starter. The scheduler and the button must share
  // both: a second Set would let an auto-pull start while a manual import is
  // mid-flight, and a GuruSquare run is 75-190s of interleaved status writes
  // and doubled edge load against the same source.
  const _importRunning = new Set();

  async function startImport(id, opts = {}, actor = {}) {
    // Claim the slot BEFORE the first await. Node is single-threaded but an
    // await is a yield point: with the SELECT in between, two requests that
    // arrive together both saw an empty Set and both started a run against the
    // same source. The claim and the check must be one synchronous step.
    if (_importRunning.has(String(id))) { const e = new Error('import_already_running'); e.code = 'running'; throw e; }
    _importRunning.add(String(id));

    let rows;
    try {
      ({ rows } = await pool.query('SELECT * FROM blacklist.sources WHERE id = $1', [id]));
      if (!rows[0]) { const e = new Error('not found'); e.code = 'not_found'; throw e; }
    } catch (e) {
      _importRunning.delete(String(id));   // never hold a slot we did not start
      throw e;
    }
    const source = rows[0];
    // Secrets are decrypted here and passed per-call — source.config still holds
    // them encrypted, so nothing downstream sees the plaintext except the one
    // outbound request that needs it.
    const cfg = decryptConfig(source.config || {});

    await pool.query(
      `UPDATE blacklist.sources SET last_import_status = 'running', last_import_note = $2
        WHERE id = $1`, [id, opts.auto ? 'กำลังนำเข้าอัตโนมัติ…' : 'กำลังนำเข้า…']).catch(() => {});
    // Stamped at START, not at finish: an import that runs longer than its own
    // interval would otherwise be due again the moment it completes.
    if (opts.auto) {
      await pool.query('UPDATE blacklist.sources SET last_auto_pull_at = NOW() WHERE id = $1', [id]).catch(() => {});
    }

    // Deliberately not awaited — callers reply immediately. When dataTypes
    // carries more than one entry (hcp/dss_pro pulling both face and lpr —
    // see runImport()'s dataType-less default in blacklistImport.js, which
    // always resolves to one type), the loop below still runs inside this
    // one IIFE with the lock held across every iteration. startImport()
    // returns long before any of it finishes, so a second call for the same
    // id would just re-claim the lock mid-loop and race the same source —
    // sequential + one lock is what keeps this at one connection to the
    // third-party box at a time (see the lock comment above).
    const dataTypes = (opts.dataTypes && opts.dataTypes.length) ? opts.dataTypes : [opts.dataType];
    (async () => {
      try {
        for (const dataType of dataTypes) {
          const result = await runImport(pool, source, {
            apiKey: cfg.apiKey, password: cfg.password,
            from: opts.from, to: opts.to, pageSize: opts.pageSize,
            withPhotos: opts.withPhotos !== false, withDetail: opts.withDetail !== false,
            dataType,
            userId: actor.id, username: actor.username || (opts.auto ? 'auto-sync' : undefined),
          });
          console.log(`[blacklist-import] source ${id}${opts.auto ? ' (auto)' : ''}${dataType ? ` ${dataType}` : ''} done: ${JSON.stringify(result).slice(0, 200)}`);
        }
      } catch (e) {
        console.error(`[blacklist-import] source ${id} failed: ${e.message}`);
        await pool.query(
          `UPDATE blacklist.sources SET last_import_at = NOW(), last_import_status = 'error',
                  last_import_note = $2 WHERE id = $1`, [id, e.message]).catch(() => {});
      } finally {
        _importRunning.delete(String(id));
      }
    })();

    return { accepted: true, source_id: Number(id), data_type: opts.dataType || null };
  }

  app.post('/api/blacklist/sources/:id/import', async (req, res) => {
    try {
      const out = await startImport(req.params.id, {
        from: req.body?.from, to: req.body?.to, pageSize: req.body?.pageSize,
        withPhotos: req.body?.withPhotos !== false, withDetail: req.body?.withDetail !== false,
        dataType: req.body?.dataType,
      }, req.user || {});
      res.status(202).json(out);
    } catch (e) {
      if (e.code === 'not_found') return res.status(404).json({ error: 'not found' });
      if (e.code === 'running')   return res.status(409).json({ error: 'import_already_running' });
      await pool.query(
        `UPDATE blacklist.sources SET last_import_at = NOW(), last_import_status = 'error',
                last_import_note = $2 WHERE id = $1`, [req.params.id, e.message]).catch(() => {});
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ---------- auto-sync scheduler ----------
  // api-server runs as a single pm2 fork, so a plain interval is the whole
  // mechanism — no leader election, no lock table. If that ever becomes a
  // cluster, this is the thing that needs revisiting first.
  //
  // The tick is 5 minutes, so a source fires within 5 minutes of becoming due.
  // ตัวเลือกถี่สุดคือ 10 นาที (2026-08-29 — สภอ. 12 ที่ลงข้อมูลเข้า GuruSquare)
  // ⇒ คาบจริง 10-15 นาที · ถ้าจะถี่กว่านี้ต้องลด tick ลงพร้อมกัน ไม่ใช่แค่เพิ่ม option
  const SCHEDULE_TICK_MS = 5 * 60 * 1000;

  async function scheduleTick() {
    try {
      const due = await pool.query(`
        SELECT id, label, source_type, data_types, pull_interval_minutes,
               (active AND pull_interval_minutes > 0
                 AND (last_auto_pull_at IS NULL
                      OR last_auto_pull_at < NOW() - (pull_interval_minutes || ' minutes')::interval)) AS pull_due,
               (active AND push_enabled AND push_auto_enabled AND push_interval_hours > 0
                 AND (last_auto_push_at IS NULL
                      OR last_auto_push_at < NOW() - (push_interval_hours || ' hours')::interval)) AS push_due
          FROM blacklist.sources
         WHERE active`);

      for (const s of due.rows) {
        if (s.pull_due) {
          try {
            // hcp/dss_pro feed both types off one connection; runImport()'s own
            // dataType-less default always resolves to one (face) — see its
            // comment in blacklistImport.js. Ask for both explicitly here so the
            // scheduler doesn't silently starve the other side (found 2026-08-18:
            // source 14 HCP ภูเก็ต never pulled lpr through auto-sync).
            const types = s.data_types || [];
            const dataTypes = (['hcp', 'dss_pro'].includes(s.source_type)
              && types.includes('face') && types.includes('lpr'))
              ? ['face', 'lpr'] : [undefined];
            await startImport(s.id, { auto: true, dataTypes }, { username: 'auto-sync' });
            console.log(`[blacklist-schedule] auto import started for source ${s.id} (${s.label})`);
          } catch (e) {
            // 'running' is the normal outcome when a manual import is in flight
            // — it is the interlock doing its job, not a failure.
            if (e.code !== 'running') console.error(`[blacklist-schedule] source ${s.id}: ${e.message}`);
          }
        }
        if (s.push_due) await runAutoPush(s.id).catch(() => {});
      }
    } catch (e) {
      console.error('[blacklist-schedule] tick failed:', e.message);
    }
  }

  async function runAutoPush(id) {
    const { rows } = await pool.query('SELECT * FROM blacklist.sources WHERE id = $1', [id]);
    if (!rows[0]) return;
    const source = rows[0];
    // Stamp first, same reason as the pull side: a push that errors must not be
    // retried every tick against a third-party system.
    await pool.query('UPDATE blacklist.sources SET last_auto_push_at = NOW() WHERE id = $1', [id]).catch(() => {});
    let note;
    try {
      const out = await pushToSource(pool, source, decryptConfig(source.config || {}));
      note = `ส่งสำเร็จ ${out.sent} รายการ`;
      await pool.query(
        `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
        [null, 'auto-sync', 'blacklist_push_attempt',
         JSON.stringify({ source_id: Number(id), outcome: 'auto_sent', sent: out.sent, checksum: out.checksum })]
      ).catch(() => {});
    } catch (e) {
      note = e.code ? `ไม่ได้ส่ง: ${e.message}` : `ผิดพลาด: ${e.message}`;
      await pool.query(
        `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
        [null, 'auto-sync', 'blacklist_push_attempt',
         JSON.stringify({ source_id: Number(id), outcome: e.code || 'error', message: e.message })]
      ).catch(() => {});
    }
    await pool.query('UPDATE blacklist.sources SET last_auto_push_note = $2 WHERE id = $1', [id, note]).catch(() => {});
    console.log(`[blacklist-schedule] auto push source ${id}: ${note}`);
  }

  // First tick is delayed past the boot-time stale-'running' cleanup above, so
  // the scheduler never sees a leftover marker from an import that died with a
  // previous process and skips a source that is not actually busy.
  if (process.env.BLACKLIST_AUTO_SYNC !== '0') {
    setTimeout(() => {
      scheduleTick();
      setInterval(scheduleTick, SCHEDULE_TICK_MS).unref();
    }, 60_000).unref();
  }

  // ---------- GuruSquare real-time alarm poller ----------
  // Separate from the roster scheduler above — /alert is a different endpoint
  // polled on a much tighter cadence (this is meant to feel "live"), so it
  // gets its own tick + its own in-flight guard rather than piggybacking on
  // scheduleTick's 5-minute cadence.
  const ALARM_TICK_MS = 20 * 1000;
  const _alarmRunning = new Set();
  const _alarmLastNote = new Map();   // source id -> last logged outcome text, so a steady "nothing new" doesn't spam every 20s

  async function alarmTick() {
    let due;
    try {
      due = await pool.query(
        `SELECT id, site_code, config, source_type FROM blacklist.sources
          WHERE active AND alarm_enabled AND source_type = 'gurusquare'`);
    } catch (e) {
      console.error('[gs-alarm] tick failed:', e.message);
      return;
    }
    for (const row of due.rows) {
      const key = String(row.id);
      if (_alarmRunning.has(key)) continue;
      _alarmRunning.add(key);
      (async () => {
        let note;
        try {
          const r = await pollGsAlarms(pool, row, decryptConfig(row.config || {}));
          note = `รับ ${r.inserted.length} ใหม่ · fetched ${r.fetched} · ซ้ำ ${r.skippedDup} · parse ไม่ได้ ${r.bad}`;
          if (_alarmLastNote.get(key) !== note) {
            console.log(`[gs-alarm] source ${row.id}: ${note}`);
            _alarmLastNote.set(key, note);
          }
        } catch (e) {
          note = `error: ${e.message}`;
          if (_alarmLastNote.get(key) !== note) {
            console.error(`[gs-alarm] source ${row.id}: ${note}`);
            _alarmLastNote.set(key, note);
          }
        } finally {
          _alarmRunning.delete(key);
        }
      })();
    }
  }

  if (process.env.BLACKLIST_AUTO_SYNC !== '0') {
    setTimeout(() => {
      alarmTick();
      setInterval(alarmTick, ALARM_TICK_MS).unref();
    }, 60_000).unref();
  }

  // ---------- push-back to the source (opt-in, double-gated, preview-only) ----------
  // We import from third-party systems we do not own — a police DSS Pro, a
  // GuruSquare box. Writing our corrections BACK into them is a different risk
  // class from reading: a bad push edits someone else's operational blocklist.
  // So three independent gates stand in front of it, and the transmitter itself
  // is deliberately not built yet:
  //   1. push_enabled per source, off by default          (opt-in)
  //   2. enabling requires an explicit acceptance, recorded with who + when
  //   3. every sync must echo back the checksum of the exact diff it saw, so
  //      confirming a stale preview cannot push something you never read
  // Even past all three, /push-apply refuses unless BLACKLIST_PUSH_LIVE=1 —
  // there is no write path to a live police system in this build, by design.

  app.get('/api/blacklist/sources/:id/push-preview', async (req, res) => {
    try {
      const s = await pool.query('SELECT * FROM blacklist.sources WHERE id = $1', [req.params.id]);
      if (!s.rows[0]) return res.status(404).json({ error: 'not found' });
      const src = s.rows[0];
      const d = await buildPushDiff(pool, req.params.id, src.push_types || []);
      res.json({
        source: {
          id: src.id, label: src.label, push_enabled: src.push_enabled,
          push_confirmed_at: src.push_confirmed_at, push_confirmed_by: src.push_confirmed_by,
          push_types: src.push_types || [], push_mode: src.push_mode,
          push_auto_enabled: src.push_auto_enabled, push_interval_hours: src.push_interval_hours,
          last_auto_push_at: src.last_auto_push_at, last_auto_push_note: src.last_auto_push_note,
        },
        live_push_available: process.env.BLACKLIST_PUSH_LIVE === '1',
        // replace is gated in the transmitter, not just in the UI — surfaced
        // here so the page can say so instead of only failing at apply time
        replace_available: false,
        checksum: d.checksum,
        pushable_count: d.pushable.length,
        excluded_count: d.changes.filter(c => c.excluded).length,
        changes: d.changes,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Gate 1+2: opt in, and record who accepted the warning.
  app.post('/api/blacklist/sources/:id/push-enable', async (req, res) => {
    try {
      const { enabled, accepted, mode, types, auto, interval_hours } = req.body || {};
      if (enabled && accepted !== true) {
        return res.status(400).json({ error: 'ต้องยืนยันคำเตือนก่อนเปิดใช้งาน push-back' });
      }
      const wantMode = mode === 'replace' ? 'replace' : 'merge';
      // Replace deletes rows from a system we do not own. Accepting a checkbox
      // is the bar for merge; this one costs the same typed confirmation as
      // destroying our own records.
      if (enabled && wantMode === 'replace' && req.body?.confirm !== 'CONFIRM') {
        return res.status(400).json({
          error: 'โหมด replace จะลบข้อมูลของต้นทางที่เราไม่มี — ต้องพิมพ์ CONFIRM เพื่อยืนยัน',
        });
      }
      // Bounded by what this source actually imports. Pushing back a type the
      // source was never read for cannot produce a single row — the diff joins
      // source_records — so accepting it would leave an operator with a feature
      // switched on that silently does nothing for ever.
      const prev = await pool.query('SELECT data_types FROM blacklist.sources WHERE id = $1', [req.params.id]);
      if (!prev.rows[0]) return res.status(404).json({ error: 'not found' });
      const imported = prev.rows[0].data_types || [];
      const asked = Array.isArray(types) ? types.filter(t => t === 'face' || t === 'lpr') : [];
      const wantTypes = asked.filter(t => imported.includes(t));
      if (enabled && !wantTypes.length) {
        return res.status(400).json({
          error: asked.length
            ? `แหล่งนี้ไม่ได้นำเข้าชนิดข้อมูลที่เลือก (นำเข้าอยู่: ${imported.join(', ') || 'ไม่มี'})`
            : 'ต้องเลือกอย่างน้อยหนึ่งชนิดข้อมูลที่จะส่งกลับ',
        });
      }

      // push_mode is written FIRST and in its own statement: the trigger that
      // revokes consent on a mode change would otherwise clear push_enabled in
      // the same UPDATE that is trying to set it.
      await pool.query('UPDATE blacklist.sources SET push_mode = $2 WHERE id = $1',
        [req.params.id, wantMode]);

      const { rows } = await pool.query(`
        UPDATE blacklist.sources
           SET push_enabled = $2,
               push_types = $3,
               push_auto_enabled = ($2 AND $4),
               push_interval_hours = GREATEST(0, LEAST(168, COALESCE($5, 0))),
               push_confirmed_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
               push_confirmed_by = CASE WHEN $2 THEN $6::text ELSE NULL END,
               updated_at = NOW()
         WHERE id = $1
     RETURNING id, label, push_enabled, push_types, push_mode, push_auto_enabled,
               push_interval_hours, push_confirmed_at, push_confirmed_by`,
        [req.params.id, !!enabled, wantTypes, !!auto, Number(interval_hours) || 0,
         req.user?.username || 'unknown']);
      if (!rows[0]) return res.status(404).json({ error: 'not found' });

      await pool.query(
        `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
        [req.user?.id || null, req.user?.username || 'unknown', 'blacklist_push_gate',
         JSON.stringify({ source_id: req.params.id, label: rows[0].label, enabled: !!enabled,
                          mode: wantMode, types: wantTypes, auto: !!rows[0].push_auto_enabled, ip: req.ip })]
      ).catch(() => { /* audit failure must not leave the gate in an unknown state */ });

      res.json(rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Gate 3: the actual sync-back. Refuses at every layer; audits every attempt.
  app.post('/api/blacklist/sources/:id/push-apply', async (req, res) => {
    const audit = (outcome, extra) => pool.query(
      `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
      [req.user?.id || null, req.user?.username || 'unknown', 'blacklist_push_attempt',
       JSON.stringify({ source_id: req.params.id, outcome, ip: req.ip, ...extra })]
    ).catch(() => {});
    try {
      const s = await pool.query('SELECT * FROM blacklist.sources WHERE id = $1', [req.params.id]);
      if (!s.rows[0]) return res.status(404).json({ error: 'not found' });
      // Every refusal in pushToSource carries a code; they are mapped to status
      // here so the one place that decides "may this be sent" stays one place.
      const out = await pushToSource(pool, s.rows[0], decryptConfig(s.rows[0].config || {}),
        { checksum: req.body?.checksum });
      await audit('sent', { sent: out.sent, checksum: out.checksum });
      res.json({ ok: true, ...out });
    } catch (e) {
      await audit(e.code || 'error', { message: e.message });
      const status = { not_enabled: 403, no_types: 400, stale_checksum: 409,
                       dry_run: 501, replace_not_live: 501, no_transmitter: 501 }[e.code] || 500;
      res.status(status).json({ ok: false, error: e.message, code: e.code || null });
    }
  });
};
