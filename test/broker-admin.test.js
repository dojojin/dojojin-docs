// ============================================================
// Vigil Platform — Tests: brokerAdmin (mosquitto migration M1)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Two things this file has to prove:
//
//   1. BROKER_KIND=emqx must be a byte-identical replay of the pre-migration
//      REST calls. The literal request shapes below (method/path/headers/body)
//      were transcribed directly from the code being replaced — read line by
//      line before deletion — not reconstructed from the plan doc:
//        - upsertUser        ← routes/cameras.js _emqxProvisionCamera
//                             + site-provision.js upsertEmqxUser (identical shape)
//        - setSiteAcl        ← site-provision.js setEdgeAcl
//        - listConnectedUsers← api-server.js _emqxConnectedUsernames (GET only,
//                              NO Content-Type header — deliberately different
//                              from the other calls, which all send one)
//        - publish           ← helpers/emqxPublish.js (also matches the inline
//                              login+publish that publishSiteConfig.js /
//                              publishSiteRetention.js carried before this
//                              migration — those three were already identical)
//        - ensureAuthzSource ← site-provision.js ensureAuthzBuiltInDb
//      fetch() itself is mocked so nothing ever reaches a real broker.
//
//   2. BROKER_KIND=mosquitto sends the dynsec command JSON the isolated spike
//      (scratchpad/mq/spike.js, 14/14 pass against a throwaway broker) proved
//      works, and rejects when a dynsec response carries an error.
//      🟡 idempotent-retry paths (client/role that already exists) are
//      UNVERIFIED against a real dynsec plugin — only the happy path was
//      exercised on the real spike broker. Marked, not silently assumed.
// ============================================================
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const EventEmitter = require('events');

const MODULE_PATH = path.join(__dirname, '..', 'src', 'helpers', 'brokerAdmin.js');
const MQTT_PATH = require.resolve('mqtt', { paths: [path.join(__dirname, '..', 'src', 'helpers')] });

function freshBrokerAdmin() {
  delete require.cache[MODULE_PATH];
  return require(MODULE_PATH);
}

function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; process.env[k] = vars[k]; }
  return Promise.resolve().then(fn).finally(() => {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
    }
  });
}

// ── fetch recorder — every emqx-mode test replays a scripted response queue
// and records every call it saw, so the assertion is against the exact
// [method, url, headers, body] tuple, not just "some POST happened". ──
function installFakeFetch(responses) {
  const calls = [];
  const prevFetch = global.fetch;
  let i = 0;
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return { ok: r.ok !== false, status: r.status || 200, json: async () => r.json, text: async () => JSON.stringify(r.json) };
  };
  return { calls, restore: () => { global.fetch = prevFetch; } };
}

function installFakeMqtt(makeClient) {
  const prev = require.cache[MQTT_PATH];
  require.cache[MQTT_PATH] = { id: MQTT_PATH, filename: MQTT_PATH, loaded: true, exports: { connect: () => makeClient() } };
  return () => { if (prev) require.cache[MQTT_PATH] = prev; else delete require.cache[MQTT_PATH]; };
}

// Fake dynsec broker: answers every publish to $CONTROL/dynamic-security/v1
// with a scripted response, batch-matched by call order (mirrors the real
// plugin's one-request/one-response-array-in-order shape the spike observed).
function fakeDynsecClient(scriptFn) {
  const c = new EventEmitter();
  c.connected = false;
  c.sentBatches = [];
  c.subscribe = (_topic, _opts, cb) => cb(null, [{ qos: 1 }]);
  c.publish = (topic, payload) => {
    if (topic !== '$CONTROL/dynamic-security/v1') return;
    const { commands } = JSON.parse(payload);
    c.sentBatches.push(commands);
    const responses = scriptFn(commands);
    setImmediate(() => c.emit('message', '$CONTROL/dynamic-security/v1/response', Buffer.from(JSON.stringify({ responses }))));
  };
  c.end = () => {};
  setImmediate(() => { c.connected = true; c.emit('connect'); });
  return c;
}

// ================================================================
// emqx mode — golden equivalence
// ================================================================

