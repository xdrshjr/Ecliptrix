'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { AgentToolCallRecord } from '@/types';
import type { CrewMemberState } from '@/lib/video-editing-agent/types';
import type { Translations } from '@/lib/i18n';
import type { LiveCrew } from '@/components/video/hooks/agentLiveProgress';
import { useLiveProgress } from '@/components/video/hooks/useCrewProgress';
import { safeResearchSourceUrl } from '../WebResearchToolCard';
import {
  crewGoalsFromParams, parseCrewActivity, parseCrewResult, toolFailureCode,
  type CrewCandidateView, type CrewResultView, type CrewTaskView,
} from './liveCardData';

/**
 * CrewCard — the `delegate_research` tool node: a live row per member while
 * the crew runs, a one-line summary (expandable) once it has finished.
 *
 * Spec: docs/plans/agent-research-crew-and-context-memory/spec.md §4.1.
 * State is never carried by colour alone: each state has a glyph and an
 * accessible name, and a polite live region announces state transitions only
 * (the fast-changing activity text stays out of it).
 */

interface Row {
  id: string;
  goal: string;
  state: CrewMemberState;
  activity?: string;
  toolCalls: number;
  candidates: number | null;
  elapsedMs: number;
}

const GLYPH: Record<CrewMemberState, string> = {
  queued: '·', running: '…', done: '✓', partial: '!', failed: '×', timeout: '⏱', cancelled: '–',
};
const GLYPH_TONE: Record<CrewMemberState, string> = {
  queued: 'text-muted-foreground', running: 'text-primary',
  done: 'text-green-600 dark:text-green-400', partial: 'text-amber-600 dark:text-amber-400',
  failed: 'text-red-600 dark:text-red-400', timeout: 'text-amber-600 dark:text-amber-400',
  cancelled: 'text-muted-foreground',
};
const TERMINAL: ReadonlySet<CrewMemberState> = new Set<CrewMemberState>(['done', 'partial', 'failed', 'timeout', 'cancelled']);
const CARD = 'min-w-0 max-w-full overflow-hidden rounded-md border border-border bg-muted/40 p-3 text-xs text-foreground';

export function formatClock(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function StateGlyph({ state, label }: { state: CrewMemberState; label: string }) {
  return (
    <span role="img" aria-label={label}
      className={`inline-flex w-4 shrink-0 justify-center font-mono ${GLYPH_TONE[state]}`}>
      {state === 'running'
        ? <>
          <span aria-hidden="true" className="motion-reduce:hidden mt-1 h-2 w-2 animate-pulse rounded-full bg-primary" />
          <span aria-hidden="true" className="hidden motion-reduce:inline">{GLYPH.running}</span>
        </>
        : <span aria-hidden="true">{GLYPH[state]}</span>}
    </span>
  );
}

function describeActivity(activity: string | undefined, copy: Translations['agentCrew']): string {
  const parsed = parseCrewActivity(activity);
  if (!parsed) return activity ?? '';
  const template = copy.activity[parsed.kind];
  return template.replace('{query}', parsed.value).replace('{host}', parsed.value);
}

function Candidate({ item }: { item: CrewCandidateView }) {
  const { t } = useLocale();
  const href = safeResearchSourceUrl(item.url);
  const source = safeResearchSourceUrl(item.sourcePageUrl);
  const host = href ? new URL(href).hostname : '';
  return (
    <li className="min-w-0 break-words">
      <span className="font-medium">{item.title || host}</span>
      <span className="text-muted-foreground"> · {item.kind}{host ? ` · ${host}` : ''}</span>
      {item.licenseHint && (
        <span className="ml-1 rounded border border-border px-1 text-[10px]">{item.licenseHint}</span>
      )}
      {source && (
        <a href={source} target="_blank" rel="noopener noreferrer"
          className="ml-1 text-primary underline underline-offset-2">{t.agentCrew.sourcePage}</a>
      )}
      {item.why && <p className="text-muted-foreground">{item.why}</p>}
    </li>
  );
}

function TaskDetails({ task, goal }: { task: CrewTaskView; goal: string }) {
  const { t } = useLocale();
  const copy = t.agentCrew;
  return (
    <section className="space-y-1 border-t border-border pt-2">
      <p className="font-medium break-words">
        <StateGlyph state={task.status} label={copy.member[task.status]} /> {task.id}
        {goal && <span className="font-normal text-muted-foreground"> · {goal}</span>}
      </p>
      {task.summary && <p className="break-words">{task.summary}</p>}
      {task.candidates.length > 0
        ? <ul className="list-disc space-y-1 pl-5">{task.candidates.map(item => <Candidate key={item.url} item={item} />)}</ul>
        : <p className="text-muted-foreground">{copy.noCandidates}</p>}
      {task.gaps.length > 0 && <p className="text-muted-foreground">{copy.gaps}: {task.gaps.join(' / ')}</p>}
      {task.droppedUnverified > 0 && (
        <p className="text-muted-foreground">{copy.unverifiedDropped.replace('{n}', String(task.droppedUnverified))}</p>
      )}
    </section>
  );
}

/** Rows for the live and the stopped view; goals come from the call's params. */
function buildRows(
  toolCall: AgentToolCallRecord, view: CrewResultView | null, live: LiveCrew | undefined,
): Row[] {
  const goals = crewGoalsFromParams(toolCall.params);
  if (view && toolCall.status !== 'executing') {
    return view.tasks.map(task => ({
      id: task.id, goal: goals.get(task.id) ?? '', state: task.status, toolCalls: task.toolCalls,
      candidates: task.candidates.length, elapsedMs: task.elapsedMs,
    }));
  }
  if (live) {
    return live.members.map(member => ({
      id: member.id, goal: member.goal, state: member.state, activity: member.activity,
      toolCalls: member.toolCalls, candidates: null, elapsedMs: member.elapsedMs,
    }));
  }
  const stopped = toolCall.status !== 'executing';
  return Array.from(goals, ([id, goal]) => ({
    id, goal, state: stopped ? 'cancelled' : 'queued', toolCalls: 0, candidates: null, elapsedMs: 0,
  }));
}

/** Announces a member reaching a terminal state; never the activity text. */
function useTransitionAnnouncement(rows: Row[], copy: Translations['agentCrew']): string {
  const previous = useRef(new Map<string, CrewMemberState>());
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    const spoken: string[] = [];
    for (const row of rows) {
      const before = previous.current.get(row.id);
      if (before && before !== row.state && TERMINAL.has(row.state)) {
        const base = copy.announce.replace('{id}', row.id).replace('{state}', copy.member[row.state]);
        spoken.push(row.candidates === null ? base
          : `${base}, ${copy.candidates.replace('{n}', String(row.candidates))}`);
      }
      previous.current.set(row.id, row.state);
    }
    if (spoken.length) setAnnouncement(spoken.join('; '));
  }, [rows, copy]);
  return announcement;
}

