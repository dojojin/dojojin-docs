// ============================================================
// Vigil Platform — OpenAPI generator (Phase TP3)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// Builds an OpenAPI 3.1 document describing what THIS consumer can actually
// call, at the moment they ask.
//
// The point is that it cannot be wrong. docs/REF_api-reference.md is written
// by hand and drifts the moment someone forgets to update it; a document
// derived from the routes we serve and the grants Postgres holds drifts only
// if the system itself changed. Two partners with different grants get
// different documents, and neither describes a column they would be refused.
//
// Emitted as JSON, not YAML. OpenAPI 3.1 accepts either, JSON is what Node
// produces without a dependency, and every tool that reads the format reads
// JSON. Hand-rolling a YAML emitter to satisfy a file extension would be code
// to maintain for no gain.
// ============================================================
'use strict';

const { resolveColumns, ENDPOINTS, PARAM_DOCS, pgType, PAGE_MAX, SKEW_MINUTES } = require('./helpers/partnerSchema');

/**
 * Columns of `view` that `dbRole` may actually SELECT.
 *
 * has_column_privilege(), NOT information_schema.column_privileges. The latter
 * lists only grants made directly to the named role, so a consumer that
 * inherits third_party_readonly — which is every consumer partner-admin
 * creates — shows up with zero columns and the generated document would claim
 * they can read nothing. Verified: an inheriting role reads 0 from
 * column_privileges and 14 of 14 from has_column_privilege.
 */
