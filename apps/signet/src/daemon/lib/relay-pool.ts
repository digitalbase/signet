import { SimplePool } from 'nostr-tools/pool';
import { type Event } from 'nostr-tools/pure';
import { type Filter } from 'nostr-tools/filter';
import createDebug from 'debug';

const debug = createDebug('signet:relay-pool');

export interface RelayStatus {
    url: string;
    connected: boolean;
    lastConnected: Date | null;
    lastDisconnected: Date | null;
    lastError: string | null;
}

export type SubscriptionFilter = Filter;

interface ActiveSubscription {
    id: string;
    close: () => void;
}

/**
 * Thin wrapper around nostr-tools SimplePool.
 * Provides connection status tracking and simplified subscription management.
 */
export class RelayPool {
    private readonly pool: SimplePool;
    private readonly relays: string[];
    private readonly subscriptions: Map<string, ActiveSubscription> = new Map();
    private readonly relayStatus: Map<string, RelayStatus> = new Map();

    // Callbacks for external monitoring
    private onPublishSuccess?: (event: Event, relay: string) => void;
    private onPublishFailure?: (event: Event, relay: string, error: Error) => void;
    private onStatusChange?: () => void;

    constructor(relays: string[]) {
        this.pool = new SimplePool();
        this.relays = relays;

        // Initialize status for all relays
        for (const url of relays) {
            this.relayStatus.set(url, {
                url,
                connected: false,
                lastConnected: null,
                lastDisconnected: null,
                lastError: null,
            });
        }

        debug('RelayPool created with %d relays', relays.length);
    }

    /**
     * Get the list of relay URLs.
     */
    public getRelays(): string[] {
        return [...this.relays];
    }

    /**
     * Subscribe to events matching a filter.
     * Returns a cleanup function to close the subscription.
     */
    public subscribe(
        filter: SubscriptionFilter,
        onEvent: (event: Event) => void,
        subscriptionId: string,
        onEose?: () => void
    ): () => void {
        // Close existing subscription with same ID if any
        const existing = this.subscriptions.get(subscriptionId);
        if (existing) {
            debug('closing existing subscription %s', subscriptionId);
            existing.close();
            this.subscriptions.delete(subscriptionId);
        }

        debug('creating subscription %s with filter %o', subscriptionId, filter);

        const sub = this.pool.subscribeMany(
            this.relays,
            filter,
            {
                onevent: (event) => {
                    debug('received event %s on subscription %s', event.id?.slice(0, 8), subscriptionId);
                    onEvent(event);
                },
                oneose: () => {
                    debug('EOSE received for subscription %s', subscriptionId);
                    // Mark all relays as connected when we receive EOSE
                    // (indicates at least one relay responded)
                    this.markAllRelaysConnected();
                    onEose?.();
                },
                onclose: (reasons) => {
                    debug('subscription %s closed: %o', subscriptionId, reasons);
                },
            }
        );

        const cleanup = () => {
            sub.close();
            this.subscriptions.delete(subscriptionId);
            debug('subscription %s closed', subscriptionId);
        };

        this.subscriptions.set(subscriptionId, { id: subscriptionId, close: cleanup });

        return cleanup;
    }

    /**
     * Publish an event to all relays.
     * Resolves when at least one relay accepts the event.
     * Throws if no relay accepts the event.
     */
    public async publish(event: Event): Promise<{ successes: string[]; failures: Array<{ url: string; error: string }> }> {
        debug('publishing event %s (kind %d)', event.id?.slice(0, 8), event.kind);

        const results = await Promise.allSettled(
            this.pool.publish(this.relays, event)
        );

        const successes: string[] = [];
        const failures: Array<{ url: string; error: string }> = [];

        results.forEach((result, index) => {
            const relayUrl = this.relays[index];
            if (result.status === 'fulfilled') {
                successes.push(relayUrl);
                this.updateRelayStatus(relayUrl, true);
                this.onPublishSuccess?.(event, relayUrl);
                debug('published to %s', relayUrl);
            } else {
                const errorMsg = result.reason?.message ?? String(result.reason);
                failures.push({ url: relayUrl, error: errorMsg });
                this.updateRelayStatus(relayUrl, false, errorMsg);
                this.onPublishFailure?.(event, relayUrl, result.reason);
                debug('failed to publish to %s: %s', relayUrl, errorMsg);
            }
        });

        if (successes.length === 0) {
            throw new Error(`Failed to publish to any relay: ${failures.map(f => `${f.url}: ${f.error}`).join(', ')}`);
        }

        debug('published to %d/%d relays', successes.length, this.relays.length);
        return { successes, failures };
    }

