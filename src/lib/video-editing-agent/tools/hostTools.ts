import { Type, type TSchema } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import {
  executeHostTool, HOST_CALL_TIMEOUT_MS, SHELL_TIMEOUT_MARGIN_MS, withProjectId,
} from './hostToolAdapter';

/**
 * `host_tools`：本机命令与文件操作（`bash`、`read_file`、`write_file`、
 * `edit_file`、`list_dir`、`glob`、`grep`）。
 *
 * 设计基线：docs/plans/agent-general-assistant/spec.md §4.4 / §4.5 / §4.7
 * 与 §6 的参数约束。七个工具名与 `aragon-agent-core` 的宿主工具同名同义
 * （§1.2，REV-P2-6 的限定只涉及另外三个出口工具）。
 *
 * 这不是沙箱：命令以用户本人权限执行，路径白名单只限定"允许读写的目录"。
 * 工具描述必须把这一点、Windows 上没有 bash、以及"被拒时要报 reason 与
 * remediation"说清楚——模型是照着描述写命令的。
 */

const shortText = (maxLength: number) =>
  Type.String({ minLength: 1, maxLength });
const object = (properties: Record<string, TSchema>) =>
  Type.Object(properties, { additionalProperties: false });

/** §6 参数约束：`path` ≤1024、`pattern` ≤512、`command` ≤8000。 */
const PATH_MAX = 1_024;
const PATTERN_MAX = 512;
/** `grep.glob` 只匹配单个文件名，后端上限 256（比 `pattern` 更窄）。 */
const GLOB_MAX = 256;
const COMMAND_MAX = 8_000;
/** `write_file` 的内容上限：与 BFF 的 2 MiB 请求体同一个数（§6）。 */
const CONTENT_MAX = 2 * 1024 * 1024;
/** `edit_file.old_string` 与后端 `FsEditRequest` 同一个上限（64 KiB）。 */
const OLD_STRING_MAX = 65_536;
const MAX_BYTES_LIMIT = 1_048_576;
/**
 * `read_file.max_bytes` 的下限必须与后端 `FsReadRequest`（`ge=1024`）一致：
 * 前端放宽就是"模型给了 200、后端回 422"的沉默失败（§6 参数约束）。
 */
const MAX_BYTES_FLOOR = 1_024;

/** `timeout_ms` 的允许区间（§6；越界由 BFF 判 400，schema 同一条）。 */
export const SHELL_TIMEOUT_MIN_MS = 1_000;
export const SHELL_TIMEOUT_MAX_MS = 600_000;
/** 未给 `timeout_ms` 时的前端预算：后端缺省 60 s。 */
export const SHELL_DEFAULT_TIMEOUT_MS = 60_000;

/**
 * `bash` 的前端超时 = `timeout_ms + 5 s`（§6 前端映射表）。
 *
 * 之所以不是固定值：后端允许 1 s–600 s 的命令，统一 190 s 会先把长命令掐断
 * （REV-P1-8）。非法或缺省的 `timeout_ms` 落到 60 s 缺省值上，与后端一致。
 *
 * @param timeoutMs - 模型给出的 `timeout_ms`（未知类型，按数字判断）。
 * @returns 前端 fetch 的超时毫秒数（1000+5000 … 600000+5000）。
 */
export function bashTimeoutMs(timeoutMs?: unknown): number {
  const requested = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs)
    ? timeoutMs : SHELL_DEFAULT_TIMEOUT_MS;
  return requested + SHELL_TIMEOUT_MARGIN_MS;
}

interface HostToolSpec {
  name: string;
  path: string;
  description: string;
  schema: TSchema;
  /** 按参数算前端超时；缺省用 `HOST_CALL_TIMEOUT_MS`（15 s）。 */
  timeout?: (params: Record<string, unknown>) => number;
}

const SHELL_DESCRIPTION =
  'Run one command on the user\'s machine. Windows runs it with cmd.exe '
  + '(%COMSPEC% /d /s /c): there is no bash, so no && chains, single quotes, '
  + '-y flags or $VAR syntax; POSIX runs /bin/sh -lc. Not a sandbox: the '
  + 'command has the user\'s own rights. A non-zero exit code is normal, '
  + 'not a tool error. Refused or failed: quote error_details.reason and '
  + 'remediation instead of guessing.';