test('emqx: upsertUser create — same login+POST shape as the old _emqxProvisionCamera/upsertEmqxUser', async () => {
  await withEnv({ BROKER_KIND: 'emqx', EMQX_DASHBOARD_PASSWORD: 'dashpw' }, async () => {
    const { calls, restore } = installFakeFetch([
      { json: { token: 'tok1' } },
      { json: {}, status: 204 },
    ]);
    try {
      const brokerAdmin = freshBrokerAdmin();
      const action = await brokerAdmin.upsertUser('cam-c28', 'secret-pw');
      assert.equal(action, 'created');
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[0], {
        url: 'http://localhost:18083/api/v5/login', method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'dashpw' }),
      });
      assert.equal(calls[1].url, 'http://localhost:18083/api/v5/authentication/password_based%3Abuilt_in_database/users');
      assert.equal(calls[1].method, 'POST');
      assert.deepEqual(calls[1].headers, { 'Content-Type': 'application/json', Authorization: 'Bearer tok1' });
      assert.equal(calls[1].body, JSON.stringify({ user_id: 'cam-c28', password: 'secret-pw', is_superuser: false }));
    } finally { restore(); }
  });
});

test('emqx: upsertUser 409 → falls back to PUT (existing-user path)', async () => {
  await withEnv({ BROKER_KIND: 'emqx', EMQX_DASHBOARD_PASSWORD: 'dashpw' }, async () => {
    const { calls, restore } = installFakeFetch([
      { json: { token: 'tok1' } },
      { json: {}, status: 409, ok: false },
      { json: {}, status: 200 },
    ]);
    try {
      const brokerAdmin = freshBrokerAdmin();
      const action = await brokerAdmin.upsertUser('cam-c28', 'new-pw');
      assert.equal(action, 'updated');
      assert.equal(calls[2].url, 'http://localhost:18083/api/v5/authentication/password_based%3Abuilt_in_database/users/cam-c28');
      assert.equal(calls[2].method, 'PUT');
      assert.equal(calls[2].body, JSON.stringify({ password: 'new-pw', is_superuser: false }));
    } finally { restore(); }
  });
});

test('emqx: setSiteAcl — same bulk-POST/PUT-fallback shape as setEdgeAcl', async () => {
  await withEnv({ BROKER_KIND: 'emqx', EMQX_DASHBOARD_PASSWORD: 'dashpw' }, async () => {
    const { calls, restore } = installFakeFetch([
      { json: { token: 'tok1' } },
      { json: {}, status: 200 },
    ]);
    try {
      const brokerAdmin = freshBrokerAdmin();
      const action = await brokerAdmin.setSiteAcl('edge-hdy', 'hdy');
      assert.equal(action, 'created');
      assert.equal(calls[1].url, 'http://localhost:18083/api/v5/authorization/sources/built_in_database/rules/users');
      assert.equal(calls[1].method, 'POST');
      assert.equal(calls[1].body, JSON.stringify([{ username: 'edge-hdy', rules: [{ topic: 'projects/hdy/#', action: 'all', permission: 'allow' }] }]));
    } finally { restore(); }
  });
});

test('emqx: listConnectedUsers — GET only, NO Content-Type (matches _emqxConnectedUsernames exactly)', async () => {
  await withEnv({ BROKER_KIND: 'emqx', EMQX_DASHBOARD_PASSWORD: 'dashpw' }, async () => {
    const { calls, restore } = installFakeFetch([
      { json: { token: 'tok1' } },
      { json: { data: [{ username: 'edge-hdy', connected: true }, { username: 'edge-hkt', connected: false }] } },
    ]);
    try {
      const brokerAdmin = freshBrokerAdmin();
      const set = await brokerAdmin.listConnectedUsers();
      assert.deepEqual([...set], ['edge-hdy']);
      assert.equal(calls[1].url, 'http://localhost:18083/api/v5/clients?limit=200');
      assert.equal(calls[1].method, 'GET');
      assert.deepEqual(calls[1].headers, { Authorization: 'Bearer tok1' }, 'must NOT send Content-Type on this GET');
    } finally { restore(); }
  });
});

test('emqx: listConnectedUsers — never throws, returns null on any failure', async () => {
  await withEnv({ BROKER_KIND: 'emqx', EMQX_DASHBOARD_PASSWORD: 'dashpw' }, async () => {
    const prevFetch = global.fetch;
    global.fetch = async () => { throw new Error('network blip'); };
    try {
      const brokerAdmin = freshBrokerAdmin();
      assert.equal(await brokerAdmin.listConnectedUsers(), null);
    } finally { global.fetch = prevFetch; }
  });
});