    /**
     * Set callbacks for publish monitoring.
     */
    public setPublishCallbacks(
        onSuccess?: (event: Event, relay: string) => void,
        onFailure?: (event: Event, relay: string, error: Error) => void
    ): void {
        this.onPublishSuccess = onSuccess;
        this.onPublishFailure = onFailure;
    }

    /**
     * Set callback for relay status changes.
     */
    public setStatusChangeCallback(callback: () => void): void {
        this.onStatusChange = callback;
    }

    /**
     * Get current status of all relays.
     * Derives connected state from tracked timestamps since SimplePool's
     * listConnectionStatus() doesn't accurately reflect subscription connections.
     */
    public getStatus(): RelayStatus[] {
        // Derive connected state from timestamps
        // A relay is considered connected if lastConnected > lastDisconnected
        // or if lastConnected exists and lastDisconnected is null
        for (const url of this.relays) {
            const existing = this.relayStatus.get(url);
            if (existing) {
                const isConnected = existing.lastConnected !== null && (
                    existing.lastDisconnected === null ||
                    existing.lastConnected > existing.lastDisconnected
                );
                if (existing.connected !== isConnected) {
                    this.relayStatus.set(url, {
                        ...existing,
                        connected: isConnected,
                    });
                }
            }
        }

        return Array.from(this.relayStatus.values());
    }

    /**
     * Get count of connected relays.
     */
    public getConnectedCount(): number {
        // Use getStatus() to get accurate connected state
        return this.getStatus().filter(s => s.connected).length;
    }

    /**
     * Check if any relay is connected.
     */
    public hasConnectedRelay(): boolean {
        return this.getConnectedCount() > 0;
    }

    /**
     * Close all subscriptions and connections.
     */
    public close(): void {
        debug('closing relay pool');

        for (const [id, sub] of this.subscriptions) {
            debug('closing subscription %s', id);
            sub.close();
        }
        this.subscriptions.clear();

        this.pool.close(this.relays);
        debug('relay pool closed');
    }

    /**
     * Ensure connections are ready by attempting to connect to relays.
     * SimplePool handles this lazily, but this can be called proactively.
     */
    public async ensureConnected(): Promise<void> {
        // SimplePool connects lazily when subscribing or publishing.
        // We can trigger this by subscribing to a filter that won't match anything.
        // Or we just trust that publish/subscribe will connect as needed.
        debug('ensureConnected called - SimplePool connects lazily');
    }

    private updateRelayStatus(url: string, connected: boolean, error?: string): void {
        const existing = this.relayStatus.get(url);
        const previouslyConnected = existing?.connected ?? false;
        this.relayStatus.set(url, {
            url,
            connected,
            lastConnected: connected ? new Date() : (existing?.lastConnected ?? null),
            lastDisconnected: !connected && error ? new Date() : (existing?.lastDisconnected ?? null),
            lastError: error ?? null,
        });
        // Notify if connection state changed
        if (connected !== previouslyConnected) {
            this.onStatusChange?.();
        }
    }

    /**
     * Mark all relays as connected (called when EOSE received).
     */
    private markAllRelaysConnected(): void {
        const now = new Date();
        let anyChanged = false;
        for (const url of this.relays) {
            const existing = this.relayStatus.get(url);
            if (existing && !existing.connected) {
                this.relayStatus.set(url, {
                    ...existing,
                    connected: true,
                    lastConnected: now,
                });
                anyChanged = true;
            }
        }
        if (anyChanged) {
            this.onStatusChange?.();
        }
    }
}
