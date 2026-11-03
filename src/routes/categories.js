// ============================================================
// Vigil Platform — Routes: Event Categories & Mapping Rules
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const routeError = require('../helpers/routeError');

module.exports = function categoriesRoutes(app, pool) {
  // GET /api/categories[?site_id=N] — list with rule counts, optionally filtered by site
  app.get('/api/categories', async (req, res) => {
    try {
      const allowed = req.user?.allowedSites ?? null;
      const siteParam = req.query.site_id ? parseInt(req.query.site_id, 10) : null;
      if (siteParam && allowed !== null && !allowed.includes(siteParam))
        return res.status(403).json({ error: 'forbidden' });
      const activeSites = siteParam ? [siteParam] : allowed;
      const params = [];
      let where = '';
      if (activeSites !== null) { params.push(activeSites); where = 'WHERE c.site_id = ANY($1)'; }
      const { rows } = await pool.query(`
        SELECT c.id, c.name, c.icon, c.color, c.kind, c.is_locked, c.sort_order,
               c.stat_group, c.site_id, c.created_at, c.updated_at,
               COUNT(r.id)::int AS rule_count
          FROM event_categories c
          LEFT JOIN event_category_rules r ON r.category_id = c.id
          ${where}
          GROUP BY c.id
          ORDER BY c.sort_order, c.id
      `, params);
      res.json(rows);
    } catch (err) { routeError(res, err, 'GET /api/categories'); }
  });

  // GET /api/categories/rule-discovery — combo (camera, rule_name, event_type,
  // object_class) ที่เห็นจริงใน events ช่วงหลัง เพื่อให้หน้า Manage ชี้ว่า rule
  // ไหนบนกล้องยังไม่ถูก map เข้า category (เคสจริง: Bus/Truck ของกล้องใหม่
  // ไหลเข้ามาแต่สถิติเงียบเพราะไม่มีใครสร้างหมวดตาม)
  // การจับคู่ว่า "map แล้วหรือยัง" ทำฝั่ง client (มี rules ทุกหมวดอยู่แล้ว)
  //
  // ⚡ 2026-09-05 — เดิม full scan 3 วัน >45s จึงเลี่ยงด้วย CROSS JOIN LATERAL
  // ต่อกล้อง + เพดาน 2,000 เหตุการณ์ล่าสุด/กล้อง (ยังวัดได้ 14.5s) ตอนนี้อ่านจาก
  // event_dim_bucket แทน (rollup 30 นาที · migration 163) → 90 ms. สิ่งที่เปลี่ยน:
  //   · **ไม่มีเพดานต่อกล้องแล้ว** (`per_camera_cap: null`) — combo ที่เคยตกขอบ
  //     เพราะกล้องยิงถี่เกิน 2,000 เหตุการณ์ กลับมาเห็นครบ
  //   · `n` เป็นยอดรวม 7 วันจริง ไม่ใช่การนับจากตัวอย่าง 2,000 แถวล่าสุดอีกต่อไป
  //     → ตัวเลขจะสูงกว่าของเดิม เป็นเรื่องปกติ ไม่ใช่บั๊ก
  //   · `last_seen` = MAX(bucket) ความละเอียด 30 นาที จึงอาจเก่ากว่าเวลาจริงได้ถึง
  //     30 นาที และ combo ที่เพิ่งเกิดจะโผล่ช้า ≤ ~5 นาที (รอบ refresher)
  //   · dim เก็บ text เป็น NOT NULL DEFAULT '' ต้อง NULLIF กลับเป็น NULL
  //     ให้ response shape เท่าเดิม
  app.get('/api/categories/rule-discovery', async (req, res) => {
    try {
      const allowed = req.user?.allowedSites ?? null;
      const params = [];
      let where = '';
      if (allowed !== null) { params.push(allowed); where = 'AND c.site_id = ANY($1)'; }
      const { rows } = await pool.query(`
        SELECT d.camera_id, c.site_id,
               NULLIF(d.rule_name, '')    AS rule_name,
               NULLIF(d.event_type, '')   AS event_type,
               NULLIF(d.object_class, '') AS object_class,
               NULLIF(d.vehicle_type, '') AS vehicle_type,
               SUM(d.n)::int AS n, MAX(d.bucket) AS last_seen
          FROM event_dim_bucket d
          JOIN cameras c ON c.id = d.camera_id
         WHERE d.bucket > now() - interval '7 days' ${where}
         GROUP BY 1, 2, 3, 4, 5, 6
         ORDER BY n DESC`, params);
      res.json({ window_days: 7, per_camera_cap: null, combos: rows });
    } catch (err) { routeError(res, err, 'GET /api/categories/rule-discovery'); }
  });

  // POST /api/categories — create user category (site_id required)
  app.post('/api/categories', async (req, res) => {
    const { name, icon, color, sort_order, site_id, stat_group } = req.body || {};
    if (stat_group != null && stat_group !== ''
      && !['vehicle', 'people', 'identify', 'watch', 'standalone'].includes(stat_group))
      return res.status(400).json({ error: 'invalid stat_group' });
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    const siteId = site_id ? parseInt(site_id, 10) : null;
    if (!siteId) return res.status(400).json({ error: 'site_id required' });
    const allowed = req.user?.allowedSites ?? null;
    if (allowed !== null && !allowed.includes(siteId))
      return res.status(403).json({ error: 'forbidden' });
    try {
      const { rows } = await pool.query(
        `INSERT INTO event_categories (name, icon, color, kind, sort_order, site_id, stat_group)
         VALUES ($1, $2, $3, 'event', COALESCE($4, 0), $5, $6)
         RETURNING *`,
        [name.trim(), icon || null, color || '#5b8def', sort_order, siteId, stat_group || null]
      );
      res.json(rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'name already exists' });
      routeError(res, err, 'POST /api/categories');
    }
  });

  // PUT /api/categories/:id — update; locked categories block name/icon changes
  app.put('/api/categories/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { name, icon, color, sort_order, is_locked, stat_group } = req.body || {};
    if (stat_group != null && stat_group !== ''
      && !['vehicle', 'people', 'identify', 'watch', 'standalone'].includes(stat_group))
      return res.status(400).json({ error: 'invalid stat_group' });
    try {
      const cur = await pool.query('SELECT * FROM event_categories WHERE id=$1', [id]);
      if (!cur.rows[0]) return res.status(404).json({ error: 'not found' });
      const c = cur.rows[0];
      const newLocked = typeof is_locked === 'boolean' ? is_locked : c.is_locked;
      const newName  = c.is_locked ? c.name : (name?.trim() || c.name);
      const newIcon  = c.is_locked ? c.icon : (icon ?? c.icon);
      const newColor = color ?? c.color;
      const newSort  = sort_order ?? c.sort_order;
      // stat_group: ส่ง '' หรือ null อย่างชัดเจน = กลับไปอัตโนมัติ · ไม่ส่ง field = คงเดิม
      const newGroup = ('stat_group' in (req.body || {})) ? (stat_group || null) : c.stat_group;
      const { rows } = await pool.query(
        `UPDATE event_categories
            SET name=$1, icon=$2, color=$3, sort_order=$4, is_locked=$5, stat_group=$6
          WHERE id=$7 RETURNING *`,
        [newName, newIcon, newColor, newSort, newLocked, newGroup, id]
      );
      res.json(rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'name already exists' });
      routeError(res, err, 'PUT /api/categories/:id');
    }
  });

  // DELETE /api/categories/:id — delete (locked categories protected)
  app.delete('/api/categories/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      const cur = await pool.query('SELECT is_locked FROM event_categories WHERE id=$1', [id]);
      if (!cur.rows[0]) return res.status(404).json({ error: 'not found' });
      if (cur.rows[0].is_locked) return res.status(403).json({ error: 'locked category cannot be deleted' });
      await pool.query('DELETE FROM event_categories WHERE id=$1', [id]);
      res.json({ ok: true });
    } catch (err) { routeError(res, err, 'DELETE /api/categories/:id'); }
  });

  // POST /api/categories/bulk-delete — ปุ่ม "ลบทั้งหมด" ของหน้า Manage (เจ้าของสั่ง
  // 2026-08-29 เพื่อเคลียร์แล้วสร้างหมวด/rules ชุดใหม่) · ตาม pattern เดียวกับ
  // /api/lpr/watchlist/bulk-delete: ต้องระบุ ids ตรง ๆ + confirm — ไม่มีโหมด
  // "ลบทุกอย่างในระบบ" แบบไม่ระบุตัว · rules ภายในหายตาม FK ON DELETE CASCADE
  // · หมวด locked ข้ามเสมอ (ด่านเดียวกับการลบทีละใบ)
  app.post('/api/categories/bulk-delete', async (req, res) => {
    try {
      const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [])
        .map((n) => parseInt(n, 10)).filter(Number.isFinite);
      if (!ids.length) return res.status(400).json({ error: 'ids required' });
      if (req.body?.confirm !== 'CONFIRM') return res.status(400).json({ error: 'confirm required' });
      const { rows } = await pool.query(
        `DELETE FROM event_categories WHERE id = ANY($1) AND is_locked = FALSE RETURNING id, name`, [ids]);
      await pool.query(
        `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
        [req.user?.id || null, req.user?.username || 'admin', 'categories_bulk_delete',
         JSON.stringify({ requested: ids.length, deleted: rows.length,
                          names: rows.slice(0, 50).map((r) => r.name) })]
      ).catch(() => { /* audit ล้มต้องไม่ทำให้การลบที่สำเร็จแล้วรายงานว่าพัง */ });
      res.json({ deleted: rows.length, skipped_locked: ids.length - rows.length });
    } catch (err) { routeError(res, err, 'POST /api/categories/bulk-delete'); }
  });

  // GET /api/categories/:id/rules — list mapping rules for a category
  app.get('/api/categories/:id/rules', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      const { rows } = await pool.query(
        `SELECT * FROM event_category_rules WHERE category_id=$1 ORDER BY priority DESC, id`,
        [id]
      );
      res.json(rows);
    } catch (err) { routeError(res, err, 'GET /api/categories/:id/rules'); }
  });

  // POST /api/categories/:id/rules — add a mapping rule
  app.post('/api/categories/:id/rules', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const body = req.body || {};
    const { camera_id, rule_name, event_type, object_class, vehicle_type, priority } = body;
    const blank = v => (v == null || v === '' ? null : v);
    // match_state: only default to 'true' when the field was OMITTED.
    // An explicit "" or null from the form means the user chose "any" → store NULL.
    const matchState = ('match_state' in body) ? blank(body.match_state) : 'true';
    try {
      const cat = await pool.query('SELECT id, site_id FROM event_categories WHERE id=$1', [id]);
      if (!cat.rows[0]) return res.status(404).json({ error: 'category not found' });
      // Camera must belong to same site as category (if both are set)
      if (blank(camera_id) && cat.rows[0].site_id) {
        const camChk = await pool.query(
          'SELECT 1 FROM cameras WHERE id=$1 AND site_id=$2',
          [blank(camera_id), cat.rows[0].site_id]);
        if (!camChk.rowCount) return res.status(400).json({ error: 'camera_site_mismatch' });
      }
      const { rows } = await pool.query(
        `INSERT INTO event_category_rules
           (category_id, camera_id, rule_name, event_type, object_class, vehicle_type, match_state, priority)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 0))
         RETURNING *`,
        [id, blank(camera_id), blank(rule_name), blank(event_type), blank(object_class),
         blank(vehicle_type), matchState, priority]
      );
      res.json(rows[0]);
    } catch (err) { routeError(res, err, 'POST /api/categories/:id/rules'); }
  });

  // DELETE /api/category-rules/:id — remove a mapping rule
  app.delete('/api/category-rules/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      await pool.query('DELETE FROM event_category_rules WHERE id=$1', [id]);
      res.json({ ok: true });
    } catch (err) { routeError(res, err, 'DELETE /api/category-rules/:id'); }
  });

  // GET /api/categories/backup?site_id=N — export categories + rules for a site as JSON
  app.get('/api/categories/backup', async (req, res) => {
    try {
      const siteId = req.query.site_id ? parseInt(req.query.site_id, 10) : null;
      if (!siteId) return res.status(400).json({ error: 'site_id required' });
      const allowed = req.user?.allowedSites ?? null;
      if (allowed !== null && !allowed.includes(siteId))
        return res.status(403).json({ error: 'forbidden' });

      // Fetch site info
      const siteRes = await pool.query('SELECT id, code, name FROM sites WHERE id=$1', [siteId]);
      if (!siteRes.rowCount) return res.status(404).json({ error: 'site not found' });
      const site = siteRes.rows[0];

      // Fetch categories + rules for this site, ordered by sort_order/id
      const { rows: cats } = await pool.query(`
        SELECT c.id, c.name, c.icon, c.color, c.kind, c.sort_order, c.stat_group, c.is_locked
          FROM event_categories c
         WHERE c.site_id = $1
         ORDER BY c.sort_order, c.id
      `, [siteId]);

      // Fetch all rules for these categories
      const catIds = cats.map(c => c.id);
      let rulesMap = new Map();
      if (catIds.length > 0) {
        const { rows: rules } = await pool.query(`
          SELECT category_id, camera_id, rule_name, event_type, object_class,
                 match_state, priority, vehicle_type
            FROM event_category_rules
           WHERE category_id = ANY($1)
           ORDER BY priority DESC, id
        `, [catIds]);
        for (const rule of rules) {
          if (!rulesMap.has(rule.category_id)) rulesMap.set(rule.category_id, []);
          rulesMap.get(rule.category_id).push({
            camera_id: rule.camera_id,
            rule_name: rule.rule_name,
            event_type: rule.event_type,
            object_class: rule.object_class,
            match_state: rule.match_state,
            priority: rule.priority,
            vehicle_type: rule.vehicle_type,
          });
        }
      }

      // Build export payload (no DB ids, portable)
      const exported = {
        version: 1,
        exported_at: new Date().toISOString(),
        site: { id: site.id, code: site.code, name: site.name },
        categories: cats.map(c => ({
          name: c.name,
          icon: c.icon,
          color: c.color,
          kind: c.kind,
          sort_order: c.sort_order,
          stat_group: c.stat_group,
          is_locked: c.is_locked,
          rules: rulesMap.get(c.id) || [],
        })),
      };

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="vigil-categories-${site.code || site.id}-${new Date().toISOString().slice(0, 10)}.json"`);
      res.setHeader('Cache-Control', 'no-store');
      res.json(exported);
    } catch (err) { routeError(res, err, 'GET /api/categories/backup'); }
  });

  // POST /api/categories/restore — restore categories + rules from backup JSON
  app.post('/api/categories/restore', async (req, res) => {
    try {
      const { site_id, mode, data } = req.body || {};
      const siteId = site_id ? parseInt(site_id, 10) : null;
      if (!siteId) return res.status(400).json({ error: 'site_id required' });
      const allowed = req.user?.allowedSites ?? null;
      if (allowed !== null && !allowed.includes(siteId))
        return res.status(403).json({ error: 'forbidden' });

      // Check payload size (>2MB JSON)
      const payloadStr = JSON.stringify(req.body);
      if (payloadStr.length > 2 * 1024 * 1024) return res.status(413).json({ error: 'payload too large' });

      // Validate mode
      if (!mode || !['replace', 'merge'].includes(mode)) return res.status(400).json({ error: 'mode must be replace or merge' });

      // Validate backup data structure
      if (!data || typeof data !== 'object') return res.status(400).json({ error: 'data required' });
      if (data.version !== 1) return res.status(400).json({ error: 'unsupported backup version' });
      if (!Array.isArray(data.categories)) return res.status(400).json({ error: 'categories must be array' });

      const allowedKinds = ['event', 'people_counter', 'vehicle_counter'];
      const allowedGroups = ['vehicle', 'people', 'identify', 'watch', 'standalone'];
      for (const cat of data.categories) {
        if (!cat.name || typeof cat.name !== 'string' || !cat.name.trim())
          return res.status(400).json({ error: 'each category must have a name' });
        if (!allowedKinds.includes(cat.kind))
          return res.status(400).json({ error: `invalid kind: ${cat.kind}` });
        if (cat.stat_group && !allowedGroups.includes(cat.stat_group))
          return res.status(400).json({ error: `invalid stat_group: ${cat.stat_group}` });
        if (!Array.isArray(cat.rules)) return res.status(400).json({ error: 'rules must be array' });
        for (const rule of cat.rules) {
          if (rule.priority !== null && typeof rule.priority !== 'number')
            return res.status(400).json({ error: 'rule priority must be number or null' });
          // camera_id, rule_name, event_type, object_class, match_state, vehicle_type can be string or null
          if (typeof rule.camera_id !== 'string' && rule.camera_id !== null)
            return res.status(400).json({ error: 'rule camera_id must be string or null' });
          if (typeof rule.rule_name !== 'string' && rule.rule_name !== null)
            return res.status(400).json({ error: 'rule rule_name must be string or null' });
          if (typeof rule.event_type !== 'string' && rule.event_type !== null)
            return res.status(400).json({ error: 'rule event_type must be string or null' });
          if (typeof rule.object_class !== 'string' && rule.object_class !== null)
            return res.status(400).json({ error: 'rule object_class must be string or null' });
          if (typeof rule.match_state !== 'string' && rule.match_state !== null)
            return res.status(400).json({ error: 'rule match_state must be string or null' });
          if (typeof rule.vehicle_type !== 'string' && rule.vehicle_type !== null)
            return res.status(400).json({ error: 'rule vehicle_type must be string or null' });
        }
      }

      // Verify site exists
      const siteRes = await pool.query('SELECT id FROM sites WHERE id=$1', [siteId]);
      if (!siteRes.rowCount) return res.status(404).json({ error: 'site not found' });

      // Run restore in a transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        let created = 0, updated = 0, deleted = 0, rules = 0;

        // Replace mode: delete non-locked categories first
        if (mode === 'replace') {
          const delRes = await client.query(
            `DELETE FROM event_categories WHERE site_id=$1 AND is_locked=FALSE RETURNING id`,
            [siteId]
          );
          deleted = delRes.rowCount;
        }

        // Process each category in the backup
        for (const catData of data.categories) {
          const existRes = await client.query(
            `SELECT id, is_locked FROM event_categories WHERE site_id=$1 AND name=$2`,
            [siteId, catData.name.trim()]
          );

          let catId;
          if (existRes.rowCount) {
            // Category exists: update if not locked
            const existing = existRes.rows[0];
            if (!existing.is_locked) {
              await client.query(
                `UPDATE event_categories
                  SET icon=$2, color=$3, kind=$4, sort_order=$5, stat_group=$6
                 WHERE id=$1`,
                [existing.id, catData.icon || null, catData.color || '#5b8def',
                 catData.kind, catData.sort_order || 0, catData.stat_group || null]
              );
              updated++;
            }
            catId = existing.id;
          } else {
            // Create new category
            const insRes = await client.query(
              `INSERT INTO event_categories (name, icon, color, kind, sort_order, site_id, stat_group, is_locked)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               RETURNING id`,
              [catData.name.trim(), catData.icon || null, catData.color || '#5b8def',
               catData.kind, catData.sort_order || 0, siteId, catData.stat_group || null,
               catData.is_locked || false]
            );
            catId = insRes.rows[0].id;
            created++;
          }

          // Delete existing rules and insert new ones (for both new and updated categories)
          await client.query('DELETE FROM event_category_rules WHERE category_id=$1', [catId]);
          for (const rule of catData.rules) {
            const blank = (v) => (v == null || v === '' ? null : v);
            const matchState = blank(rule.match_state) ?? 'true';
            await client.query(
              `INSERT INTO event_category_rules
                (category_id, camera_id, rule_name, event_type, object_class, match_state, priority, vehicle_type)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [catId, blank(rule.camera_id), blank(rule.rule_name), blank(rule.event_type),
               blank(rule.object_class), matchState, rule.priority || 0, blank(rule.vehicle_type)]
            );
            rules++;
          }
        }

        await client.query('COMMIT');
        res.json({ success: true, mode, created, updated, deleted, rules });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        routeError(res, err, 'POST /api/categories/restore');
      } finally {
        client.release();
      }
    } catch (err) { routeError(res, err, 'POST /api/categories/restore'); }
  });
};
