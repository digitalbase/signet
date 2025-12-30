import React, { useState, useMemo } from 'react';
import type { DisplayRequest, RequestFilter, RequestMeta, TrustLevel } from '@signet/types';
import type { SortBy } from '../../hooks/useRequests.js';
import { RequestCard } from './RequestCard.js';
import { RequestDetailsModal } from './RequestDetailsModal.js';
import { LoadingSpinner } from '../shared/LoadingSpinner.js';
import { ErrorMessage } from '../shared/ErrorMessage.js';
import { PageHeader } from '../shared/PageHeader.js';
import { RequestsIcon, SearchIcon } from '../shared/Icons.js';
import styles from './RequestsPanel.module.css';

type DateGroup = 'Today' | 'Yesterday' | 'This Week' | 'Older';

function getDateGroup(dateStr: string): DateGroup {
  const date = new Date(dateStr);
  const now = new Date();

  // Reset times to compare dates only
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (dateOnly >= today) return 'Today';
  if (dateOnly >= yesterday) return 'Yesterday';
  if (dateOnly >= weekAgo) return 'This Week';
  return 'Older';
}

function groupRequestsByDate(requests: DisplayRequest[]): Map<DateGroup, DisplayRequest[]> {
  const groups = new Map<DateGroup, DisplayRequest[]>();
  const order: DateGroup[] = ['Today', 'Yesterday', 'This Week', 'Older'];

  // Initialize groups in order
  order.forEach(group => groups.set(group, []));

  requests.forEach(request => {
    const group = getDateGroup(request.createdAt);
    groups.get(group)!.push(request);
  });

  // Remove empty groups
  order.forEach(group => {
    if (groups.get(group)!.length === 0) {
      groups.delete(group);
    }
  });

  return groups;
}

const FILTER_TABS: Array<{ id: RequestFilter; label: string }> = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'expired', label: 'Expired' },
];

const SORT_OPTIONS: Array<{ id: SortBy; label: string }> = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'expiring', label: 'Expiring soon' },
];

