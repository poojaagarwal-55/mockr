/**
 * Bug Condition Exploration Test for Auth Header 401 Fix
 * 
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3**
 * 
 * This test MUST FAIL on unfixed code to confirm the bug exists.
 * The test verifies that when QuestionsPage mounts and useEffect hooks execute immediately,
 * API calls wait for session to be loaded before executing, include Authorization headers
 * with valid access tokens, and don't produce 401 Unauthorized errors.
 * 
 * Expected behavior on UNFIXED code:
 * - Test FAILS because API calls execute with undefined tokens
 * - Authorization headers are "Bearer undefined"
 * - Backend would return 401 errors
 * 
 * Expected behavior on FIXED code:
 * - Test PASSES because API calls wait for session
 * - Authorization headers include valid tokens
 * - No 401 errors occur
 */

import { render, waitFor } from '@testing-library/react';
import QuestionsPage from './dsa/page';
import { createSupabaseBrowserClient } from '@/lib/supabase';
import { api } from '@/lib/api';

// Mock dependencies
jest.mock('@/lib/supabase');
jest.mock('@/lib/api');
jest.mock('@/components/page-header', () => ({
  PageHeader: jest.fn(() => null),
}));
jest.mock('@/components/question-list-item', () => ({
  QuestionListItem: jest.fn(() => null),
}));
jest.mock('@/components/question-filters', () => ({
  QuestionFilters: jest.fn(() => null),
}));
jest.mock('@/components/company-tags-sidebar', () => ({
  CompanyTagsSidebar: jest.fn(() => null),
}));
jest.mock('next/image', () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));

describe('QuestionsPage - Bug Condition Exploration', () => {
  const mockGetSession = jest.fn();
  const mockApiGet = jest.fn();
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock Supabase client
    (createSupabaseBrowserClient as jest.Mock).mockReturnValue({
      auth: {
        getSession: mockGetSession,
      },
    });
    
    // Mock API client
    (api.get as jest.Mock) = mockApiGet;
  });

  /**
   * Property 1: Bug Condition - API Requests Wait for Session
   * 
   * This test simulates the race condition where component mounts before session is ready.
   * On UNFIXED code, this test will FAIL because:
   * - getSession() returns undefined session immediately
   * - API calls execute with token=undefined
   * - Authorization headers are "Bearer undefined"
   * 
   * On FIXED code, this test will PASS because:
   * - Component waits for session to be loaded
   * - API calls only execute after session is available
   * - Authorization headers include valid tokens
   */
  test('API calls wait for session to be loaded before executing', async () => {
    // Simulate session not being immediately available (race condition)
    // First call returns no session (simulating initialization delay)
    // Second call returns valid session (simulating session loaded)
    let callCount = 0;
    mockGetSession.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First call: session not ready yet (this is the bug condition)
        return Promise.resolve({
          data: { session: null },
          error: null,
        });
      } else {
        // Subsequent calls: session is ready
        return Promise.resolve({
          data: {
            session: {
              access_token: 'valid-token-123',
              user: { id: 'user-1' },
            },
          },
          error: null,
        });
      }
    });

    // Mock successful API responses
    mockApiGet.mockResolvedValue({
      success: true,
      data: {
        questions: [],
        pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
        filters: { topics: {}, difficulties: {} },
      },
    });

    // Render component (this triggers useEffect hooks immediately)
    render(<QuestionsPage />);

    // Wait for API calls to be made
    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalled();
    }, { timeout: 3000 });

    // CRITICAL ASSERTION: Verify that API calls were made with valid tokens, not undefined
    // On UNFIXED code, this will FAIL because token will be undefined
    // On FIXED code, this will PASS because component waits for session
    const questionsCall = mockApiGet.mock.calls.find(call => 
      call[0].includes('/ide/questions')
    );
    const progressCall = mockApiGet.mock.calls.find(call => 
      call[0].includes('/ide/progress')
    );

    expect(questionsCall).toBeDefined();
    expect(progressCall).toBeDefined();

    // Verify tokens are NOT undefined (this is the key assertion)
    const questionsToken = questionsCall?.[1];
    const progressToken = progressCall?.[1];

    expect(questionsToken).toBeDefined();
    expect(questionsToken).not.toBeUndefined();
    expect(questionsToken).toBe('valid-token-123');

    expect(progressToken).toBeDefined();
    expect(progressToken).not.toBeUndefined();
    expect(progressToken).toBe('valid-token-123');
  });

  /**
   * Property 1: Bug Condition - Authorization Headers Present
   * 
   * This test verifies that Authorization headers are properly included in API requests.
   * On UNFIXED code, this test will FAIL because headers will be "Bearer undefined".
   * On FIXED code, this test will PASS because headers include valid tokens.
   */
  test('API calls include Authorization headers with valid access tokens', async () => {
    // Simulate delayed session loading
    mockGetSession
      .mockResolvedValueOnce({
        data: { session: null },
        error: null,
      })
      .mockResolvedValue({
        data: {
          session: {
            access_token: 'test-access-token-456',
            user: { id: 'user-2' },
          },
        },
        error: null,
      });

    mockApiGet.mockResolvedValue({
      success: true,
      data: {
        questions: [],
        pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
        filters: { topics: {}, difficulties: {} },
      },
    });

    render(<QuestionsPage />);

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalled();
    }, { timeout: 3000 });

    // Verify all API calls have valid tokens (not undefined)
    mockApiGet.mock.calls.forEach((call) => {
      const token = call[1];
      expect(token).toBeDefined();
      expect(token).not.toBeUndefined();
      expect(token).toBe('test-access-token-456');
    });
  });

  /**
   * Property 1: Bug Condition - No 401 Unauthorized Errors
   * 
   * This test verifies that no 401 errors occur due to missing Authorization headers.
   * On UNFIXED code, API calls with undefined tokens would result in 401 errors.
   * On FIXED code, all API calls succeed because they wait for valid tokens.
   */
  test('no 401 Unauthorized errors occur due to missing Authorization headers', async () => {
    mockGetSession
      .mockResolvedValueOnce({
        data: { session: null },
        error: null,
      })
      .mockResolvedValue({
        data: {
          session: {
            access_token: 'valid-token-789',
            user: { id: 'user-3' },
          },
        },
        error: null,
      });

    // Mock API to reject calls with undefined tokens (simulating backend behavior)
    mockApiGet.mockImplementation((path: string, token?: string) => {
      if (!token || token === 'undefined') {
        return Promise.reject({
          status: 401,
          message: 'Missing or invalid Authorization header',
        });
      }
      return Promise.resolve({
        success: true,
        data: {
          questions: [],
          pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
          filters: { topics: {}, difficulties: {} },
        },
      });
    });

    render(<QuestionsPage />);

    // Wait for component to settle
    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalled();
    }, { timeout: 3000 });

    // Verify no API calls were made with undefined tokens
    // On UNFIXED code, this will FAIL because calls are made with undefined tokens
    // On FIXED code, this will PASS because component waits for valid tokens
    mockApiGet.mock.calls.forEach((call) => {
      const token = call[1];
      expect(token).not.toBeUndefined();
      expect(token).not.toBe('undefined');
    });

    // Verify API calls succeeded (no 401 errors)
    const results = await Promise.all(
      mockApiGet.mock.results.map(result => result.value.catch((e: any) => e))
    );

    results.forEach((result) => {
      // Should not be an error object with 401 status
      expect(result.status).not.toBe(401);
    });
  });
});
