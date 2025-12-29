import type { ConnectionInfo } from '@signet/types';

// Re-export for backwards compatibility
export type { ConnectionInfo } from '@signet/types';

function resolveConnectionInfoUrl(): string {
  const fromEnv = import.meta.env.VITE_BUNKER_INFO_URL;
  if (fromEnv && typeof fromEnv === 'string') {
    return fromEnv;
  }

  // Use relative URL so it goes through the proxy (vite dev or production server.mjs)
  return '/connection';
}

export async function fetchConnectionInfo(): Promise<ConnectionInfo | null> {
  const url = resolveConnectionInfoUrl();

  try {
    const response = await fetch(url, {
      credentials: 'include'
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as ConnectionInfo;

    if (!payload?.npubUri) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
