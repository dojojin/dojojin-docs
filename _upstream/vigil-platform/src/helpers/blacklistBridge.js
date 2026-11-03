// ============================================================
// Vigil Platform — Blacklist -> lpr_watchlist bridge (B3)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Plan: docs/superpowers/plans/2026-07-26-b3-lpr-watchlist-bridge.md
//
// blacklist.* is a reservoir and fires no alerts. lpr_watchlist is what the
// alert path actually joins against (src/routes/lpr-alerts.js). This module is
// the only thing allowed to move rows from the first into the second.
//
// THE ONE INVARIANT
// Every statement that writes or deletes here is scoped by
// origin = 'blacklist_bridge'. A plate an operator typed by hand is never
// touched, not even when the same plate arrives from a roster. Losing that
// scope would delete hand-curated alerting on the next sync, silently.
//
// WHY plate_number IS NOT AN FK TO ANYTHING
// master is person-keyed; lpr_watchlist is plate-keyed. One person can hold
// several plates and one plate can appear in several rosters, so the mapping is
// recomputed each run rather than maintained as a relation.
'use strict';

const { normalizePlate } = require('./blacklist-crypto');
const { PHOTO_DIR } = require('./blacklistImport');
const fs = require('fs');
const path = require('path');
const { visibleRecordSql } = require('./blacklistVisibility');
const { snapshotDir } = require('./snapshotDir');
const SNAPSHOT_DIR = snapshotDir();
const REF_DIR = path.join(SNAPSHOT_DIR, 'lpr-watchlist');

// One master can be linked to records from several sources (2026-07-27,
// "ขจง377" — a GuruSquare record with a real photo, decoded brand/colour and a
// province, and a DSS Pro record for the SAME vehicle with raw unresolved codes
// and no photo at all). Rule membership stays scoped to the rule's OWN source —
// that is what lets a DSS group_name filter control volume — but the label,
// notes, province and photo shown for a selected plate should come from
// whichever linked record actually has the richest data, not whichever source
// happened to be the one with a bridge rule pointed at it.
//
// DISTINCT ON + this ORDER BY picks exactly one winner per master in one query:
// a record with a photo beats one without, then one with a province, then the
// longer free-text note. Ties fall back to source_id for a stable pick.
// A plate this short cannot survive one OCR error. Live evidence: the roster
// carries 'กร6' (Phuket), and in seven days the cameras matched it twice — a
// white SUV and a black Ford — while the wanted vehicle is a black Alphard.
// Both were misreads that happened to land on three correct characters, and the
// plate+province rule could not catch them because the province matched too.
// Worse, 'ขจน3/6/8/9' sit in the roster together, differ by one character, and
// are split across two groups, so one misread alerts the WRONG group.
//
// So: rows this short arrive with LINE muted. They still show on screen and in
// the watch-list exactly as before — an operator can un-mute one deliberately,
// and the bridge never writes this column again after the insert, so that
// choice survives every later sync.
//
// Set on INSERT only, deliberately. Doing it on UPDATE would re-mute a plate an
// operator had chosen to un-mute, on the next roster refresh.
const SHORT_PLATE_MAX = 4;

// Exported so the boundary is pinned by a test rather than eyeballed: the
// one-time UPDATE that muted the existing rows used `length <= 4`, and this has
// to agree with it exactly or new imports drift from the ones already there.
function bridgeNotifyLine(plate) {
  return String(plate || '').length > SHORT_PLATE_MAX;
}

