// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentOperation, ToolContext } from '../../types';
import type { TimelineState } from '@/types';
import { CORE_TOOLKIT_TOOL_NAMES, GENERAL_RESIDENT_TOOL_NAMES } from '../../promptParts';
import { ToolActivationState } from '../../registry/ToolActivationState';
import { buildAllAgentTools, createToolRegistry } from '../index';
import {
  bashTimeoutMs, createHostTools, SHELL_DEFAULT_TIMEOUT_MS,
  SHELL_TIMEOUT_MAX_MS, SHELL_TIMEOUT_MIN_MS,
} from '../hostTools';

/**
 * `host_tools` 的契约：七个工具、端点与参数映射、结构化失败（AC-G08 /
 * AC-G12 / AC-G13 的前端一侧），以及常驻名单的边界（AC-G16）。
 */

type Details = Record<string, unknown> & {
  error_details?: Record<string, unknown>;
  error_code?: string;
};

interface Recorded {
  url: string;
  body: Record<string, unknown>;
}

function ok(data: Record<string, unknown>) {
  return { success: true, data };
}

function setup(envelope: unknown = ok({ exit_code: 0 }), status = 200) {
  const calls: Recorded[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body ?? '{}')) });
    return Response.json(envelope, { status });
  }));
  const operations = new Map<string, AgentOperation>();
  const recordOperation = vi.fn((id: string, operation: AgentOperation) => {
    operations.set(id, operation);
  });
  const context = {
    apiBaseUrl: 'http://127.0.0.1:3000', materials: [], operations, recordOperation,
    turnState: {}, callBudget: { used: 0 }, projectId: 'project-7',
  } as unknown as ToolContext;
  const tools = createHostTools(context);
  const byName = new Map(tools.map(tool => [tool.name, tool]));
  const run = async (name: string, params: unknown, callId = 'call_1') => {
    const tool = byName.get(name);
    if (!tool) throw new Error(`missing tool ${name}`);
    return (await tool.execute(callId, params as never)).details as Details;
  };
  return { calls, context, tools, byName, run, operations, recordOperation };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function emptyTimeline(): TimelineState {
  return {
    currentTime: 0, totalDuration: 0, zoomLevel: 1, selectedItems: [],
    tracks: [], playbackRate: 1, isPlaying: false, snapToGrid: false,
    gridSize: 0.1, scrollLeft: 0,
  };
}

