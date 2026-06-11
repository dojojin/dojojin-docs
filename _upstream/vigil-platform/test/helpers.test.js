// ============================================================
// Vigil Platform — Tests: helpers/routeError
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const routeError = require('../src/helpers/routeError');

function mockRes() {
  const calls = [];
  return {
    calls,
    status(code) {
      return {
        json(body) { calls.push({ code, body }); },
      };
    },
  };
}

describe('routeError', () => {
  it('responds with status 500 and generic error shape', () => {
    const res = mockRes();
    routeError(res, new Error('DB down'), 'GET /api/cameras');
    assert.equal(res.calls.length, 1);
    assert.equal(res.calls[0].code, 500);
    assert.equal(res.calls[0].body.error, 'Internal server error');
    assert.equal(res.calls[0].body.code, 'ERR_INTERNAL');
  });

  it('does not leak the internal error message to the client', () => {
    const res = mockRes();
    routeError(res, new Error('password=hunter2 exposed'), 'POST /api/login');
    assert.ok(!JSON.stringify(res.calls[0].body).includes('hunter2'), 'must not leak error text');
  });

  it('does not throw when err.message is undefined', () => {
    const res = mockRes();
    assert.doesNotThrow(() => routeError(res, {}, 'ctx'));
  });
});
