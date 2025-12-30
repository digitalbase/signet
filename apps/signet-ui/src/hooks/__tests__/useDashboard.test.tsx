import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { useDashboard } from '../useDashboard';
import { SettingsProvider } from '../../contexts/SettingsContext';
import { createMockDashboardStats, createMockActivityEntry } from '../../testing/mocks';

// Mock the api-client module
vi.mock('../../lib/api-client.js', () => ({
  apiGet: vi.fn(),
}));

// Mock the ServerEventsContext to avoid SSE setup in tests
vi.mock('../../contexts/ServerEventsContext.js', () => ({
  useSSESubscription: vi.fn(),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return <SettingsProvider>{children}</SettingsProvider>;
}

describe('useDashboard', () => {
  let mockApiGet: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const apiClient = await import('../../lib/api-client.js');
    mockApiGet = apiClient.apiGet as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fetch dashboard data on mount', async () => {
    const mockStats = createMockDashboardStats({ pendingRequests: 5 });
    const mockActivity = [createMockActivityEntry({ type: 'approval' })];

    mockApiGet.mockResolvedValue({
      stats: mockStats,
      activity: mockActivity,
    });

    const { result } = renderHook(() => useDashboard(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.stats).toEqual(mockStats);
    expect(result.current.activity).toEqual(mockActivity);
  });

  it('should handle fetch errors', async () => {
    mockApiGet.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useDashboard(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');
    expect(result.current.stats).toBeNull();
  });

  it('should allow manual refresh', async () => {
    const initialStats = createMockDashboardStats({ pendingRequests: 0 });
    const updatedStats = createMockDashboardStats({ pendingRequests: 3 });

    mockApiGet
      .mockResolvedValueOnce({ stats: initialStats, activity: [] })
      .mockResolvedValueOnce({ stats: updatedStats, activity: [] });

    const { result } = renderHook(() => useDashboard(), { wrapper });

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.stats?.pendingRequests).toBe(0);
    });

    // Trigger manual refresh
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.stats?.pendingRequests).toBe(3);
  });

  it('should set loading state during fetch', async () => {
    let resolvePromise: (value: unknown) => void;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    mockApiGet.mockReturnValue(promise);

    const { result } = renderHook(() => useDashboard(), { wrapper });

    // Should be loading initially
    expect(result.current.loading).toBe(true);

    // Resolve promise
    await act(async () => {
      resolvePromise!({ stats: createMockDashboardStats(), activity: [] });
      await promise;
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });
});
