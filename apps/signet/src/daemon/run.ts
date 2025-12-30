import { decode as nip19Decode, npubEncode } from 'nostr-tools/nip19';
import { hexToBytes } from './lib/hex.js';
import { ConnectionManager } from './connection-manager.js';
import { Nip46Backend, type PermitCallbackParams } from './nip46-backend.js';
import { RelayPool } from './lib/relay-pool.js';
import { SubscriptionManager } from './lib/subscription-manager.js';
import { requestAuthorization } from './authorize.js';
import type { DaemonBootstrapConfig } from './types.js';
import { checkRequestPermission, type RpcMethod } from './lib/acl.js';
import {
    KeyService,
    RequestService,
    AppService,
    DashboardService,
    RelayService,
    PublishLogger,
    EventService,
    setEventService,
    getEventService,
} from './services/index.js';
import { requestRepository, logRepository } from './repositories/index.js';
import { HttpServer } from './http/server.js';
import prisma from '../db.js';

// Cleanup constants
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const REQUEST_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const LOG_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Rate limiting for auto-approval logging: 1 log per method per minute per app
const AUTO_APPROVAL_LOG_INTERVAL_MS = 60 * 1000; // 1 minute
const autoApprovalLogTimestamps = new Map<string, number>();

function shouldLogAutoApproval(keyUserId: number, method: string): boolean {
    const key = `${keyUserId}:${method}`;
    const now = Date.now();
    const lastLog = autoApprovalLogTimestamps.get(key);

    if (!lastLog || now - lastLog >= AUTO_APPROVAL_LOG_INTERVAL_MS) {
        autoApprovalLogTimestamps.set(key, now);
        return true;
    }
    return false;
}

function buildAuthorizationCallback(
    keyName: string,
    connectionManager: ConnectionManager
) {
    return async ({ id, method, pubkey, params }: PermitCallbackParams): Promise<boolean> => {
        const humanPubkey = npubEncode(pubkey);
        console.log(`[${keyName}] Request ${id} from ${humanPubkey} to ${method}`);

        const primaryParam = Array.isArray(params) ? params[0] : undefined;
        const result = await checkRequestPermission(
            keyName,
            pubkey,
            method as RpcMethod,
            primaryParam
        );

        if (result.permitted !== undefined) {
            const accessType = result.autoApproved ? 'auto-approved' : 'granted';
            console.log(
                `[${keyName}] Access ${result.permitted ? accessType : 'denied'} via ACL for ${humanPubkey}`
            );

            // Log auto-approved requests (with rate limiting)
            if (result.permitted && result.autoApproved && result.keyUserId) {
                if (shouldLogAutoApproval(result.keyUserId, method)) {
                    // Log asynchronously to avoid blocking
                    logAutoApproval(result.keyUserId, method, primaryParam, keyName, id, pubkey).catch(err => {
                        console.error('Failed to log auto-approval:', err);
                    });
                }
            }

            return result.permitted;
        }
        console.log(`[${keyName}] No ACL decision for ${humanPubkey}, proceeding to authorization request`);

        try {
            await requestAuthorization(connectionManager, keyName, pubkey, id, method, primaryParam);
            return true;
        } catch (error) {
            console.log(`[${keyName}] Authorization rejected: ${(error as Error).message}`);
            return false;
        }
    };
}

async function logAutoApproval(
    keyUserId: number,
    method: string,
    params: string | undefined,
    keyName: string,
    requestId: string,
    remotePubkey: string
): Promise<void> {
    // Fetch KeyUser info for the activity entry
    const keyUser = await prisma.keyUser.findUnique({
        where: { id: keyUserId },
        select: { userPubkey: true, description: true },
    });

    const paramsStr = typeof params === 'string' ? params : JSON.stringify(params);

    // Create request record (so it appears in Activity page)
    await requestRepository.createAutoApproved({
        requestId,
        keyName,
        method,
        remotePubkey,
        params: paramsStr,
        keyUserId,
    });

    // Create log entry
    const log = await logRepository.create({
        type: 'approval',
        method,
        params: paramsStr,
        keyUserId,
        autoApproved: true,
    });

    // Emit SSE event
    const eventService = getEventService();
    eventService.emitRequestAutoApproved({
        id: log.id,
        timestamp: log.timestamp.toISOString(),
        type: log.type,
        method: log.method ?? undefined,
        keyName,
        userPubkey: keyUser?.userPubkey,
        appName: keyUser?.description ?? undefined,
        autoApproved: true,
    });
}

