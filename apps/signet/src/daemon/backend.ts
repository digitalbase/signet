import NDK, {
    NDKEvent,
    NDKNip46Backend,
    NDKPrivateKeySigner,
    NDKRelay,
    NDKRelaySet,
    NDKSubscription,
    Nip46PermitCallback,
} from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';
import type { FastifyInstance } from 'fastify';
import prisma from '../db.js';
import { getEventService } from './services/event-service.js';
import { appService } from './services/app-service.js';

// Subscription management constants
const SUBSCRIPTION_RESTART_DEBOUNCE_MS = 2000; // Debounce relay:ready events
const SUBSCRIPTION_RESTART_DELAY_MS = 500; // Brief delay before restarting subscription

// Default trust level for auto-approved connections via secret
const DEFAULT_TRUST_LEVEL = 'reasonable';

export interface BunkerBackendConfig {
    keyName: string;
    adminSecret?: string;
}

export class BunkerBackend extends NDKNip46Backend {
    public readonly baseUrl?: string;
    public readonly fastify: FastifyInstance;
    private readonly keyName: string;
    private readonly adminSecret?: string;

    // Subscription lifecycle management
    private subscription: NDKSubscription | null = null;
    private isStarted = false;
    private isRestarting = false;
    private restartDebounceTimer: NodeJS.Timeout | null = null;
    private relayReadyHandler: ((relay: NDKRelay) => void) | null = null;

    constructor(
        ndk: NDK,
        fastify: FastifyInstance,
        secret: string,
        permitCallback: Nip46PermitCallback,
        config: BunkerBackendConfig,
        baseUrl?: string
    ) {
        const signer = new NDKPrivateKeySigner(secret);
        super(ndk, signer, permitCallback);
        this.fastify = fastify;
        this.keyName = config.keyName;
        this.adminSecret = config.adminSecret;
        this.baseUrl = baseUrl;
    }

    /**
     * Override start() to manage subscription lifecycle ourselves.
     * This ensures we can track and restart the subscription when relays reconnect.
     */
    public async start(): Promise<void> {
        if (this.isStarted) {
            console.log(`⚠️ [${this.keyName}] Backend already started, ignoring duplicate start()`);
            return;
        }

        this.localUser = await this.signer.user();
        const pubkey = this.localUser.pubkey;
        const npub = nip19.npubEncode(pubkey);

        console.log(`🔑 [${this.keyName}] Starting NIP-46 backend for ${npub}`);

        // Create the subscription
        await this.createSubscription();

        // Set up relay:ready handler to detect reconnections
        this.setupRelayEventHandlers();

        this.isStarted = true;
        console.log(`✅ [${this.keyName}] NIP-46 subscription active`);
    }

    /**
     * Stop the backend and clean up resources.
     */
    public stop(): void {
        if (!this.isStarted) {
            return;
        }

        console.log(`🛑 [${this.keyName}] Stopping NIP-46 backend`);

        // Remove relay event handler
        if (this.relayReadyHandler) {
            this.ndk.pool.off('relay:ready', this.relayReadyHandler);
            this.relayReadyHandler = null;
        }

        // Clear any pending restart
        if (this.restartDebounceTimer) {
            clearTimeout(this.restartDebounceTimer);
            this.restartDebounceTimer = null;
        }

        // Close the subscription
        if (this.subscription) {
            this.subscription.stop();
            this.subscription = null;
        }

        this.isStarted = false;
    }

    /**
     * Create the NIP-46 subscription for incoming requests.
     */
    private async createSubscription(): Promise<void> {
        if (!this.localUser) {
            throw new Error('Cannot create subscription: localUser not set');
        }

        // Close existing subscription if any
        if (this.subscription) {
            this.debug('closing existing subscription before creating new one');
            this.subscription.stop();
            this.subscription = null;
        }

        const pubkey = this.localUser.pubkey;

        this.subscription = this.ndk.subscribe(
            {
                kinds: [24133 as number],
                '#p': [pubkey],
            },
            {
                closeOnEose: false,
            }
        );

        // Handle incoming events
        this.subscription.on('event', (event: NDKEvent) => {
            this.handleIncomingEvent(event).catch((err) => {
                console.error(`❌ [${this.keyName}] Error handling incoming event:`, err);
            });
        });

        this.debug('subscription created for pubkey %s', pubkey);
    }

    /**
     * Set up handlers for relay events to detect when relays reconnect.
     */
    private setupRelayEventHandlers(): void {
        // Create the handler function so we can remove it later
        this.relayReadyHandler = (relay: NDKRelay) => {
            this.handleRelayReady(relay);
        };

        this.ndk.pool.on('relay:ready', this.relayReadyHandler);
        this.debug('relay event handlers set up');
    }

