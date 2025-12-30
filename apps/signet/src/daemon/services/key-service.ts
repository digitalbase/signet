import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode, nsecEncode, decode as nip19Decode } from 'nostr-tools/nip19';
import { hexToBytes } from '../lib/hex.js';
import type { KeyInfo, KeySummary } from '@signet/types';
import type { StoredKey } from '../../config/types.js';
import { encryptSecret, decryptSecret } from '../../config/keyring.js';
import { loadConfig, saveConfig } from '../../config/config.js';
import { keyRepository, appRepository } from '../repositories/index.js';
import { createSkeletonProfile } from '../lib/profile.js';
import { getEventService } from './event-service.js';

export type ActiveKeyMap = Record<string, string>;

/**
 * Callback invoked when a key becomes active (unlocked or created).
 * Used to start the bunker backend for the key.
 */
export type OnKeyActivatedCallback = (keyName: string, secret: string) => Promise<void>;

export interface KeyServiceConfig {
    configFile: string;
    allKeys: Record<string, StoredKey>;
    nostrRelays: string[];
    adminSecret?: string;
    onKeyActivated?: OnKeyActivatedCallback;
}

export class KeyService {
    private readonly config: KeyServiceConfig;
    private activeKeys: ActiveKeyMap;

    constructor(config: KeyServiceConfig, initialActiveKeys: ActiveKeyMap = {}) {
        this.config = config;
        this.activeKeys = { ...initialActiveKeys };
    }

    getActiveKeys(): ActiveKeyMap {
        return { ...this.activeKeys };
    }

    /**
     * Set the callback for when a key becomes active.
     * Called after httpServer is available to wire up bunker backend startup.
     */
    setOnKeyActivated(callback: OnKeyActivatedCallback): void {
        this.config.onKeyActivated = callback;
    }

    isKeyActive(keyName: string): boolean {
        return !!this.activeKeys[keyName];
    }

    async createKey(options: {
        keyName: string;
        passphrase?: string;
        nsec?: string;
    }): Promise<KeyInfo> {
        const { keyName, passphrase, nsec } = options;

        if (this.config.allKeys[keyName]) {
            throw new Error('A key with this name already exists');
        }

        let secretKeyBytes: Uint8Array;

        if (nsec) {
            const decoded = nip19Decode(nsec);
            if (decoded.type !== 'nsec') {
                throw new Error('Provided secret is not a valid nsec');
            }
            secretKeyBytes = decoded.data as Uint8Array;
        } else {
            secretKeyBytes = generateSecretKey();
            try {
                await createSkeletonProfile(secretKeyBytes, this.config.nostrRelays);
            } catch (error) {
                console.log(`Failed to create skeleton profile: ${(error as Error).message}`);
            }
        }

        const secretNsec = nsecEncode(secretKeyBytes);
        const pubkey = getPublicKey(secretKeyBytes);
        const npub = npubEncode(pubkey);

        // Save to config
        const config = await loadConfig(this.config.configFile);

        if (passphrase && passphrase.trim()) {
            config.keys[keyName] = encryptSecret(secretNsec, passphrase);
        } else {
            config.keys[keyName] = { key: secretNsec };
        }

        await saveConfig(this.config.configFile, config);

        // Load into memory
        this.activeKeys[keyName] = secretNsec;
        this.config.allKeys[keyName] = config.keys[keyName];

        // Notify that key is now active (starts bunker backend)
        if (this.config.onKeyActivated) {
            await this.config.onKeyActivated(keyName, secretNsec);
        }

        const bunkerUri = this.buildBunkerUri(pubkey);

        const keyInfo: KeyInfo = {
            name: keyName,
            npub,
            bunkerUri,
            status: 'online',
            isEncrypted: !!(passphrase && passphrase.trim()),
            userCount: 0,
            tokenCount: 0,
            requestCount: 0,
            lastUsedAt: null,
        };

        // Emit event for real-time updates
        getEventService().emitKeyCreated(keyInfo);

        return keyInfo;
    }

