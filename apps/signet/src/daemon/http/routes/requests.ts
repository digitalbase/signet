import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RequestService, AppService } from '../../services/index.js';
import type { TrustLevel } from '@signet/types';
import prisma from '../../../db.js';
import { grantPermissionsByTrustLevel, permitAllRequests, type AllowScope } from '../../lib/acl.js';
import { getEventService } from '../../services/event-service.js';
import {
    authorizeRequestWebHandler,
    processRequestWebHandler,
} from '../../web/authorize.js';

interface BatchApprovalBody {
    ids: string[];
    trustLevel?: TrustLevel;
    alwaysAllow?: boolean;
    allowKind?: number;
}

interface BatchResult {
    id: string;
    success: boolean;
    error?: string;
}

export interface RequestsRouteConfig {
    requestService: RequestService;
    appService: AppService;
}

export function registerRequestRoutes(
    fastify: FastifyInstance,
    config: RequestsRouteConfig,
    preHandler: { auth: any[]; csrf: any[]; rateLimit: any[] }
): void {
    // List requests (GET - no CSRF needed)
    fastify.get('/requests', { preHandler: preHandler.auth }, async (request: FastifyRequest, reply: FastifyReply) => {
        const query = (request.query ?? {}) as Record<string, string | undefined>;

        const limitParam = query.limit;
        const requestedLimit = limitParam ? Number.parseInt(limitParam, 10) : NaN;
        const limit = Number.isFinite(requestedLimit)
            ? Math.min(50, Math.max(1, requestedLimit))
            : 10;

        const offsetParam = query.offset;
        const requestedOffset = offsetParam ? Number.parseInt(offsetParam, 10) : NaN;
        const offset = Number.isFinite(requestedOffset) && requestedOffset >= 0
            ? requestedOffset
            : 0;

        const status = query.status || 'pending';

        const requests = await config.requestService.listRequests({ status, limit, offset });
        return reply.send({ requests });
    });

    // Web authorization page (HTML)
    fastify.get('/requests/:id', authorizeRequestWebHandler);

    // Process request approval (API)
    fastify.post('/requests/:id', { preHandler: preHandler.rateLimit }, async (request: FastifyRequest, reply: FastifyReply) => {
        return processRequestWebHandler(request, reply);
    });

    // Batch approval endpoint (POST - needs CSRF)
    fastify.post('/requests/batch', { preHandler: [...preHandler.rateLimit, ...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as BatchApprovalBody;

        if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
            return reply.status(400).send({ error: 'ids array is required' });
        }

        // Limit batch size to prevent abuse
        if (body.ids.length > 50) {
            return reply.status(400).send({ error: 'Maximum 50 requests per batch' });
        }

        const trustLevel: TrustLevel = body.trustLevel || 'reasonable';
        const alwaysAllow = body.alwaysAllow === true;
        const allowKind = typeof body.allowKind === 'number' ? body.allowKind : undefined;
        const eventService = getEventService();
        const results: BatchResult[] = [];

        for (const id of body.ids) {
            try {
                // Find the pending request
                const record = await prisma.request.findUnique({ where: { id } });

                if (!record) {
                    results.push({ id, success: false, error: 'Request not found' });
                    continue;
                }

                if (record.allowed !== null) {
                    results.push({ id, success: false, error: 'Request already processed' });
                    continue;
                }

                // Approve the request
                await prisma.request.update({
                    where: { id: record.id },
                    data: {
                        allowed: true,
                        processedAt: new Date(),
                    },
                });

                // Emit approval event
                eventService.emitRequestApproved(record.id);

                // Grant permissions based on request type (only if keyName is present)
                if (record.keyName) {
                    if (record.method === 'connect') {
                        const appId = await grantPermissionsByTrustLevel(
                            record.remotePubkey,
                            record.keyName,
                            trustLevel,
                            undefined
                        );

                        // Emit app:connected event
                        const app = await config.appService.getAppById(appId);
                        if (app) {
                            eventService.emitAppConnected(app);
                        }
                    } else if (alwaysAllow) {
                        // For non-connect requests with "always allow", grant the specific method
                        // If allowKind is specified, only grant for that kind; otherwise grant for all kinds
                        const scope: AllowScope = allowKind !== undefined ? { kind: allowKind } : { kind: 'all' };
                        await permitAllRequests(record.remotePubkey, record.keyName, record.method, undefined, scope);
                    }
                    // If alwaysAllow is false, we only approve this single request
                }

                // Log the approval
                if (record.keyName && record.remotePubkey) {
                    const keyUser = await prisma.keyUser.findUnique({
                        where: {
                            unique_key_user: {
                                keyName: record.keyName,
                                userPubkey: record.remotePubkey,
                            },
                        },
                    });

                    if (keyUser) {
                        await prisma.log.create({
                            data: {
                                timestamp: new Date(),
                                type: 'approval',
                                method: record.method,
                                params: record.params,
                                keyUserId: keyUser.id,
                            },
                        });
                    }
                }

                results.push({ id, success: true });
            } catch (error) {
                results.push({ id, success: false, error: (error as Error).message });
            }
        }

        const approved = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        return reply.send({ results, summary: { approved, failed } });
    });
}
