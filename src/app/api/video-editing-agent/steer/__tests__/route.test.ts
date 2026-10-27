import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';
import {
  SteerError, registerRun, resetRunRegistryForTests, unregisterRun, type AgentRunHandle,
} from '@/lib/server/agentRunRegistry';

const ORIGIN = 'http://localhost:3000';
const SENTINEL = 'SENTINEL-body-text-4711';

function request(body: unknown, headers: Record<string, string> = {}, raw?: string) {
  return new NextRequest('http://localhost:3000/api/video-editing-agent/steer', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    body: raw ?? JSON.stringify(body),
  });
}

function handle(
  runId: string,
  behaviour: (input: { steerId: string }) => void = () => undefined,
): AgentRunHandle {
  return {
    runId, pendingCount: () => 0, close: () => undefined,
    steer: input => { behaviour(input); return { steerId: input.steerId, position: 1 }; },
  };
}

const valid = { runId: 'run-abcdef12', steerId: 'steer-00000001', text: SENTINEL };

describe('POST /api/video-editing-agent/steer', () => {
  beforeEach(() => resetRunRegistryForTests());
  afterEach(() => vi.restoreAllMocks());

  it('accepts a steer with 202 and the queue position', async () => {
    registerRun(handle('run-abcdef12'));
    const response = await POST(request(valid));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      success: true, data: { steerId: 'steer-00000001', position: 1 } });
  });

  it('answers 415 json_required BEFORE the origin check when Content-Type is missing', async () => {
    registerRun(handle('run-abcdef12'));
    const response = await POST(
      request(valid, { 'content-type': 'text/plain', origin: 'http://evil.test' }));
    expect(response.status).toBe(415);
    expect((await response.json()).error_code).toBe('json_required');
  });

  it.each([
    ['foreign origin', { origin: 'http://evil.test' }],
    ['cross-site fetch', { 'sec-fetch-site': 'cross-site' }],
  ])('answers 403 for %s', async (_label, headers) => {
    registerRun(handle('run-abcdef12'));
    expect((await POST(request(valid, headers))).status).toBe(403);
  });

  it('answers 403 when the Origin header is absent', async () => {
    registerRun(handle('run-abcdef12'));
    const noOrigin = new NextRequest('http://localhost:3000/api/video-editing-agent/steer', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(valid),
    });
    expect((await POST(noOrigin)).status).toBe(403);
  });

  it('answers 404 for an unknown run and 409 for a closed one', async () => {
    expect((await POST(request(valid))).status).toBe(404);
    registerRun(handle('run-abcdef12', () => { throw new SteerError('run_closed'); }));
    const closed = await POST(request(valid));
    expect(closed.status).toBe(409);
    expect((await closed.json()).error_code).toBe('run_closed');
  });

  it.each([
    ['steer_queue_full', 429], ['duplicate_steer', 409], ['invalid_steer', 422],
  ] as const)('maps %s to %i', async (code, status) => {
    registerRun(handle('run-abcdef12', () => { throw new SteerError(code); }));
    expect((await POST(request(valid))).status).toBe(status);
  });

  it('keeps an unregistered run answerable as run_closed within the TTL', async () => {
    registerRun(handle('run-abcdef12', () => { throw new SteerError('run_closed'); }));
    unregisterRun('run-abcdef12');
    expect((await POST(request(valid))).status).toBe(409);
  });

  it('answers 422 for malformed or oversized bodies', async () => {
    registerRun(handle('run-abcdef12'));
    expect((await POST(request(null, {}, '{not json'))).status).toBe(422);
    expect((await POST(request({ ...valid, text: 5 }))).status).toBe(422);
    expect((await POST(request({ ...valid, text: 'x'.repeat(20_000) }))).status).toBe(422);
  });

  it('never writes the steer text to the console (AC-A8)', async () => {
    registerRun(handle('run-abcdef12'));
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const)
      .map(method => vi.spyOn(console, method).mockImplementation(() => undefined));
    await POST(request(valid));
    await POST(request({ ...valid, steerId: 'x' }));
    const printed = spies.flatMap(spy => spy.mock.calls).flat().join(' ');
    expect(printed).not.toContain(SENTINEL);
    expect(printed).toContain('run-abcd');
  });
});
