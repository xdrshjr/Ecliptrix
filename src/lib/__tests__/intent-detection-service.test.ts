/**
 * Vitest unit tests for `src/lib/intent-detection-service.ts`.
 *
 * Coverage: spec §7 cases C1, C5.
 *
 * IMPORTANT: Vitest is NOT YET INSTALLED in this repo — that is T07's job.
 * This file is valid Vitest syntax and will run as soon as `vitest` is added
 * to devDependencies and `vitest.config.ts` wires up the jsdom environment.
 *
 * Strategy:
 *   - We mock `@/lib/api/http-client` so each test fully owns the http surface.
 *   - We assert the helper calls `http.post('/api/intent-detection/detect', ...)`
 *     with the documented body shape.
 *   - We assert that wrapper-thrown errors propagate to the caller (no
 *     `{success:false}` envelope wrapping).
 *   - We assert the pre-flight validation guards remain intact.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

// IMPORTANT: vi.mock() is hoisted, so the http mock is in place before the
// service module is imported below.
vi.mock('@/lib/api/http-client', () => {
  return {
    http: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      del: vi.fn(),
      upload: vi.fn(),
    },
    MissingAuthError: class MissingAuthError extends Error {
      static readonly code = 'MISSING_AUTH';
      readonly code = 'MISSING_AUTH';
      constructor(message?: string) {
        super(message ?? 'No session token in localStorage.');
        this.name = 'MissingAuthError';
      }
    },
  };
});

import { detectIntent } from '../intent-detection-service';
import { http, MissingAuthError } from '@/lib/api/http-client';

const enabledWorkflows = [
  {
    workflow_id: 'wf-1',
    workflow_name: 'Search',
    tool_description: 'Search the web',
    enabled: true,
  },
];

beforeEach(() => {
  (http.post as unknown as Mock).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('intent-detection-service.detectIntent', () => {
  // ---------------------------------------------------------------------------
  // C1 — happy path: calls http.post with the correct path + body
  // ---------------------------------------------------------------------------
  it('C1: calls http.post with /api/intent-detection/detect and correct body', async () => {
    (http.post as unknown as Mock).mockResolvedValueOnce({
      success: true,
      data: {
        should_call_workflow: true,
        workflow_name: 'Search',
        workflow_id: 'wf-1',
        confidence: 0.92,
        reasoning: 'matches search intent',
      },
    });

    const result = await detectIntent('hello world', enabledWorkflows, [
      { role: 'user', content: 'previous message' },
    ]);

    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith('/api/intent-detection/detect', {
      user_message: 'hello world',
      enabled_workflows: enabledWorkflows,
      conversation_history: [{ role: 'user', content: 'previous message' }],
    });

    expect(result.success).toBe(true);
    expect(result.data?.should_call_workflow).toBe(true);
    expect(result.data?.workflow_name).toBe('Search');
  });

  // ---------------------------------------------------------------------------
  // C1.b — null conversation_history when omitted
  // ---------------------------------------------------------------------------
  it('C1.b: passes conversation_history: null when caller omits it', async () => {
    (http.post as unknown as Mock).mockResolvedValueOnce({ success: true });

    await detectIntent('hi', enabledWorkflows);

    const call = (http.post as unknown as Mock).mock.calls[0];
    expect(call[0]).toBe('/api/intent-detection/detect');
    expect(call[1].conversation_history).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // C5 — propagates MissingAuthError from http-client (no envelope wrapping)
  // ---------------------------------------------------------------------------
  it('C5: propagates MissingAuthError from http-client', async () => {
    (http.post as unknown as Mock).mockRejectedValueOnce(new MissingAuthError());

    await expect(
      detectIntent('hello', enabledWorkflows),
    ).rejects.toBeInstanceOf(MissingAuthError);
  });

  // ---------------------------------------------------------------------------
  // Pre-flight validation: empty user message returns envelope, no http call
  // ---------------------------------------------------------------------------
  it('returns {success:false} envelope when user_message is empty (no http call)', async () => {
    const result = await detectIntent('', enabledWorkflows);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/user_message/);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('returns {success:false} envelope when user_message is whitespace-only', async () => {
    const result = await detectIntent('   ', enabledWorkflows);
    expect(result.success).toBe(false);
    expect(http.post).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Pre-flight validation: empty enabled_workflows returns envelope
  // ---------------------------------------------------------------------------
  it('returns {success:false} envelope when enabled_workflows is empty (no http call)', async () => {
    const result = await detectIntent('hello', []);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/enabled_workflows/);
    expect(http.post).not.toHaveBeenCalled();
  });
});