async function bestRecordsByMaster(pool, masterIds) {
  if (!masterIds.length) return new Map();
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (l.master_id)
           l.master_id, s.label AS source_label, r.source_id,
           COALESCE(o.case_note, r.case_note) AS case_note,
           r.case_ref,
           -- migration 149 — ค่าที่คนแก้เองต้องชนะค่าดิบเสมอ · จังหวัดสำคัญที่สุด
           -- เพราะเป็นตัวตัดสินว่าป้ายเข้าเฝ้าระวังได้ไหม: ระเบียนจาก HCP ที่ไม่มี
           -- จังหวัด พอคนกรอกเองแล้วต้องผ่านด่านได้ทันที ไม่ต้องรอ GuruSquare
           COALESCE(NULLIF(o.province,''), r.raw_json->>'province') AS province,
           COALESCE(NULLIF(o.photo_path,''), r.photo_path) AS photo_path
      FROM blacklist.source_records r
      JOIN blacklist.master_links l ON l.source_record_id = r.id
      JOIN blacklist.sources s ON s.id = r.source_id
      LEFT JOIN blacklist.overrides o ON o.source_id = r.source_id AND o.external_id = r.external_id
     WHERE l.master_id = ANY($1) AND r.data_type = 'lpr' AND COALESCE(o.excluded, FALSE) = FALSE
       AND ${visibleRecordSql('r')}
     ORDER BY l.master_id,
       (COALESCE(NULLIF(o.photo_path,''), r.photo_path) IS NOT NULL) DESC,
       (COALESCE(NULLIF(o.province,''), r.raw_json->>'province') IS NOT NULL) DESC,
       length(COALESCE(o.case_note, r.case_note, '')) DESC,
       r.source_id`,
    [masterIds]);
  return new Map(rows.map(r => [r.master_id, r]));
}

// Copies the winning record's photo into the SAME directory manually-uploaded
// reference images already live in, under a name fixed to the master — so a
// second sync with the same winner is a no-op stat, not a growing pile of
// duplicate files, and a later sync whose winner now has a photo (or a better
// one) simply overwrites it. Bridge-owned rows never carry a hand-picked photo
// to protect (see the file header's ONE INVARIANT) — this is the same "bridge
// fully owns every field of its own rows" rule label/notes/region already
// followed, just extended to the reference image.
function materializeBridgePhoto(masterId, photoPath) {
  if (!photoPath) return null;
  const src = path.join(PHOTO_DIR, photoPath);
  if (!src.startsWith(PHOTO_DIR) || !fs.existsSync(src)) return null;
  try {
    fs.mkdirSync(REF_DIR, { recursive: true });
    const destName = `wl_bridge_${masterId}.jpg`;
    fs.copyFileSync(src, path.join(REF_DIR, destName));
    return `lpr-watchlist/${destName}`;
  } catch (e) {
    console.error(`[blacklistBridge] photo copy failed for master ${masterId}:`, e.message);
    return null;
  }
}

// Copy every desired row's photo, whether or not the row itself changed.
// Photo CONTENT can go stale with nothing about the row changing: ref_image's
// filename is derived from master_id alone (desiredRows()), so a source photo
// correction (placeholder -> real photo) never flips a compared field and the
// row never lands in d.update. materializeBridgePhoto() overwrites in place and
// is a safe no-op when the winner hasn't changed, so running it over the whole
// desired set is cheaper than trying to detect the change.
//
// Neither mtime nor source_records.updated_at can stand in for "the photo
// changed": savePhoto() (blacklistImport.js:93) rewrites the file
// unconditionally on every import, so both move for all 33 plates every run.
// Measured 2026-08-22 — ผธ4973's source file and its copy had identical md5
// with mtimes 3 hours apart.
//
// Manual-owned plates are excluded. Writing wl_bridge_*.jpg for a row the
// bridge does not own would breach the file header's ONE INVARIANT.
//
// existingOnly skips plates that have no watch-list row yet (d.add). The
// caller that runs BEFORE the pending-review guard passes it: a plate held for
// review may never be inserted, and writing its image first would leave a file
// with nothing pointing at it. Rows already on screen are exactly the ones that
// can be showing a stale photo, so refreshing only those loses nothing —
// sync() writes the rest inside the transaction that creates them.
function materializeDesiredPhotos(d, { existingOnly = false } = {}) {
  const skippedSet = new Set(d.skipped);
  const addSet = existingOnly ? new Set(d.add.map((r) => r.plate_number)) : null;
  for (const [plate, want] of d.desired) {
    if (skippedSet.has(plate) || !want.photo_source) continue;
    if (addSet && addSet.has(plate)) continue;
    materializeBridgePhoto(want.blacklist_master_id, want.photo_source);
  }
}

// Plates the active rules currently select, already canonical. Exclusions and
// local corrections are honoured: an operator who excluded a record must not
// see it come back as a live alert on the next sync.
async function desiredRows(pool, ruleIds) {
  const { rows: rules } = await pool.query(`
    SELECT r.*, s.label AS source_label
      FROM blacklist.bridge_rules r
      JOIN blacklist.sources s ON s.id = r.source_id
     WHERE r.active ${ruleIds && ruleIds.length ? 'AND r.id = ANY($1)' : ''}
     ORDER BY (s.source_type = 'manual') DESC, r.id`,
    ruleIds && ruleIds.length ? [ruleIds] : []);
  // Manual first, then oldest — owner's call, 2026-08-08. A rule created by the
  // manual-entry route always carries the newest id, so under plain `ORDER BY
  // r.id` a plate that any roster already listed kept the roster's group and
  // the typed one changed nothing, with nothing anywhere saying so. Measured on
  // ขจน9: typed as warrant with a province and a case reference, and the diff
  // came back "no change" — suspect, ยะลา, GuruSquare's note, the case
  // reference nowhere. The officer at the screen knows why this car matters;
  // a roster synced six hours ago does not. So they decide the group.
  //
  // It decides ONLY the group. Which record supplies the province, note, label
  // and photo is a separate contest in bestRecordsByMaster() — richest wins,
  // photo first — and manual does not get a thumb on that scale, because a
  // mistyped province would silently stop a plate_region group from ever
  // matching again.
  //
  // The rest of the ORDER BY is unchanged and still load-bearing, not cosmetic:
  // the loop below is first-rule-wins, so this row order decides which group an
  // overlapping plate lands in. Without it the planner drives the join off a Seq
  // Scan on `sources`, whose heap order
  // changes every time a source row is updated — which happens on every import.
  // Measured 2026-08-02: a no-op UPDATE on sources flipped the order from
  // 6,7,4,8 to 4,8,6,7, which would have moved 286 plates shared by the two
  // GuruSquare rosters out of warrant (plate+province) into suspect (plate only)
  // and back again on the next sync. Oldest rule wins is the rule that was there
  // first, so adding a roster can add plates but never re-classify existing ones.

  // Group mode lookup, once — alert_mode is the target group's policy, not the
  // rule's (2026-07-27, moved off per-plate). No group means no policy to
  // inherit, same fallback a manually-added ungrouped plate already gets.
  const { rows: groupRows } = await pool.query(
    'SELECT id, default_alert_mode FROM lpr_watchlist_groups');
  const groupModes = new Map(groupRows.map(g => [g.id, g.default_alert_mode]));

  const byPlate = new Map();
  for (const rule of rules) {
    const groupMode = rule.target_group_id ? (groupModes.get(rule.target_group_id) || 'plate') : 'plate';
    const params = [rule.source_id];
    const cond = [];
    if (rule.group_names && rule.group_names.length) {
      params.push(rule.group_names);
      cond.push(`r.raw_json->>'group_name' = ANY($${params.length})`);
    }
    if (rule.external_ids && rule.external_ids.length) {
      params.push(rule.external_ids);
      cond.push(`r.external_id = ANY($${params.length})`);
    }
    const { rows } = await pool.query(`
      SELECT l.master_id,
             COALESCE(o.plate_numbers, r.plate_numbers) AS plates
        FROM blacklist.source_records r
        JOIN blacklist.master_links l ON l.source_record_id = r.id
        LEFT JOIN blacklist.overrides o
          ON o.source_id = r.source_id AND o.external_id = r.external_id
       WHERE r.source_id = $1
         AND r.data_type = 'lpr'
         -- BS2 — แถวที่ต้นทางลบไปแล้วถูก **ย้ายลงถังขยะ** (overrides.excluded)
         -- โดย blacklistVanish ในรอบ import เดียวกับที่ทำเครื่องหมาย ⇒ เงื่อนไข
         -- excluded = FALSE ด้านบนคัดออกให้แล้ว ไม่ต้องมี vanished_at IS NULL ซ้ำ
         --
         -- ⚠️ เคยมีทั้งสองเงื่อนไขและมันขัดกันเอง: ถังขยะมีปุ่ม "เอากลับเข้าถังกลาง"
         -- ที่ตั้ง excluded = FALSE แต่ vanished_at ยังอยู่ (ล้างไม่ได้ เพราะรอบ
         -- import ถัดไปจะทำเครื่องหมายซ้ำ) ⇒ กดกู้คืนแล้วป้าย **ไม่กลับมาเฝ้าระวัง**
         -- ปุ่มโกหกโดยไม่มีใครรู้ · ให้เหลือจุดตัดสินจุดเดียวคือ excluded
         AND ${visibleRecordSql('r')}
         AND COALESCE(o.excluded, FALSE) = FALSE
         ${cond.length ? 'AND ' + cond.join(' AND ') : ''}`, params);

    // Membership (which plates/masters this rule selects) stays scoped to the
    // rule's own source above — that is what lets a DSS group_name filter
    // control volume. The CONTENT shown for each selected master is enriched
    // separately, across every source linked to it, so a plate that also has a
    // richer record elsewhere is not stuck displaying the thinner one just
    // because that happened to be the source a rule was pointed at.
    const masterIds = [...new Set(rows.map(r => r.master_id))];
    const best = await bestRecordsByMaster(pool, masterIds);

    for (const rec of rows) {
      const b = best.get(rec.master_id) || {};
      // A bare plate can't confirm it's the target vehicle (Thai plates repeat
      // across provinces — measured live, 93% disagreement for one roster), so
      // province-less plates need an explicit opt-in: a rule with a real
      // target group set to "ป้ายทะเบียนอย่างเดียว" in Settings. No group, or a
      // plate_region group, keeps the full province requirement. Owner's call,
      // 2026-08-19 — restores the pre-2026-08-13 per-mode check.
      if ((!rule.target_group_id || groupMode !== 'plate') && !b.province) continue;
      for (const raw of (rec.plates || [])) {
        const plate = normalizePlate(raw);
        if (!plate) continue;
        // First rule to claim a plate wins, so two overlapping rules cannot
        // produce a flapping row that each sync rewrites the other way.
        if (byPlate.has(plate)) continue;
        byPlate.set(plate, {
          plate_number: plate,
          blacklist_master_id: rec.master_id,
          group_id: rule.target_group_id || null,
          alert_mode: groupMode,
          // notify_line is NOT written from here any more. It is the per-plate
          // "mute this one car" switch a human ticks, and the bridge re-syncs
          // often — writing it every sync silently undid that edit on the next
          // roster refresh. Whether a category alerts at all is now
          // lpr_watchlist_groups.notify_line, which is manageable across 482
          // auto-imported plates in a way a per-plate flag never was.
          // (bridge_rules.notify_line consequently has no reader; its control is
          // gone from the bridge modal. The column stays, unread, rather than
          // taking a migration to drop something that costs nothing.)
          region: b.province || null,
          label: [b.source_label || rule.source_label, b.case_ref].filter(Boolean).join(' · ') || null,
          notes: b.case_note || null,
          // Raw source path only — resolved into an actual copied file by
          // sync(), never here: this function must stay a pure read (it backs
          // the preview endpoint), and copying a file is not one.
          photo_source: b.photo_path || null,
          // Deterministic from master_id alone, so diff() can tell whether the
          // photo situation changed (none -> some, or vice versa) without
          // touching the filesystem — the actual copy still only happens in
          // sync(), and only for rows that are being written anyway.
          ref_image: b.photo_path ? `lpr-watchlist/wl_bridge_${rec.master_id}.jpg` : null,
        });
      }
    }
  }
  return byPlate;
}

