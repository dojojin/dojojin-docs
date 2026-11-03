// ============================================================
// Vigil Platform — Helper: VCA rule-name issue validation
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// The `issues` array on a <cam>/onvif-ej/Device/vca-rules MQTT payload comes
// from an edge node — outside this process — so it is validated before it
// ever reaches a query, same reasoning as helpers/edgeCameraBrokerUrl.js.
// ============================================================
'use strict';

const VCA_RULE_PROBLEMS = new Set(['bad_utf8', 'at_limit', 'wildcard', 'control_char']);

/**
 * @param {*} issues  candidate `issues` array from a Device/vca-rules payload
 * @returns {Array<{id:number,type:number,name:string,problem:string}>} only the well-shaped entries
 */
function validVcaRuleIssues(issues) {
  if (!Array.isArray(issues)) return [];
  const out = [];
  for (const it of issues) {
    if (!it || typeof it !== 'object') continue;
    if (typeof it.id !== 'number' || typeof it.type !== 'number') continue;
    if (typeof it.name !== 'string' || it.name.length > 200) continue;
    if (!VCA_RULE_PROBLEMS.has(it.problem)) continue;
    out.push({ id: it.id, type: it.type, name: it.name, problem: it.problem });
  }
  return out;
}

module.exports = { validVcaRuleIssues, VCA_RULE_PROBLEMS };
