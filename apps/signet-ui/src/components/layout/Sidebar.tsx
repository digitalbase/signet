import React, { useState, useCallback } from 'react';
import { Home, Smartphone, Key, Activity, Settings, ChevronDown, ChevronRight, Link2, Plus } from 'lucide-react';
import type { KeyInfo, RelayStatusResponse } from '@signet/types';
import { copyToClipboard } from '../../lib/clipboard.js';
import styles from './Sidebar.module.css';

export type NavItem = 'home' | 'apps' | 'activity' | 'keys' | 'settings';

interface SidebarProps {
  activeNav: NavItem;
  onNavChange: (nav: NavItem) => void;
  pendingCount: number;
  keys: KeyInfo[];
  activeKeyName?: string;
  onKeySelect?: (keyName: string) => void;
  sseConnected: boolean;
  relayStatus: RelayStatusResponse | null;
}

export function Sidebar({
  activeNav,
  onNavChange,
  pendingCount,
  keys,
  activeKeyName,
  onKeySelect,
  sseConnected,
  relayStatus,
}: SidebarProps) {
  const [keysExpanded, setKeysExpanded] = useState(true);
  const [relaysExpanded, setRelaysExpanded] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopyBunkerUri = useCallback(async (e: React.MouseEvent, key: KeyInfo) => {
    e.stopPropagation(); // Don't trigger key selection
    if (!key.bunkerUri) return;

    const success = await copyToClipboard(key.bunkerUri);
    if (success) {
      setCopiedKey(key.name);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  }, []);

  const navItems: { id: NavItem; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'home', label: 'Home', icon: <Home size={18} />, badge: pendingCount > 0 ? pendingCount : undefined },
    { id: 'apps', label: 'Apps', icon: <Smartphone size={18} /> },
    { id: 'activity', label: 'Activity', icon: <Activity size={18} /> },
  ];

  return (
    <aside className={styles.sidebar}>
      {/* Logo */}
      <div className={styles.logo}>
        <div className={styles.logoIcon}>
          <Key size={20} />
        </div>
        <span className={styles.logoText}>Signet</span>
        {sseConnected && (
          <span className={styles.liveIndicator} title="Real-time updates active">
            <span className={styles.liveDot} />
          </span>
        )}
      </div>

      {/* Main Navigation */}
      <nav className={styles.nav}>
        <ul className={styles.navList}>
          {navItems.map((item) => (
            <li key={item.id}>
              <button
                className={`${styles.navItem} ${activeNav === item.id ? styles.navItemActive : ''}`}
                onClick={() => onNavChange(item.id)}
              >
                <span className={styles.navIcon}>{item.icon}</span>
                <span className={styles.navLabel}>{item.label}</span>
                {item.badge && <span className={styles.navBadge}>{item.badge}</span>}
              </button>
            </li>
          ))}
        </ul>

        {/* Keys Section */}
        <div className={styles.section}>
          <div className={styles.sectionHeaderRow}>
            <button
              className={styles.sectionHeader}
              onClick={() => onNavChange('keys')}
              title="Go to Keys page"
            >
              <span className={styles.sectionTitle}>Keys</span>
            </button>
            <div className={styles.sectionActions}>
              <button
                className={styles.sectionAddButton}
                onClick={() => onNavChange('keys')}
                title="Add key"
              >
                <Plus size={14} />
              </button>
              <button
                className={styles.sectionExpandButton}
                onClick={() => setKeysExpanded(!keysExpanded)}
                title={keysExpanded ? 'Collapse' : 'Expand'}
              >
                {keysExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            </div>
          </div>

          {keysExpanded && (
            <ul className={styles.keyList}>
              {keys.length === 0 ? (
                <li className={styles.keyEmpty}>
                  <button
                    className={styles.keyEmptyButton}
                    onClick={() => onNavChange('keys')}
                  >
                    + Add your first key
                  </button>
                </li>
              ) : (
                keys.map((key) => (
                  <li key={key.name}>
                    <div className={styles.keyRow}>
                      <button
                        className={`${styles.keyItem} ${activeKeyName === key.name ? styles.keyItemActive : ''}`}
                        onClick={() => onKeySelect?.(key.name)}
                      >
                        <span
                          className={`${styles.keyStatus} ${
                            key.status === 'online' ? styles.keyStatusOnline :
                            key.status === 'locked' ? styles.keyStatusLocked :
                            styles.keyStatusOffline
                          }`}
                        />
                        <span className={styles.keyName}>{key.name}</span>
                      </button>
                      {key.bunkerUri && key.status === 'online' && (
                        <button
                          className={`${styles.copyButton} ${copiedKey === key.name ? styles.copied : ''}`}
                          onClick={(e) => handleCopyBunkerUri(e, key)}
                          title={copiedKey === key.name ? 'Copied!' : 'Copy connection string'}
                        >
                          <Link2 size={12} />
                        </button>
                      )}
                    </div>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        {/* Relays Section */}
        <div className={styles.section}>
          <button
            className={styles.sectionHeader}
            onClick={() => setRelaysExpanded(!relaysExpanded)}
          >
            <span className={styles.sectionTitle}>
              Relays
              {relayStatus && (
                <span className={styles.sectionCount}>
                  {relayStatus.connected}/{relayStatus.total}
                </span>
              )}
            </span>
            {relaysExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>

          {relaysExpanded && (
            <ul className={styles.keyList}>
              {!relayStatus || relayStatus.relays.length === 0 ? (
                <li className={styles.keyEmpty}>No relays configured</li>
              ) : (
                relayStatus.relays.map((relay) => {
                  const displayUrl = relay.url.replace(/^wss?:\/\//, '');
                  return (
                    <li key={relay.url}>
                      <div className={styles.relayItem}>
                        <span
                          className={`${styles.keyStatus} ${
                            relay.connected ? styles.keyStatusOnline : styles.keyStatusOffline
                          }`}
                        />
                        <span className={styles.relayUrl} title={relay.url}>
                          {displayUrl}
                        </span>
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          )}
        </div>
      </nav>

      {/* Bottom Section */}
      <div className={styles.bottom}>
        <button
          className={`${styles.navItem} ${activeNav === 'settings' ? styles.navItemActive : ''}`}
          onClick={() => onNavChange('settings')}
        >
          <span className={styles.navIcon}><Settings size={18} /></span>
          <span className={styles.navLabel}>Settings</span>
        </button>
      </div>
    </aside>
  );
}
