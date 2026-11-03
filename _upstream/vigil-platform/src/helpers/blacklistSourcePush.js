// ============================================================
// Vigil Platform — Edge-side blacklist WRITE operations
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// The counterpart of blacklistSourceProbes.js, for the one direction that can
// damage somebody else's system. Central builds the diff and decides; this
// file is the only place that actually writes into DSS Pro.
//
// Named operations only — 'person-update' and 'vehicle-save' — never a generic
// "send this method to this path". The edge sits inside the site LAN with
// admin credentials for a police system; if central is ever compromised, the
// worst it can ask for must still be a bounded, reviewable set of writes.
//
// Deletion is deliberately absent. push_mode='replace' is refused upstream in
// blacklistPush.js, and there is no delete op here either, so a bug that gets
// past the upstream gate still cannot remove a row.
// ============================================================
'use strict';

const { dssRequest, dssLogin } = require('./blacklistSourceProbes');

const OPS = new Set(['person-update', 'vehicle-save']);

// One login for the whole batch — DSS Pro runs on a shared admin account and
// re-authenticating per item would look like a brute-force attempt.
async function pushDssPro({ host, port = 443, username, password, ops }) {
  const token = await dssLogin(host, port, username, password);
  const results = [];

  for (const group of ops) {
    if (!OPS.has(group.op)) throw new Error(`unsupported op ${group.op}`);
    const items = Array.isArray(group.items) ? group.items : [];
    if (!items.length) continue;

    if (group.op === 'person-update') {
      // No batch endpoint for persons — one PUT each, and each result is kept
      // separately so a partial failure is visible per record instead of
      // collapsing the whole batch into one "failed".
      for (const it of items) {
        if (!it || !it.personId) { results.push({ op: group.op, ok: false, error: 'missing personId' }); continue; }
        const r = await dssRequest(host, port, 'PUT',
          `/obms/api/v1.1/acs/person/${encodeURIComponent(it.personId)}`,
          it.body || {}, { 'X-Subject-Token': token });
        results.push({
          op: group.op, id: it.personId,
          ok: r.status >= 200 && r.status < 300,
          status: r.status, error: (r.body && (r.body.errMsg || r.body.message)) || null,
        });
      }
    }

    if (group.op === 'vehicle-save') {
      const r = await dssRequest(host, port, 'POST',
        '/ipms/api/v1.1/vehicle/save/batch', { vehicleList: items },
        { 'X-Subject-Token': token });
      results.push({
        op: group.op, count: items.length,
        ok: r.status >= 200 && r.status < 300,
        status: r.status, error: (r.body && (r.body.errMsg || r.body.message)) || null,
      });
    }
  }

  const failed = results.filter(x => !x.ok);
  return { ok: failed.length === 0, results, failed: failed.length };
}

module.exports = { pushDssPro, OPS };
