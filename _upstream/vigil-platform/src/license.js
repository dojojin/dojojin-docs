// ============================================================
// Vigil Platform — License Module
// ============================================================
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @contact   prakasit@dojojin.tech | https://dojojin.tech/
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================
// Machine-bound license verification (Ed25519/JWT, offline-first).
//
// Public key is shipped with the binary (constant below). Private key
// never leaves the issuer's secure storage (kept outside this repo —
// see scripts/keygen/setup-keys.sh).
//
// Flow: customer installs → 7-day trial from first user login → pastes
// signed license JWT into Settings → backend verifies signature +
// machine_id binding + expiry → activates with tier limits.
// ============================================================

const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { jwtVerify, importSPKI } = require('jose');

// ── PUBLIC KEY ────────────────────────────────────────────────
// Replace the placeholder below by running scripts/keygen/setup-keys.sh
// once at deployment setup; the script generates an Ed25519 keypair,
// keeps the private key outside this repo, and prints the public block
// to paste in. The matching private key signs every license we issue.
//
// NEVER paste a private key here. If you see "BEGIN PRIVATE KEY" below,
// that's a leak — rotate immediately.
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAtiQByhtwR+EPV2gqTM+l1uNDjPbqxW2tDnoZy7mpLq8=
-----END PUBLIC KEY-----`;

// ── Tunables ──────────────────────────────────────────────────
const TRIAL_DAYS = 7;            // free trial length (from first login)
const GRACE_DAYS = 7;            // read-only grace window after expiry
const FINGERPRINT_LEN = 24;      // characters of sha256 hex to surface

// ── Machine fingerprint ───────────────────────────────────────
// Composite hash of stable system identifiers. PREFERS strong OS-level
// IDs (Linux /etc/machine-id, macOS IOPlatformUUID) and uses MAC only
// as a fallback when neither resolves — because modern macOS (Big Sur+)
// and modern Linux distros randomise NIC MACs for privacy ("Private
// Wi-Fi Address"), making a MAC-derived fingerprint flap every time
// the operator joins a new network. Outputs a stable 24-char string
// in 4 dash-separated groups for easy copy-paste.
//
// Interfaces we explicitly skip even in fallback mode:
//   awdl*, llw*  — Apple's continuity/AirDrop interfaces, MACs random
//   utun*        — VPN tunnels, ephemeral
//   bridge*, p2p* — virtual bridges, ephemeral
//   anbox*, docker*, veth* — container bridges, ephemeral
const SKIP_IFACE_RE = /^(awdl|llw|utun|bridge|p2p|anbox|docker|veth|virbr|tun|tap)/;
function _isLocallyAdministeredMac(mac) {
  // Second-least-significant bit of the first octet = locally
  // administered. macOS Private Wi-Fi Address sets this bit. We avoid
  // these MACs because they rotate (per-SSID on macOS Sequoia+, per
  // boot on iOS-style devices).
  if (!mac) return false;
  const first = parseInt(mac.split(':')[0], 16);
  return Number.isFinite(first) && (first & 0x02) !== 0;
}

let _cachedFingerprint = null;
function getMachineFingerprint() {
  if (_cachedFingerprint) return _cachedFingerprint;

  const parts = [];
  let hasStrong = false;

  // 1. Linux: /etc/machine-id (unique per OS install, stable for life of install)
  try {
    const id = fs.readFileSync('/etc/machine-id', 'utf8').trim();
    if (id && id.length > 8) { parts.push('mid:' + id); hasStrong = true; }
  } catch {}
  // 1b. Alt path on some distros
  try {
    const id = fs.readFileSync('/var/lib/dbus/machine-id', 'utf8').trim();
    if (id && id.length > 8 && !parts.some(p => p.endsWith(id))) {
      parts.push('dbus:' + id); hasStrong = true;
    }
  } catch {}

  // 2. macOS: IOPlatformUUID (unique per Mac, never changes outside a
  //    logic-board replacement or OS re-image)
  try {
    const out = execSync(
      "ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null | grep IOPlatformUUID",
      { encoding: 'utf8', timeout: 2000 }
    );
    const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
    if (m) { parts.push('ioreg:' + m[1]); hasStrong = true; }
  } catch {}

  // 3. MAC — ONLY if no strong source resolved (bare container, BSD,
  //    embedded box). On every normal install one of (1)/(2) succeeds
  //    and MAC is skipped, which is what saves us from privacy-MAC
  //    rotation breaking the fingerprint.
  if (!hasStrong) {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces).sort()) {
      if (SKIP_IFACE_RE.test(name)) continue;
      let found = false;
      for (const ni of ifaces[name]) {
        if (!ni.internal && ni.mac && ni.mac !== '00:00:00:00:00:00' && !_isLocallyAdministeredMac(ni.mac)) {
          parts.push('mac:' + ni.mac);
          found = true; break;
        }
      }
      if (found) break;
    }
  }

  // 4. CPU model + arch — extra entropy, doesn't change without re-image
  parts.push('cpu:' + os.arch() + '-' + (os.cpus()[0]?.model || 'unknown').replace(/\s+/g, '_'));

  // Final fallback if absolutely nothing else resolved (very rare —
  // e.g. minimal Alpine container with /etc/machine-id deleted and
  // no usable NICs).
  if (parts.length < 2) {
    parts.push('host:' + os.hostname());
    parts.push('totalmem:' + os.totalmem());
  }
  const hash = crypto.createHash('sha256').update(parts.join('|')).digest('hex');
  _cachedFingerprint = hash.substring(0, FINGERPRINT_LEN).match(/.{6}/g).join('-').toUpperCase();
  return _cachedFingerprint;
}

// ── Verify a license JWT ──────────────────────────────────────
// Returns { valid: bool, payload?, error? }. Errors are coarse-grained
// codes the API layer turns into Thai messages.
async function verifyLicense(token) {
  if (!token || typeof token !== 'string') return { valid: false, error: 'no_key' };
  if (LICENSE_PUBLIC_KEY.includes('PLACEHOLDER_PUBLIC_KEY')) {
    // Issuer hasn't run setup-keys.sh yet — skip verify, run open. This
    // only happens on a fresh dev clone before the operator has injected
    // the real public key.
    return { valid: false, error: 'public_key_not_configured' };
  }
  try {
    const publicKey = await importSPKI(LICENSE_PUBLIC_KEY, 'EdDSA');
    const { payload } = await jwtVerify(token.trim(), publicKey, {
      algorithms: ['EdDSA'],
    });
    // Machine binding — the licence is glued to the specific machine that
    // submitted the Machine ID at activation time. Copying the licence
    // string to a different machine fails this check.
    const fingerprint = getMachineFingerprint();
    if (payload.machine_id && payload.machine_id !== fingerprint) {
      return { valid: false, error: 'machine_mismatch', payload, current_machine_id: fingerprint };
    }
    return { valid: true, payload };
  } catch (e) {
    if (e.code === 'ERR_JWT_EXPIRED')                       return { valid: false, error: 'expired',           payload: e.payload };
    if (e.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') return { valid: false, error: 'invalid_signature' };
    if (e.code === 'ERR_JWS_INVALID')                       return { valid: false, error: 'malformed' };
    return { valid: false, error: 'verify_failed: ' + e.message };
  }
}

// ── License state ─────────────────────────────────────────────
// Coarse-grained modes the rest of the app reacts to:
//   LICENSED          — active paid license, full access
//   GRACE             — expired ≤ GRACE_DAYS days ago, read-only
//   EXPIRED           — past grace window, locked out
//   INVALID           — signature failed / machine mismatch / malformed
//   TRIAL             — no licence yet, within trial window
//   TRIAL_EXPIRED     — trial used up, no licence
//   TRIAL_NOT_STARTED — fresh install, no admin login yet (no banner needed)
async function computeLicenseState(pool) {
  const machine_id = getMachineFingerprint();
  const r = await pool.query(
    `SELECT key, value FROM system_settings
      WHERE key IN ('license_key', 'first_login_at')`
  );
  const settings = {};
  r.rows.forEach(row => { settings[row.key] = row.value || ''; });

  const licenseKey = settings.license_key.trim();
  if (licenseKey) {
    const result = await verifyLicense(licenseKey);
    if (result.valid) {
      const expMs = result.payload.exp * 1000;
      const daysLeft = Math.floor((expMs - Date.now()) / 86400000);
      if (daysLeft >= 0) {
        return { mode: 'LICENSED', payload: result.payload, days_left: daysLeft, machine_id };
      }
      const daysOver = Math.abs(daysLeft);
      if (daysOver <= GRACE_DAYS) {
        return {
          mode: 'GRACE', payload: result.payload,
          days_over: daysOver, grace_left: GRACE_DAYS - daysOver,
          machine_id,
        };
      }
      return { mode: 'EXPIRED', payload: result.payload, days_over: daysOver, machine_id };
    }
    return { mode: 'INVALID', reason: result.error, current_machine_id: result.current_machine_id, machine_id };
  }

  // No license — check trial window
  const firstLogin = settings.first_login_at;
  if (!firstLogin) return { mode: 'TRIAL_NOT_STARTED', machine_id };
  const trialStartMs = new Date(firstLogin).getTime();
  if (!Number.isFinite(trialStartMs)) return { mode: 'TRIAL_NOT_STARTED', machine_id };
  const trialEndMs = trialStartMs + TRIAL_DAYS * 86400000;
  const trialDaysLeft = Math.ceil((trialEndMs - Date.now()) / 86400000);
  if (trialDaysLeft > 0) {
    return { mode: 'TRIAL', trial_days_left: trialDaysLeft, machine_id, trial_started_at: firstLogin };
  }
  return { mode: 'TRIAL_EXPIRED', machine_id, trial_started_at: firstLogin };
}

// Record the first-ever successful user login. Called from auth.js on
// every successful login; short-circuits if already set. This is what
// kicks off the trial clock — not process boot — so a restart cycle
// can't reset the trial.
async function recordFirstLogin(pool) {
  try {
    const r = await pool.query(
      `SELECT value FROM system_settings WHERE key='first_login_at'`
    );
    if (r.rows[0]?.value) return;
    await pool.query(
      `UPDATE system_settings SET value=$1 WHERE key='first_login_at'`,
      [new Date().toISOString()]
    );
  } catch (e) { /* not fatal — trial just starts on next attempt */ }
}

// Save (or clear) the license key to system_settings. Caller is
// responsible for verifying the key before saving.
async function saveLicenseKey(pool, key) {
  await pool.query(
    `UPDATE system_settings SET value=$1 WHERE key='license_key'`,
    [String(key || '').trim()]
  );
}

// True when scripts/keygen/setup-keys.sh has been run and the public key
// block above has been pasted in. Used by the API layer to bypass license
// enforcement entirely on fresh dev clones (so a freshly-cloned repo isn't
// "locked out of itself" by an INVALID state).
function isPublicKeyConfigured() {
  return !LICENSE_PUBLIC_KEY.includes('PLACEHOLDER_PUBLIC_KEY');
}

module.exports = {
  TRIAL_DAYS,
  GRACE_DAYS,
  getMachineFingerprint,
  verifyLicense,
  computeLicenseState,
  recordFirstLogin,
  saveLicenseKey,
  isPublicKeyConfigured,
};
