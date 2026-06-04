// ============================================================
// Vigil Mobile — useEvents Hook
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { eventApi, EventListParams } from '../api/client';
import { VigilEvent } from '../types';

const PAGE_SIZE = 20;

interface UseEventsResult {
  events:        VigilEvent[];
  total:         number;
  hasMore:       boolean;
  isLoading:     boolean;
  isLoadingMore: boolean;
  error:         string | null;
  refresh:       () => void;
  loadMore:      () => void;
}

export function useEvents(filter: Omit<EventListParams, 'limit' | 'offset'> = {}): UseEventsResult {
  const [events,        setEvents]        = useState<VigilEvent[]>([]);
  const [total,         setTotal]         = useState(0);
  const [isLoading,     setIsLoading]     = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  // Use ref to hold current events length for loadMore closure
  const eventsLenRef = useRef(0);
  eventsLenRef.current = events.length;

  const fetchPage = useCallback(async (reset: boolean) => {
    const offset = reset ? 0 : eventsLenRef.current;
    if (reset) { setIsLoading(true); setError(null); }
    else        setIsLoadingMore(true);

    try {
      const { events: newRows, total: newTotal } = await eventApi.list({
        ...filter,
        limit: PAGE_SIZE,
        offset,
      });
      setTotal(newTotal);
      setEvents(prev => reset ? newRows : [...prev, ...newRows]);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Failed to load events');
    } finally {
      if (reset) setIsLoading(false);
      else        setIsLoadingMore(false);
    }
  }, [JSON.stringify(filter)]);  // re-run when filter changes

  useEffect(() => { fetchPage(true); }, [fetchPage]);

  const refresh  = useCallback(() => fetchPage(true),  [fetchPage]);
  const loadMore = useCallback(() => {
    if (!isLoadingMore && eventsLenRef.current < total) fetchPage(false);
  }, [isLoadingMore, total, fetchPage]);

  return {
    events, total,
    hasMore:       events.length < total,
    isLoading, isLoadingMore, error,
    refresh, loadMore,
  };
}
