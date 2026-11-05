import { Type, type TSchema } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import {
  EGRESS_DIAGNOSE_TIMEOUT_MS, EGRESS_DOWNLOAD_TIMEOUT_MS,
  EGRESS_REQUEST_TIMEOUT_MS, executeHostTool, hostFailure, withProjectId,
} from './hostToolAdapter';

/**
 * `egress_tools`：tier-2 通用出口（`http_request`、`download_url`、
 * `diagnose_url`）。
 *
 * 设计基线：docs/plans/agent-general-assistant/spec.md §4.3 / §4.7 与 §6。
 *
 * 这一层**不认识 run**：没有 `X-Research-Run`、没有 80 call 配额、没有
 * `run_closed`。唯一的预算是前端每回合的 `egress_max_per_turn`（AC-G22a），
 * 用完之后剪辑工具照常工作。
 */

const url = Type.String({ minLength: 1, maxLength: 4_096 });
const shortText = (maxLength: number) =>
  Type.String({ minLength: 1, maxLength });
const object = (properties: Record<string, TSchema>) =>
  Type.Object(properties, { additionalProperties: false });

/** 只有 GET/HEAD 会被后端放行（REV-P0-3：没有请求体，没有写方法）。 */
const READ_METHOD = Type.Union([Type.Literal('GET'), Type.Literal('HEAD')]);

const HTTP_DESCRIPTION =
  'Request any public URL without a research run: GET or HEAD only, no '
  + 'request body, and only accept/accept-language headers are forwarded. '
  + 'Use it for the raw status, headers or bytes of a page or file. A '
  + 'refusal is never "the site blocked us": quote error_details.reason and '
  + 'remediation, and call diagnose_url when the reason names a proxy, DNS '
  + 'or port rule.';

const DOWNLOAD_DESCRIPTION =
  'Download one public image or media file straight into the material '
  + 'library, no research run needed. kind is image or media (generic files '
  + 'are refused with unsupported_media_type). It answers status ready plus '
  + 'material; material.size = 0 means no bytes were written — report that '
  + 'as a failure and never claim it exists. Refused: quote reason and '
  + 'remediation.';

const DIAGNOSE_DESCRIPTION =
  'Explain whether an egress request would be allowed, without downloading '
  + 'anything: url, policy, proxy, dns and robots checks with a reason and '
  + 'the remediation for it. Call it first whenever a request is refused, '
  + 'so the user learns which setting actually blocked it.';

/**
 * 创建 tier-2 出口工具。
 *
 * @param context - 本轮工具上下文（出口预算、素材库、工程 id）。
 * @returns 三个 `AgentTool`，由 `tools/index.ts` 注册进 `egress_tools` 类别。
 */
export function createEgressTools(context: ToolContext): AgentTool[] {
  return [
    httpRequestTool(context), downloadTool(context), diagnoseTool(context),
  ];
}

/** `http_request`：写方法在**发出请求之前**就被拒（`http_write_unsupported`）。 */
function httpRequestTool(context: ToolContext): AgentTool {
  return {
    name: 'http_request',
    label: 'http_request',
    description: HTTP_DESCRIPTION,
    parameters: object({
      method: READ_METHOD,
      url,
      headers: Type.Optional(Type.Record(Type.String(), Type.String())),
      max_bytes: Type.Optional(Type.Integer({
        minimum: 1, maximum: 1_048_576,
      })),
      timeout_ms: Type.Optional(Type.Integer({
        minimum: 1_000, maximum: 120_000,
      })),
      allow_robots: Type.Optional(Type.Boolean()),
    }),
    execute: async (id: string, params: unknown, signal?: AbortSignal) => {
      const input = params as Record<string, unknown>;
      const method = String(input.method ?? 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        return hostFailure('http_write_unsupported', {
          failure_class: 'user_input', retryable: false,
        });
      }
      return executeHostTool(context, id, {
        path: '/egress/request', signal,
        egress: true,
        timeout: EGRESS_REQUEST_TIMEOUT_MS,
        body: withProjectId(context, { ...input, method }),
      });
    },
  };
}

/** `download_url`：成功后把 `material` 变成一次 `add_materials` 操作（AC-G05/06）。 */
function downloadTool(context: ToolContext): AgentTool {
  return {
    name: 'download_url',
    label: 'download_url',
    description: DOWNLOAD_DESCRIPTION,
    parameters: object({
      url,
      name: Type.Optional(shortText(120)),
      kind: Type.Union([Type.Literal('image'), Type.Literal('media')]),
      source_page_url: Type.Optional(url),
      import_to_library: Type.Optional(Type.Boolean()),
    }),
    execute: async (id: string, params: unknown, signal?: AbortSignal) => {
      const input = params as Record<string, unknown>;
      return executeHostTool(context, id, {
        path: '/egress/download', signal,
        egress: true,
        timeout: EGRESS_DOWNLOAD_TIMEOUT_MS,
        // `import_to_library:false` 只取回描述：不发布入库操作。
        importMaterial: input.import_to_library !== false,
        body: withProjectId(context, input),
      });
    },
  };
}

/** `diagnose_url`：纯判定，不抓目标页（robots 只在 `check_robots` 时抓）。 */
function diagnoseTool(context: ToolContext): AgentTool {
  return {
    name: 'diagnose_url',
    label: 'diagnose_url',
    description: DIAGNOSE_DESCRIPTION,
    parameters: object({
      url,
      resolve: Type.Optional(Type.Boolean()),
      check_robots: Type.Optional(Type.Boolean()),
    }),
    execute: async (id: string, params: unknown, signal?: AbortSignal) => executeHostTool(
      context, id, {
      path: '/egress/diagnose', signal,
      egress: true,
      timeout: EGRESS_DIAGNOSE_TIMEOUT_MS,
      body: withProjectId(context, params as Record<string, unknown>),
    }),
  };
}
