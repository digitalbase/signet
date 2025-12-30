import React, { useState, useMemo } from 'react';
import type { KeyInfo, ConnectedApp } from '@signet/types';
import { LoadingSpinner } from '../shared/LoadingSpinner.js';
import { ConfirmDialog } from '../shared/ConfirmDialog.js';
import { QRModal } from '../shared/QRModal.js';
import { PageHeader } from '../shared/PageHeader.js';
import { Key, ChevronDown, ChevronRight, Copy, QrCode, Lock, Unlock, Trash2, Users, Pencil, Shield } from 'lucide-react';
import { formatRelativeTime, toNpub } from '../../lib/formatters.js';
import { getTrustLevelInfo } from '../../lib/event-labels.js';
import { copyToClipboard as copyText } from '../../lib/clipboard.js';
import styles from './KeysPanel.module.css';

interface KeysPanelProps {
  keys: KeyInfo[];
  apps: ConnectedApp[];
  loading: boolean;
  error: string | null;
  creating: boolean;
  deleting: boolean;
  unlocking: boolean;
  renaming: boolean;
  settingPassphrase: boolean;
  onCreateKey: (data: { keyName: string; passphrase?: string; nsec?: string }) => Promise<KeyInfo | null>;
  onDeleteKey: (keyName: string, passphrase?: string) => Promise<{ success: boolean; revokedApps?: number }>;
  onUnlockKey: (keyName: string, passphrase: string) => Promise<boolean>;
  onRenameKey: (keyName: string, newName: string) => Promise<boolean>;
  onSetPassphrase: (keyName: string, passphrase: string) => Promise<boolean>;
  onClearError: () => void;
}

function isActiveRecently(date: string | null): boolean {
  if (!date) return false;
  const diff = Date.now() - new Date(date).getTime();
  const hours = diff / (1000 * 60 * 60);
  return hours < 24;
}

