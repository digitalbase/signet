import React from 'react';
import type { ConnectionInfo } from '@signet/types';
import { copyToClipboard } from '../../lib/clipboard.js';
import styles from './Header.module.css';

interface HeaderProps {
  connectionInfo: ConnectionInfo | null;
  sseConnected?: boolean;
}

export function Header({ connectionInfo, sseConnected = false }: HeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <h1 className={styles.title}>Signet</h1>
        <span className={styles.subtitle}>NIP-46 Remote Signer</span>
      </div>

      <div className={styles.rightSection}>
        {sseConnected && (
          <span className={styles.liveBadge} title="Real-time updates active">
            <span className={styles.liveDot} />
            Live
          </span>
        )}

        {connectionInfo && (
          <div className={styles.connection}>
            <span className={styles.statusDot} />
            <span className={styles.npub} title={connectionInfo.npub}>
              {connectionInfo.npub.slice(0, 12)}...{connectionInfo.npub.slice(-8)}
            </span>
            <button
              className={styles.copyButton}
              onClick={() => copyToClipboard(connectionInfo.npubUri)}
              title="Copy bunker URI"
            >
              Copy URI
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
