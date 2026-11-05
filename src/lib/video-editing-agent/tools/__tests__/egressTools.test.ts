// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentOperation, ToolContext } from '../../types';
import type { HostCapabilitySnapshot } from '@/types/agentHost';
import { createEgressTools } from '../egressTools';
import { createHostTools } from '../hostTools';
import { DEFAULT_EGRESS_MAX_PER_TURN } from '../hostToolAdapter';

/**
 * `egress_tools`（tier-2）的契约：GET/HEAD、素材入库、`size=0` 不是成功，
 * 以及每回合出口预算（AC-G05 / AC-G07 / AC-G22a / AC-G24）。
 */

type Details = Record<string, unknown> & {
  error_details?: Record<string, unknown>;
  error_code?: string;
};

const MATERIAL = {
  id: 'web-abc123', name: 'Yorkie', type: 'image', format: 'jpg', size: 184_321,
  width: 1600, height: 1200, created_at: '2026-11-06',
  local_url: '/api/storage/files/cached_materials/web/web-abc123.jpg',
  provenance: { license_status: 'unknown' },
};

function setup(envelope: unknown, options: { status?: number;
  hostCapabilities?: HostCapabilitySnapshot } = {}) {
  const urls: string[] = [];
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    urls.push(url);
    bodies.push(JSON.parse(String(init.body ?? '{}')));
    return Response.json(envelope, { status: options.status ?? 200 });
  }));
  const operations = new Map<string, AgentOperation>();
  const recordOperation = vi.fn((id: string, operation: AgentOperation) => {
    operations.set(id, operation);
  });
  const context = {
    apiBaseUrl: 'http://127.0.0.1:3000', materials: [] as unknown[], operations,
    recordOperation, turnState: {}, callBudget: { used: 0 }, projectId: 'project-7',
    ...(options.hostCapabilities ? { hostCapabilities: options.hostCapabilities } : {}),
  } as unknown as ToolContext;
  const byName = new Map(createEgressTools(context).map(tool => [tool.name, tool]));
  const run = async (name: string, params: unknown, callId = 'call_1') => {
    const tool = byName.get(name);
    if (!tool) throw new Error(`missing tool ${name}`);
    return (await tool.execute(callId, params as never)).details as Details;
  };
  return { urls, bodies, context, run, byName, operations, recordOperation };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('egress_tools contract', () => {
  it('registers http_request, download_url and diagnose_url', () => {
    const { byName } = setup({ success: true, data: {} });
    expect(Array.from(byName.keys())).toEqual([
      'http_request', 'download_url', 'diagnose_url',
    ]);
    const method = byName.get('http_request')!.parameters as unknown as {
      properties: Record<string, unknown>;
    };
    expect(method.properties.method).toBeTruthy();
    expect(byName.get('http_request')!.description).toContain('GET or HEAD only');
  });

  it('rejects a write method client-side with http_write_unsupported', async () => {
    const { run, urls } = setup({ success: true, data: {} });
    const details = await run('http_request', { method: 'POST', url: 'https://e.com' });
    expect(urls).toHaveLength(0);
    expect(details).toMatchObject({
      success: false, error_code: 'http_write_unsupported',
      error_details: { failure_class: 'user_input', retryable: false },
    });
  });

  it('sends a GET through /egress/request with the project id', async () => {
    const { run, urls, bodies } = setup({
      success: true,
      data: { status: 200, headers: {}, body_text: 'ok', truncated: false,
        final_url: 'https://e.com/' },
    });
    const details = await run('http_request', {
      method: 'GET', url: 'https://e.com/', timeout_ms: 5_000,
    });
    expect(urls[0].endsWith('/api/agent-host/egress/request')).toBe(true);
    expect(bodies[0]).toMatchObject({
      method: 'GET', url: 'https://e.com/', project_id: 'project-7',
    });
    expect(details).toMatchObject({ success: true, status: 200, body_text: 'ok' });
  });

  it('passes a diagnose report through, including layer and reason', async () => {
    const { run } = setup({
      success: true,
      data: { allowed: false, url: 'http://127.0.0.1/x', host: '127.0.0.1',
        mode: 'balanced', layer: 'policy', reason: 'host_literal_non_global',
        remediation: 'Use a public host.',
        checks: [{ name: 'url', ok: true, detail: 'parsed' }] },
    });
    const details = await run('diagnose_url', { url: 'http://127.0.0.1/x' });
    expect(details).toMatchObject({
      success: true, allowed: false, layer: 'policy',
      reason: 'host_literal_non_global',
    });
  });
});

