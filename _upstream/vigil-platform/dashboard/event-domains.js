// ============================================================
// Vigil Platform — Event Domain Registry (classification source of truth)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Single place that classifies an event_type into a DOMAIN — drives how the
// Events feed renders it (thumb), which badge it carries, and (future) which
// dedicated page it routes to / whether it shows in the generic feed.
//
// Adding a new system = add ONE entry here instead of editing scattered
// hardcoded `event_type === '...'` checks across events/snapshots/faces.
// Future: promote to DB-driven category system (event_categories.domain +
// show_in_feed) for white-label no-code reconfiguration.
(function () {
  // color = text/border (token); bg = translucent badge background (literal rgba,
  // since CSS vars can't take a hex-alpha suffix).
  const REG = {
    anprAlarm:       { domain: 'lpr',  i18nKey: 'evt.badgeLpr',  render: 'plaque',    color: 'var(--accent)', bg: 'rgba(91,141,239,.18)' },
    FaceRecognition: { domain: 'face', i18nKey: 'evt.badgeFace', render: 'faceBadge', color: 'var(--purple)', bg: 'rgba(139,92,246,.18)' },
    FaceCapture:     { domain: 'face', i18nKey: 'evt.badgeFace', render: 'faceBadge', color: 'var(--purple)', bg: 'rgba(139,92,246,.18)' },
    // Dahua NVR face equivalents (2026-07-15). Only the two event_types
    // routes/faces.js actually recognizes (CAPTURE_TYPES_SQL/RECOG_TYPES_SQL)
    // — do NOT add FaceDetector/Detected|Attribute|Analysis here until
    // faces.js is extended to match them too; adding one without the other
    // makes those events disappear from the generic feed AND the Face page
    // (the exact regression this pass was scoped to avoid — see the
    // 2026-07-15 Dahua Face system plan).
    'FaceDetector/Recognized': { domain: 'face', i18nKey: 'evt.badgeFace', render: 'faceBadge', color: 'var(--purple)', bg: 'rgba(139,92,246,.18)' },
    'FaceDetector/Comparison': { domain: 'face', i18nKey: 'evt.badgeFace', render: 'faceBadge', color: 'var(--purple)', bg: 'rgba(139,92,246,.18)' },
  };
  const GENERAL = { domain: 'general', i18nKey: null, render: 'image', color: 'var(--muted)', bg: 'var(--surface-overlay)' };

  // eventDomain(ev) → { domain, i18nKey, render, color }
  function eventDomain(ev) {
    const t = (ev && ev.event_type) || '';
    return REG[t] || GENERAL;
  }

  // event_types that belong to a dedicated page (LPR/Face) → excluded from the
  // generic Events/Snapshot feeds so high-frequency plates don't bury other logs.
  // Driven by the registry: add a domain here → it drops out of those feeds.
  function specializedEventTypes() { return Object.keys(REG); }

  window.eventDomain = eventDomain;
  window.EVENT_DOMAIN_REG = REG;
  window.specializedEventTypes = specializedEventTypes;
})();