test('emqx: listConnectedUsers — null when EMQX_DASHBOARD_PASSWORD is unset (no fetch at all)', async () => {
  await withEnv({ BROKER_KIND: 'emqx', EMQX_DASHBOARD_PASSWORD: '' }, async () => {
    let called = false;
    const prevFetch = global.fetch;
    global.fetch = async () => { called = true; throw new Error('must not be called'); };
    try {
      const brokerAdmin = freshBrokerAdmin();
      assert.equal(await brokerAdmin.listConnectedUsers(), null);
      assert.equal(called, false);
    } finally { global.fetch = prevFetch; }
  });
});

test('emqx: publish — same login+/publish shape as helpers/emqxPublish.js', async () => {
  await withEnv({ BROKER_KIND: 'emqx', EMQX_DASHBOARD_PASSWORD: 'dashpw' }, async () => {
    const { calls, restore } = installFakeFetch([
      { json: { token: 'tok1' } },
      { json: {}, status: 200 },
    ]);
    try {
      const brokerAdmin = freshBrokerAdmin();
      await brokerAdmin.publish('projects/hdy/_config/cameras', { version: 123, cameras: [] }, { qos: 1, retain: true });
      assert.equal(calls[1].url, 'http://localhost:18083/api/v5/publish');
      assert.equal(calls[1].method, 'POST');
      assert.equal(calls[1].body, JSON.stringify({
        topic: 'projects/hdy/_config/cameras',
        payload: JSON.stringify({ version: 123, cameras: [] }),
        qos: 1, retain: true,
      }));
    } finally { restore(); }
  });
});

test('emqx: publish — throws same-shaped error as emqxPublish.js when not configured', async () => {
  await withEnv({ BROKER_KIND: 'emqx', EMQX_DASHBOARD_PASSWORD: '' }, async () => {
    const brokerAdmin = freshBrokerAdmin();
    await assert.rejects(() => brokerAdmin.publish('x', {}), /EMQX_DASHBOARD_PASSWORD not set/);
  });
});

test('emqx: isConfigured() true/false tracks EMQX_DASHBOARD_PASSWORD regardless of "as"', async () => {
  await withEnv({ BROKER_KIND: 'emqx', EMQX_DASHBOARD_PASSWORD: 'x' }, async () => {
    const brokerAdmin = freshBrokerAdmin();
    assert.equal(brokerAdmin.isConfigured(), true);
    assert.equal(brokerAdmin.isConfigured({ as: 'publisher' }), true);
  });
  await withEnv({ BROKER_KIND: 'emqx', EMQX_DASHBOARD_PASSWORD: '' }, async () => {
    const brokerAdmin = freshBrokerAdmin();
    assert.equal(brokerAdmin.isConfigured(), false);
  });
});

test('emqx: ensureAuthzSource — GET then conditional POST, matches ensureAuthzBuiltInDb', async () => {
  await withEnv({ BROKER_KIND: 'emqx', EMQX_DASHBOARD_PASSWORD: 'dashpw' }, async () => {
    const { calls, restore } = installFakeFetch([
      { json: { token: 'tok1' } },
      { json: { sources: [] } },
      { json: {}, status: 200 },
    ]);
    try {
      const brokerAdmin = freshBrokerAdmin();
      const r = await brokerAdmin.ensureAuthzSource();
      assert.equal(r, 'created');
      assert.equal(calls[2].url, 'http://localhost:18083/api/v5/authorization/sources');
      assert.equal(calls[2].method, 'POST');
      assert.equal(calls[2].body, JSON.stringify({ type: 'built_in_database', enable: true }));
    } finally { restore(); }
  });
});

// ================================================================
// mosquitto mode — dynsec command shapes (per the spike)
// ================================================================

test('mosquitto: upsertUser — createClient with the requested role', async () => {
  await withEnv({ BROKER_KIND: 'mosquitto', MQTT_PROVISIONER_USER: 'prov', MQTT_PROVISIONER_PASSWORD: 'pw' }, async () => {
    let client;
    const restore = installFakeMqtt(() => (client = fakeDynsecClient((cmds) => cmds.map(() => ({})))));
    try {
      const brokerAdmin = freshBrokerAdmin();
      const action = await brokerAdmin.upsertUser('edge-hdy', 'edgepw', { role: 'site-hdy' });
      assert.equal(action, 'created');
      assert.deepEqual(client.sentBatches[0], [
        { command: 'createClient', username: 'edge-hdy', password: 'edgepw', roles: [{ rolename: 'site-hdy' }] },
      ]);
    } finally { restore(); }
  });
});