describe('download_url material import (AC-G05 / AC-G06)', () => {
  it('publishes exactly one add_materials operation and never twice', async () => {
    const { run, context, operations, recordOperation } = setup({
      success: true, data: { status: 'ready', reused: false, material: MATERIAL },
    });
    const first = await run('download_url',
      { url: 'https://upload.wikimedia.org/a.jpg', kind: 'image' });
    expect(first).toMatchObject({ success: true, already_in_library: false });
    expect(recordOperation).toHaveBeenCalledTimes(1);
    const operation = operations.get('call_1') as
      { type: string; materials: unknown[] };
    expect(operation.type).toBe('add_materials');
    expect(operation.materials).toHaveLength(1);
    expect(context.materials).toHaveLength(1);

    const again = await run('download_url',
      { url: 'https://upload.wikimedia.org/a.jpg', kind: 'image' }, 'call_2');
    expect(again).toMatchObject({ success: true, already_in_library: true });
    expect(recordOperation).toHaveBeenCalledTimes(1);
    expect(context.materials).toHaveLength(1);
  });

  it('reports size 0 as material_not_materialized, never as success', async () => {
    const { run, recordOperation, context } = setup({
      success: true,
      data: { status: 'ready', reused: false,
        material: { ...MATERIAL, size: 0 } },
    });
    const details = await run('download_url',
      { url: 'https://e.com/a.jpg', kind: 'image' });
    expect(details).toMatchObject({
      success: false, error_code: 'material_not_materialized',
      error_details: { failure_class: 'policy', retryable: false },
    });
    expect(recordOperation).not.toHaveBeenCalled();
    expect(context.materials).toHaveLength(0);
  });

  it('refuses a local_url outside the cache folder', async () => {
    const { run, recordOperation } = setup({
      success: true,
      data: { status: 'ready', reused: false,
        material: { ...MATERIAL, local_url: 'https://e.com/a.jpg' } },
    });
    const details = await run('download_url',
      { url: 'https://e.com/a.jpg', kind: 'image' });
    expect(details.error_code).toBe('invalid_local_material');
    expect(recordOperation).not.toHaveBeenCalled();
  });

  it('keeps import_to_library:false descriptive only', async () => {
    const { run, recordOperation } = setup({
      success: true, data: { status: 'ready', reused: false, material: MATERIAL },
    });
    await run('download_url', { url: 'https://e.com/a.jpg', kind: 'image',
      import_to_library: false });
    expect(recordOperation).not.toHaveBeenCalled();
  });
});

describe('per-turn egress budget (AC-G22a)', () => {
  function capability(maxPerTurn: number): HostCapabilitySnapshot {
    return {
      enabled: true,
      shell: { enabled: true, scope: 'workspace', timeoutSeconds: 60, maxOutputKb: 64 },
      fs: { enabled: true, maxBytes: 4_096, readRoots: [], writeRoots: [] },
      egress: { enabled: true, mode: 'balanced',
        proxy: { mode: 'auto', resolvedFrom: 'direct', target: '' },
        maxBytes: 8 * 1024 * 1024, maxPerTurn, maxPerMinute: 120 },
    };
  }

  const diagnosis = { success: true, data: { allowed: true, checks: [] } };

  it(`fails the ${DEFAULT_EGRESS_MAX_PER_TURN + 1}th call and keeps editing tools`, async () => {
    const { run, urls, context } = setup(diagnosis);
    for (let index = 0; index < DEFAULT_EGRESS_MAX_PER_TURN; index += 1) {
      const details = await run('diagnose_url', { url: `https://e.com/${index}` },
        `call_${index}`);
      expect(details.success).toBe(true);
    }
    const blocked = await run('diagnose_url', { url: 'https://e.com/x' }, 'call_61');
    expect(blocked).toMatchObject({
      success: false, error_code: 'egress_budget_exceeded',
      error_details: { failure_class: 'transient', retryable: false },
    });
    expect(urls).toHaveLength(DEFAULT_EGRESS_MAX_PER_TURN);

    // 纯剪辑与本机工具不受影响：预算只关出口，不关整轮。
    const [bash] = createHostTools(context);
    const shell = (await bash.execute('call_shell', { command: 'echo hi' } as never))
      .details as Details;
    expect(shell.success).toBe(true);
  });

  it('reads the limit from hostCapabilities.egress.maxPerTurn', async () => {
    const { run, urls } = setup(diagnosis, { hostCapabilities: capability(2) });
    await run('diagnose_url', { url: 'https://e.com/1' }, 'call_1');
    await run('diagnose_url', { url: 'https://e.com/2' }, 'call_2');
    const third = await run('diagnose_url', { url: 'https://e.com/3' }, 'call_3');
    expect(third.error_code).toBe('egress_budget_exceeded');
    expect(urls).toHaveLength(2);
  });

  it('restarts the count on a fresh turn state', async () => {
    const { run, context, urls } = setup(diagnosis,
      { hostCapabilities: capability(1) });
    await run('diagnose_url', { url: 'https://e.com/1' }, 'call_1');
    expect((await run('diagnose_url', { url: 'https://e.com/2' }, 'call_2')).error_code)
      .toBe('egress_budget_exceeded');
    context.turnState = {};
    const fresh = await run('diagnose_url', { url: 'https://e.com/3' }, 'call_3');
    expect(fresh.success).toBe(true);
    expect(urls).toHaveLength(2);
  });
});