const HOST_TOOL_SPECS: HostToolSpec[] = [
  {
    name: 'bash',
    path: '/shell/run',
    description: SHELL_DESCRIPTION,
    schema: object({
      command: shortText(COMMAND_MAX),
      cwd: Type.Optional(shortText(PATH_MAX)),
      timeout_ms: Type.Optional(Type.Integer({
        minimum: SHELL_TIMEOUT_MIN_MS, maximum: SHELL_TIMEOUT_MAX_MS,
      })),
    }),
    timeout: params => bashTimeoutMs(params.timeout_ms),
  },
  {
    name: 'read_file',
    path: '/fs/read',
    description:
      'Read a text file from an allowed folder, paged by bytes; the byte '
      + 'offset and next_offset cover the rest. Binary content answers '
      + 'binary_file. Find the path first with list_dir, glob or grep.',
    schema: object({
      path: shortText(PATH_MAX),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      max_bytes: Type.Optional(Type.Integer({
        minimum: MAX_BYTES_FLOOR, maximum: MAX_BYTES_LIMIT,
      })),
    }),
  },
  {
    name: 'write_file',
    path: '/fs/write',
    description:
      'Write one text file inside an allowed folder, creating parent folders. '
      + 'Not a sandbox: a path outside the configured roots is refused with '
      + 'path_forbidden. An existing file is refused unless overwrite:true; '
      + 'the content limit is 2 MiB.',
    schema: object({
      path: shortText(PATH_MAX),
      content: Type.String({ maxLength: CONTENT_MAX }),
      overwrite: Type.Optional(Type.Boolean()),
    }),
  },
  {
    name: 'edit_file',
    path: '/fs/edit',
    description:
      'Replace old_string with new_string in one file and return a diff. '
      + 'old_string must occur exactly once unless replace_all is true; '
      + 'otherwise edit_not_unique (409) and the file is left untouched.',
    schema: object({
      path: shortText(PATH_MAX),
      old_string: shortText(OLD_STRING_MAX),
      new_string: Type.String({ maxLength: CONTENT_MAX }),
      replace_all: Type.Optional(Type.Boolean()),
    }),
  },
  {
    name: 'list_dir',
    path: '/fs/list',
    description:
      'List one folder with entry name, type and size. Use it before writing '
      + 'or after a shell command moved files.',
    schema: object({ path: shortText(PATH_MAX) }),
  },
  {
    name: 'glob',
    path: '/fs/glob',
    description:
      'Find files by glob pattern (for example **/*.ts) under an allowed '
      + 'folder, returning path, type, size and mtime.',
    schema: object({
      pattern: shortText(PATTERN_MAX),
      cwd: Type.Optional(shortText(PATH_MAX)),
    }),
  },
  {
    name: 'grep',
    path: '/fs/grep',
    description:
      'Search file contents by regular expression and return path, line and '
      + 'text. Narrow the scan with path or glob; the backend caps the scan '
      + 'timeout, so keep the pattern simple.',
    schema: object({
      pattern: shortText(PATTERN_MAX),
      path: Type.Optional(shortText(PATH_MAX)),
      glob: Type.Optional(shortText(GLOB_MAX)),
      ignore_case: Type.Optional(Type.Boolean()),
    }),
  },
];

/**
 * `write_file` 的请求体。
 *
 * `create_parents` 恒为 true：工具描述承诺"自动建父目录"。`overwrite` 原样
 * 透传——后端 `FsWriteRequest.overwrite` 缺省是 **false**（I-7），所以这里
 * 丢掉 `overwrite:true` 就等于"模型永远无法覆盖已有文件"，而它明明照着
 * 工具描述传了。
 */
function writeBody(params: Record<string, unknown>) {
  return { ...params, create_parents: true };
}

function bodyFor(spec: HostToolSpec, params: Record<string, unknown>) {
  return spec.name === 'write_file' ? writeBody(params) : params;
}

/**
 * 创建本机能力工具。
 *
 * @param context - 本轮工具上下文（工程 id、abortSignal、出口预算）。
 * @returns 七个 `AgentTool`，由 `tools/index.ts` 注册进 `host_tools` 类别。
 */
export function createHostTools(context: ToolContext): AgentTool[] {
  return HOST_TOOL_SPECS.map(spec => ({
    name: spec.name,
    label: spec.name,
    description: spec.description,
    parameters: spec.schema,
    execute: async (id: string, params: unknown) => {
      const input = params as Record<string, unknown>;
      return executeHostTool(context, id, {
        path: spec.path,
        timeout: spec.timeout?.(input) ?? HOST_CALL_TIMEOUT_MS,
        body: withProjectId(context, bodyFor(spec, input)),
      });
    },
  }));
}
