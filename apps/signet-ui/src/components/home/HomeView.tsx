import React, { useState } from 'react';
import type { DisplayRequest, DashboardStats, TrustLevel, RelayStatusResponse, ActivityEntry } from '@signet/types';
import { Radio, Key, Smartphone, Clock, ChevronDown, ChevronRight, Check, X, Inbox, Activity } from 'lucide-react';
import { PageHeader } from '../shared/PageHeader.js';
import { SkeletonStatCard, SkeletonCard } from '../shared/Skeleton.js';
import { getTrustLevelInfo } from '../../lib/event-labels.js';
import styles from './HomeView.module.css';

const TRUST_LEVELS: TrustLevel[] = ['paranoid', 'reasonable', 'full'];

interface HomeViewProps {
  requests: DisplayRequest[];
  stats: DashboardStats | null;
  activity: ActivityEntry[];
  loading: boolean;
  relayStatus: RelayStatusResponse | null;
  passwords: Record<string, string>;
  showAutoApproved: boolean;
  onPasswordChange: (requestId: string, password: string) => void;
  onApprove: (requestId: string, trustLevel?: TrustLevel) => Promise<void>;
  onViewDetails: (request: DisplayRequest) => void;
  onNavigateToActivity: () => void;
  onNavigateToKeys: () => void;
  onToggleShowAutoApproved: () => void;
}

