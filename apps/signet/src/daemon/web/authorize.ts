import createDebug from 'debug';
import prisma from '../../db.js';
import { permitAllRequests, grantPermissionsByTrustLevel, type TrustLevel } from '../lib/acl.js';
import type { AllowScope } from '../lib/acl.js';
import { sanitizeCallbackUrl } from '../lib/auth.js';
import { getEventService } from '../services/event-service.js';
import { appService } from '../services/index.js';
import { VALID_TRUST_LEVELS } from '../constants.js';

const debug = createDebug('signet:web');

async function loadPendingRequest(request: any) {
    const record = await prisma.request.findUnique({
        where: { id: request.params.id },
    });

    if (!record || record.allowed !== null) {
        throw new Error('Request not found or already processed');
    }

    return record;
}

export async function authorizeRequestWebHandler(request: any, reply: any) {
    try {
        const record = await loadPendingRequest(request);

        // Safely parse the request URL
        let callbackUrl: string | undefined;
        try {
            const url = new URL(request.url, `http://${request.headers.host}`);
            const rawCallback = url.searchParams.get('callbackUrl');
            // Validate callback URL to prevent XSS (javascript:, data:, etc.)
            callbackUrl = sanitizeCallbackUrl(rawCallback) ?? undefined;
        } catch {
            // Invalid URL, proceed without callback
        }

        return reply.view('/templates/authorizeRequest.handlebar', {
            record,
            callbackUrl,
            authorised: true, // Always authorized - auth handled at route level
        });
    } catch (error) {
        debug('authorizeRequestWebHandler failed', error);
        // Escape error message to prevent XSS
        const safeError = String((error as Error).message || 'An error occurred')
            .replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c] || c));
        return reply.view('/templates/error.handlebar', { error: safeError });
    }
}

export async function processRequestWebHandler(
    request: any,
    reply: any
) {
    try {
        const record = await loadPendingRequest(request);

        // Get trust level from request body (default to 'reasonable')
        const requestedTrustLevel = request.body?.trustLevel;
        const trustLevel: TrustLevel = VALID_TRUST_LEVELS.includes(requestedTrustLevel)
            ? requestedTrustLevel
            : 'reasonable';

        // Get alwaysAllow flag from request body (default to false for one-time approval)
        const alwaysAllow = request.body?.alwaysAllow === true;

        // Get allowKind for kind-specific permissions (optional)
        const allowKind = typeof request.body?.allowKind === 'number' ? request.body.allowKind : undefined;

        await prisma.request.update({
            where: { id: record.id },
            data: {
                allowed: true,
                processedAt: new Date(),
            },
        });

        // Emit approval event for real-time updates
        getEventService().emitRequestApproved(record.id);

        // For connect requests, use the new trust level system (only if keyName is present)
        if (record.keyName) {
            if (record.method === 'connect') {
                const appId = await grantPermissionsByTrustLevel(
                    record.remotePubkey,
                    record.keyName,
                    trustLevel,
                    undefined // description can be added later
                );

                // Emit app:connected event for real-time updates
                const app = await appService.getAppById(appId);
                if (app) {
                    getEventService().emitAppConnected(app);
                }
            } else if (alwaysAllow) {
                // For non-connect requests with "always allow", grant the specific method for future requests
                // If allowKind is specified, only grant for that kind; otherwise grant for all kinds
                const scope: AllowScope = allowKind !== undefined ? { kind: allowKind } : { kind: 'all' };
                await permitAllRequests(record.remotePubkey, record.keyName, record.method, undefined, scope);
            }
            // If alwaysAllow is false, we only approve this single request (no SigningCondition created)
        }

        // Log the approved request
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

        reply.type('application/json');
        return reply.send({ ok: true, trustLevel });
    } catch (error) {
        reply.status(400);
        reply.type('application/json');
        return reply.send({ ok: false, error: (error as Error).message });
    }
}
