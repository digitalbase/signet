import { useState, useCallback, useEffect } from 'react';
import type { DashboardStats, ActivityEntry } from '@signet/types';
import { apiGet } from '../lib/api-client.js';
import { buildErrorMessage } from '../lib/formatters.js';
import { useSSESubscription } from '../contexts/ServerEventsContext.js';
import type { ServerEvent } from './useServerEvents.js';

interface DashboardData {
  stats: DashboardStats;
  activity: ActivityEntry[];
  hourlyActivity?: Array<{ hour: number; type: string; count: number }>;
}

interface UseDashboardResult {
  stats: DashboardStats | null;
  activity: ActivityEntry[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useDashboard(): UseDashboardResult {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiGet<DashboardData>('/dashboard');
      setStats(response.stats);
      setActivity(response.activity);
      setError(null);
    } catch (err) {
      setError(buildErrorMessage(err, 'Unable to load dashboard'));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Subscribe to SSE events for real-time stats updates
  const handleSSEEvent = useCallback((event: ServerEvent) => {
    // Handle stats updates
    setStats(prev => {
      if (!prev) return prev;

      switch (event.type) {
        case 'request:created':
          return {
            ...prev,
            pendingRequests: prev.pendingRequests + 1,
            recentActivity24h: prev.recentActivity24h + 1,
          };
        case 'request:approved':
        case 'request:denied':
        case 'request:expired':
          return {
            ...prev,
            pendingRequests: Math.max(0, prev.pendingRequests - 1),
          };
        case 'request:auto_approved':
          return {
            ...prev,
            recentActivity24h: prev.recentActivity24h + 1,
          };
        case 'app:connected':
          return {
            ...prev,
            connectedApps: prev.connectedApps + 1,
          };
        case 'stats:updated':
          return event.stats;
        default:
          return prev;
      }
    });

    // Handle activity updates for auto-approved requests
    if (event.type === 'request:auto_approved') {
      setActivity(prev => [event.activity, ...prev].slice(0, 20));
    }
  }, []);

  useSSESubscription(handleSSEEvent);

  return {
    stats,
    activity,
    loading,
    error,
    refresh,
  };
}
