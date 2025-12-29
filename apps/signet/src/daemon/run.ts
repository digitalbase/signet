import NDK, {
    NDKPrivateKeySigner,
    Nip46PermitCallback,
    type Nip46PermitCallbackParams,
} from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';
import { ConnectionManager } from './connection-manager.js';
import { BunkerBackend, type BunkerBackendConfig } from './backend.js';
import { requestAuthorization } from './authorize.js';
import type { DaemonBootstrapConfig } from './types.js';
import { isRequestPermitted, type RpcMethod } from './lib/acl.js';
import {
    KeyService,
    RequestService,
    AppService,
    DashboardService,
    RelayService,
    PublishLogger,
    EventService,
    setEventService,
} from './services/index.js';
import { requestRepository, logRepository } from './repositories/index.js';
import { HttpServer } from './http/server.js';

// Cleanup constants
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const REQUEST_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const LOG_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function buildAuthorizationCallback(
    keyName: string,
    connectionManager: ConnectionManager
): Nip46PermitCallback {
    return async ({ id, method, pubkey, params }: Nip46PermitCallbackParams): Promise<boolean> => {
        const humanPubkey = nip19.npubEncode(pubkey);
        console.log(`🔐 Request ${id} from ${humanPubkey} to ${method} using key ${keyName}`);

        const primaryParam = Array.isArray(params) ? params[0] : undefined;
        const existingDecision = await isRequestPermitted(
            keyName,
            pubkey,
            method as RpcMethod,
            primaryParam
        );

        if (existingDecision !== undefined) {
            console.log(
                `🔎 Access ${existingDecision ? 'granted' : 'denied'} via ACL for ${humanPubkey} - returning ${existingDecision}`
            );
            return existingDecision;
        }
        console.log(`🔍 No ACL decision for ${humanPubkey}, proceeding to authorization request`);

        try {
            await requestAuthorization(connectionManager, keyName, pubkey, id, method, primaryParam);
            return true;
        } catch (error) {
            console.log(`❌ Authorization rejected: ${(error as Error).message}`);
            return false;
        }
    };
}

export async function runDaemon(config: DaemonBootstrapConfig): Promise<void> {
    const daemon = new Daemon(config);
    await daemon.start();
}

class Daemon {
    private readonly config: DaemonBootstrapConfig;
    private readonly ndk: NDK;
    private readonly connectionManager: ConnectionManager;
    private readonly keyService: KeyService;
    private readonly requestService: RequestService;
    private readonly appService: AppService;
    private readonly dashboardService: DashboardService;
    private readonly relayService: RelayService;
    private readonly publishLogger: PublishLogger;
    private readonly eventService: EventService;
    private httpServer?: HttpServer;

    constructor(config: DaemonBootstrapConfig) {
        this.config = config;

        // Use admin key as the pool-level signer for NIP-42 relay authentication
        const poolSigner = new NDKPrivateKeySigner(config.admin.key);

        this.ndk = new NDK({
            explicitRelayUrls: config.nostr.relays,
            signer: poolSigner,
        });

        this.ndk.pool.on('notice', (relay, notice) =>
            console.log(`👀 Notice from ${relay.url}:`, notice)
        );

        this.ndk.pool.on('relay:auth', (relay, challenge) =>
            console.log(`🔑 Auth challenge from ${relay.url}:`, challenge)
        );

        this.ndk.pool.on('relay:ready', (relay) =>
            console.log(`✅ Relay ready: ${relay.url}`)
        );

        // More granular connection events
        this.ndk.pool.on('relay:connect', (relay) =>
            console.log(`🔗 Relay connected: ${relay.url}`)
        );

        this.ndk.pool.on('relay:disconnect', (relay) =>
            console.log(`🔌 Relay disconnected: ${relay.url}`)
        );

        // Initialize relay health monitoring (handles connect/disconnect logging)
        this.relayService = new RelayService(this.ndk);

        // Initialize publish logger for debugging response delivery
        this.publishLogger = new PublishLogger(this.ndk);

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

        // Initialize connection manager (generates bunker URIs)
        this.connectionManager = new ConnectionManager({
            key: config.admin.key,
            relays: config.nostr.relays,
            secret: config.admin.secret,
        }, config.configFile);
    }