test('mosquitto: upsertUser — existing client falls back to setClientPassword + addClientRole', async () => {
  await withEnv({ BROKER_KIND: 'mosquitto', MQTT_PROVISIONER_USER: 'prov', MQTT_PROVISIONER_PASSWORD: 'pw' }, async () => {
    let call = 0;
    let client;
    const restore = installFakeMqtt(() => (client = fakeDynsecClient((cmds) => {
      call++;
      if (call === 1) return [{ error: 'Client already exists' }];
      return cmds.map((c) => (c.command === 'getClient' ? { data: { client: { roles: [] } } } : {}));
    })));
    try {
      const brokerAdmin = freshBrokerAdmin();
      const action = await brokerAdmin.upsertUser('edge-hdy', 'newpw', { role: 'site-hdy' });
      assert.equal(action, 'updated');
      assert.deepEqual(client.sentBatches[1], [{ command: 'setClientPassword', username: 'edge-hdy', password: 'newpw' }]);
      assert.deepEqual(client.sentBatches[2], [{ command: 'getClient', username: 'edge-hdy' }]);
      assert.deepEqual(client.sentBatches[3], [{ command: 'addClientRole', username: 'edge-hdy', rolename: 'site-hdy' }]);
    } finally { restore(); }
  });
});

test('mosquitto: upsertUser — throws when dynsec returns an unrelated error', async () => {
  await withEnv({ BROKER_KIND: 'mosquitto', MQTT_PROVISIONER_USER: 'prov', MQTT_PROVISIONER_PASSWORD: 'pw' }, async () => {
    const restore = installFakeMqtt(() => fakeDynsecClient(() => [{ error: 'permission denied' }]));
    try {
      const brokerAdmin = freshBrokerAdmin();
      await assert.rejects(() => brokerAdmin.upsertUser('cam-x', 'pw'), /permission denied/);
    } finally { restore(); }
  });
});

test('mosquitto: setSiteAcl — createRole + addRoleACL (publishClientSend + subscribePattern) + addClientRole', async () => {
  await withEnv({ BROKER_KIND: 'mosquitto', MQTT_PROVISIONER_USER: 'prov', MQTT_PROVISIONER_PASSWORD: 'pw' }, async () => {
    let client;
    const restore = installFakeMqtt(() => (client = fakeDynsecClient((cmds) =>
      cmds.map((c) => (c.command === 'getClient' ? { data: { client: { roles: [] } } } : {})))));
    try {
      const brokerAdmin = freshBrokerAdmin();
      await brokerAdmin.setSiteAcl('edge-hdy', 'hdy');
      assert.deepEqual(client.sentBatches[0], [
        { command: 'createRole', rolename: 'site-hdy' },
        { command: 'addRoleACL', rolename: 'site-hdy', acltype: 'publishClientSend', topic: 'projects/hdy/#', allow: true },
        { command: 'addRoleACL', rolename: 'site-hdy', acltype: 'subscribePattern', topic: 'projects/hdy/_config/#', allow: true },
      ]);
      assert.deepEqual(client.sentBatches[1], [{ command: 'getClient', username: 'edge-hdy' }]);
      assert.deepEqual(client.sentBatches[2], [{ command: 'addClientRole', username: 'edge-hdy', rolename: 'site-hdy' }]);
    } finally { restore(); }
  });
});

// เจอจริงกับ Mosquitto 2.1.2 (27 ก.ย. 2569): addClientRole ซ้ำ role เดิมตอบ "Internal error"
// ⇒ ต้องดู getClient ก่อน ห้ามส่ง addClientRole ถ้ามี role อยู่แล้ว
test('mosquitto: setSiteAcl re-run — role already assigned ⇒ no addClientRole sent', async () => {
  await withEnv({ BROKER_KIND: 'mosquitto', MQTT_PROVISIONER_USER: 'prov', MQTT_PROVISIONER_PASSWORD: 'pw' }, async () => {
    let client;
    const restore = installFakeMqtt(() => (client = fakeDynsecClient((cmds) => cmds.map((c) => {
      if (c.command === 'createRole') return { error: 'Role already exists' };
      if (c.command === 'getClient') return { data: { client: { roles: [{ rolename: 'site-hdy' }] } } };
      if (c.command === 'addClientRole') return { error: 'Internal error' };
      return {};
    }))));
    try {
      const brokerAdmin = freshBrokerAdmin();
      await assert.doesNotReject(() => brokerAdmin.setSiteAcl('edge-hdy', 'hdy'));
      assert.ok(!client.sentBatches.flat().some((c) => c.command === 'addClientRole'));
    } finally { restore(); }
  });
});