export async function runDaemon(config: DaemonBootstrapConfig): Promise<void> {
    const daemon = new Daemon(config);
    await daemon.start();
}

class Daemon {
    private readonly config: DaemonBootstrapConfig;
    private readonly pool: RelayPool;
    private readonly subscriptionManager: SubscriptionManager;
    private readonly connectionManager: ConnectionManager;
    private readonly keyService: KeyService;
    private readonly requestService: RequestService;
    private readonly appService: AppService;
    private readonly dashboardService: DashboardService;
    private readonly relayService: RelayService;
    private readonly publishLogger: PublishLogger;
    private readonly eventService: EventService;
    private readonly backends: Map<string, Nip46Backend> = new Map();
    private httpServer?: HttpServer;

    constructor(config: DaemonBootstrapConfig) {
        this.config = config;

        // Create shared relay pool
        this.pool = new RelayPool(config.nostr.relays);

        // Create subscription manager for automatic reconnection after sleep/wake
        this.subscriptionManager = new SubscriptionManager({ pool: this.pool });

        // Initialize relay health monitoring
        this.relayService = new RelayService(this.pool);

        // Wire up relay status change callback to emit SSE events
        this.pool.setStatusChangeCallback(() => {
            this.emitRelayStatus();
        });

        // Initialize publish logger for debugging response delivery
        this.publishLogger = new PublishLogger(this.pool);

        // Initialize services
        this.keyService = new KeyService({
            configFile: config.configFile,
            allKeys: config.allKeys,
            nostrRelays: config.nostr.relays,
            adminSecret: config.admin.secret,
        }, config.keys);

        this.requestService = new RequestService({
            allKeys: config.allKeys,
        });

        this.appService = new AppService();

        this.dashboardService = new DashboardService({
            allKeys: config.allKeys,
            getActiveKeyCount: () => Object.keys(this.keyService.getActiveKeys()).length,
        });

        // Initialize event service for real-time updates
        this.eventService = new EventService();
        setEventService(this.eventService);

        // Initialize connection manager (generates bunker URIs and sends auth_url responses)
        this.connectionManager = new ConnectionManager({
            key: config.admin.key,
            relays: config.nostr.relays,
            secret: config.admin.secret,
        }, config.configFile, this.pool);
    }

    public async start(): Promise<void> {
        console.log('Connecting to relays...');

        // RelayPool connects lazily, but let's log what we're configured with
        const relayCount = this.pool.getRelays().length;
        console.log(`Configured with ${relayCount} relays: ${this.pool.getRelays().join(', ')}`);

        this.subscriptionManager.start();
        this.relayService.start();
        this.publishLogger.start();
        await this.startWebAuth();

        // Wire up callback to start bunker backend when keys are unlocked/created via HTTP
        this.keyService.setOnKeyActivated(async (keyName: string, secret: string) => {
            await this.startKey(keyName, secret);
        });

        await this.startConfiguredKeys();
        await this.loadPlainKeys();
        this.startCleanupTasks();
        console.log('Signet ready to serve requests.');
    }

    private startCleanupTasks(): void {
        // Run cleanup immediately on startup
        this.runCleanup();

        // Schedule periodic cleanup
        setInterval(() => {
            this.runCleanup();
        }, CLEANUP_INTERVAL_MS);
    }

    private async runCleanup(): Promise<void> {
        // Cleanup expired requests (older than 24 hours)
        try {
            const requestMaxAge = new Date(Date.now() - REQUEST_MAX_AGE_MS);
            const deletedRequests = await requestRepository.cleanupExpired(requestMaxAge);
            if (deletedRequests > 0) {
                console.log(`Cleaned up ${deletedRequests} expired request(s) older than 24 hours`);
            }
        } catch (error) {
            console.error('Failed to cleanup old requests:', error);
        }

        // Cleanup old logs (older than 30 days)
        try {
            const logMaxAge = new Date(Date.now() - LOG_MAX_AGE_MS);
            const deletedLogs = await logRepository.cleanupExpired(logMaxAge);
            if (deletedLogs > 0) {
                console.log(`Cleaned up ${deletedLogs} log(s) older than 30 days`);
            }
        } catch (error) {
            console.error('Failed to cleanup old logs:', error);
        }
    }

