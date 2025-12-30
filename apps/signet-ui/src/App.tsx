import React, { useEffect, useState, useCallback } from 'react';
import type { ConnectionInfo, TrustLevel, DisplayRequest } from '@signet/types';
import { fetchConnectionInfo } from './lib/connection.js';
import { ToastProvider, useToast } from './contexts/ToastContext.js';
import { SettingsProvider, useSettings } from './contexts/SettingsContext.js';
import { ServerEventsProvider, useServerEventsContext, useSSESubscription } from './contexts/ServerEventsContext.js';
import type { ServerEvent } from './hooks/useServerEvents.js';
import { AppLayout } from './components/layout/AppLayout.js';
import type { NavItem } from './components/layout/Sidebar.js';
import { Toast } from './components/shared/Toast.js';
import { LoadingSpinner } from './components/shared/LoadingSpinner.js';
import { CommandPalette } from './components/shared/CommandPalette.js';
import { HomeView } from './components/home/HomeView.js';
import { RequestsPanel } from './components/requests/RequestsPanel.js';
import { RequestDetailsModal } from './components/requests/RequestDetailsModal.js';
import { KeysPanel } from './components/keys/KeysPanel.js';
import { AppsPanel } from './components/apps/AppsPanel.js';
import { SettingsPanel } from './components/settings/SettingsPanel.js';
import { useRequests } from './hooks/useRequests.js';
import { useKeys } from './hooks/useKeys.js';
import { useApps } from './hooks/useApps.js';
import { useDashboard } from './hooks/useDashboard.js';
import { useRelays } from './hooks/useRelays.js';
import './design-system.css';
import './styles.css';

type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