test('mosquitto: setSiteAcl — "already exists" on re-apply is not an error', async () => {
  await withEnv({ BROKER_KIND: 'mosquitto', MQTT_PROVISIONER_USER: 'prov', MQTT_PROVISIONER_PASSWORD: 'pw' }, async () => {
    const restore = installFakeMqtt(() => fakeDynsecClient((cmds) => cmds.map((c) =>
      c.command === 'createRole' ? { error: 'Role already exists' } : {})));
    try {
      const brokerAdmin = freshBrokerAdmin();
      await assert.doesNotReject(() => brokerAdmin.setSiteAcl('edge-hdy', 'hdy'));
    } finally { restore(); }
  });
});

test('mosquitto: listConnectedUsers is always null — dynsec cannot tell who is live', async () => {
  await withEnv({ BROKER_KIND: 'mosquitto', MQTT_PROVISIONER_USER: 'prov', MQTT_PROVISIONER_PASSWORD: 'pw' }, async () => {
    const brokerAdmin = freshBrokerAdmin();
    assert.equal(await brokerAdmin.listConnectedUsers(), null);
  });
});

test('mosquitto: ensureAuthzSource is a no-op', async () => {
  await withEnv({ BROKER_KIND: 'mosquitto', MQTT_PROVISIONER_USER: 'prov', MQTT_PROVISIONER_PASSWORD: 'pw' }, async () => {
    const brokerAdmin = freshBrokerAdmin();
    assert.equal(await brokerAdmin.ensureAuthzSource(), 'n/a');
  });
});

test('mosquitto: isConfigured() checks provisioner vs publisher creds separately', async () => {
  await withEnv({
    BROKER_KIND: 'mosquitto',
    MQTT_PROVISIONER_USER: 'prov', MQTT_PROVISIONER_PASSWORD: 'pw',
    MQTT_PUBLISHER_USER: '', MQTT_PUBLISHER_PASSWORD: '',
  }, async () => {
    const brokerAdmin = freshBrokerAdmin();
    assert.equal(brokerAdmin.isConfigured(), true);
    assert.equal(brokerAdmin.isConfigured({ as: 'provisioner' }), true);
    assert.equal(brokerAdmin.isConfigured({ as: 'publisher' }), false);
  });
});

test('mosquitto: clientExists — true when getClient returns no error, false on "not found"', async () => {
  await withEnv({ BROKER_KIND: 'mosquitto', MQTT_PROVISIONER_USER: 'prov', MQTT_PROVISIONER_PASSWORD: 'pw' }, async () => {
    let client;
    const restore = installFakeMqtt(() => (client = fakeDynsecClient((cmds) =>
      cmds.map((c) => (c.username === 'edge-hdy' ? { data: { client: { roles: [] } } } : { error: 'Client not found' })))));
    try {
      const brokerAdmin = freshBrokerAdmin();
      assert.equal(await brokerAdmin.clientExists('edge-hdy'), true);
      assert.equal(await brokerAdmin.clientExists('edge-ghost'), false);
    } finally { restore(); }
  });
});

test('emqx: clientExists — not supported, throws rather than guessing', async () => {
  await withEnv({ BROKER_KIND: 'emqx', EMQX_DASHBOARD_PASSWORD: 'dashpw' }, async () => {
    const brokerAdmin = freshBrokerAdmin();
    await assert.rejects(() => brokerAdmin.clientExists('cam-x'), /mosquitto only/);
  });
});

test('BROKER_KIND default (unset) behaves as emqx', async () => {
  await withEnv({ BROKER_KIND: '' }, async () => {
    const brokerAdmin = freshBrokerAdmin();
    assert.equal(brokerAdmin._kind(), 'emqx');
  });
});
