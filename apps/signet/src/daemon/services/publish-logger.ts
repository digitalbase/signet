import type { Event } from 'nostr-tools/pure';
import type { RelayPool } from '../lib/relay-pool.js';

/**
 * Logs NIP-46 response publishing for debugging.
 * Hooks into RelayPool's publish callbacks to track success/failure.
 */
export class PublishLogger {
    private readonly pool: RelayPool;
    private enabled = false;

    // Track publish stats
    private stats = {
        totalPublished: 0,
        totalFailed: 0,
        byRelay: new Map<string, { published: number; failed: number }>(),
    };

    constructor(pool: RelayPool) {
        this.pool = pool;
    }

    /**
     * Start logging publish events
     */
    public start(): void {
        if (this.enabled) {
            return;
        }

        this.enabled = true;

        // Initialize stats for all relays
        for (const url of this.pool.getRelays()) {
            this.stats.byRelay.set(url, { published: 0, failed: 0 });
        }

        // Set up publish callbacks
        this.pool.setPublishCallbacks(
            (event: Event, relay: string) => this.onPublishSuccess(event, relay),
            (event: Event, relay: string, error: Error) => this.onPublishFailure(event, relay, error)
        );

        console.log('Publish logging enabled');
    }

    /**
     * Stop logging publish events
     */
    public stop(): void {
        if (!this.enabled) {
            return;
        }

        this.enabled = false;
        this.pool.setPublishCallbacks(undefined, undefined);
        console.log('Publish logging disabled');
    }

    /**
     * Get publish statistics
     */
    public getStats(): typeof this.stats {
        return {
            ...this.stats,
            byRelay: new Map(this.stats.byRelay),
        };
    }

    /**
     * Reset statistics
     */
    public resetStats(): void {
        this.stats = {
            totalPublished: 0,
            totalFailed: 0,
            byRelay: new Map(),
        };

        // Re-initialize for all relays
        for (const url of this.pool.getRelays()) {
            this.stats.byRelay.set(url, { published: 0, failed: 0 });
        }
    }

    private onPublishSuccess(event: Event, relay: string): void {
        if (!this.enabled) return;

        this.stats.totalPublished++;
        const relayStat = this.stats.byRelay.get(relay);
        if (relayStat) {
            relayStat.published++;
        } else {
            this.stats.byRelay.set(relay, { published: 1, failed: 0 });
        }

        console.log(`Published kind ${event.kind} to ${relay} (id: ${event.id?.slice(0, 8)}...)`);
    }

    private onPublishFailure(event: Event, relay: string, error: Error): void {
        if (!this.enabled) return;

        this.stats.totalFailed++;
        const relayStat = this.stats.byRelay.get(relay);
        if (relayStat) {
            relayStat.failed++;
        } else {
            this.stats.byRelay.set(relay, { published: 0, failed: 1 });
        }

        console.log(`FAILED kind ${event.kind} to ${relay}: ${error.message} (id: ${event.id?.slice(0, 8)}...)`);
    }

    /**
     * Print a summary of publish stats
     */
    public printSummary(): void {
        console.log('\nPublish Statistics:');
        console.log(`   Total published: ${this.stats.totalPublished}`);
        console.log(`   Total failed: ${this.stats.totalFailed}`);
        console.log('   By relay:');
        for (const [url, stat] of this.stats.byRelay) {
            console.log(`     ${url}: ${stat.published} published, ${stat.failed} failed`);
        }
        console.log('');
    }
}