interface RequestsPanelProps {
  requests: DisplayRequest[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  filter: RequestFilter;
  passwords: Record<string, string>;
  meta: Record<string, RequestMeta>;
  selectionMode: boolean;
  selectedIds: Set<string>;
  bulkApproving: boolean;
  searchQuery: string;
  sortBy: SortBy;
  onFilterChange: (filter: RequestFilter) => void;
  onPasswordChange: (id: string, password: string) => void;
  onApprove: (id: string, trustLevel?: TrustLevel, alwaysAllow?: boolean, allowKind?: number) => void;
  onLoadMore: () => void;
  onToggleSelectionMode: () => void;
  onToggleSelection: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onBulkApprove: () => void;
  onSearchChange: (query: string) => void;
  onSortChange: (sort: SortBy) => void;
  onRefresh: () => void;
}

export function RequestsPanel({
  requests,
  loading,
  loadingMore,
  error,
  hasMore,
  filter,
  passwords,
  meta,
  selectionMode,
  selectedIds,
  bulkApproving,
  searchQuery,
  sortBy,
  onFilterChange,
  onPasswordChange,
  onApprove,
  onLoadMore,
  onToggleSelectionMode,
  onToggleSelection,
  onSelectAll,
  onDeselectAll,
  onBulkApprove,
  onSearchChange,
  onSortChange,
  onRefresh,
}: RequestsPanelProps) {
  const [selectedRequest, setSelectedRequest] = useState<DisplayRequest | null>(null);
  const [keyFilter, setKeyFilter] = useState<string>('all');
  const [appFilter, setAppFilter] = useState<string>('all');

  // Get unique keys and apps for filters
  const uniqueKeys = useMemo(() => {
    const keys = new Set<string>();
    requests.forEach(r => {
      if (r.keyName) keys.add(r.keyName);
    });
    return Array.from(keys).sort();
  }, [requests]);

  const uniqueApps = useMemo(() => {
    const apps = new Map<string, string>(); // npub -> display name (appName or truncated npub)
    requests.forEach(r => {
      if (!apps.has(r.npub)) {
        apps.set(r.npub, r.appName || r.npub.slice(0, 12) + '...');
      }
    });
    return Array.from(apps.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [requests]);

  // Apply local filters
  const filteredRequests = useMemo(() => {
    let result = requests;
    if (keyFilter !== 'all') {
      result = result.filter(r => r.keyName === keyFilter);
    }
    if (appFilter !== 'all') {
      result = result.filter(r => r.npub === appFilter);
    }
    return result;
  }, [requests, keyFilter, appFilter]);

  const pendingRequests = filteredRequests.filter(r => r.state === 'pending');
  const groupedRequests = useMemo(() => groupRequestsByDate(filteredRequests), [filteredRequests]);

  return (
    <div className={styles.container}>
      <PageHeader title="Activity" />

      <div className={styles.header}>
        <div className={styles.filters}>
          {FILTER_TABS.map(tab => (
            <button
              key={tab.id}
              className={`${styles.filterTab} ${filter === tab.id ? styles.active : ''}`}
              onClick={() => onFilterChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {filter === 'pending' && pendingRequests.length > 0 && (
          <div className={styles.bulkActions}>
            <button
              className={styles.selectionButton}
              onClick={onToggleSelectionMode}
            >
              {selectionMode ? 'Cancel' : 'Select'}
            </button>

            {selectionMode && (
              <>
                <button className={styles.selectAllButton} onClick={onSelectAll}>
                  Select All
                </button>
                {selectedIds.size > 0 && (
                  <>
                    <button className={styles.deselectButton} onClick={onDeselectAll}>
                      Deselect
                    </button>
                    <button
                      className={styles.bulkApproveButton}
                      onClick={onBulkApprove}
                      disabled={bulkApproving}
                    >
                      {bulkApproving
                        ? 'Approving...'
                        : `Approve ${selectedIds.size}`}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className={styles.searchSortRow}>
        <div className={styles.searchBox}>
          <SearchIcon size={16} className={styles.searchIcon} aria-hidden="true" />
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search by method, npub, key, or event kind..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search requests"
          />
          {searchQuery && (
            <button
              className={styles.clearSearch}
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
            >
              &times;
            </button>
          )}
        </div>

        <div className={styles.filtersRow}>
          {uniqueKeys.length > 1 && (
            <select
              className={styles.filterSelect}
              value={keyFilter}
              onChange={(e) => setKeyFilter(e.target.value)}
              aria-label="Filter by key"
            >
              <option value="all">All keys</option>
              {uniqueKeys.map(key => (
                <option key={key} value={key}>{key}</option>
              ))}
            </select>
          )}

          {uniqueApps.length > 1 && (
            <select
              className={styles.filterSelect}
              value={appFilter}
              onChange={(e) => setAppFilter(e.target.value)}
              aria-label="Filter by app"
            >
              <option value="all">All apps</option>
              {uniqueApps.map(([npub, label]) => (
                <option key={npub} value={npub}>{label}</option>
              ))}
            </select>
          )}

          <select
            className={styles.filterSelect}
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value as SortBy)}
            aria-label="Sort requests"
          >
            {SORT_OPTIONS.map(opt => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <ErrorMessage
          error={error}
          onRetry={onRefresh}
          retrying={loading}
        />
      )}

      {loading && requests.length === 0 ? (
        <LoadingSpinner text="Loading requests..." />
      ) : requests.length === 0 ? (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <RequestsIcon size={48} />
          </span>
          <span>No {filter} requests</span>
        </div>
      ) : (
        <div className={styles.list}>
          {Array.from(groupedRequests.entries()).map(([group, groupRequests]) => (
            <div key={group} className={styles.dateGroup}>
              <h3 className={styles.dateGroupHeader}>{group}</h3>
              <div className={styles.dateGroupList}>
                {groupRequests.map(request => (
                  <RequestCard
                    key={request.id}
                    request={request}
                    meta={meta[request.id] ?? { state: 'idle' }}
                    password={passwords[request.id] ?? ''}
                    selectionMode={selectionMode}
                    selected={selectedIds.has(request.id)}
                    onPasswordChange={(pw) => onPasswordChange(request.id, pw)}
                    onApprove={(trustLevel, alwaysAllow, allowKind) => onApprove(request.id, trustLevel, alwaysAllow, allowKind)}
                    onSelect={() => onToggleSelection(request.id)}
                    onViewDetails={() => setSelectedRequest(request)}
                  />
                ))}
              </div>
            </div>
          ))}

          {hasMore && (
            <button
              className={styles.loadMoreButton}
              onClick={onLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading...' : 'Load More'}
            </button>
          )}
        </div>
      )}

      <RequestDetailsModal
        request={selectedRequest}
        open={selectedRequest !== null}
        onClose={() => setSelectedRequest(null)}
      />
    </div>
  );
}
