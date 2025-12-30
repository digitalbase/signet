import type { PendingRequest } from '@signet/types';
import type { StoredKey } from '../../config/types.js';
import {
    requestRepository,
    type RequestStatus,
    type RequestRecord,
} from '../repositories/index.js';

export interface RequestServiceConfig {
    allKeys: Record<string, StoredKey>;
}

export interface RequestQueryParams {
    status?: string;
    limit?: number;
    offset?: number;
}

export class RequestService {
    private readonly config: RequestServiceConfig;
    private readonly REQUEST_TTL_MS = 60_000;

    constructor(config: RequestServiceConfig) {
        this.config = config;
    }

    async findPending(id: string): Promise<RequestRecord | null> {
        return requestRepository.findPending(id);
    }

    async listRequests(params: RequestQueryParams): Promise<PendingRequest[]> {
        const status = (params.status || 'pending') as RequestStatus;
        const limit = Math.min(50, Math.max(1, params.limit ?? 10));
        const offset = Math.max(0, params.offset ?? 0);

        const records = await requestRepository.findMany({ status, limit, offset });
        const nowMillis = Date.now();

        return records.map(record => this.toApiResponse(record, nowMillis));
    }

    async countPending(): Promise<number> {
        return requestRepository.countPending();
    }

    async approve(id: string): Promise<void> {
        await requestRepository.approve(id);
    }

    async deny(id: string): Promise<void> {
        await requestRepository.deny(id);
    }

    private toApiResponse(record: RequestRecord, nowMillis: number): PendingRequest {
        const entry = record.keyName ? this.config.allKeys[record.keyName] : undefined;
        const requiresPassword = record.keyName ? !entry?.key : false;
        const expiresAt = record.createdAt.getTime() + this.REQUEST_TTL_MS;

        let eventPreview: PendingRequest['eventPreview'] = null;
        if (record.method === 'sign_event' && record.params) {
            try {
                const params = JSON.parse(record.params);
                if (Array.isArray(params) && params[0]) {
                    const event = params[0];
                    eventPreview = {
                        kind: event.kind,
                        content: event.content,
                        tags: event.tags || [],
                    };
                }
            } catch {
                // Ignore parse errors
            }
        }

        return {
            id: record.id,
            keyName: record.keyName ?? null,
            method: record.method,
            remotePubkey: record.remotePubkey,
            params: record.params ?? null,
            eventPreview,
            createdAt: record.createdAt.toISOString(),
            expiresAt: new Date(expiresAt).toISOString(),
            ttlSeconds: Math.max(0, Math.round((expiresAt - nowMillis) / 1_000)),
            requiresPassword,
            processedAt: record.processedAt?.toISOString() ?? null,
            autoApproved: record.autoApproved,
            appName: record.KeyUser?.description ?? null,
        };
    }
}