export function HomeView({
  requests,
  stats,
  activity,
  loading,
  relayStatus,
  passwords,
  showAutoApproved,
  onPasswordChange,
  onApprove,
  onViewDetails,
  onNavigateToActivity,
  onNavigateToKeys,
  onToggleShowAutoApproved,
}: HomeViewProps) {
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
  const [selectedTrustLevels, setSelectedTrustLevels] = useState<Record<string, TrustLevel>>({});

  const pendingRequests = requests.filter(r => r.state === 'pending');

  const getTrustLevel = (requestId: string): TrustLevel => {
    return selectedTrustLevels[requestId] || 'reasonable';
  };

  const setTrustLevel = (requestId: string, level: TrustLevel) => {
    setSelectedTrustLevels(prev => ({ ...prev, [requestId]: level }));
  };

  const filteredActivity = showAutoApproved
    ? activity
    : activity.filter(entry => !entry.autoApproved);
  const recentActivity = filteredActivity.slice(0, 5);

  const formatTimeAgo = (timestamp: string): string => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const getActivityIcon = (type: string) => {
    if (type === 'approved') return <Check size={14} className={styles.activityIconApproved} />;
    if (type === 'denied') return <X size={14} className={styles.activityIconDenied} />;
    return <Clock size={14} className={styles.activityIconPending} />;
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <PageHeader title="Dashboard" />

        {/* Skeleton Stats */}
        <section className={styles.statsSection}>
          <div className={styles.statsGrid}>
            <SkeletonStatCard />
            <SkeletonStatCard />
            <SkeletonStatCard />
            <SkeletonStatCard />
          </div>
        </section>

        {/* Skeleton Pending */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Pending</h2>
          <div className={styles.skeletonList}>
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </section>

        {/* Skeleton Recent */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Recent</h2>
          <div className={styles.skeletonList}>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <PageHeader title="Dashboard" />

      {/* Stats Row */}
      <section className={styles.statsSection}>
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.statIconRelays}`}>
              <Radio size={24} />
            </div>
            <div className={styles.statContent}>
              <span className={styles.statValue}>
                {relayStatus ? `${relayStatus.connected}/${relayStatus.total}` : '-'}
              </span>
              <span className={styles.statLabel}>Relays</span>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.statIconKeys}`}>
              <Key size={24} />
            </div>
            <div className={styles.statContent}>
              <span className={styles.statValue}>{stats?.activeKeys ?? '-'}</span>
              <span className={styles.statLabel}>Keys</span>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.statIconApps}`}>
              <Smartphone size={24} />
            </div>
            <div className={styles.statContent}>
              <span className={styles.statValue}>{stats?.connectedApps ?? '-'}</span>
              <span className={styles.statLabel}>Apps</span>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.statIconActivity}`}>
              <Clock size={24} />
            </div>
            <div className={styles.statContent}>
              <span className={styles.statValue}>{stats?.recentActivity24h ?? '-'}</span>
              <span className={styles.statLabel}>Last 24h</span>
            </div>
          </div>
        </div>
      </section>

      {/* Onboarding - show when no keys exist at all */}
      {stats?.totalKeys === 0 && (
        <section className={styles.onboardingSection}>
          <div className={styles.onboardingCard}>
            <div className={styles.onboardingIcon}>
              <Key size={32} />
            </div>
            <h2 className={styles.onboardingTitle}>Welcome to Signet</h2>
            <p className={styles.onboardingText}>
              Create your first signing key to start using Signet as a remote signer for your Nostr apps.
            </p>
            <button className={styles.onboardingButton} onClick={onNavigateToKeys}>
              <Key size={16} />
              Create Your First Key
            </button>
          </div>
        </section>
      )}

      {/* Only show Pending and Recent when there are keys */}
      {(stats?.totalKeys ?? 0) > 0 && (
        <>
          {/* Pending Approvals */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              Pending
              {pendingRequests.length > 0 && (
                <span className={styles.badge}>{pendingRequests.length}</span>
              )}
            </h2>
            {pendingRequests.length === 0 ? (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon}><Inbox size={32} /></span>
                <p>No pending approvals</p>
              </div>
            ) : (
              <div className={styles.listCard}>
                {pendingRequests.map((request) => {
                  const isExpanded = expandedRequestId === request.id;
                  return (
                    <div key={request.id} className={styles.listItem}>
                      <button
                        className={styles.listItemHeader}
                        onClick={() => setExpandedRequestId(isExpanded ? null : request.id)}
                      >
                        <span className={styles.pendingDot} />
                        <span className={styles.listItemMethod}>{request.method}</span>
                        <span className={styles.listItemMeta}>
                          {request.keyName || 'Unknown'} &bull; {request.createdLabel}
                        </span>
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                      {isExpanded && (
                        <div className={styles.listItemExpanded}>
                          <div className={styles.listItemDetails}>
                            <div className={styles.detailRow}>
                              <span className={styles.detailLabel}>From:</span>
                              <code className={styles.detailValue}>{request.npub.slice(0, 20)}...</code>
                            </div>
                            {request.requiresPassword && (
                              <div className={styles.detailRow}>
                                <span className={styles.detailLabel}>Password:</span>
                                <input
                                  type="password"
                                  className={styles.passwordInput}
                                  value={passwords[request.id] || ''}
                                  onChange={(e) => onPasswordChange(request.id, e.target.value)}
                                  placeholder="Enter key password"
                                />
                              </div>
                            )}
                            {request.method === 'connect' && (
                              <div className={styles.trustSection}>
                                <span className={styles.detailLabel}>Trust:</span>
                                <div className={styles.trustOptions}>
                                  {TRUST_LEVELS.map(level => {
                                    const info = getTrustLevelInfo(level);
                                    const isSelected = getTrustLevel(request.id) === level;
                                    return (
                                      <button
                                        key={level}
                                        className={`${styles.trustOption} ${isSelected ? styles.trustOptionSelected : ''} ${styles[`trust_${level}`]}`}
                                        onClick={() => setTrustLevel(request.id, level)}
                                      >
                                        <span className={styles.trustOptionLabel}>{info.label}</span>
                                        <span className={styles.trustOptionDesc}>{info.description}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                          <div className={styles.listItemActions}>
                            <button
                              className={styles.approveButton}
                              onClick={() => onApprove(request.id, request.method === 'connect' ? getTrustLevel(request.id) : undefined)}
                            >
                              Approve
                            </button>
                            <button
                              className={styles.detailsButton}
                              onClick={() => onViewDetails(request)}
                            >
                              Details
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Recent Activity */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Recent</h2>
              <label className={styles.filterToggle}>
                <input
                  type="checkbox"
                  checked={showAutoApproved}
                  onChange={onToggleShowAutoApproved}
                />
                <span>Show auto</span>
              </label>
            </div>
            {recentActivity.length === 0 ? (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon}><Activity size={32} /></span>
                <p>{activity.length === 0 ? 'No recent activity' : 'No manual approvals'}</p>
              </div>
            ) : (
              <div className={styles.listCard}>
                {recentActivity.map((entry) => (
                  <div key={entry.id} className={styles.activityItem}>
                    {getActivityIcon(entry.type)}
                    <span className={styles.activityMethod}>{entry.method || entry.type}</span>
                    <span className={styles.activityMeta}>
                      {entry.appName || entry.keyName || 'Unknown'}
                    </span>
                    <span className={styles.activityTime}>
                      {entry.autoApproved && <span className={styles.autoBadge}>Auto</span>}
                      {formatTimeAgo(entry.timestamp)}
                    </span>
                  </div>
                ))}
                <button className={styles.viewAllButton} onClick={onNavigateToActivity}>
                  View all
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