    async unlockKey(keyName: string, passphrase: string): Promise<string> {
        const record = this.config.allKeys[keyName];
        if (!record?.iv || !record?.data) {
            throw new Error('No encrypted key material found');
        }

        const decrypted = decryptSecret(
            { iv: record.iv, data: record.data },
            passphrase
        );

        this.activeKeys[keyName] = decrypted;

        // Notify that key is now active (starts bunker backend)
        if (this.config.onKeyActivated) {
            await this.config.onKeyActivated(keyName, decrypted);
        }

        // Emit event for real-time updates
        getEventService().emitKeyUnlocked(keyName);

        return decrypted;
    }

    loadKeyMaterial(keyName: string, nsec: string): void {
        this.activeKeys[keyName] = nsec;
    }

    async listKeys(): Promise<KeyInfo[]> {
        const keyNames = Object.keys(this.config.allKeys);
        if (keyNames.length === 0) {
            return [];
        }

        // Batch fetch all stats in 3 queries instead of 3N
        const allStats = await keyRepository.getKeyStatsBatch(keyNames);

        const keys: KeyInfo[] = [];

        for (const [name, entry] of Object.entries(this.config.allKeys)) {
            const isOnline = !!this.activeKeys[name];
            const isEncrypted = !!(entry?.iv && entry?.data);
            const status = isOnline ? 'online' : isEncrypted ? 'locked' : 'offline';

            let npub: string | undefined;
            let bunkerUri: string | undefined;

            if (isOnline) {
                try {
                    const { pubkey: pk, npub: np } = this.deriveKeysFromSecret(this.activeKeys[name]);
                    npub = np;
                    bunkerUri = this.buildBunkerUri(pk);
                } catch (error) {
                    console.log(`Unable to get info for key ${name}: ${(error as Error).message}`);
                }
            } else if (entry?.key) {
                try {
                    const secret = entry.key.startsWith('nsec1')
                        ? entry.key
                        : nsecEncode(hexToBytes(entry.key));
                    const { pubkey: pk, npub: np } = this.deriveKeysFromSecret(secret);
                    npub = np;
                    bunkerUri = this.buildBunkerUri(pk);
                } catch (error) {
                    console.log(`Unable to get info for key ${name}: ${(error as Error).message}`);
                }
            }

            const stats = allStats.get(name) ?? {
                userCount: 0,
                tokenCount: 0,
                requestCount: 0,
                lastUsedAt: null,
            };

            keys.push({
                name,
                npub,
                bunkerUri,
                status,
                isEncrypted,
                userCount: stats.userCount,
                tokenCount: stats.tokenCount,
                requestCount: stats.requestCount,
                lastUsedAt: stats.lastUsedAt?.toISOString() ?? null,
            });
        }

        return keys;
    }

    async describeKeys(): Promise<KeySummary[]> {
        const allKeyNames = Object.keys(this.config.allKeys);
        if (allKeyNames.length === 0) {
            return [];
        }

        // Batch fetch all stats in 3 queries instead of 3N
        const allStats = await keyRepository.getKeyStatsBatch(allKeyNames);

        const keys: KeySummary[] = [];
        const remaining = new Set(allKeyNames);

        for (const [name, secret] of Object.entries(this.activeKeys)) {
            try {
                const { npub } = this.deriveKeysFromSecret(secret);
                const stats = allStats.get(name) ?? { userCount: 0, tokenCount: 0 };

                keys.push({
                    name,
                    npub,
                    userCount: stats.userCount,
                    tokenCount: stats.tokenCount,
                });
            } catch (error) {
                console.log(`Unable to describe key ${name}: ${(error as Error).message}`);
            }

            remaining.delete(name);
        }

        for (const name of remaining) {
            const stats = allStats.get(name) ?? { userCount: 0, tokenCount: 0 };
            keys.push({
                name,
                userCount: stats.userCount,
                tokenCount: stats.tokenCount,
            });
        }

        return keys;
    }

