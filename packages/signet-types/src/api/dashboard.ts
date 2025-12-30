/**
 * Dashboard statistics summary
 */
export interface DashboardStats {
    totalKeys: number;
    activeKeys: number;
    connectedApps: number;
    pendingRequests: number;
    recentActivity24h: number;
}

/**
 * A single activity entry for the dashboard timeline
 */
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

/**
 * Dashboard API response
 */
export interface DashboardResponse {
    stats: DashboardStats;
    activity: ActivityEntry[];
}
