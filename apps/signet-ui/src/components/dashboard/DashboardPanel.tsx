import React from 'react';
import type { DashboardStats, ActivityEntry } from '@signet/types';
import { formatRelativeTime } from '../../lib/formatters.js';
import { LoadingSpinner } from '../shared/LoadingSpinner.js';
import { ApprovalIcon, RegistrationIcon, ActivityIcon } from '../shared/Icons.js';
import styles from './DashboardPanel.module.css';

interface DashboardPanelProps {
  stats: DashboardStats | null;
  activity: ActivityEntry[];
  loading: boolean;
  error: string | null;
  showAutoApproved: boolean;
  onToggleShowAutoApproved: () => void;
}

function getActivityIcon(type: string) {
  switch (type) {
    case 'approval':
      return ApprovalIcon;
    case 'registration':
      return RegistrationIcon;
    default:
      return ActivityIcon;
  }
}

export function DashboardPanel({ stats, activity, loading, error, showAutoApproved, onToggleShowAutoApproved }: DashboardPanelProps) {
  if (loading && !stats) {
    return <LoadingSpinner text="Loading dashboard..." />;
  }

  if (error) {
    return (
      <div className={styles.error} role="alert">
        <span>Failed to load dashboard: {error}</span>
      </div>
    );
  }

  const now = Date.now();
  const filteredActivity = showAutoApproved
    ? activity
    : activity.filter(entry => !entry.autoApproved);

  return (
    <div className={styles.container}>
      {stats && (
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={styles.statValue}>{stats.totalKeys}</div>
            <div className={styles.statLabel}>Total Keys</div>
          </div>
          <div className={`${styles.statCard} ${styles.highlight}`}>
            <div className={styles.statValue}>{stats.activeKeys}</div>
            <div className={styles.statLabel}>Active Keys</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statValue}>{stats.connectedApps}</div>
            <div className={styles.statLabel}>Connected Apps</div>
          </div>
          <div className={`${styles.statCard} ${stats.pendingRequests > 0 ? styles.warning : ''}`}>
            <div className={styles.statValue}>{stats.pendingRequests}</div>
            <div className={styles.statLabel}>Pending Requests</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statValue}>{stats.recentActivity24h}</div>
            <div className={styles.statLabel}>Activity (24h)</div>
          </div>
        </div>
      )}

      <div className={styles.activitySection}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>Recent Activity</h3>
          <label className={styles.filterToggle}>
            <input
              type="checkbox"
              checked={showAutoApproved}
              onChange={onToggleShowAutoApproved}
            />
            <span>Show auto-approved</span>
          </label>
        </div>
        {filteredActivity.length === 0 ? (
          <div className={styles.emptyState}>
            {activity.length === 0 ? 'No recent activity' : 'No manual approvals'}
          </div>
        ) : (
          <div className={styles.activityList}>
            {filteredActivity.map(entry => {
              const Icon = getActivityIcon(entry.type);
              return (
                <div key={entry.id} className={styles.activityItem}>
                  <div className={styles.activityIcon} aria-hidden="true">
                    <Icon size={16} />
                  </div>
                  <div className={styles.activityContent}>
                    <span className={styles.activityType}>{entry.type}</span>
                    {entry.autoApproved && <span className={styles.autoBadge}>Auto</span>}
                    {entry.method && <span className={styles.activityMethod}>{entry.method}</span>}
                    {entry.keyName && <span className={styles.activityKey}>{entry.keyName}</span>}
                  </div>
                  <div className={styles.activityTime}>
                    {formatRelativeTime(entry.timestamp, now)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