// Was every active rule named? Then the caller does have the whole picture and
// removal is safe, even though they passed ids rather than omitting them.
// Compared as a superset rather than by count, so naming one rule twice cannot
// masquerade as naming two.
async function coversEveryActiveRule(pool, ruleIds) {
  const given = new Set((ruleIds || []).map(String));
  const { rows } = await pool.query('SELECT id FROM blacklist.bridge_rules WHERE active');
  return rows.every((r) => given.has(String(r.id)));
}

// What a sync would change. Pure read — safe to call from a preview endpoint.
async function diff(pool, ruleIds) {
  const desired = await desiredRows(pool, ruleIds);
  const { rows: current } = await pool.query(
    `SELECT plate_number, label, notes, group_id, alert_mode, notify_line, region, ref_image,
            blacklist_master_id, group_pinned
       FROM lpr_watchlist WHERE origin = 'blacklist_bridge'`);
  const cur = new Map(current.map(r => [r.plate_number, r]));

  // A plate an operator added by hand is theirs. The bridge reports it as
  // skipped rather than taking it over — plate_number is the primary key, so
  // "insert anyway" would mean overwriting their row.
  //
  // ยกเว้นป้ายที่คนเพิ่มไว้ใน "กลุ่มเฉพาะ Site" (migration 261): ถ้าปล่อยข้าม ป้ายที่เข้ามาในบัญชีดำ
  // ระดับประเทศทีหลังจะแจ้งเตือนแค่ Site นั้นตลอดไป — bridge จึงยึดกลับเข้ากลุ่มของกฎ (takeover)
  // เจ้าของเลือกทางนี้ 2026-10-14 (ทาง ข = ห้าม Site Admin เพิ่มป้ายที่อยู่ในบัญชีดำ ไม่ได้เลือก)
  const { rows: manual } = await pool.query(
    `SELECT w.plate_number, g.site_id FROM lpr_watchlist w
       LEFT JOIN lpr_watchlist_groups g ON g.id = w.group_id
      WHERE w.origin <> 'blacklist_bridge'`);
  const manualSite = new Map(manual.map(r => [r.plate_number, r.site_id]));

  const add = [], update = [], remove = [], skipped = [], takeover = [];
  for (const [plate, want] of desired) {
    if (manualSite.has(plate)) {
      if (manualSite.get(plate) != null) takeover.push({ ...want, from_site_id: manualSite.get(plate) });
      else skipped.push(plate);
      continue;
    }
    const have = cur.get(plate);
    if (!have) { add.push(want); continue; }
    // A pinned row keeps the group a person put it in (migration 166). Carry
    // their values into `want` rather than special-casing the comparison: the
    // same object is what apply() writes, so one place decides and the preview
    // the operator confirms shows exactly what will land. alert_mode travels
    // with it — it is the group's matching policy, and leaving it on the rule's
    // group would match by one group's rules and file under another's.
    if (have.group_pinned) { want.group_id = have.group_id; want.alert_mode = have.alert_mode; }
    const changed = have.label !== want.label || have.notes !== want.notes ||
      have.group_id !== want.group_id || have.alert_mode !== want.alert_mode ||
      have.region !== want.region ||
      have.ref_image !== want.ref_image ||
      String(have.blacklist_master_id) !== String(want.blacklist_master_id);
    if (changed) update.push(want);
  }
  // Removal needs the whole picture, and a caller who narrowed by rule does not
  // have it. `desired` above was computed from the given rules only, while
  // `current` is every bridge-owned row there is — so this loop would read
  // "every plate the OTHER rules own" as "no longer wanted" and delete them.
  // Measured 2026-08-07 against live data: diff(pool, ['9']) wanted 3 plates and
  // proposed removing all 481, i.e. the entire watch list, silently ending
  // alerting for every roster. diff(pool, ['6']) proposed 172, ['7'] 334.
  //
  // Nothing has triggered it — blBridgeSync() posts only {confirm} and the
  // preview is a bare GET, so the dashboard has always taken the full-sync path
  // where this loop is correct. It needed a hand-written POST carrying
  // rule_ids. The `confirm` counts guard does not help: it compares against the
  // same narrowed diff, so a caller who previews and syncs with identical
  // rule_ids passes it and deletes everything.
  //
  // So a narrowed diff adds and updates but never removes. Withdrawing a plate
  // still works — it is what a full sync is for, and that is the one run that
  // can see whether some other rule still claims it.
  const partial = !!(ruleIds && ruleIds.length) && !(await coversEveryActiveRule(pool, ruleIds));
  if (!partial) {
    for (const [plate, have] of cur) {
      if (!desired.has(plate)) remove.push({ plate_number: plate, label: have.label });
    }
  }
  return {
    add, update, remove, skipped, takeover,
    partial,                       // callers can say why nothing is being withdrawn
    desired_total: desired.size, current_total: cur.size,
    // sync() needs the full desired set, not just add/update — see the photo
    // re-materialize loop there for why (photo content can go stale without
    // any watched field, including ref_image's own filename, changing).
    desired,
  };
}

