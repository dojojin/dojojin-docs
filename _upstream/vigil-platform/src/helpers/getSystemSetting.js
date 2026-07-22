// ============================================================
// Vigil Platform — System Settings Cache Helper
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================

const _cache = new Map(); // key → { value, expiresAt }
const TTL_MS = 60_000;

async function getSystemSetting(pool, key) {
  const hit = _cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const { rows } = await pool.query(
    'SELECT value FROM system_settings WHERE key = $1', [key]
  );
  const value = rows[0]?.value ?? null;
  _cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

// Fetches multiple keys in a single query; returns { [key]: value|null }
async function getSystemSettings(pool, keys) {
  const missing = keys.filter(k => {
    const hit = _cache.get(k);
    return !(hit && hit.expiresAt > Date.now());
  });
  if (missing.length) {
    const { rows } = await pool.query(
      'SELECT key, value FROM system_settings WHERE key = ANY($1)', [missing]
    );
    for (const row of rows) {
      _cache.set(row.key, { value: row.value, expiresAt: Date.now() + TTL_MS });
    }
    // Cache nulls for keys not returned by DB so we don't re-query
    for (const k of missing) {
      if (!_cache.has(k)) _cache.set(k, { value: null, expiresAt: Date.now() + TTL_MS });
    }
  }
  return Object.fromEntries(keys.map(k => [k, _cache.get(k)?.value ?? null]));
}

function invalidateSystemSetting(key) {
  _cache.delete(key);
}

module.exports = { getSystemSetting, getSystemSettings, invalidateSystemSetting };
