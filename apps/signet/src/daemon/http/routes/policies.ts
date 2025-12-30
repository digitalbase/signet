import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma from '../../../db.js';

const VALID_METHODS = new Set([
    'connect',
    'sign_event',
    'get_public_key',
    'encrypt', 'decrypt',
    'nip04_encrypt', 'nip04_decrypt',
    'nip44_encrypt', 'nip44_decrypt',
    'ping',
]);

export function registerPoliciesRoutes(
    fastify: FastifyInstance,
    preHandler: { auth: any[]; csrf: any[]; rateLimit: any[] }
): void {
    // List all policies (GET - no CSRF needed)
    fastify.get('/policies', { preHandler: preHandler.auth }, async (_request: FastifyRequest, reply: FastifyReply) => {
        const policies = await prisma.policy.findMany({
            include: { rules: true },
            orderBy: { createdAt: 'desc' },
        });

        const payload = policies.map((policy) => ({
            id: policy.id,
            name: policy.name,
            description: policy.description,
            createdAt: policy.createdAt.toISOString(),
            expiresAt: policy.expiresAt?.toISOString() ?? null,
            rules: policy.rules.map((rule) => ({
                id: rule.id,
                method: rule.method,
                kind: rule.kind,
                maxUsageCount: rule.maxUsageCount,
                currentUsageCount: rule.currentUsageCount,
            })),
        }));

        return reply.send({ policies: payload });
    });

    // Create a new policy (POST - needs CSRF)
    fastify.post('/policies', { preHandler: [...preHandler.rateLimit, ...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as {
            name?: string;
            description?: string;
            expiresAt?: string;
            rules?: Array<{
                method: string;
                kind?: string | number;
                maxUsageCount?: number;
            }>;
        };

        if (!body.name) {
            return reply.code(400).send({ error: 'name is required' });
        }

        // Validate method names
        if (body.rules) {
            const invalidMethods = body.rules
                .map(r => r.method)
                .filter(m => !VALID_METHODS.has(m));
            if (invalidMethods.length > 0) {
                return reply.code(400).send({
                    error: `Invalid method(s): ${invalidMethods.join(', ')}. Valid methods: ${[...VALID_METHODS].join(', ')}`,
                });
            }
        }

        const policy = await prisma.policy.create({
            data: {
                name: body.name,
                description: body.description,
                expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
            },
        });

        if (body.rules && body.rules.length > 0) {
            for (const rule of body.rules) {
                await prisma.policyRule.create({
                    data: {
                        policyId: policy.id,
                        method: rule.method,
                        kind: rule.kind !== undefined ? String(rule.kind) : undefined,
                        maxUsageCount: rule.maxUsageCount ?? null,
                        currentUsageCount: 0,
                    },
                });
            }
        }

        const created = await prisma.policy.findUnique({
            where: { id: policy.id },
            include: { rules: true },
        });

        return reply.send({
            ok: true,
            policy: {
                id: created!.id,
                name: created!.name,
                rules: created!.rules.map((r) => ({
                    id: r.id,
                    method: r.method,
                    kind: r.kind,
                })),
            },
        });
    });

    // Delete a policy (DELETE - needs CSRF)
    fastify.delete('/policies/:id', { preHandler: [...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };

        try {
            // Delete rules first (cascade)
            await prisma.policyRule.deleteMany({
                where: { policyId: parseInt(id, 10) },
            });

            await prisma.policy.delete({
                where: { id: parseInt(id, 10) },
            });

            return reply.send({ ok: true });
        } catch (error) {
            return reply.code(404).send({ error: 'Policy not found' });
        }
    });
}