    public async start(): Promise<void> {
        console.log('🔌 Connecting to relays...');
        await this.ndk.connect(5_000);

        // Debug: Check relay connection status right after connect
        // NDK status codes: 1=DISCONNECTED, 2=RECONNECTING, 3=FLAPPING, 4=CONNECTING, 5=CONNECTED, 8=AUTHENTICATED
        const relayCount = this.ndk.pool.relays.size;
        let connectedCount = 0;
        for (const [url, relay] of this.ndk.pool.relays) {
            const status = relay.status;
            const statusName = status >= 5 ? 'CONNECTED' : status === 4 ? 'CONNECTING' : status === 3 ? 'FLAPPING' : 'DISCONNECTED';
            console.log(`   ${url}: status=${status} (${statusName})`);
            if (status >= 5) connectedCount++;
        }
        console.log(`🔌 Connected to ${connectedCount}/${relayCount} relays`);

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
        console.log('✅ Signet ready to serve requests.');
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
                console.log(`🧹 Cleaned up ${deletedRequests} expired request(s) older than 24 hours`);
            }
        } catch (error) {
            console.error('Failed to cleanup old requests:', error);
        }

        // Cleanup old logs (older than 30 days)
        try {
            const logMaxAge = new Date(Date.now() - LOG_MAX_AGE_MS);
            const deletedLogs = await logRepository.cleanupExpired(logMaxAge);
            if (deletedLogs > 0) {
                console.log(`🧹 Cleaned up ${deletedLogs} log(s) older than 30 days`);
            }
        } catch (error) {
            console.error('Failed to cleanup old logs:', error);
        }
    }

    private async startConfiguredKeys(): Promise<void> {
        const activeKeys = this.keyService.getActiveKeys();
        const names = Object.keys(activeKeys);
        console.log('🔑 Starting keys:', names.join(', ') || '(none)');

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
                : nip19.nsecEncode(Buffer.from(entry.key, 'hex'));
            this.loadKeyMaterial(name, nsec);
        }
    }

    private async startKey(name: string, secret: string): Promise<void> {
        const fastify = this.httpServer?.getFastify();
        if (!fastify) {
            console.log(`❌ Cannot start key ${name}: HTTP server not initialized`);
            return;
        }

        try {
            const signer = new NDKPrivateKeySigner(secret);
            const hexSecret = signer.privateKey!;

            const backendConfig: BunkerBackendConfig = {
                keyName: name,
                adminSecret: this.config.admin.secret,
            };

            const backend = new BunkerBackend(
                this.ndk,
                fastify,
                hexSecret,
                buildAuthorizationCallback(name, this.connectionManager),
                backendConfig,
                this.config.baseUrl
            );

            await backend.start();
            console.log(`🔑 Key "${name}" online.`);
        } catch (error) {
            console.log(`❌ Failed to start key ${name}: ${(error as Error).message}`);
        }
    }

    private async startWebAuth(): Promise<void> {
        // Support both new (SIGNET_*) and legacy (AUTH_*) env var names
        const portEnv = process.env.SIGNET_PORT ?? process.env.AUTH_PORT;
        const authPort = this.config.authPort ?? (portEnv ? parseInt(portEnv, 10) : undefined);
        if (!authPort) {
            console.log('⚠️ No authPort configured, HTTP server disabled');
            return;
        }

        const baseUrl = this.config.baseUrl ?? process.env.EXTERNAL_URL ?? process.env.BASE_URL;
        console.log(`🌐 Starting HTTP server on port ${authPort}...`);
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
        console.log(`🌐 HTTP server listening on port ${authPort}`);
    }

    private loadKeyMaterial(keyName: string, nsec: string): void {
        this.keyService.loadKeyMaterial(keyName, nsec);
        this.startKey(keyName, nsec).catch((error) => {
            console.log(`❌ Failed to start key ${keyName}: ${(error as Error).message}`);
        });
    }
}
