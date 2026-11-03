// ============================================================
// Vigil Platform — Tests: helpers/notifier.js pickFallbackChats() (T3)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// pickFallbackChats() is pure — no DB/network. lineResults must be the
// recipientsLog sendAlert()/_pushToAll() build: one entry per recipient, in
// the SAME ORDER as the `recipients` array passed to those senders (verified
// against src/line-sender.js sendAlert() and src/alert-engine.js _pushToAll(),
// both iterate `for (const r of recipients)` pushing one log entry each,
// success or fail, never skipping). pickFallbackChats() matches by index on
// that guarantee, since the log entries carry only name/id_tail, not the
// full recipient id.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { pickFallbackChats } = require('../src/helpers/notifier');

function ok(name) { return { name, ok: true, error: null }; }
function limitFail(name) { return { name, ok: false, error: 'You have reached your monthly limit.' }; }
function otherFail(name) { return { name, ok: false, error: 'Invalid reply token' }; }

describe('pickFallbackChats', () => {
  it('LINE ok → no fallback chat', () => {
    const recipients = [{ id: 'r1', name: 'Somchai' }];
    const chats = [{ chat_id: '-1', mirror_of_line_id: 'r1' }];
    assert.deepEqual(pickFallbackChats([ok('Somchai')], recipients, chats), []);
  });

  it('other error (not monthly limit) → no fallback chat', () => {
    const recipients = [{ id: 'r1', name: 'Somchai' }];
    const chats = [{ chat_id: '-1', mirror_of_line_id: 'r1' }];
    assert.deepEqual(pickFallbackChats([otherFail('Somchai')], recipients, chats), []);
  });

  it('monthly limit + mirror exists → that chat comes back', () => {
    const recipients = [{ id: 'r1', name: 'Somchai' }];
    const chats = [{ chat_id: '-100111', mirror_of_line_id: 'r1', enabled: true }];
    const r = pickFallbackChats([limitFail('Somchai')], recipients, chats);
    assert.equal(r.length, 1);
    assert.equal(r[0].chat_id, '-100111');
  });

  it('monthly limit but no chat mirrors that recipient → empty, no throw', () => {
    const recipients = [{ id: 'r1', name: 'Somchai' }];
    const chats = [{ chat_id: '-1', mirror_of_line_id: 'someone_else' }];
    assert.deepEqual(pickFallbackChats([limitFail('Somchai')], recipients, chats), []);
  });

  it('no chats at all → empty, no throw', () => {
    const recipients = [{ id: 'r1', name: 'Somchai' }];
    assert.deepEqual(pickFallbackChats([limitFail('Somchai')], recipients, []), []);
  });

  it('two chats mirror the same recipient → both come back', () => {
    const recipients = [{ id: 'r1', name: 'Somchai' }];
    const chats = [
      { chat_id: '-1', mirror_of_line_id: 'r1' },
      { chat_id: '-2', mirror_of_line_id: 'r1' },
    ];
    const r = pickFallbackChats([limitFail('Somchai')], recipients, chats);
    assert.deepEqual(r.map((c) => c.chat_id).sort(), ['-1', '-2']);
  });

  it('disabled mirror chat is not used', () => {
    const recipients = [{ id: 'r1', name: 'Somchai' }];
    const chats = [{ chat_id: '-1', mirror_of_line_id: 'r1', enabled: false }];
    assert.deepEqual(pickFallbackChats([limitFail('Somchai')], recipients, chats), []);
  });

  it('mixed: one recipient ok, one hits limit — only the failing one gets a fallback', () => {
    const recipients = [{ id: 'r1', name: 'A' }, { id: 'r2', name: 'B' }];
    const chats = [
      { chat_id: '-a', mirror_of_line_id: 'r1' },
      { chat_id: '-b', mirror_of_line_id: 'r2' },
    ];
    const r = pickFallbackChats([ok('A'), limitFail('B')], recipients, chats);
    assert.equal(r.length, 1);
    assert.equal(r[0].chat_id, '-b');
  });

  it('matching is positional (index), not by name — log carries no full id', () => {
    // Two recipients share a display name; only index tells them apart, exactly
    // like sendAlert()'s recipientsLog does in production.
    const recipients = [{ id: 'r1', name: 'Somchai' }, { id: 'r2', name: 'Somchai' }];
    const chats = [{ chat_id: '-2', mirror_of_line_id: 'r2' }];
    const r = pickFallbackChats([ok('Somchai'), limitFail('Somchai')], recipients, chats);
    assert.equal(r.length, 1);
    assert.equal(r[0].chat_id, '-2');
  });

  it('mismatched array lengths never throw — zips to the shorter one', () => {
    const recipients = [{ id: 'r1', name: 'A' }];
    assert.doesNotThrow(() => pickFallbackChats([limitFail('A'), limitFail('B')], recipients, []));
  });

  it('empty/undefined lineResults → empty, no throw', () => {
    assert.deepEqual(pickFallbackChats([], [{ id: 'r1' }], [{ chat_id: '-1', mirror_of_line_id: 'r1' }]), []);
    assert.deepEqual(pickFallbackChats(undefined, [{ id: 'r1' }], [{ chat_id: '-1', mirror_of_line_id: 'r1' }]), []);
  });
});
