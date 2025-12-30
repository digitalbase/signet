import { useState, useEffect, useCallback, useRef } from 'react';
import type { RelayStatusResponse } from '@signet/types';
import { apiGet } from '../lib/api-client.js';
import { useSSESubscription } from '../contexts/ServerEventsContext.js';
import type { ServerEvent } from './useServerEvents.js';

// Refresh relay status every 30 seconds as fallback
const REFRESH_INTERVAL_MS = 30 * 1000;

interface UseRelaysResult {
  relays: RelayStatusResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useRelays(): UseRelaysResult {
  const [relays, setRelays] = useState<RelayStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await apiGet<RelayStatusResponse>('/relays');
      setRelays(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load relay status');
    } finally {
      setLoading(false);
    }
  }, []);

  // Subscribe to SSE events for real-time relay status updates
  const handleEvent = useCallback((event: ServerEvent) => {
    if (event.type === 'relays:updated') {
      setRelays(event.relays);
      setError(null);
      setLoading(false);
    }
  }, []);

  useSSESubscription(handleEvent);

  useEffect(() => {
    // Initial fetch
    refresh();

    // Auto-refresh every 30 seconds as fallback
    intervalRef.current = setInterval(refresh, REFRESH_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [refresh]);

  return { relays, loading, error, refresh };
}