describe('host_tools registry wiring', () => {
  it('registers the seven machine tools with closed schemas', () => {
    const { tools } = setup();
    expect(tools.map(tool => tool.name)).toEqual([
      'bash', 'read_file', 'write_file', 'edit_file', 'list_dir', 'glob', 'grep',
    ]);
    for (const tool of tools) {
      expect(tool.parameters).toMatchObject({ additionalProperties: false });
      expect(tool.description.length).toBeGreaterThan(40);
    }
  });

  it('states the Windows reality and the refusal discipline for bash', () => {
    const { byName } = setup();
    const description = byName.get('bash')!.description;
    expect(description).toContain('cmd.exe');
    expect(description).toContain('no bash');
    expect(description).toContain('Not a sandbox');
    expect(description).toContain('error_details.reason');
    expect(description).toContain('remediation');
  });

  it('keeps list_dir, glob and grep on demand and the four carriers resident', () => {
    // AC-G16：常驻名让 canExecute 恒真；其余三个必须先 explore_tools 装载。
    expect([...GENERAL_RESIDENT_TOOL_NAMES]).toEqual([
      'bash', 'read_file', 'write_file',
      'http_request', 'download_url', 'diagnose_url',
    ]);
    expect(GENERAL_RESIDENT_TOOL_NAMES).not.toContain('list_dir');
    expect(GENERAL_RESIDENT_TOOL_NAMES).not.toContain('glob');
    expect(GENERAL_RESIDENT_TOOL_NAMES).not.toContain('grep');
  });

  it('lets resident bash run while list_dir still needs explore_tools (AC-G16)', async () => {
    const { context } = setup(ok({ exit_code: 0, stdout: 'hi', stderr: '',
      killed: false, shell: 'cmd.exe' }));
    context.timelineState = emptyTimeline();
    const registry = createToolRegistry(context);
    const activation = new ToolActivationState(registry, [
      ...registry.getAlwaysAvailableTools().map(tool => tool.name),
      ...CORE_TOOLKIT_TOOL_NAMES.filter(name => name !== 'ask_user'),
      ...GENERAL_RESIDENT_TOOL_NAMES,
      'explore_tools',
    ]);
    const tools = new Map(buildAllAgentTools(registry, activation)
      .map(tool => [tool.name, tool]));
    // 一个模型响应：常驻名已经在 offer() 里，其余没装载过。
    activation.offer();
    const gated = await tools.get('list_dir')!.execute('call_dir', { path: '.' });
    expect(JSON.stringify(gated.details)).toContain('tool_not_loaded');
    const shell = await tools.get('bash')!.execute('call_sh', { command: 'echo hi' });
    expect((shell.details as Details).success).toBe(true);
  });

  it('bounds timeout_ms to 1s…600s and adds the 5s frontend margin', () => {
    const { byName } = setup();
    const schema = byName.get('bash')!.parameters as unknown as {
      properties: Record<string, { minimum?: number; maximum?: number }>;
    };
    expect(schema.properties.timeout_ms).toMatchObject({
      minimum: SHELL_TIMEOUT_MIN_MS, maximum: SHELL_TIMEOUT_MAX_MS,
    });
    expect(bashTimeoutMs(1_000)).toBe(6_000);
    expect(bashTimeoutMs(600_000)).toBe(605_000);
    expect(bashTimeoutMs(undefined)).toBe(SHELL_DEFAULT_TIMEOUT_MS + 5_000);
    expect(bashTimeoutMs('nope')).toBe(SHELL_DEFAULT_TIMEOUT_MS + 5_000);
  });
});

describe('host_tools endpoint mapping', () => {
  it('runs one command through /shell/run and keeps exit code 1 a result', async () => {
    const { calls, run } = setup(ok({
      exit_code: 1, stdout: 'boom', stderr: '', stdout_truncated: false,
      stderr_truncated: false, duration_ms: 12, cwd: 'C:/work', killed: false,
      shell: 'cmd.exe',
    }));
    const details = await run('bash', { command: 'echo hi', timeout_ms: 1_000 });
    expect(calls[0].url).toBe(`${'http://127.0.0.1:3000'}/api/agent-host/shell/run`);
    expect(calls[0].body).toEqual({ command: 'echo hi', timeout_ms: 1_000,
      project_id: 'project-7' });
    expect(details).toMatchObject({ success: true, exit_code: 1, shell: 'cmd.exe' });
  });

  it('maps every fs tool onto its own endpoint and body', async () => {
    const cases: Array<[string, unknown, string, Record<string, unknown>]> = [
      ['read_file', { path: 'a.md', offset: 10 },
        '/fs/read', { path: 'a.md', offset: 10, project_id: 'project-7' }],
      ['write_file', { path: 'a.md', content: 'hi' }, '/fs/write',
        { path: 'a.md', content: 'hi', create_parents: true, project_id: 'project-7' }],
      ['edit_file', { path: 'a.md', old_string: 'a', new_string: 'b' }, '/fs/edit',
        { path: 'a.md', old_string: 'a', new_string: 'b', project_id: 'project-7' }],
      ['list_dir', { path: '.' }, '/fs/list', { path: '.', project_id: 'project-7' }],
      ['glob', { pattern: '**/*.ts' }, '/fs/glob',
        { pattern: '**/*.ts', project_id: 'project-7' }],
      ['grep', { pattern: 'TODO', ignore_case: true }, '/fs/grep',
        { pattern: 'TODO', ignore_case: true, project_id: 'project-7' }],
    ];
    for (const [name, params, endpoint, body] of cases) {
      const { calls, run } = setup(ok({ ok: true }));
      await run(name, params);
      expect(calls[0].url.endsWith(`/api/agent-host${endpoint}`)).toBe(true);
      expect(calls[0].body).toEqual(body);
    }
  });

  it('forwards overwrite so the model can replace a file it read', async () => {
    // 后端 `FsWriteRequest.overwrite` 缺省是 false（I-7）：把 `true` 丢掉就等于
    // "模型永远覆盖不了已有文件"，而工具描述正是那么承诺的。
    const { calls, run } = setup(ok({ path: 'a.md', bytes: 2, created: true }));
    await run('write_file', { path: 'a.md', content: 'hi', overwrite: true });
    expect(calls[0].body).toMatchObject({ overwrite: true, create_parents: true });
    const fresh = setup(ok({ path: 'a.md', bytes: 2, created: true }));
    await fresh.run('write_file', { path: 'a.md', content: 'hi', overwrite: false });
    expect(fresh.calls[0].body).toMatchObject({
      overwrite: false, create_parents: true,
    });
  });

  it('keeps every numeric bound inside the backend contract (§6)', () => {
    const { byName } = setup();
    const read = byName.get('read_file')!.parameters as unknown as {
      properties: Record<string, { minimum?: number }>;
    };
    // 后端 `FsReadRequest.max_bytes` 是 ge=1024：前端放宽就是 422。
    expect(read.properties.max_bytes).toMatchObject({ minimum: 1_024 });
    const edit = byName.get('edit_file')!.parameters as unknown as {
      properties: Record<string, { maxLength?: number }>;
    };
    expect(edit.properties.old_string).toMatchObject({ maxLength: 65_536 });
    const grep = byName.get('grep')!.parameters as unknown as {
      properties: Record<string, { maxLength?: number }>;
    };
    expect(grep.properties.glob).toMatchObject({ maxLength: 256 });
    expect(grep.properties.pattern).toMatchObject({ maxLength: 512 });
  });
});