    /**
     * Handle relay:ready events.
     * When a relay becomes ready, we should ensure our subscription is active on it.
     * We debounce this to avoid multiple restarts when several relays reconnect at once.
     */
    private handleRelayReady(relay: NDKRelay): void {
        // Only care about reconnections after initial start
        if (!this.isStarted || this.isRestarting) {
            return;
        }

        console.log(`📡 [${this.keyName}] Relay ready: ${relay.url} - scheduling subscription refresh`);

        // Debounce: wait for all relays to reconnect before restarting
        if (this.restartDebounceTimer) {
            clearTimeout(this.restartDebounceTimer);
        }

        this.restartDebounceTimer = setTimeout(() => {
            this.restartDebounceTimer = null;
            this.restartSubscription().catch((err) => {
                console.error(`❌ [${this.keyName}] Failed to restart subscription:`, err);
            });
        }, SUBSCRIPTION_RESTART_DEBOUNCE_MS);
    }

    /**
     * Restart the subscription to ensure it's active on all connected relays.
     * This is called after relays reconnect.
     */
    private async restartSubscription(): Promise<void> {
        if (!this.isStarted || this.isRestarting) {
            return;
        }

        this.isRestarting = true;
        console.log(`🔄 [${this.keyName}] Restarting NIP-46 subscription after relay reconnection`);

        try {
            // Brief delay to let relay connections stabilize
            await new Promise((resolve) => setTimeout(resolve, SUBSCRIPTION_RESTART_DELAY_MS));

            // Re-create the subscription
            await this.createSubscription();

            console.log(`✅ [${this.keyName}] NIP-46 subscription restarted successfully`);
        } catch (err) {
            console.error(`❌ [${this.keyName}] Failed to restart subscription:`, err);
        } finally {
            this.isRestarting = false;
        }
    }

    /**
     * Ensure relays are connected and return a relay set for publishing.
     * This ensures we use the pool's actual relay instances and that they're connected.
     */
    private async getConnectedRelaySet(): Promise<NDKRelaySet> {
        const pool = this.ndk.pool;

        // Ensure pool is connected (this will reconnect any disconnected relays)
        await pool.connect();

        // Get the actual relay instances from the pool
        const relays = new Set(pool.relays.values());
        return new NDKRelaySet(relays, this.ndk);
    }

    /**
     * Override handleIncomingEvent to use our custom response publishing.
     * The parent class's RPC creates a separate pool that disconnects due to no subscriptions.
     * By overriding this, we use the main pool's connections and limit to configured relays.
     */
    protected async handleIncomingEvent(event: NDKEvent): Promise<void> {
        const { id, method, params } = (await this.rpc.parseEvent(event)) as {
            id: string;
            method: string;
            params: string[];
        };
        const remotePubkey = event.pubkey;
        let response: string | undefined;

        this.debug('incoming event', { id, method, params });

        // Validate signature explicitly
        if (!event.verifySignature(false)) {
            this.debug('invalid signature', event.rawEvent());
            return;
        }

        // Handle connect method with secret validation for auto-approval
        if (method === 'connect') {
            const result = await this.handleConnect(id, remotePubkey, params);
            if (result.handled) {
                if (result.response) {
                    await this.sendResponse(id, remotePubkey, result.response);
                } else if (result.error) {
                    await this.sendResponse(id, remotePubkey, 'error', result.error);
                }
                return;
            }
            // Fall through to normal handler if not handled by secret validation
        }

        const strategy = this.handlers[method];
        if (strategy) {
            try {
                response = await strategy.handle(this, id, remotePubkey, params);
            } catch (e: unknown) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                this.debug('error handling event', e, { id, method, params });
                await this.sendResponse(id, remotePubkey, 'error', errorMessage);
                return;
            }
        } else {
            this.debug('unsupported method', { method, params });
        }

