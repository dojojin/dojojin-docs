// ============================================================
// Vigil Platform — Analytics / metric event classification
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

// "ชนิดของ event ไหนนับเป็นเหตุการณ์" ทั้งก้อน — metric samples (CountAggregation/*)
// กับ camera-automation analytics (ImageToo* / GlobalSceneChange / Trigger/*)
// พร้อม SQL fragment ที่ทุกหน้าใช้ร่วมกัน.
//
// Returns the symbols api-server.js still uses after this move — the same set
// it used to declare inline, wired into routes/events, routes/stats,
// routes/settings and stats-summary-route unchanged.
module.exports = function analyticsEvents(deps) {
  const { pool } = deps;

  // CountAggregation/* (and any other Bosch *Aggregation* event_type) are
  // metric samples emitted multiple times per second — they're counts, not
  // incidents. They feed the live occupancy tracker but should NOT appear in:
  //   - Events Live feed (would strobe at the sample rate)
  //   - /api/events lists or X-Total-Count
  //   - Today's count badge
  //   - rule_name / event_type facets used by editors and Events filters
  // They DO remain in the events table for the occupancy tracker and for
  // per-camera historical "People Counting" / "Vehicle Counting" stats
  // (which already aggregate via the event_category_rules mechanism).
  const METRIC_EVENT_TYPE_PATTERN = '%Aggregation%';
  function isMetricEventType(eventType) {
    return typeof eventType === 'string' && eventType.includes('Aggregation');
  }

  // ============================================================
  // Camera-side automatic analytics events (Phase 7.1)
  // ============================================================
  // These fire AUTOMATICALLY from the camera (not IVA rules — no rule_name):
  // image-quality diagnostics, scene-change/tamper, and digital I/O triggers.
  // They come as pairs — event_state 'true' when the condition starts, 'false'
  // when it ends. Option B handling: always STORED, but display is filtered:
  //   - operator toggles which types appear in the Events feed (system_settings
  //     key 'analytics_event_display', CSV of enabled keys)
  //   - the event_state='false' "ended" half is always hidden from the feed
  //     (state dedup — otherwise every condition shows twice)
  // Image-quality counts are also surfaced on the Health Check page.
  // Broad prefix keys — every analytics event is matched by exactly one of
  // these. Trigger/DigitalInput catches Input_1 / Input_2 AND the IP-suffixed
  // variants Bosch FW 6-7.x emits ('Trigger/DigitalInput/&Input_1__192_168...'),
  // so the operator toggles two switches instead of one per physical port.
  const ANALYTICS_EVENT_KEYS = [
    'ImageTooBright', 'ImageTooBlurry', 'ImageTooDark', 'GlobalSceneChange',
    'Trigger/DigitalInput', 'Trigger/Relay',
  ];
  // Image quality + scene change ON by default; digital I/O OFF (operator-
  // specific — depends what's physically wired).
  const ANALYTICS_DEFAULT_ENABLED =
    'ImageTooBright,ImageTooBlurry,ImageTooDark,GlobalSceneChange';

  // SQL CASE that resolves an events row (alias `e`) to its analytics key,
  // or NULL if it isn't one of the known camera-automation events. All
  // matches are prefix-LIKE so every variant of the same automation type
  // folds into the same key (Bosch FW 6-7.x adds an `__<ip>_` suffix to
  // the port name; FW 9.x doesn't — same toggle controls both).
  const ANALYTICS_KEY_SQL = `
  CASE
    WHEN e.event_type LIKE 'ImageTooBright/%'      THEN 'ImageTooBright'
    WHEN e.event_type LIKE 'ImageTooBlurry/%'      THEN 'ImageTooBlurry'
    WHEN e.event_type LIKE 'ImageTooDark/%'        THEN 'ImageTooDark'
    WHEN e.event_type LIKE 'GlobalSceneChange/%'   THEN 'GlobalSceneChange'
    WHEN e.event_type LIKE 'Trigger/DigitalInput/%' THEN 'Trigger/DigitalInput'
    WHEN e.event_type LIKE 'Trigger/Relay/%'        THEN 'Trigger/Relay'
    ELSE NULL
  END`;

  // SQL fragment — TRUE when the row is a camera-automation analytics event
  // (ImageToo* / GlobalSceneChange / Trigger/*). `col` = the event_type column
  // reference ('event_type' or 'e.event_type'). These fire automatically from
  // the camera, aren't incidents, and are already kept out of the Events feed
  // (Phase 7.1) — reports/stats that count raw events should exclude them too.
  function analyticsEventClause(col) {
    return `(${col} LIKE 'ImageTooBright/%' OR ${col} LIKE 'ImageTooBlurry/%' `
         + `OR ${col} LIKE 'ImageTooDark/%' OR ${col} LIKE 'GlobalSceneChange/%' `
         + `OR ${col} LIKE 'Trigger/%')`;
  }

  // JS mirror of ANALYTICS_KEY_SQL — used by the WS-broadcast filter.
  function analyticsKeyOf(eventType) {
    if (typeof eventType !== 'string') return null;
    for (const key of ANALYTICS_EVENT_KEYS) {
      if (eventType === key || eventType.startsWith(key + '/')) return key;
    }
    return null;
  }

  // Cached set of analytics keys the operator wants shown in the Events feed.
  // Module-level + 60s refresh so the 1s WS-broadcast loop reads it
  // synchronously; PUT /api/settings/analytics_event_display refreshes it
  // immediately on save.
  let _analyticsEnabledSet = new Set(ANALYTICS_DEFAULT_ENABLED.split(','));
  async function refreshAnalyticsEnabledSet() {
    try {
      const r = await pool.query(
        "SELECT value FROM system_settings WHERE key='analytics_event_display'"
      );
      if (r.rows[0] && typeof r.rows[0].value === 'string') {
        _analyticsEnabledSet = new Set(
          r.rows[0].value.split(',').map(s => s.trim()).filter(Boolean)
        );
      }
    } catch { /* keep last good set */ }
  }
  refreshAnalyticsEnabledSet();
  setInterval(refreshAnalyticsEnabledSet, 60_000);

  // True if this event should be hidden from the live Events feed:
  // either a disabled analytics type, or the event_state='false' half of
  // any analytics event. Non-analytics events always return false.
  function isHiddenAnalyticsEvent(eventType, eventState) {
    const key = analyticsKeyOf(eventType);
    if (!key) return false;
    if (!_analyticsEnabledSet.has(key)) return true;
    if (String(eventState) === 'false') return true;
    return false;
  }

  // SQL fragment that excludes analytics events the operator has DISABLED
  // (e.g. Trigger/DigitalInput when not in analytics_event_display).
  // Returns ' AND NOT (…)' ready to be appended to a WHERE clause, or ''
  // when nothing is disabled. Used by stats-summary-route + other endpoints
  // that aggregate raw event counts and should respect the operator's
  // "what counts as an incident" preference. Safe to inline (no SQL
  // injection — keys come from the constant ANALYTICS_EVENT_KEYS list).
  function disabledAnalyticsClause(col = 'event_type') {
    const disabled = ANALYTICS_EVENT_KEYS.filter(k => !_analyticsEnabledSet.has(k));
    if (disabled.length === 0) return '';
    // All keys are prefix-LIKE — folds Bosch FW 6-7.x IP-suffix variants
    // under the same toggle as FW 9.x clean variants.
    const conditions = disabled
      .map(k => `${col} LIKE '${k.replace(/'/g, "''")}/%'`)
      .join(' OR ');
    return ` AND NOT (${conditions})`;
  }

  return {
    METRIC_EVENT_TYPE_PATTERN, isMetricEventType,
    ANALYTICS_EVENT_KEYS, ANALYTICS_DEFAULT_ENABLED, ANALYTICS_KEY_SQL,
    analyticsEventClause, analyticsKeyOf,
    // getter, ไม่ใช่ตัว Set — refreshAnalyticsEnabledSet "แทนที่" ตัวแปรทั้งก้อน
    // ทุกรอบ (ไม่ได้ mutate) คนที่ถือ Set ก้อนแรกไว้จะไม่มีวันเห็นค่าที่แอดมินแก้
    getAnalyticsEnabledSet: () => _analyticsEnabledSet,
    refreshAnalyticsEnabledSet,
    isHiddenAnalyticsEvent, disabledAnalyticsClause,
  };
};
