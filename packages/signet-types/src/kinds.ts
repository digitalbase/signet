import type { TrustLevel } from './api/apps.js';

/**
 * Human-readable names for Nostr event kinds.
 * Based on https://github.com/nostr-protocol/nips
 */
export const KIND_NAMES: Record<number, string> = {
  // Core protocol (NIP-01)
  0: 'Profile Metadata',
  1: 'Short Text Note',
  2: 'Relay Recommendation', // deprecated
  3: 'Follow List',
  4: 'Encrypted DM (NIP-04)', // deprecated but still used
  5: 'Event Deletion',
  6: 'Repost',
  7: 'Reaction',
  8: 'Badge Award',
  16: 'Generic Repost',

  // Direct Messages (NIP-17)
  14: 'Direct Message',

  // Channels (NIP-28)
  40: 'Channel Creation',
  41: 'Channel Metadata',
  42: 'Channel Message',
  43: 'Channel Hide Message',
  44: 'Channel Mute User',

  // Gift Wrap (NIP-59)
  1059: 'Gift Wrap',

  // File Metadata (NIP-94)
  1063: 'File Metadata',

  // Comments (NIP-22)
  1111: 'Comment',

  // Reporting (NIP-56)
  1984: 'Report',

  // Labels (NIP-32)
  1985: 'Label',

  // Zaps (NIP-57)
  9734: 'Zap Request',
  9735: 'Zap Receipt',

  // Mute/Pin/Bookmarks (NIP-51)
  10000: 'Mute List',
  10001: 'Pin List',
  10002: 'Relay List',

  // Wallet Connect (NIP-47)
  13194: 'Wallet Info',
  23194: 'Wallet Request',
  23195: 'Wallet Response',

  // Client Authentication (NIP-42)
  22242: 'Client Authentication',

  // Nostr Connect / NIP-46
  24133: 'NIP-46 Request',

  // Blossom (media servers)
  24242: 'Blossom Auth',

  // HTTP Auth (NIP-98)
  27235: 'HTTP Auth',

  // Lists (NIP-51)
  30000: 'Follow Sets',
  30001: 'Bookmark Sets',
  30002: 'Relay Sets',
  30003: 'Contact Sets',

  // Long-form Content (NIP-23)
  30023: 'Long-form Article',
  30024: 'Draft Article',

  // App-specific Data (NIP-78)
  30078: 'App-specific Data',

  // Live Activities (NIP-53)
  30311: 'Live Event',

  // Classifieds (NIP-99)
  30402: 'Classified Listing',

  // Date-based Calendar (NIP-52)
  31922: 'Date-based Event',
  31923: 'Time-based Event',

  // Handler Information (NIP-89)
  31989: 'Handler Recommendation',
  31990: 'Handler Information',
};

/**
 * Event kinds that are sensitive and should show warnings.
 * These can change identity, leak data, or have security/financial implications.
 */
export const SENSITIVE_KINDS = new Set([
  0,      // Profile metadata (identity)
  3,      // Contact/follow list (social graph)
  4,      // NIP-04 encrypted DM (privacy)
  5,      // Event deletion (irreversible)
  10002,  // Relay list (can affect connectivity)
  22242,  // Client authentication (security)
  24133,  // NIP-46 request (meta - signing for another signer)
  13194,  // Wallet info (financial)
  23194,  // Wallet request (financial)
  23195,  // Wallet response (financial)
]);

/**
 * Event kinds considered "safe" for auto-approval in "reasonable" trust level.
 */
export const SAFE_KINDS = new Set([
  1,      // Short text note
  6,      // Repost
  7,      // Reaction
  16,     // Generic repost
  1111,   // Comment
  30023,  // Long-form article
  30024,  // Draft long-form
  9735,   // Zap receipt
  10000,  // Mute list
  10001,  // Pin list
  30000,  // Follow sets
  30001,  // Bookmark sets
  24242,  // Blossom authorization
]);

/**
 * Permission behavior for a given trust level.
 */
export interface TrustLevelBehavior {
  label: string;
  description: string;
  autoApprove: string[];
  requiresApproval: string[];
}

/**
 * Get detailed behavior breakdown for a trust level.
 */
