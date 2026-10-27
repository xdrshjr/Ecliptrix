import { Type } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { createWebTools } from '../tools/webTools';
import { createResearchArtifactTool } from '../tools/researchArtifactTool';
import { cleanText } from './verifyReport';

export const SUBMIT_REPORT_TOOL = 'submit_report';

/**
 * The only tools a research crew member may hold. Read-only by construction:
 * nothing here downloads, edits, asks the user or writes memory, and
 * `delegate_research` is absent so depth is capped at one without a counter.
 * `web_research` (its own model calls) and `browser_*` (one session per run)
 * are excluded on purpose; see crew spec §3.3.3.
 */
export const CREW_TOOL_ALLOWLIST: readonly string[] = [
  'web_search', 'web_fetch', 'extract_web_images', 'read_research_artifact', SUBMIT_REPORT_TOOL,
];

/**
 * Deliberately loose: a model that overshoots a length bound would otherwise
 * burn one of its few turns on a validation error. `verifyReport` truncates.
 */
const reportSchema = Type.Object({
  summary: Type.String(),
  candidates: Type.Optional(Type.Array(Type.Object({
    candidate_id: Type.Optional(Type.String()), url: Type.String(), kind: Type.String(),
    title: Type.Optional(Type.String()), source_page_url: Type.Optional(Type.String()),
    license_hint: Type.Optional(Type.String()), why: Type.Optional(Type.String()),
  }), { maxItems: 12 })),
  sources: Type.Optional(Type.Array(Type.Object({
    url: Type.String(), title: Type.Optional(Type.String()),
  }), { maxItems: 8 })),
  gaps: Type.Optional(Type.Array(Type.String(), { maxItems: 6 })),
});

/** The member-private terminating tool: it only hands the report to the closure. */
export function createSubmitReportTool(onReport: (report: unknown) => void): AgentTool {
  return {
    name: SUBMIT_REPORT_TOOL, label: SUBMIT_REPORT_TOOL,
    description: 'Submit the final research report for your task, then stop. Only url and candidate_id values returned by your tools are accepted; anything else is discarded.',
    parameters: reportSchema,
    execute: async (_callId, params) => {
      onReport(params);
      return { content: [{ type: 'text' as const, text: 'report received' }],
        details: { received: true } };
    },
  };
}

function forbidSideEffect(): never {
  throw new Error('crew_forbidden_side_effect');
}

/**
 * The context a member's tools run with (crew spec §3.3.3, reviews R-03/R-04).
 * `callBudget` and `researchRun` stay the parent's own objects so call ids are
 * counted once and candidates stay downloadable by the parent; `turnState` is a
 * private empty object; the abort signal is the member's own, so one slow
 * member can be cut off without closing the shared run.
 */
export function deriveMemberContext(parent: ToolContext, memberSignal: AbortSignal): ToolContext {
  return {
    ...parent,
    operations: new Map(),
    updateTimeline: forbidSideEffect,
    recordOperation: forbidSideEffect,
    turnState: {},
    abortSignal: memberSignal,
    // Depth is capped structurally: a member can neither emit UI events,
    // load tools, nor reach the crew settings that would let it delegate.
    emit: undefined,
    loadTools: undefined,
    crewRuntime: undefined,
  };
}

/** Builds the allowlisted member toolset on a derived context. */
export function createMemberTools(context: ToolContext, onReport: (report: unknown) => void): AgentTool[] {
  const web = createWebTools(context).filter(tool => CREW_TOOL_ALLOWLIST.includes(tool.name));
  // The artifact tool is typed with its own parameter schema; the member only
  // needs the common AgentTool surface.
  const artifact = createResearchArtifactTool(context) as unknown as AgentTool;
  return [...web, artifact, createSubmitReportTool(onReport)];
}

function hostOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { return cleanText(new URL(value).hostname, 40) || null; } catch { return null; }
}

/**
 * Short, sanitised activity code for the progress event: `search:<query>`,
 * `read:<host>`, `images:<host>`, `report` or `work`, so the client can
 * localise it. Never the full URL or page text: those are untrusted and would
 * reach the UI renderer.
 */
export function describeActivity(toolName: string, params: unknown): string {
  const args = (typeof params === 'object' && params !== null ? params : {}) as Record<string, unknown>;
  switch (toolName) {
    case 'web_search': return `search:${cleanText(args.query, 40)}`;
    case 'web_fetch': return `read:${hostOf(args.url) ?? 'archive'}`;
    case 'extract_web_images': return `images:${hostOf(args.url) ?? 'browser'}`;
    case 'read_research_artifact': return 'read:archive';
    case SUBMIT_REPORT_TOOL: return 'report';
    default: return 'work';
  }
}