async function readableColumns(client, dbRole, view) {
  const { rows } = await client.query(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
        AND has_column_privilege($2, quote_ident($1), column_name, 'SELECT')
      ORDER BY ordinal_position`,
    [view, dbRole]);
  return rows;
}

// FC1 — อายุข้อมูลที่บอก partner ต้องมาจากค่าจริง ไม่ใช่ตัวเลขที่พิมพ์ทิ้งไว้
//
// สองอย่างที่ไม่เท่ากันและ partner ต้องรู้ทั้งคู่:
//   ค่าที่ตั้งไว้  — system_settings.<retentionKey> · เปลี่ยนได้ทุกเมื่อจากหน้าตั้งค่า
//   ที่มีอยู่จริง — min(timeColumn) ของ view นั้น · ระบบยังใหม่กว่า retention ที่ตั้ง
//                  ก็ได้ (LPR ตั้ง 365 แต่มีจริง 35 วันเมื่อ 2026-08-08) หรือสั้นกว่าก็ได้
//                  ถ้า pruner เพิ่งวิ่ง
//
// อ่านตอน generate ทุกครั้ง เพราะถ้าฝังตัวเลขไว้ วันที่เจ้าของแก้ค่าในหน้าตั้งค่า
// เอกสารจะเริ่มโกหกทันทีโดยไม่มีใครรู้ · min() บนคอลัมน์ที่มี index วัดได้ 0.4 ms
// (idx_appearances_time_id / idx_plates_detected_at) จึงไม่ต้องแคช
async function retentionFacts(client, ep) {
  if (!ep.retentionKey || !ep.timeColumn) return null;
  let configured = null, oldest = null;
  try {
    const r = await client.query('SELECT value FROM system_settings WHERE key = $1', [ep.retentionKey]);
    configured = r.rows[0] ? parseInt(r.rows[0].value, 10) : null;
  } catch { /* ไม่มีค่า = ไม่พูดถึง ดีกว่าพูดผิด */ }
  try {
    const r = await client.query(`SELECT min(${ep.timeColumn}) AS m FROM ${ep.view}`);
    oldest = r.rows[0] && r.rows[0].m;
  } catch { /* view อ่านไม่ได้ = ข้าม */ }
  if (configured == null && !oldest) return null;
  return { configured, oldest };
}

function retentionText(f) {
  if (!f) return '';
  const parts = [];
  if (f.configured != null) parts.push(`Retained for **${f.configured} days** by policy.`);
  if (f.oldest) {
    const days = Math.floor((Date.now() - new Date(f.oldest).getTime()) / 86400000);
    parts.push(`The oldest row available right now is ${new Date(f.oldest).toISOString().slice(0, 10)} ` +
      `(${days} days back)` +
      (f.configured != null && days < f.configured - 1
        ? ` — **less than the ${f.configured}-day policy**, because the system has not been collecting that long yet.`
        : '.'));
  }
  parts.push('Asking for anything older returns `400`, not an empty page — you will be told the ' +
    'earliest date we actually hold. **Images expire far sooner than rows do.**');
  return '\n\n**History.** ' + parts.join(' ');
}

/**
 * @param {object} client   a pg client (the admin pool — this reads catalogues,
 *                          not partner data, and must see grants the partner
 *                          role itself cannot introspect)
 * @param {object} consumer row from api_consumers
 * @param {string} baseUrl  public origin, e.g. https://dashboard.dojojin.tech
 */
async function buildSpec(client, consumer, baseUrl) {
  const paths = {};
  const schemas = {};
  const omitted = [];

  for (const ep of ENDPOINTS) {
    const readable = await readableColumns(client, consumer.db_role, ep.view);
    const readableNames = new Set(readable.map((r) => r.column_name));
    const { cols, missingRequired } = resolveColumns(ep, readableNames);

    // The endpoint sends only the granted columns. If a required one (id, time,
    // camera_id) is missing, the call returns 403 — describing it would be
    // describing something that does not work, so it is left out.
    if (missingRequired.length) {
      omitted.push({ path: ep.path, missing: missingRequired });
      continue;
    }

    const props = {};
    for (const c of cols) {
      props[c] = pgType(readable.find((r) => r.column_name === c).data_type);
    }
    const rowSchema = `${ep.id}Row`;
    schemas[rowSchema] = { type: 'object', properties: props };

    const op = {
      operationId: ep.id,
      summary: ep.summary,
      description: ep.description + retentionText(await retentionFacts(client, ep)),
      responses: {
        200: {
          description: 'Success',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['data', 'nextCursor', 'pageSize'],
                properties: {
                  data: { type: 'array', items: { $ref: `#/components/schemas/${rowSchema}` } },
                  nextCursor: {
                    type: ['string', 'null'],
                    description: 'Pass to the next call. Null means there is nothing further right now.',
                  },
                  pageSize: { type: 'integer' },
                },
              },
            },
          },
        },
        400: { $ref: '#/components/responses/Problem' },
        401: { $ref: '#/components/responses/Problem' },
        403: { $ref: '#/components/responses/Problem' },
        429: { $ref: '#/components/responses/Problem' },
        503: { $ref: '#/components/responses/Problem' },
      },
    };

    if (ep.method === 'get') {
      op.parameters = (ep.params || []).map((name) => ({
        name, ...PARAM_DOCS[name],
        required: (ep.requiredParams || []).includes(name),
      }));
    } else {
      op.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['plate'],
              properties: {
                plate: { type: 'string', maxLength: 32, description: 'Plate text. Thai is fine here — that is why this is a POST.' },
                exact: { type: 'boolean', default: true, description: 'False for a substring match, which needs 3+ characters and a `since`.' },
                since: { type: 'string', format: 'date-time' },
                until: { type: 'string', format: 'date-time' },
                pageSize: { type: 'integer', minimum: 1, maximum: PAGE_MAX, default: 100 },
                cursor: { type: 'string' },
                cameraId: { type: 'string' },
              },
            },
          },
        },
      };
    }

    paths[ep.path] = { ...(paths[ep.path] || {}), [ep.method]: op };
  }

  // healthz is always available and takes no grants — it proves the signature
  // works and the consumer's database role is assumable, which is what a
  // partner wants to check first and what we want them to check first.
  paths['/v1/healthz'] = {
    get: {
      operationId: 'healthz',
      summary: 'Verify credentials and connectivity',
      description: 'Round-trips through this consumer\'s database role, so a 200 proves signing works AND the role is usable.',
      responses: {
        200: {
          description: 'Success',
          content: { 'application/json': { schema: { type: 'object', properties: {
            ok: { type: 'boolean' }, consumer: { type: 'string' },
            label: { type: 'string' }, dbRole: { type: 'string' },
            serverTime: { type: 'string', format: 'date-time' },
          } } } },
        },
        401: { $ref: '#/components/responses/Problem' },
      },
    },
  };

  let description =
    `Generated for **${consumer.label}** from the routes this server actually serves and the ` +
    `grants Postgres actually holds. It is not maintained by hand and cannot describe something ` +
    `you would be refused.\n\n` +
    `**Signing.** Every request carries \`X-Ca-Key\`, \`X-Ca-Nonce\` (fresh per request), ` +
    `\`X-Ca-Timestamp\` (epoch ms, within ${SKEW_MINUTES} minutes of server time) and ` +
    `\`X-Ca-Signature\` — base64 HMAC-SHA256 over:\n\n` +
    '```\n' +
    'METHOD \\n Accept \\n [Content-MD5 \\n] Content-Type \\n\n' +
    '<signed headers, "name:value\\n", sorted>\n' +
    '<path with query params sorted>\n' +
    '```\n\n' +
    'Sign the full path including `/v1`. **A header you do not send contributes no line at all — ' +
    'not an empty one.** Content-MD5 appears only when there is a body; there is no `Date` line ' +
    'because we do not use one (`X-Ca-Timestamp` carries the time). A bodiless request therefore ' +
    'has three lines before the header block, not five, and the signed string never contains a ' +
    'blank line.\n\n' +
    '**Query values must be ASCII.** Non-ASCII cannot be signed unambiguously and is refused with ' +
    '`400 non-ascii-query`. Use `POST /v1/lpr/search` for Thai plate text.\n\n' +
    `**Limits.** ${consumer.rate_per_min || 60} requests per minute (429 with \`Retry-After\`), ` +
    `page size up to ${PAGE_MAX}, and a 5 second ceiling per query (503 if exceeded).\n\n` +

    // CP1 — what may change inside v1, published to the partner rather than kept
    // in our heads. Written while there are zero live partners, which is the
    // only moment we can commit to it without negotiating: on 2026-08-08 the
    // signing layout was corrected three times in one day, and each of those
    // would have silently broken a live integration with `bad-signature`
    // forever. Stating the rule is what makes the next such fix a versioned
    // change instead of an outage.
    `**Compatibility.** Inside \`/v1\` we may: add a field to a response, add an ` +
    `optional query or body parameter, and add a new endpoint. **Your client must ` +
    `ignore fields it does not recognise** — if it rejects unknown fields, then ` +
    `adding one breaks you and the rule above cannot protect you.\n\n` +
    `We will not, inside \`/v1\`: remove or rename a field, change a field's type or ` +
    `meaning, make an optional parameter required, or change the string-to-sign ` +
    `layout. Those arrive as \`/v2\` with \`/v1\` kept alive during a stated ` +
    `overlap.\n\n` +
    `**One thing is scoped to you, not to the version.** Your column grants can be ` +
    `narrowed by the operator: a field you do not hold is simply absent from the rows ` +
    `(this document lists exactly the fields you receive), and an endpoint whose key fields ` +
    `you do not hold returns \`403 not-permitted\`.\n\n` +

    // CP3 — เจ้าของเลือก "ประกาศรูปแบบเป็นสัญญา" 2026-08-08
    // ข้อความเดิมบอกว่า cursor เป็น opaque และเราเปลี่ยนได้ ทั้งที่มันคือ base64url
    // ของ JSON ธรรมดาที่ partner แกะอ่านได้ทันที · เอกสารที่พูดไม่ตรงกับโค้ดคือ
    // ความผิดคลาสเดียวกับที่ทำให้เสียเวลาทั้งวันกับ hcpSign — จึงประกาศตามจริง
    `**\`nextCursor\`.** It is \`base64url\` of a JSON object: ` +
    `\`{"v":1,"t":"<sort time of the last row>","i":"<id of the last row>"}\`. ` +
    // ค่าจริงคือ '2026-08-08 03:51:20.148+00' — รูปแบบที่ Postgres พิมพ์ ไม่ใช่ RFC 3339
    // ตั้งใจไม่แปลง เพราะแปลงแล้วเสี่ยงเสียความละเอียดของ timestamp ที่ใช้เทียบใน keyset
    // แต่พอประกาศเป็นสัญญาแล้วต้องบอกตรง ๆ ไม่งั้น client ภาษาอื่นจะ parse พัง
    `\`t\` is the timestamp exactly as the database rendered it — parse it, do not assume ` +
    `RFC 3339 — a calendar date (\`YYYY-MM-DD\`) on daily statistics, and the string \`"0"\` on ` +
    `endpoints that have no time dimension. \`i\` is the row's \`id\`, or its \`camera_id\` on the ` +
    `\`/v1/stats/*\` endpoints, whose rows are summaries without an id. ` +
    `This shape is part of \`/v1\` — we will not ` +
    `change or remove \`v\`, \`t\` or \`i\` without a \`/v2\`, though we may add fields, ` +
    `which your client must ignore. Continue from the value we returned rather than ` +
    `building one yourself; a cursor we did not issue is not guaranteed to land where you ` +
    `expect.\n\n` +

    // FC3 — ปลดล็อกโดย CP3: จะบอกวิธีตรวจ "ช่วงที่หายไป" ได้ก็ต่อเมื่อ t อ่านได้
    `**A cursor does not expire, but the data behind it does.** We keep no server-side ` +
    `state for it — it is a position, not a session — so a cursor from last year is still ` +
    `accepted. What moves is the data: retention prunes from the old end (see each ` +
    `endpoint below). If you stop polling for longer than the retention window, the rows ` +
    `between your cursor and the oldest row we still hold are gone, and resuming will ` +
    `**not** error — the feed simply continues from the oldest surviving row. Decode \`t\` ` +
    `and compare it with the first row you get back: a jump larger than your polling ` +
    `interval is a gap, and it is permanent. \`since\` is the one place we do raise this, ` +
    `as \`400 since-too-old\`, because there we can tell you asked for something we never ` +
    `still had.`;

  if (consumer.site_codes && consumer.site_codes.length) {
    description += `\n\n**Scope.** Limited to site(s): ${consumer.site_codes.join(', ')}. ` +
      `Other sites' cameras and events are not visible, including by explicit \`cameraId\`.`;
  }
  if (consumer.max_lookback_days) {
    // คนละเรื่องกับ **History.** ราย endpoint ด้านล่าง: อันนั้นคืออายุข้อมูลของทั้งระบบ
    // อันนี้คือเพดานที่ผูกกับ consumer รายนี้โดยเฉพาะ ซึ่งสั้นกว่าได้ · ตั้งชื่อต่างกัน
    // เพราะถ้าใช้หัวข้อเดียวกัน partner จะอ่านเป็นตัวเลขที่ขัดกันเอง
    description += `\n\n**Your window.** This consumer may look back at most ` +
      `${consumer.max_lookback_days} days, which is a limit on you specifically and is separate ` +
      `from how long the system keeps data (stated per endpoint below). Whichever is shorter wins.`;
  }
  if (omitted.length) {
    description += `\n\n**Not available to this consumer:** ` +
      omitted.map((o) => `\`${o.path}\` (missing: ${o.missing.join(', ')})`).join('; ') +
      `. Ask the operator if you need these.`;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Vigil Platform Partner API',
      version: '1.0.0',
      description,
      // Stamped so a partner can tell a stale copy from a current one. Read at
      // generation time from the same connection that read the grants, so the
      // two cannot disagree.
      'x-generated-for': consumer.slug,
      'x-generated-at': new Date().toISOString(),
    },
    servers: [{ url: baseUrl }],
    security: [{ akSk: [] }],
    paths,
    components: {
      schemas,
      securitySchemes: {
        akSk: {
          type: 'apiKey', in: 'header', name: 'X-Ca-Key',
          description: 'Identifies the consumer. Authentication is the signature in X-Ca-Signature; this header alone grants nothing.',
        },
      },
      responses: {
        Problem: {
          description: 'RFC 7807 problem document',
          content: {
            'application/problem+json': {
              schema: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  title: { type: 'string', description: 'Stable machine-readable slug, e.g. nonce-replay.' },
                  status: { type: 'integer' },
                  detail: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  };
}

module.exports = { buildSpec, readableColumns };
