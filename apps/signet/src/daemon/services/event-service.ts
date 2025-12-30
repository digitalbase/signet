import createDebug from 'debug';
import type { PendingRequest, ConnectedApp, DashboardStats, KeyInfo, RelayStatusResponse, ActivityEntry } from '@signet/types';

const debug = createDebug('signet:events');

/**
 * Server-sent event types for real-time updates
 */
export type ServerEvent =
    | { type: 'request:created'; request: PendingRequest }
    | { type: 'request:approved'; requestId: string }
    | { type: 'request:denied'; requestId: string }
    | { type: 'request:expired'; requestId: string }
    | { type: 'request:auto_approved'; activity: ActivityEntry }
    | { type: 'app:connected'; app: ConnectedApp }
    | { type: 'key:created'; key: KeyInfo }
    | { type: 'key:unlocked'; keyName: string }
    | { type: 'key:deleted'; keyName: string }
    | { type: 'stats:updated'; stats: DashboardStats }
    | { type: 'relays:updated'; relays: RelayStatusResponse }
    | { type: 'ping' };

export type EventCallback = (event: ServerEvent) => void;

/**
 * EventService provides a simple pub/sub mechanism for real-time events.
 * Subscribers receive events when requests are created, approved, denied,
 * or when apps connect.
 */
export class EventService {
    private subscribers: Set<EventCallback> = new Set();

    /**
     * Subscribe to all server events
     * @returns Unsubscribe function
     */
    subscribe(callback: EventCallback): () => void {
        this.subscribers.add(callback);
        return () => {
            this.subscribers.delete(callback);
        };
    }

    /**
     * Get the number of active subscribers
     */
    getSubscriberCount(): number {
        return this.subscribers.size;
    }

    /**
     * Emit an event to all subscribers
     */
    emit(event: ServerEvent): void {
        debug('Emitting event %s to %d subscribers', event.type, this.subscribers.size);
        for (const callback of this.subscribers) {
            try {
                callback(event);
            } catch (error) {
                console.error('Error in event subscriber:', error);
            }
        }
    }

    /**
     * Emit a request:created event
     */
    emitRequestCreated(request: PendingRequest): void {
        this.emit({ type: 'request:created', request });
    }

    /**
     * Emit a request:approved event
     */
    emitRequestApproved(requestId: string): void {
        this.emit({ type: 'request:approved', requestId });
    }

    /**
     * Emit a request:denied event
     */
    emitRequestDenied(requestId: string): void {
        this.emit({ type: 'request:denied', requestId });
    }

    /**
     * Emit a request:expired event
     */
    emitRequestExpired(requestId: string): void {
        this.emit({ type: 'request:expired', requestId });
    }

    /**
     * Emit an app:connected event
     */
    emitAppConnected(app: ConnectedApp): void {
        this.emit({ type: 'app:connected', app });
    }

    /**
     * Emit a stats:updated event
     */
    emitStatsUpdated(stats: DashboardStats): void {
        this.emit({ type: 'stats:updated', stats });
    }

    /**
     * Emit a key:created event
     */
    emitKeyCreated(key: KeyInfo): void {
        this.emit({ type: 'key:created', key });
    }

    /**
     * Emit a key:unlocked event
     */
    emitKeyUnlocked(keyName: string): void {
        this.emit({ type: 'key:unlocked', keyName });
    }

    /**
     * Emit a key:deleted event
     */
    emitKeyDeleted(keyName: string): void {
        this.emit({ type: 'key:deleted', keyName });
    }

    /**
     * Emit a relays:updated event
     */
    emitRelaysUpdated(relays: RelayStatusResponse): void {
        this.emit({ type: 'relays:updated', relays });
    }

    /**
     * Emit a request:auto_approved event
     */
    emitRequestAutoApproved(activity: ActivityEntry): void {
        this.emit({ type: 'request:auto_approved', activity });
    }
}

// Singleton instance for global access
let eventServiceInstance: EventService | null = null;

export function getEventService(): EventService {
    if (!eventServiceInstance) {
        eventServiceInstance = new EventService();
    }
    return eventServiceInstance;
}

export function setEventService(service: EventService): void {
    eventServiceInstance = service;
}
