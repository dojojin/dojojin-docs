// ============================================================
// Vigil Mobile — useCameras Hook
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { cameraApi } from '../api/client';
import { CAMERA_POLL_MS, HEARTBEAT_TIMEOUT_SECONDS } from '../constants';
import { useWsStore } from '../store/wsStore';
import { Camera, CameraGroup, CameraStats } from '../types';

// ใช้ status field จาก API + ยืนยันด้วย last_seen
function isOnline(cam: Camera): boolean {
  if (cam.status === 'online') {
    if (!cam.last_seen) return true;
    const diff = (Date.now() - new Date(cam.last_seen).getTime()) / 1000;
    return diff < HEARTBEAT_TIMEOUT_SECONDS;
  }
  return false;
}

export function useCameras(groupId?: number) {
  const [cameras,   setCameras]   = useState<Camera[]>([]);
  const [groups,    setGroups]    = useState<CameraGroup[]>([]);
  const [stats,     setStats]     = useState<CameraStats>({ total: 0, online: 0, offline: 0, alerts_today: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const fetchCameras = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const [rawCams, rawGroups] = await Promise.allSettled([
        cameraApi.list(groupId),
        cameraApi.groups(),
      ]);

      const cams: Camera[] = rawCams.status === 'fulfilled' ? rawCams.value : [];
      const grps: CameraGroup[] = rawGroups.status === 'fulfilled' ? rawGroups.value : [];

      const online  = cams.filter(isOnline).length;
      const offline = cams.length - online;
      const alerts  = cams.reduce((s, c) => s + (c.alert_count_today ?? 0), 0);

      setCameras(cams);
      setGroups(grps);
      setStats({ total: cams.length, online, offline, alerts_today: alerts });
      setLastFetch(new Date());
      // REST data is authoritative — reset WS delta accumulator to avoid double-counting
      useWsStore.getState().clearDeltas();

      if (rawCams.status === 'rejected') {
        setError('Failed to load cameras');
      }
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Failed to load cameras');
    } finally {
      setIsLoading(false);
    }
  }, [groupId]);

  const startPolling = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => fetchCameras(true), CAMERA_POLL_MS);
  }, [fetchCameras]);

  const stopPolling = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  useEffect(() => {
    fetchCameras();
    startPolling();
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && next === 'active') {
        fetchCameras(true); startPolling();
      } else if (next.match(/inactive|background/)) {
        stopPolling();
      }
      appStateRef.current = next;
    });
    return () => { stopPolling(); sub.remove(); };
  }, [fetchCameras, startPolling, stopPolling]);

  // ── WS real-time: apply event deltas to alert_count_today ──────────────
  const eventDeltas = useWsStore(s => s.eventDeltas);
  useEffect(() => {
    if (Object.keys(eventDeltas).length === 0) return;
    setCameras(prev => {
      const updated = prev.map(c => {
        const d = eventDeltas[c.camera_id] ?? 0;
        return d > 0 ? { ...c, alert_count_today: (c.alert_count_today ?? 0) + d } : c;
      });
      const alerts = updated.reduce((s, c) => s + (c.alert_count_today ?? 0), 0);
      setStats(st => ({ ...st, alerts_today: alerts }));
      return updated;
    });
    useWsStore.getState().clearDeltas();
  }, [eventDeltas]);

  return { cameras, groups, stats, isLoading, error, lastFetch, refresh: () => fetchCameras(false) };
}
