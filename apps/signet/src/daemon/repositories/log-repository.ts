import prisma from '../../db.js';

export interface LogEntry {
    id: number;
    timestamp: Date;
    type: string;
    method: string | null;
    params: string | null;
    keyUserId: number | null;
    autoApproved: boolean;
    KeyUser?: {
        keyName: string;
        userPubkey: string;
        description: string | null;
    } | null;
}

export interface ActivityEntry {
    id: number;
    timestamp: string;
    type: string;
    method?: string;
    keyName?: string;
    userPubkey?: string;
    appName?: string;
    autoApproved: boolean;
}

export class LogRepository {
    async create(data: {
        type: string;
        method?: string;
        params?: string;
        keyUserId?: number;
        autoApproved?: boolean;
    }): Promise<LogEntry> {
        return prisma.log.create({
            data: {
                timestamp: new Date(),
                type: data.type,
                method: data.method,
                params: data.params,
                keyUserId: data.keyUserId,
                autoApproved: data.autoApproved ?? false,
            },
        });
    }

    async findRecent(limit: number): Promise<LogEntry[]> {
        return prisma.log.findMany({
            take: limit,
            orderBy: { timestamp: 'desc' },
            include: { KeyUser: true },
        });
    }

    async countSince(since: Date): Promise<number> {
        return prisma.log.count({
            where: { timestamp: { gte: since } },
        });
    }

    async getHourlyActivityRaw(): Promise<Array<{ hour: number; type: string; count: number }>> {
        const results = await prisma.$queryRaw<Array<{ hour: number | bigint; type: string; count: number | bigint }>>`
            SELECT
                CAST(strftime('%H', timestamp) AS INTEGER) as hour,
                type,
                COUNT(*) as count
            FROM Log
            WHERE timestamp >= datetime('now', '-24 hours')
            GROUP BY hour, type
            ORDER BY hour ASC
        `;
        // Convert BigInt to Number for JSON serialization
        return results.map(r => ({
            hour: Number(r.hour),
            type: r.type,
            count: Number(r.count),
        }));
    }

    async cleanupExpired(maxAge: Date): Promise<number> {
        const result = await prisma.log.deleteMany({
            where: { timestamp: { lt: maxAge } },
        });
        return result.count;
    }

    toActivityEntry(log: LogEntry): ActivityEntry {
        return {
            id: log.id,
            timestamp: log.timestamp.toISOString(),
            type: log.type,
            method: log.method ?? undefined,
            keyName: log.KeyUser?.keyName ?? undefined,
            userPubkey: log.KeyUser?.userPubkey ?? undefined,
            appName: log.KeyUser?.description ?? undefined,
            autoApproved: log.autoApproved,
        };
    }
}

export const logRepository = new LogRepository();
