import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as httpModule from '@/lib/api/http-client';
import { ApiError } from '@/lib/api/http-client';
import {
  saveAgentWorkflow,
  loadAgentWorkflows,
  deleteAgentWorkflow,
  type SaveWorkflowRequest,
} from '../workflow';

const fakeWorkflow = {
  id: 'pk-1',
  user_id: 'u1',
  workflow_id: 'wf-1',
  workflow_name: 'Demo',
  nodes: [],
  connections: [],
  is_active: true,
  is_template: false,
  version: 1,
  created_at: '2026-04-07T00:00:00Z',
  updated_at: '2026-04-07T00:00:00Z',
};

const saveRequest: SaveWorkflowRequest = {
  user_id: 'u1',
  workflow_id: 'wf-1',
  workflow_name: 'Demo',
  nodes: [],
  connections: [],
};

describe('workflow API client', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('saveAgentWorkflow calls http.post with the save path', async () => {
    const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: true,
      message: 'ok',
      data: fakeWorkflow,
    } as never);

    const result = await saveAgentWorkflow(saveRequest);

    expect(spy).toHaveBeenCalledWith('/api/workflow/agent/save', saveRequest);
    expect(result.success).toBe(true);
  });

  it('saveAgentWorkflow throws when backend returns success:false', async () => {
    vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: false,
      message: 'no permission',
      data: fakeWorkflow,
    } as never);
    await expect(saveAgentWorkflow(saveRequest)).rejects.toThrow('no permission');
  });

  it('loadAgentWorkflows uses GET on the load path with userId', async () => {
    const spy = vi.spyOn(httpModule.http, 'get').mockResolvedValue({
      success: true,
      message: 'ok',
      data: [fakeWorkflow],
    } as never);

    await loadAgentWorkflows('u1');

    expect(spy).toHaveBeenCalledWith('/api/workflow/agent/load/u1');
  });

  it('deleteAgentWorkflow uses http.del with the delete path', async () => {
    const spy = vi.spyOn(httpModule.http, 'del').mockResolvedValue({
      success: true,
      message: 'ok',
      data: { workflow_id: 'wf-1' },
    } as never);

    await deleteAgentWorkflow('u1', 'wf-1');

    expect(spy).toHaveBeenCalledWith('/api/workflow/agent/delete/u1/wf-1');
  });

  it('lets ApiError propagate without wrapping', async () => {
    const err = new ApiError(500, 'INTERNAL', 'workflow store down');
    vi.spyOn(httpModule.http, 'get').mockRejectedValue(err);
    await expect(loadAgentWorkflows('u1')).rejects.toBe(err);
  });
});
