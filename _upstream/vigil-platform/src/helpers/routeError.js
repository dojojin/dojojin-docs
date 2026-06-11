// ============================================================
// Vigil Platform — Route Error Helper
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================

/**
 * Handles route catch-block errors: logs full detail server-side,
 * returns a generic response to the client (SEC-2T-004).
 *
 * @param {import('express').Response} res
 * @param {Error} err
 * @param {string} context  - short label for server logs, e.g. 'GET /api/users'
 */
function routeError(res, err, context) {
  console.error(`[routeError] ${context}:`, err.message);
  res.status(500).json({ error: 'Internal server error', code: 'ERR_INTERNAL' });
}

module.exports = routeError;
