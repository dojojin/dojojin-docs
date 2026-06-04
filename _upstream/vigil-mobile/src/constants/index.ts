// ============================================================
// Vigil Mobile — App Constants
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

export const API_BASE_URL = 'https://dashboard.dojojin.tech';
export const WS_URL       = 'wss://dashboard.dojojin.tech';

// Strip trailing slash + ensure protocol prefix
export function normalizeServerUrl(raw: string): string {
  let url = raw.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
  return url.replace(/\/+$/, '');
}

// Derive WebSocket URL from HTTP server URL
export function deriveWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
}

export const STORAGE_KEYS = {
  AUTH_TOKEN:  'vigil_auth_token',
  USER:        'vigil_user',
  SERVER_URL:  'vigil_server_url',
  PUSH_TOKEN:  'vigil_push_token',   // Expo push token ล่าสุด (ใช้ unregister)
  NOTIF_PREF:  'vigil_notif_enabled', // '1' | '0' — push เปิด/ปิด รวม
  NOTIF_ALERT: 'vigil_notif_alert',  // '1' | '0' — alert sub-toggle
  NOTIF_FACE:      'vigil_notif_face',       // '1' | '0' — face sub-toggle
  BIOMETRIC_PREF:  'vigil_biometric_enabled', // '1' | '0' — lock เมื่อเปิดจาก background
  LANGUAGE_PREF:   'vigil_lang_mode',          // 'auto' | 'th' | 'en'
} as const;

// กล้องที่ไม่ heartbeat เกิน threshold นี้ถือว่า offline
export const HEARTBEAT_TIMEOUT_SECONDS = 90;

// Poll interval สำหรับ camera status — WS handles real-time events
export const CAMERA_POLL_MS = 3 * 60_000;

export const COLORS = {
  online:  '#22c55e',
  offline: '#ef4444',
  alert:   '#f59e0b',
  cyan:    '#06b6d4',
} as const;
