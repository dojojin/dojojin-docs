// ============================================================
// Vigil Platform — Routes: Camera Groups
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const routeError = require('../helpers/routeError');

module.exports = function groupsRoutes(app, pool, { auth, getIP, loadGroups, saveGroups, logCameraAudit }) {

  // Groups live in camera-groups.json (cameraIds by string, no site_id of
  // their own) and feed the shared group tab bar rendered on every page
  // (Cameras/Events/Snapshot/Media/Map/Stats) plus the Map's own group
  // legend — one fix here covers all of them. A site-scoped viewer only
  // gets cameraIds trimmed to cameras in their allowedSites; a group left
  // with zero cameras is dropped entirely so it never appears as an empty
  // tab. admin/auditor (allowedSites=null) see groups unfiltered.
  app.get('/api/groups', async (req, res) => {
    try {
      const allGroups = loadGroups().groups || [];
      // Annotate each group with a site_id. Groups saved after this feature carry
      // an explicit site_id; legacy groups derive it from the dominant site of
      // their member cameras (groups are single-site in practice). Orphan/unknown
      // cameraIds contribute nothing to the tally.
      let camSite = new Map();
      try {
        const { rows } = await pool.query('SELECT id, site_id FROM cameras');
        camSite = new Map(rows.map(r => [r.id, r.site_id]));
      } catch { /* DB hiccup — groups just come back without a derived site */ }
      const withSite = (g) => {
        if (g.site_id != null) return g;
        const tally = new Map();
        for (const id of (g.cameraIds || [])) {
          const s = camSite.get(id);
          if (s != null) tally.set(s, (tally.get(s) || 0) + 1);
        }
        let best = null, bestN = 0;
        for (const [s, n] of tally) if (n > bestN) { best = s; bestN = n; }
        return { ...g, site_id: best };
      };

      const allowedSites = req.user?.allowedSites ?? null;
      if (allowedSites === null) return res.json(allGroups.map(withSite));

      let allowedCameraIds = new Set();
      if (allowedSites.length) {
        const camRows = await pool.query('SELECT id FROM cameras WHERE site_id = ANY($1)', [allowedSites]);
        allowedCameraIds = new Set(camRows.rows.map(r => r.id));
      }
      const scoped = allGroups
        .map(g => ({ ...g, cameraIds: (g.cameraIds || []).filter(id => allowedCameraIds.has(id)) }))
        .filter(g => g.cameraIds.length > 0)
        .map(withSite);
      res.json(scoped);
    } catch (err) { routeError(res, err, 'GET /api/groups'); }
  });

  app.post('/api/groups', async (req, res) => {
    try {
      const { id, name, color, cameraIds, site_id } = req.body;
      if (!name) return res.status(400).json({ error: 'name is required' });

      const data = loadGroups();
      if (!data.groups) data.groups = [];

      const newGroup = {
        id: id || `g_${Date.now()}`,
        name: String(name).trim(),
        color: color || '#00b4ff',
        site_id: (site_id != null && site_id !== '') ? (parseInt(site_id, 10) || null) : null,
        cameraIds: Array.isArray(cameraIds) ? cameraIds : [],
        created_at: new Date().toISOString(),
      };

      const idx = data.groups.findIndex(g => g.id === newGroup.id);
      const prevGroup = idx >= 0 ? data.groups[idx] : null;
      if (idx >= 0) {
        newGroup.created_at = data.groups[idx].created_at;
        data.groups[idx] = newGroup;
      } else {
        data.groups.push(newGroup);
      }

      saveGroups(data);
      const beforeIds = new Set(prevGroup?.cameraIds || []);
      const afterIds = new Set(newGroup.cameraIds || []);
      const added = [...afterIds].filter(cameraId => !beforeIds.has(cameraId));
      const removed = [...beforeIds].filter(cameraId => !afterIds.has(cameraId));
      await auth.logAudit(req.user?.id, req.user?.username, idx >= 0 ? 'group_update' : 'group_create', null, null, getIP(req), req.headers['user-agent'], {
        group_id: newGroup.id,
        group_name: newGroup.name,
        camera_count: newGroup.cameraIds.length,
        added_cameras: added,
        removed_cameras: removed,
      });
      for (const cameraId of added) {
        await logCameraAudit(req, 'camera_group_assign', cameraId, { group_id: newGroup.id, group_name: newGroup.name });
      }
      for (const cameraId of removed) {
        await logCameraAudit(req, 'camera_group_remove', cameraId, { group_id: newGroup.id, group_name: newGroup.name });
      }
      res.json({ success: true, group: newGroup });
    } catch (err) { routeError(res, err, 'POST /api/groups'); }
  });

  app.delete('/api/groups/:groupId', async (req, res) => {
    try {
      const data = loadGroups();
      const prevGroup = (data.groups || []).find(g => g.id === req.params.groupId) || null;
      data.groups = (data.groups || []).filter(g => g.id !== req.params.groupId);
      saveGroups(data);
      await auth.logAudit(req.user?.id, req.user?.username, 'group_delete', null, null, getIP(req), req.headers['user-agent'], {
        group_id: req.params.groupId,
        group_name: prevGroup?.name || null,
        camera_count: (prevGroup?.cameraIds || []).length,
      });
      for (const cameraId of prevGroup?.cameraIds || []) {
        await logCameraAudit(req, 'camera_group_remove', cameraId, { group_id: req.params.groupId, group_name: prevGroup?.name || null });
      }
      res.json({ success: true });
    } catch (err) { routeError(res, err, 'DELETE /api/groups/:groupId'); }
  });
};
