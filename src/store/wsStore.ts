// ============================================================
// Vigil Mobile — WebSocket Store
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import { AppState, AppStateStatus } from 'react-native';
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { WS_URL, deriveWsUrl, normalizeServerUrl } from '../constants';
import { STORAGE_KEYS } from '../constants';
import { VigilEvent } from '../types';

export type WsStatus = 'disconnected' | 'connecting' | 'connected';

// Inbound WS message union (matches api-server.js broadcast shapes)
type WsMessage =
  | { type: 'new_event'; event: VigilEvent }
  | { type: 'new_face';  event: VigilEvent }
  | { type: 'clip_done'; camera_id: string; clip_file: string }
  | { type: 'occupancy_update'; camera_id: string; rule_name: string; current: number; raw: number; ts: number; stale?: boolean };

const MAX_RECENT = 50;
// Exponential backoff caps (ms)
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

interface WsState {
  status:       WsStatus;
  recentEvents: VigilEvent[];
  // camera_id → event count since last REST sync; useCameras reads + clears this
  eventDeltas:  Record<string, number>;

  connect:      (token: string) => Promise<void>;
  disconnect:   () => void;
  clearDeltas:  () => void;
  dismissEvent: (id: number) => void;
}

// ── Module-level singleton — lives outside React tree ──────────────────────
let _socket:     WebSocket | null              = null;
let _token:      string | null                 = null;
let _wsBaseUrl   = WS_URL;   // updated at connect() from SecureStore
let _retries     = 0;
let _retryTimer: ReturnType<typeof setTimeout> | null = null;
let _paused      = false;
let _appSub:     { remove: () => void } | null = null;

function clearRetry() {
  if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
}

export const useWsStore = create<WsState>((set) => {
  function open(token: string) {
    if (_socket && (_socket.readyState === WebSocket.OPEN || _socket.readyState === WebSocket.CONNECTING)) return;

    set({ status: 'connecting' });
    const ws = new WebSocket(`${_wsBaseUrl}?token=${encodeURIComponent(token)}`);
    _socket = ws;

    ws.onopen = () => {
      _retries = 0;
      clearRetry();
      set({ status: 'connected' });
    };

    ws.onmessage = (e) => {
      let msg: WsMessage;
      try { msg = JSON.parse(e.data as string); } catch { return; }
      if (msg.type !== 'new_event' && msg.type !== 'new_face') return;
      const ev = msg.event;
      set(s => ({
        recentEvents: [ev, ...s.recentEvents].slice(0, MAX_RECENT),
        eventDeltas:  { ...s.eventDeltas, [ev.camera_id]: (s.eventDeltas[ev.camera_id] ?? 0) + 1 },
      }));
    };

    ws.onerror = () => { /* onclose fires next — handle there */ };

    ws.onclose = () => {
      _socket = null;
      if (_paused || !_token) { set({ status: 'disconnected' }); return; }
      const delay = BACKOFF_MS[Math.min(_retries, BACKOFF_MS.length - 1)];
      _retries++;
      set({ status: 'disconnected' });
      _retryTimer = setTimeout(() => { if (_token && !_paused) open(_token); }, delay);
    };
  }

  return {
    status:       'disconnected',
    recentEvents: [],
    eventDeltas:  {},

    connect: async (token) => {
      _token  = token;
      _paused = false;
      clearRetry();

      // Resolve WS URL from stored server URL (custom server support)
      const stored = await SecureStore.getItemAsync(STORAGE_KEYS.SERVER_URL);
      _wsBaseUrl = stored ? deriveWsUrl(normalizeServerUrl(stored)) : WS_URL;

      // Register AppState listener once per session
      if (!_appSub) {
        _appSub = AppState.addEventListener('change', (next: AppStateStatus) => {
          if (next.match(/inactive|background/)) {
            _paused = true;
            clearRetry();
            if (_socket) { _socket.onclose = null; _socket.close(); _socket = null; }
            set({ status: 'disconnected' });
          } else if (next === 'active') {
            _paused = false;
            if (_token) open(_token);
          }
        });
      }

      open(token);
    },

    disconnect: () => {
      _token  = null;
      _paused = false;
      clearRetry();
      _appSub?.remove();
      _appSub = null;
      if (_socket) { _socket.onclose = null; _socket.close(); _socket = null; }
      set({ status: 'disconnected', recentEvents: [], eventDeltas: {} });
    },

    clearDeltas:  () => set({ eventDeltas: {} }),
    dismissEvent: (id) => set(s => ({ recentEvents: s.recentEvents.filter(e => e.id !== id) })),
  };
});
