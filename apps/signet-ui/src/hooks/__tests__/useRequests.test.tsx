import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { useRequests } from '../useRequests';
import { SettingsProvider } from '../../contexts/SettingsContext';
import { createMockRequest } from '../../testing/mocks';

// Mock the api-client module
vi.mock('../../lib/api-client.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

// Mock the ServerEventsContext to avoid SSE setup in tests
vi.mock('../../contexts/ServerEventsContext.js', () => ({
  useSSESubscription: vi.fn(),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return <SettingsProvider>{children}</SettingsProvider>;
}

describe('useRequests', () => {
  let mockApiGet: ReturnType<typeof vi.fn>;
  let mockApiPost: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const apiClient = await import('../../lib/api-client.js');
    mockApiGet = apiClient.apiGet as ReturnType<typeof vi.fn>;
    mockApiPost = apiClient.apiPost as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial load', () => {
    it('should fetch pending requests on mount', async () => {
      const mockRequests = [
        createMockRequest({ id: 'req-1' }),
        createMockRequest({ id: 'req-2' }),
      ];
      mockApiGet.mockResolvedValue({ requests: mockRequests });

      const { result } = renderHook(() => useRequests(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.requests).toHaveLength(2);
      expect(mockApiGet).toHaveBeenCalledWith(expect.stringContaining('status=pending'));
    });

    it('should handle fetch errors', async () => {
      mockApiGet.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useRequests(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Network error');
    });
  });

  describe('filtering', () => {
    it('should refetch when filter changes', async () => {
      mockApiGet.mockResolvedValue({ requests: [] });

      const { result } = renderHook(() => useRequests(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Change filter to approved
      await act(async () => {
        result.current.setFilter('approved');
      });

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledWith(expect.stringContaining('status=approved'));
      });
    });
  });

  describe('password management', () => {
    it('should store password for requests', async () => {
      const mockRequests = [createMockRequest({ id: 'req-1', requiresPassword: true })];
      mockApiGet.mockResolvedValue({ requests: mockRequests });

      const { result } = renderHook(() => useRequests(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.setPassword('req-1', 'mypassword');
      });

      expect(result.current.passwords['req-1']).toBe('mypassword');
    });
  });

  describe('approval', () => {
    it('should approve a request without password', async () => {
      const mockRequests = [createMockRequest({ id: 'req-1', requiresPassword: false })];
      mockApiGet.mockResolvedValue({ requests: mockRequests });
      mockApiPost.mockResolvedValue({ ok: true });

      const { result } = renderHook(() => useRequests(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.approve('req-1');
      });

      expect(mockApiPost).toHaveBeenCalledWith('/requests/req-1', {});
    });

    it('should require password for encrypted key requests', async () => {
      const mockRequests = [createMockRequest({ id: 'req-1', requiresPassword: true })];
      mockApiGet.mockResolvedValue({ requests: mockRequests });

      const { result } = renderHook(() => useRequests(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Try to approve without password
      await act(async () => {
        await result.current.approve('req-1');
      });

      // Should have error in meta
      expect(result.current.meta['req-1']).toEqual({
        state: 'error',
        message: 'Password required to authorize this request',
      });
    });

    it('should send password when approving encrypted request', async () => {
      const mockRequests = [createMockRequest({ id: 'req-1', requiresPassword: true })];
      mockApiGet.mockResolvedValue({ requests: mockRequests });
      mockApiPost.mockResolvedValue({ ok: true });

      const { result } = renderHook(() => useRequests(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Set password first
      act(() => {
        result.current.setPassword('req-1', 'mypassword');
      });

      await act(async () => {
        await result.current.approve('req-1');
      });

      expect(mockApiPost).toHaveBeenCalledWith('/requests/req-1', { password: 'mypassword' });
    });
  });

  describe('selection mode', () => {
    it('should toggle selection mode', async () => {
      mockApiGet.mockResolvedValue({ requests: [] });

      const { result } = renderHook(() => useRequests(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.selectionMode).toBe(false);

      act(() => {
        result.current.toggleSelectionMode();
      });

      expect(result.current.selectionMode).toBe(true);
    });

    it('should select and deselect requests', async () => {
      const mockRequests = [
        createMockRequest({ id: 'req-1' }),
        createMockRequest({ id: 'req-2' }),
      ];
      mockApiGet.mockResolvedValue({ requests: mockRequests });

      const { result } = renderHook(() => useRequests(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Enter selection mode
      act(() => {
        result.current.toggleSelectionMode();
      });

      // Select first request
      act(() => {
        result.current.toggleSelection('req-1');
      });

      expect(result.current.selectedIds.has('req-1')).toBe(true);
      expect(result.current.selectedIds.size).toBe(1);

      // Deselect
      act(() => {
        result.current.toggleSelection('req-1');
      });

      expect(result.current.selectedIds.has('req-1')).toBe(false);
    });

    it('should select all pending requests', async () => {
      const mockRequests = [
        createMockRequest({ id: 'req-1' }),
        createMockRequest({ id: 'req-2' }),
      ];
      mockApiGet.mockResolvedValue({ requests: mockRequests });

      const { result } = renderHook(() => useRequests(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.selectAll();
      });

      expect(result.current.selectedIds.size).toBe(2);
    });

    it('should deselect all', async () => {
      const mockRequests = [createMockRequest({ id: 'req-1' })];
      mockApiGet.mockResolvedValue({ requests: mockRequests });

      const { result } = renderHook(() => useRequests(), { wrapper });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.selectAll();
        result.current.deselectAll();
      });

      expect(result.current.selectedIds.size).toBe(0);
    });
  });
});