export function getTrustLevelBehavior(level: TrustLevel): TrustLevelBehavior {
  switch (level) {
    case 'paranoid':
      return {
        label: 'Always Ask',
        description: 'Every action requires your approval',
        autoApprove: [],
        requiresApproval: [
          'All signing requests',
          'All encryption/decryption',
          'Everything else',
        ],
      };
    case 'reasonable':
      return {
        label: 'Auto-approve Safe',
        description: 'Auto-approve common actions, ask for sensitive ones',
        autoApprove: [
          'Notes, reposts, reactions',
          'Comments, articles',
          'Zap receipts, blossom auth',
          'NIP-44 encryption (general)',
          'Mute/pin/bookmark lists',
        ],
        requiresApproval: [
          'Profile changes',
          'Follow list updates',
          'NIP-04 encryption (DMs)',
          'Relay list changes',
          'Wallet operations',
        ],
      };
    case 'full':
      return {
        label: 'Auto-approve All',
        description: 'Automatically approve all requests',
        autoApprove: [
          'All signing requests',
          'All encryption/decryption',
          'Everything',
        ],
        requiresApproval: [],
      };
  }
}

/**
 * Get a human-readable name for an event kind.
 * Returns "Kind {number}" for unknown kinds.
 */
export function getKindName(kind: number): string {
  return KIND_NAMES[kind] ?? `Kind ${kind}`;
}

/**
 * Get a human-readable label for display (includes kind number).
 * Example: "Short Text Note (kind 1)"
 */
export function getKindLabel(kind: number): string {
  const name = KIND_NAMES[kind];
  if (name) {
    return `${name}`;
  }
  return `Kind ${kind}`;
}

/**
 * Check if a kind is considered sensitive and should show extra warnings.
 */
export function isKindSensitive(kind: number): boolean {
  return SENSITIVE_KINDS.has(kind);
}

/**
 * Parse NIP-46 connect permissions string.
 * Format: "method[:kind],method[:kind],..."
 * Example: "sign_event:1,sign_event:7,nip44_encrypt"
 */
export interface ParsedPermission {
  method: string;
  kind?: number;
}

export function parseConnectPermissions(perms: string | null | undefined): ParsedPermission[] {
  if (!perms) return [];

  return perms.split(',')
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => {
      const [method, kindStr] = p.split(':');
      const kind = kindStr ? parseInt(kindStr, 10) : undefined;
      return {
        method,
        kind: kind !== undefined && !isNaN(kind) ? kind : undefined,
      };
    });
}

/**
 * Format a parsed permission for display.
 */
export function formatPermission(perm: ParsedPermission): string {
  if (perm.method === 'sign_event' && perm.kind !== undefined) {
    return `Sign ${getKindName(perm.kind)}`;
  }

  switch (perm.method) {
    case 'sign_event':
      return 'Sign events (any kind)';
    case 'nip04_encrypt':
      return 'Encrypt messages (NIP-04)';
    case 'nip04_decrypt':
      return 'Decrypt messages (NIP-04)';
    case 'nip44_encrypt':
      return 'Encrypt messages (NIP-44)';
    case 'nip44_decrypt':
      return 'Decrypt messages (NIP-44)';
    case 'get_public_key':
      return 'Get public key';
    case 'ping':
      return 'Ping';
    default:
      return perm.method;
  }
}

/**
 * Get a description of what approving this kind means.
 * Used for detailed permission explanations.
 */
export function getKindDescription(kind: number): string | null {
  switch (kind) {
    case 0:
      return 'Updates your public profile (name, bio, picture, etc.)';
    case 1:
      return 'Publishes a short text note visible to your followers';
    case 3:
      return 'Updates who you follow - affects your social graph';
    case 4:
      return 'Sends an encrypted direct message (NIP-04, legacy)';
    case 5:
      return 'Requests deletion of a previously published event';
    case 6:
    case 16:
      return 'Reposts/shares another user\'s content';
    case 7:
      return 'Reacts to another event (like, emoji, etc.)';
    case 14:
      return 'Sends a direct message (NIP-17)';
    case 1059:
      return 'Creates a gift-wrapped encrypted message';
    case 9734:
      return 'Initiates a lightning zap payment';
    case 9735:
      return 'Confirms a lightning zap was received';
    case 10002:
      return 'Updates your relay list - affects where your content is published';
    case 13194:
      return 'Shares wallet connection information';
    case 23194:
      return 'Makes a request to a connected wallet (may involve funds)';
    case 23195:
      return 'Responds to a wallet request';
    case 24242:
      return 'Authorizes file upload/download from a media server';
    case 30023:
      return 'Publishes a long-form article';
    case 30024:
      return 'Saves a draft article (replaceable)';
    default:
      return null;
  }
}
