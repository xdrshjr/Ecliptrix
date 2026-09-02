/**
 * Vitest unit tests for `src/lib/api/llm.ts`.
 *
 * Coverage: spec §7 cases C2, C6.
 *
 * Vitest is not yet installed (T07 owns runner setup); this file is valid
 * Vitest syntax that will run once the runner is wired up.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@/lib/api/http-client', () => {
  return {
    http: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      del: vi.fn(),
      upload: vi.fn(),
    },
  };
});

import { fetchLLMModels } from '../llm';
import { http } from '@/lib/api/http-client';

const sampleModels = [
  {
    id: 'agent_llm_01',
    name: 'qwen3-next-80b-a3b-instruct',
    api_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    api_key: 'sk-redacted',
    display_name: 'Qwen 80B (Agent 01)',
    description: 'Primary agent LLM',
  },
  {
    id: 'agent_llm_02',
    name: 'qwen3-next-80b-a3b-instruct',
    api_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    api_key: 'sk-redacted',
    display_name: 'Qwen 80B (Agent 02)',
  },
];

beforeEach(() => {
  (http.get as unknown as Mock).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('llm.fetchLLMModels', () => {
  // ---------------------------------------------------------------------------
  // C2 — happy path: calls http.get('/api/llm/models') and returns response.models
  // ---------------------------------------------------------------------------
  it('C2: calls http.get(/api/llm/models) and returns the models array', async () => {
    (http.get as unknown as Mock).mockResolvedValueOnce({
      success: true,
      message: 'ok',
      models: sampleModels,
      total_count: sampleModels.length,
    });

    const result = await fetchLLMModels();

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.get).toHaveBeenCalledWith('/api/llm/models');
    expect(result).toEqual(sampleModels);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('agent_llm_01');
    expect(result[0].display_name).toBe('Qwen 80B (Agent 01)');
  });

  // ---------------------------------------------------------------------------
  // C2.b — empty model list still returns []
  // ---------------------------------------------------------------------------
  it('C2.b: returns empty array when backend reports zero models', async () => {
    (http.get as unknown as Mock).mockResolvedValueOnce({
      success: true,
      message: 'ok',
      models: [],
      total_count: 0,
    });

    const result = await fetchLLMModels();
    expect(result).toEqual([]);
  });
});