    private async startConfiguredKeys(): Promise<void> {
        const activeKeys = this.keyService.getActiveKeys();
        const names = Object.keys(activeKeys);
        console.log('Starting keys:', names.join(', ') || '(none)');

        for (const [name, secret] of Object.entries(activeKeys)) {
            await this.startKey(name, secret);
        }
    }

    private async loadPlainKeys(): Promise<void> {
        for (const [name, entry] of Object.entries(this.config.allKeys)) {
            if (!entry?.key) {
                continue;
            }

            const nsec = entry.key.startsWith('nsec1')
                ? entry.key
                : (() => {
                    const { nsecEncode } = require('nostr-tools/nip19');
                    return nsecEncode(hexToBytes(entry.key));
                })();
            this.loadKeyMaterial(name, nsec);
        }
    }

    private async startKey(name: string, secret: string): Promise<void> {
        // Parse secret to bytes
        let secretBytes: Uint8Array;
        if (secret.startsWith('nsec1')) {
            const decoded = nip19Decode(secret);
            if (decoded.type !== 'nsec') {
                console.log(`Cannot start key ${name}: Invalid nsec`);
                return;
            }
            secretBytes = decoded.data as Uint8Array;
        } else {
            secretBytes = hexToBytes(secret);
        }

        try {
            const backend = new Nip46Backend({
                keyName: name,
                nsec: secretBytes,
                pool: this.pool,
                subscriptionManager: this.subscriptionManager,
                permitCallback: buildAuthorizationCallback(name, this.connectionManager),
                adminSecret: this.config.admin.secret,
            });

            backend.start();
            this.backends.set(name, backend);
            console.log(`Key "${name}" online.`);
        } catch (error) {
            console.log(`Failed to start key ${name}: ${(error as Error).message}`);
        }
    }

    private async startWebAuth(): Promise<void> {
        // Support both new (SIGNET_*) and legacy (AUTH_*) env var names
        const portEnv = process.env.SIGNET_PORT ?? process.env.AUTH_PORT;
        const authPort = this.config.authPort ?? (portEnv ? parseInt(portEnv, 10) : undefined);
        if (!authPort) {
            console.log('No authPort configured, HTTP server disabled');
            return;
        }

        const baseUrl = this.config.baseUrl ?? process.env.EXTERNAL_URL ?? process.env.BASE_URL;
        console.log(`Starting HTTP server on port ${authPort}...`);
        this.httpServer = new HttpServer({
            port: authPort,
            host: this.config.authHost ?? process.env.SIGNET_HOST ?? process.env.AUTH_HOST ?? '0.0.0.0',
            baseUrl,
            jwtSecret: this.config.jwtSecret,
            allowedOrigins: this.config.allowedOrigins ?? [],
            requireAuth: this.config.requireAuth ?? false,
            connectionManager: this.connectionManager,
            nostrConfig: this.config.nostr,
            keyService: this.keyService,
            requestService: this.requestService,
            appService: this.appService,
            dashboardService: this.dashboardService,
            eventService: this.eventService,
            relayService: this.relayService,
        });

        await this.httpServer.start();
        console.log(`HTTP server listening on port ${authPort}`);
    }

    private loadKeyMaterial(keyName: string, nsec: string): void {
        this.keyService.loadKeyMaterial(keyName, nsec);
        this.startKey(keyName, nsec).catch((error) => {
            console.log(`Failed to start key ${keyName}: ${(error as Error).message}`);
        });
    }

    private emitRelayStatus(): void {
        const statuses = this.relayService.getStatus();
        const connected = this.relayService.getConnectedCount();
        this.eventService.emitRelaysUpdated({
            connected,
            total: statuses.length,
            relays: statuses.map(s => ({
                url: s.url,
                connected: s.connected,
                lastConnected: s.lastConnected?.toISOString() ?? null,
                lastDisconnected: s.lastDisconnected?.toISOString() ?? null,
            })),
        });
    }
}