        if (response) {
            this.debug(`sending response to ${remotePubkey}`, response);
            await this.sendResponse(id, remotePubkey, response);
        } else {
            await this.sendResponse(id, remotePubkey, 'error', 'Not authorized');
        }
    }

    /**
     * Handle connect method with secret validation.
     * If a valid admin secret is provided, auto-approve and create KeyUser.
     * Returns { handled: true } if we handled it, { handled: false } to fall through.
     */
    private async handleConnect(
        id: string,
        remotePubkey: string,
        params: string[]
    ): Promise<{ handled: boolean; response?: string; error?: string }> {
        // NIP-46 connect params: [targetPubkey, secret?]
        const providedSecret = params[1]?.trim().toLowerCase();
        const expectedSecret = this.adminSecret?.trim().toLowerCase();

        // If no admin secret configured, fall through to normal flow
        if (!expectedSecret) {
            this.debug('no admin secret configured, using normal connect flow');
            return { handled: false };
        }

        // If no secret provided in request, fall through to normal flow (manual approval)
        if (!providedSecret) {
            const humanPubkey = nip19.npubEncode(remotePubkey);
            console.log(`🔐 Connect from ${humanPubkey} without secret, requiring manual approval`);
            return { handled: false };
        }

        // Validate the secret - silently drop invalid attempts (no response)
        if (providedSecret !== expectedSecret) {
            this.debug('connect with invalid secret from', nip19.npubEncode(remotePubkey));
            return { handled: true }; // Silent rejection - no response sent
        }

        // Secret matches - auto-approve and create KeyUser
        const humanPubkey = nip19.npubEncode(remotePubkey);
        console.log(`✅ Connect from ${humanPubkey} with valid secret - auto-approving`);

        try {
            await this.createKeyUserForConnect(remotePubkey);
            return { handled: true, response: 'ack' };
        } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.log(`❌ Failed to create KeyUser: ${errorMessage}`);
            return { handled: true, error: errorMessage };
        }
    }

    /**
     * Create or update KeyUser for an auto-approved connection.
     */
    private async createKeyUserForConnect(remotePubkey: string): Promise<void> {
        const keyUser = await prisma.keyUser.upsert({
            where: {
                unique_key_user: {
                    keyName: this.keyName,
                    userPubkey: remotePubkey,
                },
            },
            update: {
                // Update last used time, don't change trust level if already exists
                lastUsedAt: new Date(),
            },
            create: {
                keyName: this.keyName,
                userPubkey: remotePubkey,
                trustLevel: DEFAULT_TRUST_LEVEL,
                description: 'Auto-approved via bunker secret',
            },
        });

        // Create connect signing condition if not exists
        const existingCondition = await prisma.signingCondition.findFirst({
            where: {
                keyUserId: keyUser.id,
                method: 'connect',
            },
        });

        if (!existingCondition) {
            await prisma.signingCondition.create({
                data: {
                    keyUserId: keyUser.id,
                    method: 'connect',
                    allowed: true,
                },
            });
        }

        console.log(`📝 KeyUser created/updated for ${nip19.npubEncode(remotePubkey)} with trust level: ${keyUser.trustLevel}`);

        // Emit app:connected event for real-time updates
        const app = await appService.getAppById(keyUser.id);
        if (app) {
            getEventService().emitAppConnected(app);
        }
    }

    /**
     * Send a NIP-46 response using the pool's actual connected relays.
     */
    private async sendResponse(id: string, remotePubkey: string, result: string, error?: string): Promise<void> {
        const res = error ? { id, result, error } : { id, result };
        const localUser = await this.signer.user();
        const remoteUser = this.ndk.getUser({ pubkey: remotePubkey });

        const event = new NDKEvent(this.ndk, {
            kind: 24133,
            content: JSON.stringify(res),
            tags: [['p', remotePubkey]],
            pubkey: localUser.pubkey,
        });

        // NIP-46 spec requires NIP-44 encryption
        event.content = await this.signer.encrypt(remoteUser, event.content, 'nip44');
        await event.sign(this.signer);

        // Ensure relays are connected and get the relay set
        const relaySet = await this.getConnectedRelaySet();
        await event.publish(relaySet);
    }

    private async fetchValidToken(token: string) {
        const record = await prisma.token.findUnique({
            where: { token },
            include: { policy: { include: { rules: true } } },
        });

        if (!record) {
            throw new Error('Token not found');
        }

        if (record.redeemedAt) {
            throw new Error('Token already redeemed');
        }

        if (!record.policy) {
            throw new Error('Token policy missing');
        }

        if (record.expiresAt && record.expiresAt < new Date()) {
            throw new Error('Token expired');
        }

        return record;
    }

    public async applyToken(remotePubkey: string, token: string): Promise<void> {
        const record = await this.fetchValidToken(token);

        const keyUser = await prisma.keyUser.upsert({
            where: { unique_key_user: { keyName: record.keyName, userPubkey: remotePubkey } },
            update: {},
            create: {
                keyName: record.keyName,
                userPubkey: remotePubkey,
                description: record.clientName,
            },
        });

        await prisma.signingCondition.create({
            data: {
                keyUserId: keyUser.id,
                method: 'connect',
                allowed: true,
            },
        });

        for (const rule of record.policy!.rules) {
            await prisma.signingCondition.create({
                data: {
                    keyUserId: keyUser.id,
                    method: rule.method,
                    allowed: true,
                    kind: rule.kind !== null && rule.kind !== undefined ? rule.kind.toString() : undefined,
                },
            });
        }

        await prisma.token.update({
            where: { id: record.id },
            data: {
                redeemedAt: new Date(),
                keyUserId: keyUser.id,
            },
        });
    }
}