describe('host_tools failures', () => {
  it('surfaces reason, remediation and sticky verbatim', async () => {
    const { run } = setup({
      success: false, error_code: 'proxy_config_invalid',
      message: 'proxy URL is invalid',
      error_details: { failure_class: 'configuration', retryable: false,
        reason: 'proxy_config_invalid', layer: 'proxy', sticky: false,
        remediation: 'Fix the proxy URL to scheme://host:port.' },
    }, 403);
    const details = await run('bash', { command: 'echo hi' });
    expect(details).toMatchObject({
      success: false, error_code: 'proxy_config_invalid',
      failureClass: 'configuration',
      error_details: {
        failure_class: 'configuration', retryable: false,
        reason: 'proxy_config_invalid', layer: 'proxy', sticky: false,
        remediation: 'Fix the proxy URL to scheme://host:port.',
      },
    });
  });

  it('keeps edit_not_unique a structured failure instead of an exception', async () => {
    const { run } = setup({
      success: false, error_code: 'edit_not_unique',
      error_details: { failure_class: 'policy', retryable: false,
        remediation: 'Pass a longer, unique old_string.' },
    }, 409);
    const details = await run('edit_file',
      { path: 'a.md', old_string: 'x', new_string: 'y' });
    expect(details.success).toBe(false);
    expect(details.error_code).toBe('edit_not_unique');
    expect(String(details.next_step)).toContain('old_string');
  });

  it('reports a timeout as a retryable transient failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    }));
    const context = {
      apiBaseUrl: 'http://127.0.0.1:3000', materials: [], operations: new Map(),
      recordOperation: vi.fn(), turnState: {}, callBudget: { used: 0 },
    } as unknown as ToolContext;
    const [bash] = createHostTools(context);
    const details = (await bash.execute('call_1', { command: 'sleep' } as never))
      .details as Details;
    expect(details.error_code).toBe('timeout');
    expect(details.error_details).toMatchObject({
      failure_class: 'transient', retryable: true,
    });
  });
});
