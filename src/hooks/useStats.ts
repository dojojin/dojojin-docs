// ============================================================
// Vigil Mobile — useStats Hook
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { statsApi, StatsRange } from '../api/client';
import { CategoryStat, TimelineSeries } from '../types';

export type RangeKey = 'today' | '7d' | '30d';

function rangeToParams(key: RangeKey): StatsRange {
  const now = new Date();
  const to  = now.toISOString();
  if (key === 'today') {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    return { from: start.toISOString(), to };
  }
  const days  = key === '7d' ? 7 : 30;
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: start.toISOString(), to };
}

interface UseStatsResult {
  categories: CategoryStat[];
  series:     TimelineSeries[];
  isLoading:  boolean;
  error:      string | null;
  refresh:    () => void;
}

// cameraIds = undefined → ALL (ไม่ส่ง cameras param); [] หรือมีค่า → filter
export function useStats(rangeKey: RangeKey, cameraIds?: string[]): UseStatsResult {
  const [categories, setCategories] = useState<CategoryStat[]>([]);
  const [series,     setSeries]     = useState<TimelineSeries[]>([]);
  const [isLoading,  setIsLoading]  = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  const camKey = cameraIds ? cameraIds.join(',') : '';

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const range: StatsRange = {
      ...rangeToParams(rangeKey),
      ...(camKey ? { cameras: camKey } : {}),
    };
    try {
      const [c, t] = await Promise.allSettled([
        statsApi.categories(range),
        statsApi.timelineByCategory(range),
      ]);
      setCategories(c.status === 'fulfilled' ? c.value : []);
      setSeries(t.status     === 'fulfilled' ? t.value : []);
      if (c.status === 'rejected') setError('โหลดข้อมูลสถิติไม่สำเร็จ');
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'โหลดข้อมูลสถิติไม่สำเร็จ');
    } finally {
      setIsLoading(false);
    }
  }, [rangeKey, camKey]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  return { categories, series, isLoading, error, refresh: fetchAll };
}