    private buildBunkerUri(pubkey: string): string {
        const relayParams = this.config.nostrRelays
            .map(relay => `relay=${encodeURIComponent(relay)}`)
            .join('&');
        const secret = this.config.adminSecret?.trim().toLowerCase();
        const secretParam = secret ? `&secret=${encodeURIComponent(secret)}` : '';
        return `bunker://${pubkey}?${relayParams}${secretParam}`;
    }

    /**
     * Derive pubkey and npub from a secret key (nsec or hex).
     */
    private deriveKeysFromSecret(secret: string): { pubkey: string; npub: string } {
        let secretBytes: Uint8Array;

        if (secret.startsWith('nsec1')) {
            const decoded = nip19Decode(secret);
            if (decoded.type !== 'nsec') {
                throw new Error('Invalid nsec');
            }
            secretBytes = decoded.data as Uint8Array;
        } else {
            // Assume hex
            secretBytes = hexToBytes(secret);
        }

        const pubkey = getPublicKey(secretBytes);
        const npub = npubEncode(pubkey);
        return { pubkey, npub };
    }

    async setPassphrase(keyName: string, passphrase: string): Promise<void> {
        const record = this.config.allKeys[keyName];
        if (!record) {
            throw new Error('Key not found');
        }

        // Check if key is already encrypted
        if (record.iv && record.data) {
            throw new Error('Key is already encrypted. Use change passphrase instead.');
        }

        // Get the plain key
        const nsec = record.key;
        if (!nsec) {
            throw new Error('No key material found');
        }

        if (!passphrase || !passphrase.trim()) {
            throw new Error('Passphrase is required');
        }

        // Encrypt the key
        const encrypted = encryptSecret(nsec, passphrase);

        // Save to config file
        const config = await loadConfig(this.config.configFile);
        config.keys[keyName] = encrypted;
        await saveConfig(this.config.configFile, config);

        // Update in-memory structures
        this.config.allKeys[keyName] = encrypted;
        // Key stays active in memory until daemon restart
    }

    async renameKey(oldName: string, newName: string): Promise<void> {
        // Check if old key exists
        const record = this.config.allKeys[oldName];
        if (!record) {
            throw new Error('Key not found');
        }

        // Check if new name is available
        if (this.config.allKeys[newName]) {
            throw new Error('A key with this name already exists');
        }

        // Validate new name
        if (!newName.trim()) {
            throw new Error('Key name cannot be empty');
        }

        // Update config file
        const config = await loadConfig(this.config.configFile);
        config.keys[newName] = config.keys[oldName];
        delete config.keys[oldName];
        await saveConfig(this.config.configFile, config);

        // Update in-memory structures
        this.config.allKeys[newName] = this.config.allKeys[oldName];
        delete this.config.allKeys[oldName];

        if (this.activeKeys[oldName]) {
            this.activeKeys[newName] = this.activeKeys[oldName];
            delete this.activeKeys[oldName];
        }

        // Update database references
        await keyRepository.renameKey(oldName, newName);
    }

    async deleteKey(keyName: string, passphrase?: string): Promise<{ revokedApps: number }> {
        const record = this.config.allKeys[keyName];
        if (!record) {
            throw new Error('Key not found');
        }

        // For encrypted keys, require passphrase verification
        const isEncrypted = !!(record.iv && record.data);
        if (isEncrypted) {
            if (!passphrase) {
                throw new Error('Passphrase required to delete encrypted key');
            }
            // Verify passphrase is correct
            try {
                decryptSecret({ iv: record.iv!, data: record.data! }, passphrase);
            } catch {
                throw new Error('Invalid passphrase');
            }
        }

        // Revoke all connected apps for this key
        const revokedApps = await appRepository.revokeByKeyName(keyName);

        // Remove from config file
        const config = await loadConfig(this.config.configFile);
        delete config.keys[keyName];
        await saveConfig(this.config.configFile, config);

        // Remove from memory
        delete this.activeKeys[keyName];
        delete this.config.allKeys[keyName];

        // Emit event for real-time updates
        getEventService().emitKeyDeleted(keyName);

        return { revokedApps };
    }
}
