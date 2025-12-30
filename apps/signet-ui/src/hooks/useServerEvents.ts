import { useEffect, useRef, useState, useCallback } from 'react';
import type { PendingRequest, ConnectedApp, DashboardStats, KeyInfo, RelayStatusResponse, ActivityEntry } from '@signet/types';

/**
 * Server-sent event types matching the backend event-service.ts
 */
export type ServerEvent =
  | { type: 'connected' }
  | { type: 'request:created'; request: PendingRequest }
  | { type: 'request:approved'; requestId: string }
  | { type: 'request:denied'; requestId: string }
  | { type: 'request:expired'; requestId: string }
  | { type: 'request:auto_approved'; activity: ActivityEntry }
  | { type: 'app:connected'; app: ConnectedApp }
  | { type: 'key:created'; key: KeyInfo }
  | { type: 'key:unlocked'; keyName: string }
  | { type: 'key:deleted'; keyName: string }
  | { type: 'stats:updated'; stats: DashboardStats }
  | { type: 'relays:updated'; relays: RelayStatusResponse }
  | { type: 'ping' };

export type ServerEventCallback = (event: ServerEvent) => void;

export interface UseServerEventsOptions {
  enabled?: boolean;
  onEvent?: ServerEventCallback;
}

export interface UseServerEventsResult {
  connected: boolean;
  error: string | null;
  reconnecting: boolean;
  connectionCount: number;
}

const MAX_RECONNECT_DELAY = 30000; // 30 seconds
const INITIAL_RECONNECT_DELAY = 1000; // 1 second

function getApiBase(): string {
  const envBase = import.meta.env.VITE_DAEMON_API_URL ?? import.meta.env.VITE_BUNKER_API_URL;
  if (typeof envBase === 'string' && envBase.trim().length > 0) {
    return envBase.trim().replace(/\/+$/, '');
  }
  return '';
}

export function useServerEvents(options: UseServerEventsOptions = {}): UseServerEventsResult {
  const { enabled = true, onEvent } = options;

  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [connectionCount, setConnectionCount] = useState(0);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEventRef = useRef(onEvent);

  // Keep the callback ref up to date
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const connect = useCallback(() => {
    if (!enabled) return;

    // Clean up any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const apiBase = getApiBase();
    const url = `${apiBase}/events`;

    try {
      const eventSource = new EventSource(url, { withCredentials: true });
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setConnected(true);
        setError(null);
        setReconnecting(false);
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
        setConnectionCount(c => c + 1);
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as ServerEvent;
          if (onEventRef.current) {
            onEventRef.current(data);
          }
        } catch (err) {
          console.error('Failed to parse SSE event:', err);
        }
      };

      eventSource.onerror = () => {
        setConnected(false);

        // EventSource automatically tries to reconnect, but we want more control
        eventSource.close();
        eventSourceRef.current = null;

        // Exponential backoff for reconnect
        setReconnecting(true);
        setError('Connection lost. Reconnecting...');

        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectDelayRef.current = Math.min(
            reconnectDelayRef.current * 2,
            MAX_RECONNECT_DELAY
          );
          connect();
        }, reconnectDelayRef.current);
      };
    } catch (err) {
      setError('Failed to connect to event stream');
      setConnected(false);
    }
  }, [enabled]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setConnected(false);
    setReconnecting(false);
  }, []);

  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  return {
    connected,
    error,
    reconnecting,
    connectionCount,
  };
}
