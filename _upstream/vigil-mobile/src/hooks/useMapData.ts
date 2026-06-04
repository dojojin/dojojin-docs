// ============================================================
// Vigil Mobile — useMapData Hook
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import client, { cameraApi } from '../api/client';
import { Camera } from '../types';

export interface MapMarker {
  camera_id:   string;
  camera_name: string;
  lat:         number;
  lon:         number;
  online:      boolean;
  count:       number;   // event count (heatmap) ในช่วงที่กำหนด
  location?:   string;
}

// Thailand bounding box — กรองพิกัดที่ผิด/สลับออก
function validCoord(lat?: number, lon?: number): boolean {
  return lat != null && lon != null
    && lat >= 5 && lat <= 21
    && lon >= 97 && lon <= 106;
}

interface UseMapDataResult {
  markers:   MapMarker[];
  isLoading: boolean;
  error:     string | null;
  refresh:   () => void;
}

export function useMapData(): UseMapDataResult {
  const [markers,   setMarkers]   = useState<MapMarker[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error,     setError]     = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [camsRes, heatRes] = await Promise.allSettled([
        cameraApi.list(),
        client.get('/api/heatmap', { params: { hours: 24 } }),
      ]);
      const cams: Camera[] = camsRes.status === 'fulfilled' ? camsRes.value : [];

      // heatmap → camera_id → count
      const heat: Record<string, number> = {};
      if (heatRes.status === 'fulfilled' && Array.isArray(heatRes.value.data)) {
        heatRes.value.data.forEach((r: { camera_id: string; count: number }) => {
          heat[r.camera_id] = r.count;
        });
      }

      const m: MapMarker[] = cams
        .filter(c => validCoord(c.latitude, c.longitude))
        .map(c => ({
          camera_id:   c.camera_id,
          camera_name: c.camera_name,
          lat:         c.latitude as number,
          lon:         c.longitude as number,
          online:      c.status === 'online',
          count:       heat[c.camera_id] ?? 0,
          location:    c.location,
        }));

      setMarkers(m);
      if (camsRes.status === 'rejected') setError('โหลดข้อมูลกล้องไม่สำเร็จ');
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'โหลดข้อมูลแผนที่ไม่สำเร็จ');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  return { markers, isLoading, error, refresh: fetchAll };
}