function AppContent() {
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [activeNav, setActiveNav] = useState<NavItem>('home');
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>('default');
  const [detailsModalRequest, setDetailsModalRequest] = useState<DisplayRequest | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [selectedKeyName, setSelectedKeyName] = useState<string | null>(null);
  const [showAutoApproved, setShowAutoApproved] = useState(true);

  const { showToast } = useToast();
  const { settings } = useSettings();
  const { connected: sseConnected } = useServerEventsContext();

  // Hooks for data
  const requests = useRequests();
  const keys = useKeys();
  const apps = useApps();
  const dashboard = useDashboard();
  const relays = useRelays();

  // Handle SSE events for real-time updates
  const handleSSEEvent = useCallback((event: ServerEvent) => {
    switch (event.type) {
      case 'connected':
        // SSE just connected/reconnected - refresh all data to catch any missed events
        requests.refresh();
        apps.refresh();
        keys.refresh();
        dashboard.refresh();
        break;
      case 'request:created':
        requests.refresh();
        dashboard.refresh();
        break;
      case 'request:approved':
      case 'request:denied':
      case 'request:expired':
      case 'request:auto_approved':
        requests.refresh();
        dashboard.refresh();
        break;
      case 'app:connected':
        apps.refresh();
        keys.refresh();
        dashboard.refresh();
        break;
      case 'key:created':
      case 'key:unlocked':
      case 'key:deleted':
        keys.refresh();
        dashboard.refresh();
        break;
      case 'stats:updated':
        dashboard.refresh();
        break;
    }
  }, [requests.refresh, apps.refresh, keys.refresh, dashboard.refresh]);

  useSSESubscription(handleSSEEvent);

  // Load connection info
  useEffect(() => {
    fetchConnectionInfo()
      .then(setConnectionInfo)
      .catch(console.error)
      .finally(() => setConnectionLoading(false));
  }, []);

  // Load keys and apps on mount
  useEffect(() => {
    keys.refresh();
    apps.refresh();
  }, []);

  // Check notification permission on mount
  useEffect(() => {
    if (!('Notification' in window)) {
      setNotificationPermission('unsupported');
      return;
    }

    setNotificationPermission(Notification.permission as NotificationPermissionState);
  }, []);

  // Request notification permission
  const requestNotificationPermission = useCallback(async () => {
    if (!('Notification' in window)) return;

    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission as NotificationPermissionState);
    } catch (error) {
      console.error('Failed to request notification permission:', error);
    }
  }, []);

  // Global keyboard shortcut for Command Palette (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Use dashboard stats for accurate pending count (not affected by filter)
  const pendingCount = dashboard.stats?.pendingRequests ?? 0;

  // Update browser tab title with pending count
  useEffect(() => {
    document.title = pendingCount > 0 ? `(${pendingCount}) Signet` : 'Signet';
  }, [pendingCount]);

  // Send notification for new requests (use dashboard stats for accuracy regardless of filter)
  useEffect(() => {
    if (!settings.notificationsEnabled || notificationPermission !== 'granted') {
      return;
    }

    if (pendingCount > 0 && document.hidden) {
      new Notification('Signet', {
        body: `${pendingCount} pending request${pendingCount > 1 ? 's' : ''} awaiting approval`,
        icon: '/favicon.ico',
      });
    }
  }, [pendingCount, settings.notificationsEnabled, notificationPermission]);

  // Handle key selection from sidebar
  const handleKeySelect = useCallback((keyName: string) => {
    setSelectedKeyName(keyName);
    setActiveNav('keys');
  }, []);

  // Handle navigation changes - reset filter when going to Home
  const handleNavChange = useCallback((nav: NavItem) => {
    setActiveNav(nav);
    // When navigating to Home, ensure we're viewing pending requests
    if (nav === 'home' && requests.filter !== 'pending') {
      requests.setFilter('pending');
    }
  }, [requests.filter, requests.setFilter]);

  if (connectionLoading) {
    return (
      <div className="app-loading">
        <LoadingSpinner size="large" text="Connecting to Signet..." />
      </div>
    );
  }

  // Render content based on active nav
  const renderContent = () => {
    switch (activeNav) {
      case 'home':
        return (
          <HomeView
            requests={requests.requests}
            stats={dashboard.stats}
            activity={dashboard.activity}
            loading={requests.loading || dashboard.loading}
            relayStatus={relays.relays}
            passwords={requests.passwords}
            showAutoApproved={showAutoApproved}
            onPasswordChange={requests.setPassword}
            onApprove={requests.approve}
            onViewDetails={setDetailsModalRequest}
            onNavigateToActivity={() => setActiveNav('activity')}
            onNavigateToKeys={() => setActiveNav('keys')}
            onToggleShowAutoApproved={() => setShowAutoApproved(prev => !prev)}
          />
        );

      case 'apps':
        return (
          <AppsPanel
            apps={apps.apps}
            loading={apps.loading}
            error={apps.error}
            onRevokeApp={async (appId) => {
              const success = await apps.revokeApp(appId);
              if (success) {
                showToast({
                  message: 'App access revoked',
                  type: 'success',
                });
              }
              return success;
            }}
            onUpdateDescription={async (appId, description) => {
              const success = await apps.updateDescription(appId, description);
              if (success) {
                showToast({
                  message: 'App renamed successfully',
                  type: 'success',
                });
              }
              return success;
            }}
            onUpdateTrustLevel={async (appId: number, trustLevel: TrustLevel) => {
              const success = await apps.updateTrustLevel(appId, trustLevel);
              if (success) {
                showToast({
                  message: 'Trust level updated',
                  type: 'success',
                });
              }
              return success;
            }}
            onClearError={apps.clearError}
          />
        );

      case 'activity':
        // For now, show requests panel as activity
        return (
          <RequestsPanel
            requests={requests.requests}
            loading={requests.loading}
            loadingMore={requests.loadingMore}
            error={requests.error}
            hasMore={requests.hasMore}
            filter={requests.filter}
            passwords={requests.passwords}
            meta={requests.meta}
            selectionMode={requests.selectionMode}
            selectedIds={requests.selectedIds}
            bulkApproving={requests.bulkApproving}
            searchQuery={requests.searchQuery}
            sortBy={requests.sortBy}
            onFilterChange={requests.setFilter}
            onPasswordChange={requests.setPassword}
            onApprove={requests.approve}
            onLoadMore={requests.loadMore}
            onToggleSelectionMode={requests.toggleSelectionMode}
            onToggleSelection={requests.toggleSelection}
            onSelectAll={requests.selectAll}
            onDeselectAll={requests.deselectAll}
            onBulkApprove={async () => {
              const result = await requests.bulkApprove();
              if (result.approved > 0) {
                showToast({
                  message: `Approved ${result.approved} request${result.approved > 1 ? 's' : ''}`,
                  type: 'success',
                });
              }
              if (result.failed > 0) {
                showToast({
                  message: `Failed to approve ${result.failed} request${result.failed > 1 ? 's' : ''}`,
                  type: 'error',
                });
              }
            }}
            onSearchChange={requests.setSearchQuery}
            onSortChange={requests.setSortBy}
            onRefresh={requests.refresh}
          />
        );

      case 'keys':
        return (
          <KeysPanel
            keys={keys.keys}
            apps={apps.apps}
            loading={keys.loading}
            error={keys.error}
            creating={keys.creating}
            deleting={keys.deleting}
            unlocking={keys.unlocking}
            renaming={keys.renaming}
            settingPassphrase={keys.settingPassphrase}
            onCreateKey={keys.createKey}
            onDeleteKey={keys.deleteKey}
            onUnlockKey={keys.unlockKey}
            onRenameKey={keys.renameKey}
            onSetPassphrase={keys.setPassphrase}
            onClearError={keys.clearError}
          />
        );

      case 'settings':
        return (
          <SettingsPanel
            notificationPermission={notificationPermission}
            onRequestNotificationPermission={requestNotificationPermission}
          />
        );

      default:
        return null;
    }
  };

  return (
    <AppLayout
      activeNav={activeNav}
      onNavChange={handleNavChange}
      pendingCount={pendingCount}
      keys={keys.keys}
      activeKeyName={selectedKeyName ?? undefined}
      onKeySelect={handleKeySelect}
      sseConnected={sseConnected}
      onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      relayStatus={relays.relays}
    >
      {renderContent()}

      {/* Keys Panel - shown when clicking on a key in sidebar */}
      {/* For now, keys are managed separately - could add a keys nav item */}

      {/* Request Details Modal */}
      <RequestDetailsModal
        request={detailsModalRequest}
        open={detailsModalRequest !== null}
        onClose={() => setDetailsModalRequest(null)}
      />

      <Toast />

      {/* Command Palette */}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onNavigate={setActiveNav}
        keys={keys.keys}
        apps={apps.apps}
      />
    </AppLayout>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <ToastProvider>
        <ServerEventsProvider>
          <AppContent />
        </ServerEventsProvider>
      </ToastProvider>
    </SettingsProvider>
  );
}
