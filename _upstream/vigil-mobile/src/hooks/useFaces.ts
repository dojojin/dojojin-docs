// ============================================================
// Vigil Mobile — useFaces Hook
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { faceApi, FaceListParams } from '../api/client';
import { VigilFace } from '../types';

const PAGE_SIZE = 30;

interface UseFacesResult {
  faces:         VigilFace[];
  total:         number;
  hasMore:       boolean;
  isLoading:     boolean;
  isLoadingMore: boolean;
  error:         string | null;
  refresh:       () => void;
  loadMore:      () => void;
}

export function useFaces(filter: Omit<FaceListParams, 'limit' | 'offset'> = {}): UseFacesResult {
  const [faces,         setFaces]         = useState<VigilFace[]>([]);
  const [total,         setTotal]         = useState(0);
  const [isLoading,     setIsLoading]     = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  const facesLenRef = useRef(0);
  facesLenRef.current = faces.length;

  const fetchPage = useCallback(async (reset: boolean) => {
    const offset = reset ? 0 : facesLenRef.current;
    console.log('[useFaces] fetchPage reset=', reset, 'offset=', offset);
    if (reset) { setIsLoading(true); setError(null); }
    else        setIsLoadingMore(true);

    try {
      const { faces: newRows, total: newTotal } = await faceApi.list({
        ...filter,
        limit: PAGE_SIZE,
        offset,
      });
      console.log('[useFaces] got', newRows.length, '/', newTotal);
      setTotal(newTotal);
      setFaces(prev => reset ? newRows : [...prev, ...newRows]);
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? err?.message ?? 'Failed to load faces';
      console.log('[useFaces] error:', msg, err?.response?.status);
      setError(msg);
    } finally {
      if (reset) setIsLoading(false);
      else        setIsLoadingMore(false);
    }
  }, [JSON.stringify(filter)]);

  useEffect(() => { fetchPage(true); }, [fetchPage]);

  const refresh  = useCallback(() => fetchPage(true), [fetchPage]);
  const loadMore = useCallback(() => {
    if (!isLoadingMore && facesLenRef.current < total) fetchPage(false);
  }, [isLoadingMore, total, fetchPage]);

  return {
    faces, total,
    hasMore:       faces.length < total,
    isLoading, isLoadingMore, error,
    refresh, loadMore,
  };
}