export function KeysPanel({
  keys,
  apps,
  loading,
  error,
  creating,
  deleting,
  unlocking,
  renaming,
  settingPassphrase,
  onCreateKey,
  onDeleteKey,
  onUnlockKey,
  onRenameKey,
  onSetPassphrase,
  onClearError,
}: KeysPanelProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [nsec, setNsec] = useState('');
  const [createMode, setCreateMode] = useState<'generate' | 'import'>('generate');

  // Unlock state
  const [unlockPassphrase, setUnlockPassphrase] = useState('');

  // Rename state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // Set passphrase state
  const [settingPassphraseKey, setSettingPassphraseKey] = useState<string | null>(null);
  const [newPassphrase, setNewPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');

  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<KeyInfo | null>(null);
  const [deletePassphrase, setDeletePassphrase] = useState('');

  // QR modal state
  const [qrModal, setQrModal] = useState<{ value: string; title: string } | null>(null);

  // Clipboard feedback
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const now = useMemo(() => Date.now(), [keys]);

  // Get apps for a specific key
  const getAppsForKey = (keyName: string): ConnectedApp[] => {
    return apps.filter(app => app.keyName === keyName);
  };

  const handleExpand = (name: string) => {
    if (expandedKey === name) {
      setExpandedKey(null);
    } else {
      setExpandedKey(name);
      setUnlockPassphrase('');
      setEditingKey(null);
      setEditName('');
      setSettingPassphraseKey(null);
      setNewPassphrase('');
      setConfirmPassphrase('');
      onClearError();
    }
  };

  const startSetPassphrase = (key: KeyInfo) => {
    setSettingPassphraseKey(key.name);
    setNewPassphrase('');
    setConfirmPassphrase('');
    onClearError();
  };

  const cancelSetPassphrase = () => {
    setSettingPassphraseKey(null);
    setNewPassphrase('');
    setConfirmPassphrase('');
  };

  const handleSetPassphrase = async () => {
    if (!settingPassphraseKey || !newPassphrase.trim()) return;

    if (newPassphrase !== confirmPassphrase) {
      return; // Button should be disabled, but just in case
    }

    const success = await onSetPassphrase(settingPassphraseKey, newPassphrase);
    if (success) {
      setSettingPassphraseKey(null);
      setNewPassphrase('');
      setConfirmPassphrase('');
    }
  };

  const startRename = (key: KeyInfo) => {
    setEditingKey(key.name);
    setEditName(key.name);
    onClearError();
  };

  const cancelRename = () => {
    setEditingKey(null);
    setEditName('');
  };

  const handleRename = async () => {
    if (!editingKey || !editName.trim()) return;

    const success = await onRenameKey(editingKey, editName.trim());
    if (success) {
      // Update expandedKey to follow the renamed key
      setExpandedKey(editName.trim());
      setEditingKey(null);
      setEditName('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await onCreateKey({
      keyName: keyName.trim(),
      passphrase: passphrase.trim() || undefined,
      nsec: createMode === 'import' ? nsec.trim() : undefined,
    });

    if (result) {
      setShowCreateForm(false);
      setKeyName('');
      setPassphrase('');
      setNsec('');
    }
  };

  const copyToClipboard = async (text: string, field: string) => {
    const success = await copyText(text);
    if (success) {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  const isKeyEncrypted = (key: KeyInfo): boolean => {
    return key.status === 'locked';
  };

  const handleDeleteClick = (key: KeyInfo) => {
    setDeleteConfirm(key);
    setDeletePassphrase('');
    onClearError();
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm) return;

    const needsPassphrase = isKeyEncrypted(deleteConfirm);
    if (needsPassphrase && !deletePassphrase.trim()) {
      return;
    }

    const result = await onDeleteKey(
      deleteConfirm.name,
      needsPassphrase ? deletePassphrase : undefined
    );

    if (result.success) {
      setDeleteConfirm(null);
      setDeletePassphrase('');
      setExpandedKey(null);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteConfirm(null);
    setDeletePassphrase('');
    onClearError();
  };

  const handleUnlock = async (keyName: string) => {
    if (!unlockPassphrase.trim()) return;

    const success = await onUnlockKey(keyName, unlockPassphrase);
    if (success) {
      setUnlockPassphrase('');
    }
  };

  if (loading && keys.length === 0) {
    return <LoadingSpinner text="Loading keys..." />;
  }

  return (
    <div className={styles.container}>
      <PageHeader
        title="Keys"
        count={keys.length}
        action={
          <button
            className={styles.addButton}
            onClick={() => {
              setShowCreateForm(!showCreateForm);
              onClearError();
            }}
          >
            {showCreateForm ? 'Cancel' : '+ Add Key'}
          </button>
        }
      />

      {error && <div className={styles.error}>{error}</div>}

      {showCreateForm && (
        <form className={styles.createForm} onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <label className={styles.label}>Key Name</label>
            <input
              type="text"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="e.g., main-key"
              className={styles.input}
              required
            />
          </div>

          <div className={styles.modeSelector}>
            <button
              type="button"
              className={`${styles.modeButton} ${createMode === 'generate' ? styles.active : ''}`}
              onClick={() => setCreateMode('generate')}
            >
              Generate New
            </button>
            <button
              type="button"
              className={`${styles.modeButton} ${createMode === 'import' ? styles.active : ''}`}
              onClick={() => setCreateMode('import')}
            >
              Import Existing
            </button>
          </div>

          {createMode === 'import' && (
            <div className={styles.formGroup}>
              <label className={styles.label}>Private Key (nsec)</label>
              <input
                type="password"
                value={nsec}
                onChange={(e) => setNsec(e.target.value)}
                placeholder="nsec1..."
                className={styles.input}
                required
              />
            </div>
          )}

          <div className={styles.formGroup}>
            <label className={styles.label}>Encryption Passphrase (optional)</label>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Leave empty for unencrypted storage"
              className={styles.input}
            />
            <span className={styles.hint}>
              Keys without a passphrase are stored in plain text and auto-unlock on startup
            </span>
          </div>

          <button type="submit" className={styles.submitButton} disabled={creating}>
            {creating ? 'Creating...' : createMode === 'generate' ? 'Generate Key' : 'Import Key'}
          </button>
        </form>
      )}

      {keys.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <Key size={48} />
          </div>
          <p>No keys configured</p>
          <p className={styles.emptyHint}>Add your first key to get started</p>
        </div>
      ) : (
        <div className={styles.keyList}>
          {keys.map(key => {
            const isExpanded = expandedKey === key.name;
            const isActive = isActiveRecently(key.lastUsedAt);
            const keyApps = getAppsForKey(key.name);

            return (
              <div key={key.name} className={`${styles.keyCard} ${isExpanded ? styles.expanded : ''}`}>
                <button
                  className={styles.keyHeader}
                  onClick={() => handleExpand(key.name)}
                >
                  <div className={styles.keyMain}>
                    <span className={`${styles.activityDot} ${isActive ? styles.active : ''}`} />
                    <span className={styles.keyName}>{key.name}</span>
                    <span className={`${styles.status} ${styles[key.status]}`}>
                      {key.status === 'locked' && <Lock size={12} />}
                      {key.status}
                    </span>
                  </div>
                  <div className={styles.keyMeta}>
                    {key.npub && (
                      <span className={styles.npubPreview}>
                        {key.npub.slice(0, 12)}...
                      </span>
                    )}
                    <span className={styles.dot}>•</span>
                    <span>{key.userCount} app{key.userCount !== 1 ? 's' : ''}</span>
                    <span className={styles.dot}>•</span>
                    <span>{key.requestCount} request{key.requestCount !== 1 ? 's' : ''}</span>
                    {key.lastUsedAt && (
                      <>
                        <span className={styles.dot}>•</span>
                        <span>{formatRelativeTime(key.lastUsedAt, now)}</span>
                      </>
                    )}
                  </div>
                  <span className={styles.expandIcon}>
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </span>
                </button>

                {isExpanded && (
                  <div className={styles.keyDetails}>
                    {key.status === 'locked' ? (
                      <div className={styles.unlockSection}>
                        <div className={styles.unlockHeader}>
                          <Lock size={20} />
                          <span>Key is Locked</span>
                        </div>
                        <p className={styles.unlockHint}>
                          Enter passphrase to unlock and start signing
                        </p>
                        <div className={styles.unlockForm}>
                          <input
                            type="password"
                            className={styles.input}
                            value={unlockPassphrase}
                            onChange={(e) => setUnlockPassphrase(e.target.value)}
                            placeholder="Enter passphrase"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleUnlock(key.name);
                              }
                            }}
                          />
                          <button
                            className={styles.unlockButton}
                            onClick={() => handleUnlock(key.name)}
                            disabled={unlocking || !unlockPassphrase.trim()}
                          >
                            <Unlock size={16} />
                            {unlocking ? 'Unlocking...' : 'Unlock'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {key.npub && (
                          <div className={styles.detailSection}>
                            <span className={styles.detailLabel}>Public Key</span>
                            <div className={styles.detailRow}>
                              <code className={styles.detailValue}>{key.npub}</code>
                              <div className={styles.detailActions}>
                                <button
                                  className={styles.actionButton}
                                  onClick={() => copyToClipboard(key.npub!, `npub-${key.name}`)}
                                >
                                  <Copy size={14} />
                                  {copiedField === `npub-${key.name}` ? 'Copied' : 'Copy'}
                                </button>
                                <button
                                  className={styles.actionButton}
                                  onClick={() => setQrModal({ value: key.npub!, title: 'Public Key' })}
                                >
                                  <QrCode size={14} />
                                  QR
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {key.bunkerUri && (
                          <div className={styles.detailSection}>
                            <span className={styles.detailLabel}>Bunker Connection</span>
                            <div className={styles.detailRow}>
                              <code className={styles.detailValue}>
                                {key.bunkerUri.slice(0, 40)}...
                              </code>
                              <div className={styles.detailActions}>
                                <button
                                  className={styles.actionButton}
                                  onClick={() => copyToClipboard(key.bunkerUri!, `bunker-${key.name}`)}
                                >
                                  <Copy size={14} />
                                  {copiedField === `bunker-${key.name}` ? 'Copied' : 'Copy'}
                                </button>
                                <button
                                  className={styles.actionButton}
                                  onClick={() => setQrModal({ value: key.bunkerUri!, title: 'Bunker URI' })}
                                >
                                  <QrCode size={14} />
                                  QR
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {!key.isEncrypted && (
                          <div className={styles.detailSection}>
                            <span className={styles.detailLabel}>
                              <Shield size={14} />
                              Security
                            </span>
                            {settingPassphraseKey === key.name ? (
                              <div className={styles.setPassphraseForm}>
                                <input
                                  type="password"
                                  className={styles.input}
                                  value={newPassphrase}
                                  onChange={(e) => setNewPassphrase(e.target.value)}
                                  placeholder="New passphrase"
                                  autoFocus
                                />
                                <input
                                  type="password"
                                  className={styles.input}
                                  value={confirmPassphrase}
                                  onChange={(e) => setConfirmPassphrase(e.target.value)}
                                  placeholder="Confirm passphrase"
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && newPassphrase && newPassphrase === confirmPassphrase) {
                                      handleSetPassphrase();
                                    }
                                    if (e.key === 'Escape') {
                                      cancelSetPassphrase();
                                    }
                                  }}
                                />
                                {newPassphrase && confirmPassphrase && newPassphrase !== confirmPassphrase && (
                                  <span className={styles.passphraseMismatch}>Passphrases do not match</span>
                                )}
                                <div className={styles.setPassphraseActions}>
                                  <button
                                    className={styles.saveButton}
                                    onClick={handleSetPassphrase}
                                    disabled={settingPassphrase || !newPassphrase.trim() || newPassphrase !== confirmPassphrase}
                                  >
                                    {settingPassphrase ? 'Saving...' : 'Set Passphrase'}
                                  </button>
                                  <button
                                    className={styles.cancelButton}
                                    onClick={cancelSetPassphrase}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className={styles.securityWarning}>
                                <p>This key is stored unencrypted. Anyone with access to the config file can read it.</p>
                                <button
                                  className={styles.setPassphraseButton}
                                  onClick={() => startSetPassphrase(key)}
                                >
                                  <Lock size={14} />
                                  Set Passphrase
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}

                    {keyApps.length > 0 && (
                      <div className={styles.detailSection}>
                        <span className={styles.detailLabel}>
                          <Users size={14} />
                          Connected Apps
                        </span>
                        <div className={styles.appsList}>
                          {keyApps.map(app => {
                            const trustInfo = getTrustLevelInfo(app.trustLevel);
                            const displayName = app.description || toNpub(app.userPubkey).slice(0, 12) + '...';
                            return (
                              <div key={app.id} className={styles.appItem}>
                                <span className={styles.appName}>{displayName}</span>
                                <span className={`${styles.appTrust} ${styles[app.trustLevel]}`}>
                                  {trustInfo.label}
                                </span>
                                <span className={styles.appRequests}>
                                  {app.requestCount} req
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className={styles.actions}>
                      {editingKey === key.name ? (
                        <div className={styles.renameRow}>
                          <input
                            type="text"
                            className={styles.input}
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder="New key name"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRename();
                              if (e.key === 'Escape') cancelRename();
                            }}
                          />
                          <button
                            className={styles.saveButton}
                            onClick={handleRename}
                            disabled={renaming || !editName.trim() || editName.trim() === key.name}
                          >
                            {renaming ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            className={styles.cancelButton}
                            onClick={cancelRename}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            className={styles.renameButton}
                            onClick={() => startRename(key)}
                          >
                            <Pencil size={16} />
                            Rename
                          </button>
                          <button
                            className={styles.deleteButton}
                            onClick={() => handleDeleteClick(key)}
                          >
                            <Trash2 size={16} />
                            Delete Key
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={deleteConfirm !== null}
        title="Delete Key"
        message={
          deleteConfirm ? (
            <div className={styles.deleteConfirmContent}>
              <p>
                Are you sure you want to delete the key <strong>{deleteConfirm.name}</strong>?
              </p>
              {deleteConfirm.userCount > 0 && (
                <p className={styles.deleteWarning}>
                  This will revoke access for {deleteConfirm.userCount} connected app{deleteConfirm.userCount !== 1 ? 's' : ''}.
                </p>
              )}
              <p className={styles.deleteWarning}>
                This action cannot be undone.
              </p>
              {isKeyEncrypted(deleteConfirm) && (
                <div className={styles.deletePassphraseInput}>
                  <label htmlFor="delete-passphrase">Enter passphrase to confirm:</label>
                  <input
                    id="delete-passphrase"
                    type="password"
                    value={deletePassphrase}
                    onChange={(e) => setDeletePassphrase(e.target.value)}
                    placeholder="Enter key passphrase"
                    className={styles.input}
                    autoComplete="off"
                  />
                </div>
              )}
              {error && <p className={styles.deleteError}>{error}</p>}
            </div>
          ) : ''
        }
        confirmLabel={deleting ? 'Deleting...' : 'Delete Key'}
        danger
        disabled={deleting || (deleteConfirm !== null && isKeyEncrypted(deleteConfirm) && !deletePassphrase.trim())}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />

      <QRModal
        open={qrModal !== null}
        onClose={() => setQrModal(null)}
        value={qrModal?.value ?? ''}
        title={qrModal?.title}
      />
    </div>
  );
}
