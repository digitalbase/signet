import { useState, useCallback, useEffect } from 'react';
import type { PendingRequest, PendingRequestWire, RequestFilter, DisplayRequest, RequestMeta, TrustLevel } from '@signet/types';
import { apiGet, apiPost } from '../lib/api-client.js';
import { buildErrorMessage, formatRelativeTime, toNpub } from '../lib/formatters.js';
import { useSSESubscription } from '../contexts/ServerEventsContext.js';
import type { ServerEvent } from './useServerEvents.js';

const REQUEST_LIMIT = 10;

export type SortBy = 'newest' | 'oldest' | 'expiring';

interface UseRequestsResult {
  requests: DisplayRequest[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  filter: RequestFilter;
  setFilter: (filter: RequestFilter) => void;
  passwords: Record<string, string>;
  setPassword: (id: string, password: string) => void;
  meta: Record<string, RequestMeta>;
  approve: (id: string, trustLevel?: TrustLevel, alwaysAllow?: boolean, allowKind?: number) => Promise<void>;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  // Search and sort
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  sortBy: SortBy;
  setSortBy: (sort: SortBy) => void;
  // Bulk selection
  selectionMode: boolean;
  toggleSelectionMode: () => void;
  selectedIds: Set<string>;
  toggleSelection: (id: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  bulkApprove: (trustLevel?: TrustLevel) => Promise<{ approved: number; failed: number }>;
  bulkApproving: boolean;
}

export function useRequests(): UseRequestsResult {
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [filter, setFilter] = useState<RequestFilter>('pending');
  const [offset, setOffset] = useState(0);
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [meta, setMeta] = useState<Record<string, RequestMeta>>({});
  const [now, setNow] = useState(() => Date.now());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkApproving, setBulkApproving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('newest');

  // Update now every second
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchRequests = useCallback(async (status: RequestFilter, offsetVal: number, append: boolean) => {
    const response = await apiGet<{ requests?: PendingRequestWire[] }>(
      `/requests?limit=${REQUEST_LIMIT}&status=${status}&offset=${offsetVal}`
    );

    const list = Array.isArray(response.requests)
      ? response.requests.map((request) => ({
          ...request,
          requiresPassword: Boolean(request.requiresPassword)
        }))
      : [];

    if (append) {
      setRequests(prev => [...prev, ...list]);
    } else {
      setRequests(list);
      setOffset(REQUEST_LIMIT);
    }

    setHasMore(list.length === REQUEST_LIMIT);
  }, []);

  const refresh = useCallback(async () => {
    try {
      await fetchRequests(filter, 0, false);
      setError(null);
    } catch (err) {
      setError(buildErrorMessage(err, 'Unable to refresh requests'));
    }
  }, [filter, fetchRequests]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      await fetchRequests(filter, offset, true);
      setOffset(prev => prev + REQUEST_LIMIT);
    } catch (err) {
      console.error('Failed to load more requests:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, filter, offset, fetchRequests]);

  // Initial load and filter change
  useEffect(() => {
    let cancelled = false;
    setOffset(0);
    setHasMore(true);
    setLoading(true);

    const load = async () => {
      try {
        await fetchRequests(filter, 0, false);
        if (!cancelled) setError(null);
      } catch (err) {
        if (!cancelled) setError(buildErrorMessage(err, 'Unable to load requests'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [filter, fetchRequests]);

  // Subscribe to SSE events for real-time updates
  const handleSSEEvent = useCallback((event: ServerEvent) => {
    // Only handle events when viewing pending requests
    if (filter !== 'pending') return;

    if (event.type === 'request:created') {
      // Add new request at the beginning
      setRequests(prev => [event.request, ...prev]);
    } else if (event.type === 'request:approved' || event.type === 'request:denied') {
      // Remove the request from the pending list
      setRequests(prev => prev.filter(r => r.id !== event.requestId));
      // Clean up meta state
      setMeta(prev => {
        const next = { ...prev };
        delete next[event.requestId];
        return next;
      });
    } else if (event.type === 'request:expired') {
      // Remove expired request from pending list
      setRequests(prev => prev.filter(r => r.id !== event.requestId));
    }
  }, [filter]);

  useSSESubscription(handleSSEEvent);

  // Clean up passwords and meta when requests change
  useEffect(() => {
    setPasswords(prev => {
      const next: Record<string, string> = {};
      for (const request of requests) {
        if (request.requiresPassword && prev[request.id]) {
          next[request.id] = prev[request.id];
        }
      }
      return next;
    });

    setMeta(prev => {
      const next: Record<string, RequestMeta> = {};
      for (const request of requests) {
        const details = prev[request.id];
        if (details && details.state !== 'success') {
          next[request.id] = details;
        }
      }
      return next;
    });
  }, [requests]);

  const setPassword = useCallback((id: string, password: string) => {
    setPasswords(prev => ({ ...prev, [id]: password }));
  }, []);

  const approve = useCallback(async (id: string, trustLevel?: TrustLevel, alwaysAllow?: boolean, allowKind?: number) => {
    const request = requests.find(r => r.id === id);
    const requiresPassword = request?.requiresPassword ?? false;
    const password = passwords[id]?.trim() ?? '';

    if (requiresPassword && !password) {
      setMeta(prev => ({
        ...prev,
        [id]: { state: 'error', message: 'Password required to authorize this request' }
      }));
      return;
    }

    setMeta(prev => ({ ...prev, [id]: { state: 'approving' } }));

    try {
      const payload: { password?: string; trustLevel?: TrustLevel; alwaysAllow?: boolean; allowKind?: number } = {};
      if (requiresPassword) {
        payload.password = password;
      }
      if (trustLevel) {
        payload.trustLevel = trustLevel;
      }
      if (alwaysAllow) {
        payload.alwaysAllow = alwaysAllow;
      }
      if (allowKind !== undefined) {
        payload.allowKind = allowKind;
      }
      const result = await apiPost<{ ok?: boolean; error?: string }>(`/requests/${id}`, payload);

      if (!result?.ok) {
        throw new Error(result?.error ?? 'Authorization failed');
      }

      setMeta(prev => ({ ...prev, [id]: { state: 'success', message: 'Approved' } }));
      setPasswords(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });

      await refresh();
    } catch (err) {
      setMeta(prev => ({
        ...prev,
        [id]: { state: 'error', message: buildErrorMessage(err, 'Authorization failed') }
      }));
    }
  }, [requests, passwords, refresh]);

  // Decorate requests with computed fields
  const decoratedRequests: DisplayRequest[] = requests.map(request => {
    const expires = Date.parse(request.expiresAt);
    const ttl = Number.isFinite(expires)
      ? Math.max(0, Math.round((expires - now) / 1000))
      : Math.max(0, request.ttlSeconds);

    let state: DisplayRequest['state'];
    if (filter === 'approved' || request.processedAt) {
      state = 'approved';
    } else if (filter === 'expired' || ttl === 0) {
      state = 'expired';
    } else {
      state = 'pending';
    }

    return {
      ...request,
      ttl,
      npub: toNpub(request.remotePubkey),
      createdLabel: formatRelativeTime(request.createdAt, now),
      state,
      approvedAt: request.processedAt ?? undefined
    };
  });

  // Filter by search query
  const filteredRequests = decoratedRequests.filter(request => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      request.method.toLowerCase().includes(query) ||
      request.npub.toLowerCase().includes(query) ||
      (request.keyName?.toLowerCase().includes(query) ?? false) ||
      (request.appName?.toLowerCase().includes(query) ?? false) ||
      (request.eventPreview?.kind.toString().includes(query) ?? false)
    );
  });

  // Sort requests
  const sortedRequests = [...filteredRequests].sort((a, b) => {
    switch (sortBy) {
      case 'oldest':
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      case 'expiring':
        return a.ttl - b.ttl;
      case 'newest':
      default:
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
  });

  // Selection handlers
  const toggleSelectionMode = useCallback(() => {
    setSelectionMode(prev => !prev);
    setSelectedIds(new Set());
  }, []);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    const pendingIds = sortedRequests
      .filter(r => r.state === 'pending')
      .map(r => r.id);
    setSelectedIds(new Set(pendingIds));
  }, [sortedRequests]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const bulkApprove = useCallback(async (trustLevel?: TrustLevel): Promise<{ approved: number; failed: number }> => {
    if (selectedIds.size === 0) return { approved: 0, failed: 0 };

    const toApprove = Array.from(selectedIds);
    const needPassword = toApprove.filter(id => {
      const req = requests.find(r => r.id === id);
      return req?.requiresPassword && (!passwords[id] || !passwords[id].trim());
    });

    if (needPassword.length > 0) {
      setError(`${needPassword.length} selected request(s) require a password`);
      return { approved: 0, failed: needPassword.length };
    }

    setBulkApproving(true);
    let approved = 0;
    let failed = 0;

    for (const id of toApprove) {
      try {
        await approve(id, trustLevel);
        approved++;
      } catch {
        failed++;
      }
    }

    setBulkApproving(false);
    setSelectedIds(new Set());
    setSelectionMode(false);

    return { approved, failed };
  }, [selectedIds, requests, passwords, approve]);

  return {
    requests: sortedRequests,
    loading,
    loadingMore,
    error,
    hasMore,
    filter,
    setFilter,
    passwords,
    setPassword,
    meta,
    approve,
    loadMore,
    refresh,
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    selectionMode,
    toggleSelectionMode,
    selectedIds,
    toggleSelection,
    selectAll,
    deselectAll,
    bulkApprove,
    bulkApproving,
  };
}
