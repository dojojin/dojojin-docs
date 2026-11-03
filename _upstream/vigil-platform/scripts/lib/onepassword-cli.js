// ============================================================
// Vigil Platform — shared 1Password CLI (`op`) transport
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Shared by backup-env-to-1password.js and rotate-central-mqtt-password.js —
// op ไม่รับ token/secret ทาง argv เด็ดขาด: token ผ่าน child env เท่านั้น,
// item JSON ผ่าน stdin เท่านั้น. op's own stderr can echo back values we sent
// it (e.g. on a malformed-template error) so we never surface it verbatim —
// callers get an exit code only.
// ============================================================
'use strict';

function runOp(spawn, args, { env, input } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('op', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { return reject(e); }
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', () => {}); // discarded — may echo values, see header
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(Object.assign(new Error(`op ${args[0] || ''} exit ${code}`), { code }));
    });
    child.stdin.end(input == null ? '' : input);
  });
}

async function opAvailable(spawn) {
  return runOp(spawn, ['--version']).then(() => true, () => false);
}

module.exports = { runOp, opAvailable };
