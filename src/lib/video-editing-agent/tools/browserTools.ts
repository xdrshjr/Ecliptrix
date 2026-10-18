import { Type } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { executeWebTool } from './webToolAdapter';

const session_id = Type.String({ format: 'uuid' });
const snapshot_version = Type.Integer({ minimum: 1 });
const element_ref = Type.String({ minLength: 1, maxLength: 64 });
const act = Type.Union([
  Type.Object({ session_id, snapshot_version, action: Type.Literal('click'), element_ref }, { additionalProperties: false }),
  Type.Object({ session_id, snapshot_version, action: Type.Literal('fill'), element_ref,
    text: Type.String({ maxLength: 256 }) }, { additionalProperties: false }),
  Type.Object({ session_id, snapshot_version, action: Type.Literal('press'), element_ref,
    key: Type.Literal('Enter') }, { additionalProperties: false }),
  Type.Object({ session_id, snapshot_version, action: Type.Literal('scroll'),
    delta_y: Type.Integer({ minimum: -1440, maximum: 1440 }) }, { additionalProperties: false }),
], { type: 'object' });

export function createBrowserTools(context: ToolContext): AgentTool[] {
  return [
    { name: 'browser_open', label: 'browser_open',
      description: 'Open a public dynamic page in an isolated browser. No login. Call browser_read for fresh element references.',
      parameters: Type.Object({ url: Type.String({ minLength: 1, maxLength: 4096 }) }, { additionalProperties: false }),
      execute: (id, params) => executeWebTool(context, id, { path: '/browser/open', body: params }) },
    { name: 'browser_read', label: 'browser_read',
      description: 'Read current page text and fresh element references. Optional screenshot returns an artifact ID, never image bytes.',
      parameters: Type.Object({ session_id, max_bytes: Type.Optional(Type.Integer({ minimum: 500, maximum: 8000 })),
        screenshot: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
      execute: (id, params) => executeWebTool(context, id, { path: '/browser/read', body: params, timeout: 15000 }) },
    { name: 'browser_act', label: 'browser_act',
      description: 'Use the latest snapshot version to click public links, fill a public search field, press Enter there, or scroll. Stale refs require browser_read.',
      parameters: act,
      execute: (id, params) => executeWebTool(context, id, { path: '/browser/act', body: params }) },
    { name: 'browser_close', label: 'browser_close',
      description: 'Close the browser session and release its resources. Does not change the editor.',
      parameters: Type.Object({ session_id }, { additionalProperties: false }),
      execute: (id, params) => executeWebTool(context, id, {
        path: `/browser/${(params as { session_id: string }).session_id}`, method: 'DELETE', timeout: 5000 }) },
  ];
}