// Over 50 lines: the JSX of one card; every decision it makes lives in the helpers above.
export default function CrewCard({ toolCall }: { toolCall: AgentToolCallRecord }) {
  const { t } = useLocale();
  const copy = t.agentCrew;
  const [expanded, setExpanded] = useState(false);
  const failure = toolCall.result === undefined ? null : toolFailureCode(toolCall.result);
  const view = failure ? null : parseCrewResult(toolCall.result);
  const live = useLiveProgress().crews[toolCall.id];
  const rows = buildRows(toolCall, view, live);
  const announcement = useTransitionAnnouncement(rows, copy);
  const running = toolCall.status === 'executing';
  const goals = crewGoalsFromParams(toolCall.params);
  const elapsed = Math.max(0, ...rows.map(row => row.elapsedMs));
  const tier = view?.modelTier ?? live?.modelTier;
  const settled = rows.filter(row => row.state === 'done' || row.state === 'partial').length;
  const candidateTotal = view?.tasks.reduce((sum, task) => sum + task.candidates.length, 0) ?? 0;
  const gapTotal = view?.tasks.reduce((sum, task) => sum + task.gaps.length, 0) ?? 0;

  return (
    <section aria-label={copy.title.replace('{n}', String(rows.length))} className={CARD}>
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
      <header className="flex items-center justify-between gap-2">
        <p className="font-medium">
          {view && !running
            ? copy.summary.replace('{done}', String(settled)).replace('{candidates}', String(candidateTotal))
              .replace('{gaps}', String(gapTotal))
            : copy.title.replace('{n}', String(rows.length))}
        </p>
        <span aria-hidden="true" className="tabular-nums text-muted-foreground">{formatClock(elapsed)}</span>
      </header>
      {failure && <p className="mt-1 text-red-600 dark:text-red-400">× {failure}</p>}
      {!view && !failure && (
        <ul className="mt-2 space-y-1">
          {rows.map(row => (
            <li key={row.id} className="flex min-w-0 items-baseline gap-2">
              <StateGlyph state={row.state} label={copy.member[row.state]} />
              <span className="min-w-0 flex-1 truncate" title={row.goal}>{row.id} {row.goal}</span>
              <span aria-hidden="true" className="max-w-[45%] truncate text-muted-foreground">
                {describeActivity(row.activity, copy)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!view && !running && rows.length > 0 && !failure && (
        <p className="mt-1 text-muted-foreground">{copy.cancelledNote}</p>
      )}
      {view && (
        <>
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded(open => !open)}
            className="mt-1 rounded text-primary underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            {expanded ? copy.collapse : copy.expand}
          </button>
          {expanded && (
            <div className="mt-2 space-y-2">
              <p className="text-muted-foreground">{copy.untrusted}</p>
              {view.tasks.map(task => <TaskDetails key={task.id} task={task} goal={goals.get(task.id) ?? ''} />)}
            </div>
          )}
        </>
      )}
      {tier && (
        <p className="mt-2 border-t border-border pt-1 text-muted-foreground">
          {copy.tier[tier]} · {copy.toolCalls.replace('{n}', String(rows.reduce((sum, row) => sum + row.toolCalls, 0)))}
        </p>
      )}
    </section>
  );
}
