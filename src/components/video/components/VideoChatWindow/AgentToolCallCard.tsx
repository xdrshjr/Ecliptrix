'use client';

import React, { useState } from 'react';
import type { AgentToolCallRecord } from '@/types';
import { COVER_CARD_ACTION_EVENT, type CoverCardActionDetail,
  type CoverOperationStatus } from '@/lib/video-editing-agent/types';
import { useLocale } from '@/contexts/LocaleContext';

/** Business status stays visible even after the tool invocation finished. */
export function CoverToolStatus({ toolCall }: { toolCall: AgentToolCallRecord }) {
  const { t } = useLocale();
  const result = toolCall.result && typeof toolCall.result === 'object'
    ? toolCall.result as Record<string, unknown> : {};
  const status = result.coverStatus as CoverOperationStatus | undefined;
  const state = status?.state ?? (result.status === 'queued'
    ? 'submitted' : result.status === 'draft_ready' ? 'not_applied'
      : result.status === 'succeeded' ? 'image_ready' : null);
  if (!state) return null;
  const label = t.coverStudio[state];
  // Only controller-issued context enables actions; model parameters and old
  // history without project identity must never choose the destination project.
  const projectId = typeof status?.projectId === 'string' && status.projectId.trim()
    ? status.projectId : undefined;
  const revisionId = typeof status?.revisionId === 'string' && status.revisionId.trim()
    ? status.revisionId : undefined;
  const thumbnailUrl = typeof status?.thumbnailUrl === 'string' &&
    status.thumbnailUrl.startsWith('/api/storage/files/') ? status.thumbnailUrl : undefined;
  const ready = state === 'image_ready' || state === 'not_applied' || state === 'applied';
  const dispatch = (action: CoverCardActionDetail['action']) => {
    if (!projectId || !toolCall.id || (action !== 'edit' && !revisionId)) return;
    const detail: CoverCardActionDetail = { projectId, operationId: toolCall.id, action,
      ...(revisionId ? { revisionId } : {}) };
    // The project-mounted listener rechecks project identity and timeline locks.
    window.dispatchEvent(new CustomEvent<CoverCardActionDetail>(COVER_CARD_ACTION_EVENT, { detail }));
  };
  return <div className="px-3 py-2 text-xs border-t border-border"
    role="status" aria-live="polite">
    {thumbnailUrl && <img src={thumbnailUrl} alt={t.coverStudio.preview}
      loading="lazy" className="mb-2 max-h-28 max-w-full rounded border border-border object-contain" />}
    <span className={state === 'applied' ? 'text-green-600' : 'text-muted-foreground'}>
      {t.coverStudio.title} · {label}
    </span>
    {!!(status?.jobId ?? result.jobId) && <code className="ml-2 text-muted-foreground">
      {String(status?.jobId ?? result.jobId)}
    </code>}
    {status?.error && <p className="mt-1 text-destructive">
      {t.coverStudio.errors[status.error] ?? status.error}
    </p>}
    {ready && <div className="mt-2 flex flex-wrap gap-2">
      {(['edit', ...(revisionId ? ['apply'] : []),
        ...(state === 'applied' && revisionId ? ['locate'] : [])] as CoverCardActionDetail['action'][])
        .map(action => <button key={action} type="button" disabled={!projectId || !toolCall.id}
          className="rounded border border-border px-2 py-1 hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => dispatch(action)}>
          {action === 'edit' ? t.coverStudio.editCover
            : action === 'apply' ? t.coverStudio.apply : t.coverStudio.locate}
        </button>)}
    </div>}
  </div>;
}

interface AgentToolCallCardProps {
  toolCall: AgentToolCallRecord;
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  get_timeline: 'Get Timeline',
  search_materials: 'Search Materials',
  add_to_track: 'Add to Track',
  trim_clip: 'Trim Clip',
  delete_clip: 'Delete Clip',
  move_clip: 'Move Clip',
  resize_clip: 'Resize Clip',
};

function formatParamValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function formatResult(result: unknown): string {
  if (!result) return '';
  if (typeof result === 'string') return result;
  if (typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    // Show success/message if available
    if ('success' in obj && 'message' in obj) {
      return String(obj.message);
    }
    if ('success' in obj && 'error' in obj) {
      return String(obj.error);
    }
    if ('content' in obj) return String(obj.content);
    return JSON.stringify(result, null, 2);
  }
  return String(result);
}

/** @deprecated Use timeline/AgentExecutionNode instead. */
const AgentToolCallCard: React.FC<AgentToolCallCardProps> = ({ toolCall }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const displayName = TOOL_DISPLAY_NAMES[toolCall.name] || toolCall.name;
  const resultText = toolCall.result ? formatResult(toolCall.result) : '';

  return (
    <div className="border border-border rounded-md overflow-hidden bg-muted/50 text-sm">
      {/* Header */}
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors text-left"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* Status icon */}
        {toolCall.status === 'executing' && (
          <svg className="w-3.5 h-3.5 text-primary animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )}
        {toolCall.status === 'completed' && (
          <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
        {toolCall.status === 'error' && (
          <svg className="w-3.5 h-3.5 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
        {toolCall.status === 'cancelled' && (
          <svg className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}

        {/* Tool name */}
        <span className="font-medium text-foreground">{displayName}</span>

        {/* Brief result (collapsed) */}
        {!isExpanded && resultText && (
          <span className="text-muted-foreground truncate flex-1 text-xs">
            {resultText.slice(0, 60)}{resultText.length > 60 ? '...' : ''}
          </span>
        )}

        {/* Expand indicator */}
        <svg
          className={`w-3 h-3 text-muted-foreground flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {toolCall.name.endsWith('_video_cover') && <CoverToolStatus toolCall={toolCall} />}

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-3 pb-2 border-t border-border space-y-1.5 pt-2">
          {/* Params */}
          {Object.keys(toolCall.params).length > 0 ? (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Parameters</div>
              <div className="bg-background rounded px-2 py-1.5 text-xs font-mono space-y-0.5">
                {Object.entries(toolCall.params).map(([key, val]) => {
                  const displayVal = formatParamValue(val);
                  return (
                    <div key={key} className="flex gap-1">
                      <span className="text-primary">{key}:</span>
                      <span className="text-foreground break-all">{displayVal}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Result */}
          {toolCall.result != null && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Result</div>
              <div className="bg-background rounded px-2 py-1.5 text-xs font-mono text-foreground break-all whitespace-pre-wrap max-h-32 overflow-y-auto">
                {resultText}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AgentToolCallCard;
