'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { AgentToolCallRecord } from '@/types';
import type { Translations } from '@/lib/i18n';
import { sendPrefilledMessage } from '@/lib/video-editing-agent/prefilledMessage';
import { useLiveProgress } from '@/components/video/hooks/useCrewProgress';
import {
  parseAcquireResult, requestedItemCount, toolFailureCode,
  type AcquireItemStatus, type AcquireItemView,
} from './liveCardData';

/**
 * AcquireProgress — the `acquire_web_materials` tool node: one slot per
 * requested item that fills in as the batch settles, then a summary with a
 * per-item "ask the agent to retry" action.
 *
 * Spec: docs/plans/agent-research-crew-and-context-memory/spec.md §4.2.
 * Retry only fills the message box (`sendPrefilledMessage`): sending it would
 * start a billable turn without the user's say-so.
 */

type SlotState = AcquireItemStatus | 'pending';

const GLYPH: Record<SlotState, string> = {
  pending: '…', ready: '✓', already_in_library: '✓', failed: '×', skipped: '–',
};
const TONE: Record<SlotState, string> = {
  pending: 'text-muted-foreground',
  ready: 'text-green-600 dark:text-green-400',
  already_in_library: 'text-green-600 dark:text-green-400',
  failed: 'text-red-600 dark:text-red-400',
  skipped: 'text-muted-foreground',
};

function statusLabel(state: SlotState, copy: Translations['agentAcquire']): string {
  switch (state) {
    case 'pending': return copy.item.pending;
    case 'ready': return copy.item.ready;
    case 'already_in_library': return copy.item.already;
    case 'failed': return copy.item.failed;
    case 'skipped': return copy.item.skipped;
  }
}

function errorLabel(code: string | undefined, copy: Translations['agentAcquire']): string {
  if (!code) return '';
  const known = Object.prototype.hasOwnProperty.call(copy.error, code);
  return copy.error[(known ? code : 'unknown') as keyof typeof copy.error];
}

function Slot({ index, state, item, copy }: {
  index: number; state: SlotState; item?: AcquireItemView;
  copy: Translations['agentAcquire'];
}) {
  const label = statusLabel(state, copy);
  const detail = state === 'failed' || state === 'skipped'
    ? errorLabel(item?.errorCode, copy) : item?.name;
  return (
    <li className="min-w-0 rounded border border-border bg-background p-1.5" aria-label={`#${index} ${label}`}>
      <p className="flex items-center gap-1">
        <span aria-hidden="true" className={`font-mono ${TONE[state]}`}>{GLYPH[state]}</span>
        <span className="text-muted-foreground">#{index}</span>
      </p>
      {detail && <p className="truncate" title={detail}>{detail}</p>}
      {item?.licenseStatus === 'unknown' && (
        <span className="rounded border border-border px-1 text-[10px] text-amber-700 dark:text-amber-300">
          {copy.licenseUnknown}
        </span>
      )}
    </li>
  );
}

// Over 50 lines: the JSX of one card; every decision it makes lives in the helpers above.
export default function AcquireProgress({ toolCall }: { toolCall: AgentToolCallRecord }) {
  const { t } = useLocale();
  const copy = t.agentAcquire;
  const live = useLiveProgress().acquire[toolCall.id];
  const failure = toolCall.result === undefined ? null : toolFailureCode(toolCall.result);
  const view = failure ? null : parseAcquireResult(toolCall.result);
  const requested = view?.requested ?? live?.total ?? requestedItemCount(toolCall.params);
  const itemsByIndex = new Map((view?.items ?? []).map(item => [item.index, item]));
  const indexes = view ? view.items.map(item => item.index)
    : Array.from({ length: requested }, (_, index) => index);
  const stateOf = (index: number): SlotState =>
    itemsByIndex.get(index)?.status ?? live?.slots[index] ?? 'pending';
  const settled = view ? view.items.length : live?.done ?? 0;
  const retryable = (view?.items ?? []).filter(
    item => item.status === 'failed' && item.retryable !== false);

  return (
    <section aria-label={copy.title.replace('{done}', String(settled)).replace('{total}', String(requested))}
      className="min-w-0 max-w-full overflow-hidden rounded-md border border-border bg-muted/40 p-3 text-xs text-foreground">
      <p className="font-medium">
        {copy.title.replace('{done}', String(settled)).replace('{total}', String(requested))}
      </p>
      {failure && <p className="mt-1 text-red-600 dark:text-red-400">× {errorLabel(failure, copy) || failure}</p>}
      {!failure && (
        <ul className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {indexes.map(index => (
            <Slot key={index} index={index} state={stateOf(index)}
              item={itemsByIndex.get(index)} copy={copy} />
          ))}
        </ul>
      )}
      {view && (
        <p className="mt-2 text-muted-foreground">
          {copy.summary.replace('{ready}', String(view.ready)).replace('{failed}', String(view.failed))}
        </p>
      )}
      {view && !view.published && view.ready > 0 && (
        <p className="mt-1 text-amber-700 dark:text-amber-300">{copy.unpublished}</p>
      )}
      {retryable.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-2">
          {retryable.map(item => (
            <button key={item.index} type="button" title={copy.retryHint}
              aria-label={`${copy.retry} #${item.index}`}
              onClick={() => sendPrefilledMessage(copy.retryMessage.replace('{n}', String(item.index)))}
              className="rounded border border-border px-2 py-1 hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
              {copy.retry} #{item.index}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