// Apply the diff. One transaction: a half-synced watch list is worse than an
// unsynced one, because nobody can tell which half is live.
//
// opts.holdRemovals — รายชื่อป้าย (รูป lpr_watchlist ที่ normalize แล้ว) ที่ห้ามถอน
// ในรอบนี้: การถอนที่ยังยืนยันไม่ได้ (unconfirmedRemovals) ถูกกันออก **ที่นี่**
// ก่อนถึง DELETE เสมอ — จุดตัดสินจุดเดียว ผู้เรียกแค่ส่งรายชื่อมา
async function sync(pool, ruleIds, actor, { holdRemovals } = {}) {
  const d = await diff(pool, ruleIds);
  let held = [];
  if (holdRemovals && holdRemovals.length) {
    const hold = new Set(holdRemovals);
    held = d.remove.filter((r) => hold.has(r.plate_number)).map((r) => r.plate_number);
    d.remove = d.remove.filter((r) => !hold.has(r.plate_number));
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // (Found 2026-08-18 — a GuruSquare photo correction on an already-synced
    // plate never reached the watch list; the row looked "unchanged".)
    // Idempotent, and attemptAutoSync() calls it too before deciding whether
    // there is anything to sync — running it twice on that path is a no-op
    // stat-and-copy. Do not delete either call: the other one does not cover
    // this one's case. See materializeDesiredPhotos() for why.
    materializeDesiredPhotos(d);
    for (const r of d.add) {
      await client.query(`
        INSERT INTO lpr_watchlist
          (plate_number, label, notes, active, group_id, alert_mode, region,
           ref_image, origin, blacklist_master_id, notify_line)
        VALUES ($1,$2,$3,TRUE,$4,$5,$6,$7,'blacklist_bridge',$8,$9)
        ON CONFLICT (plate_number) DO NOTHING`,
        [r.plate_number, r.label, r.notes, r.group_id, r.alert_mode, r.region,
         r.ref_image, r.blacklist_master_id,
         bridgeNotifyLine(r.plate_number)]);
    }
    // ยึดป้ายที่คนเพิ่มไว้ในกลุ่มเฉพาะ Site กลับมาเป็นของ bridge (ดู diff()) — origin เปลี่ยน
    // ⇒ รอบถัดไปเป็น update/remove ปกติ · group_pinned = FALSE เพื่อให้กลุ่มของกฎชนะ
    for (const r of (d.takeover || [])) {
      await client.query(`
        UPDATE lpr_watchlist
           SET origin = 'blacklist_bridge', label = $2, notes = $3, group_id = $4, alert_mode = $5,
               region = $6, ref_image = $7, blacklist_master_id = $8, notify_line = $9,
               group_pinned = FALSE, active = TRUE
         WHERE plate_number = $1 AND origin <> 'blacklist_bridge'`,
        [r.plate_number, r.label, r.notes, r.group_id, r.alert_mode, r.region,
         r.ref_image, r.blacklist_master_id, bridgeNotifyLine(r.plate_number)]);
    }
    for (const r of d.update) {
      // The CASE is belt-and-braces over diff()'s pin handling: that is where
      // the decision is made and the preview comes from, but this statement is
      // the last thing standing between a roster refresh and somebody's manual
      // grouping, and a future caller that applies rows without going through
      // diff() would otherwise wipe it with no trace.
      await client.query(`
        UPDATE lpr_watchlist
           SET label = $2, notes = $3,
               group_id   = CASE WHEN group_pinned THEN group_id   ELSE $4 END,
               alert_mode = CASE WHEN group_pinned THEN alert_mode ELSE $5 END,
               region = $6, ref_image = $7, blacklist_master_id = $8
         WHERE plate_number = $1 AND origin = 'blacklist_bridge'`,
        [r.plate_number, r.label, r.notes, r.group_id, r.alert_mode, r.region,
         r.ref_image, r.blacklist_master_id]);
    }
    if (d.remove.length) {
      // The origin guard is what makes removal safe. Without it this deletes
      // every hand-added plate that no roster happens to mention.
      await client.query(
        `DELETE FROM lpr_watchlist
          WHERE origin = 'blacklist_bridge' AND plate_number = ANY($1)`,
        [d.remove.map(r => r.plate_number)]);
    }
    await client.query(
      `UPDATE blacklist.sources SET last_bridge_sync_at = NOW()
        WHERE id IN (SELECT source_id FROM blacklist.bridge_rules
                      WHERE active ${ruleIds && ruleIds.length ? 'AND id = ANY($1)' : ''})`,
      ruleIds && ruleIds.length ? [ruleIds] : []);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  await pool.query(
    `INSERT INTO audit_log (user_id, username, action, details) VALUES ($1,$2,$3,$4)`,
    [actor?.id || null, actor?.username || 'system', 'blacklist_bridge_sync',
     JSON.stringify({
       rule_ids: ruleIds || 'all',
       added: d.add.length, updated: d.update.length,
       removed: d.remove.length, skipped_manual: d.skipped.length,
       ...((d.takeover || []).length ? { taken_over: d.takeover.slice(0, 50).map(t => ({ plate: t.plate_number, from_site_id: t.from_site_id, to_group: t.group_id })) } : {}),
       // ใบที่ถูกกันไว้ต้องเห็นใน audit เสมอ — ไม่งั้นรอบที่ hold ดูเหมือนรอบปกติ
       ...(held.length ? { held_removals: held.slice(0, 50) } : {}),
     })]
  ).catch(() => { /* a good sync must not be reported as failed by an audit write */ });

  return {
    added: d.add.length, updated: d.update.length,
    removed: d.remove.length, skipped_manual: d.skipped.length,
    taken_over: (d.takeover || []).length,
    ...(held.length ? { held: held.length, held_plates: held.slice(0, 5) } : {}),
  };
}

// BS2 — one confirmed-safe sync attempt, shared by every caller that just
// created a safe removal reason: an import's vanish-scan (finishImport(), on
// every full-sweep import), or an operator's manual exclude
// (PUT /record/:id/override).
//
// การถอนที่ยังยืนยันไม่ได้ (ดู unconfirmedRemovals() ใน blacklistImport.js ว่า
// อะไรนับเป็นยืนยันแล้ว) **hold เฉพาะตัวมันเอง** — add/update และการถอนที่ยืนยัน
// แล้วเดินทันที (เจ้าของเลือกแยกคิว 2026-08-29 หลังเหตุ GOTCHAS #183: เดิม hold
// ทั้ง diff ใบเดียวที่อธิบายไม่ได้เลยพาการถอนที่ยืนยันแล้วค้างยิง LINE ต่อ และพา
// add 4 ป้าย — รวมป้ายที่ต้นทางแก้ให้ถูกแล้ว — ไม่ถูกเฝ้าระวังไปด้วย 2 วัน)
// เหตุผลเชิงทิศ: "ป้ายที่ควรเฝ้าไม่ถูกเฝ้า" เงียบและกู้ไม่ได้ ส่วน "ป้ายค้างรอตรวจ
// ยิงเกินไปก่อน" เห็นบนจอ/ถังขยะและกู้ได้ — ระบบ security ต้องล้มไปทางหลัง
// ตาข่ายเหตุ 481 แถวยังอยู่ครบ: ใบ unconfirmed ไม่มีวันถึง DELETE (กันใน sync())
// Never throws — a failed or skipped attempt is reported, not fatal to the
// caller's own write.
async function attemptAutoSync(pool, { username } = {}) {
  try {
    const d = await diff(pool, null);
    // Before the early return, not after it. A corrected source photo changes
    // no compared field, so the diff below is empty and this function used to
    // return "nothing to sync" without ever reaching sync() — where the
    // re-materialize loop lives. The stale reference image then survived every
    // import until some UNRELATED plate happened to make the diff non-empty.
    // Measured live 2026-08-22: ผธ4973 showed the roster's old placeholder on
    // its alarm for over a day and healed only as a side effect of an
    // unrelated `added: 1` sync. Copying files is safe here — this is the
    // import's own write path, not the preview GET.
    //
    // existingOnly because the pending-review guard below can hold the sync
    // indefinitely: a plate in d.add might never be inserted, and its image
    // would sit orphaned until then.
    materializeDesiredPhotos(d, { existingOnly: true });
    if (!d.remove.length && !d.add.length && !d.update.length && !(d.takeover || []).length) {
      return { ok: true, skipped: 'nothing to sync' };
    }
    // require here, not at file top — blacklistImport.js requires this file
    // back (for PHOTO_DIR); a top-of-file require would be circular.
    const { unconfirmedRemovals } = require('./blacklistImport');
    const pending = await unconfirmedRemovals(pool, d.remove.map((r) => r.plate_number));
    // ระบุตัวป้ายเสมอ — เคย log แค่จำนวนแล้วป้ายเดียวบล็อกเงียบ ๆ อยู่หลายชั่วโมง
    // กว่าจะรู้ว่าตัวไหนต้องไล่ DB เอง (2026-08-29, 2กง2651)
    const names = pending.slice(0, 5).join(', ') + (pending.length > 5 ? ', …' : '');
    if (pending.length === d.remove.length && !d.add.length && !d.update.length) {
      // เหลือแต่ใบรอตรวจล้วน — sync เปล่าจะไม่เขียนอะไรนอกจาก bump last_sync/audit
      return { ok: true, skipped: `${pending.length} plate(s) pending review: ${names}` };
    }
    const r = await sync(pool, null, { username: username || 'auto-sync' },
      { holdRemovals: pending });
    return { ok: true, ...r };
  } catch (e) {
    console.warn('[blacklist-bridge] attemptAutoSync failed:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = {
  desiredRows, diff, sync, attemptAutoSync, bridgeNotifyLine, SHORT_PLATE_MAX,
  __test: { materializeDesiredPhotos },
};

// ---------- self-check ----------
// `node src/helpers/blacklistBridge.js` — the diff logic is the part worth
// pinning: the DB paths are exercised by the dry-run against real data.
if (require.main === module) {
  const assert = require('assert');

  // plate canonicalization must agree with the alert join's expectation
  assert.strictEqual(normalizePlate('1กค 9136'), '1กค9136');
  assert.strictEqual(normalizePlate('  บท-3421 '), 'บท3421');
  assert.strictEqual(normalizePlate(''), '');

  // the origin guard is a string literal in four places — if one is edited the
  // others must match, so assert they are all the same value
  const src = require('fs').readFileSync(__filename, 'utf8');
  const guards = src.match(/origin\s*(?:=|<>)\s*'blacklist_bridge'/g) || [];
  assert.ok(guards.length >= 4, `expected the origin guard on every write path, found ${guards.length}`);

  // Both write paths must refresh photos. sync() alone is not enough:
  // attemptAutoSync() returns early on an empty diff and never reaches it, so
  // a photo-only correction stayed invisible until an unrelated plate changed.
  const calls = (src.match(/^\s*materializeDesiredPhotos\(d[,)]/gm) || []).length;
  assert.strictEqual(calls, 2,
    `both sync() and attemptAutoSync() must refresh photos, found ${calls} call(s)`);

  // ...and must skip manual-owned plates while doing it. Same ONE INVARIANT
  // the origin guard above protects, on the filesystem side of it.
  assert.ok(/function materializeDesiredPhotos[\s\S]*?skippedSet\.has\(plate\)/.test(src),
    'materializeDesiredPhotos() must not write a reference image for a manual-owned plate');

  // แยกคิว (GOTCHAS #183): sync() ต้องกรอง holdRemovals ออกจาก d.remove ก่อนถึง
  // DELETE และ attemptAutoSync() ต้องส่ง pending เข้าไปเป็น holdRemovals เสมอ —
  // ถ้าใครถอดตัวกรองหรือกลับไปเรียก sync() เปล่า ใบรอตรวจจะถูกลบจริง
  assert.ok(/const d = await diff\(pool, ruleIds\);[\s\S]{0,600}?d\.remove = d\.remove\.filter\(\(r\) => !hold\.has\(r\.plate_number\)\)/.test(src),
    'sync() must filter holdRemovals out of d.remove before any write');
  assert.ok(/await sync\(pool, null, \{ username: username \|\| 'auto-sync' \},\s*\{ holdRemovals: pending \}\)/.test(src),
    'attemptAutoSync() must pass unconfirmed removals as holdRemovals');

  console.log('blacklistBridge self-check: all assertions passed');
}
