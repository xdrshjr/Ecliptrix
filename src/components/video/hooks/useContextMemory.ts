import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { requestConversationCompaction, type CompactionOutcome } from '@/lib/api/agentCompact';
import { estimateConversationTokens } from '@/lib/video-editing-agent/memory/estimateTokens';
import type { ChatMessage, Conversation } from '@/types';
import type { ConversationWriteScope } from './videoChatSessionModel';
import type { AgentExecutionStatus } from './useAgentExecutionState';
import { stripHistoryForRequest } from './agentTurnLifecycle';
import {
  buildCompactionMessage, insertCompaction, isFoldStillValid, planFold, removeCompaction,
  savedPercent, type FoldPlan, type FoldRefusal,
} from './conversationCompaction';
import {
  contextLevel, contextRatio, idleReading, ratioPercent,
  type ContextLevel, type ContextUsageReading,
} from './contextUsage';
import { useCompactionSettings, type UseCompactionSettingsReturn } from './useCompactionSettings';

/**
 * Context-window reading plus conversation compaction (auto and manual).
 *
 * Compaction folds everything but the latest two user turns into a digest
 * message. It is best-effort: a failure, a stale result or a busy conversation
 * writes nothing, and the lossy fallback in `budgetModelContext` keeps working.
 *
 * Spec: docs/plans/agent-research-crew-and-context-memory/spec.md §3.4.
 */

export type CompactionResult = 'compacted' | FoldRefusal | 'failed' | 'discarded';

export interface UseContextMemoryParams {
  getConversation?: (id: string) => Conversation | undefined;
  getSelectionEpoch?: () => number;
  captureWriteScope?: (id: string) => ConversationWriteScope | null;
  isScopeValid?: (scope: ConversationWriteScope) => boolean;
  writeScopedMessages?: (scope: ConversationWriteScope, messages: ChatMessage[]) => boolean;
  canStartCompaction?: () => boolean;
  conversationId: string | null | undefined;
  messages: readonly ChatMessage[];
  /** Replaces the conversation's messages (same writer the agent turn uses). */
  writeMessages: (conversationId: string, messages: ChatMessage[]) => void;
  /** Latest `context_usage` event of the running or last turn. */
  liveUsage: ContextUsageReading | null;
  agentIsExecuting: boolean;
  executionStatus: AgentExecutionStatus;
  /** Steers or queued follow-ups are waiting: the next turn is already decided. */
  hasPendingSteers: boolean;
}

export interface UseContextMemoryReturn {
  reading: ContextUsageReading;
  ratio: number;
  percent: number;
  level: ContextLevel;
  isCompacting: boolean;
  isCompactingNow?: () => boolean;
  /** Idle conversation, none in flight: `/compact` and the ring button may run. */
  canCompact: boolean;
  /** The message the pending digest will follow; null when none is pending. */
  compactingAfterMessageId: string | null;
  settings: UseCompactionSettingsReturn['settings'];
  setAutoCompact: UseCompactionSettingsReturn['setAutoCompact'];
  compactNow: () => Promise<CompactionResult>;
  undoCompaction: (compactionId: string) => boolean;
}

function newCompactionId(): string {
  return `compaction-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface UsageClaim {
  reading: ContextUsageReading;
  conversationId: string | null | undefined;
}

/**
 * The server reading, unless it no longer describes this conversation: it was
 * discarded by a compaction/undo, belongs to another conversation, or the chat
 * was cleared. The reading carries no conversation id, so the first render that
 * sees a new reading claims it for the conversation on screen.
 */
function trustedUsage(
  reading: ContextUsageReading | null,
  discarded: ContextUsageReading | null,
  owner: { current: UsageClaim | null },
  conversationId: string | null | undefined,
  messageCount: number,
): ContextUsageReading | null {
  if (reading === null || reading === discarded || messageCount === 0) return null;
  if (owner.current?.reading !== reading) owner.current = { reading, conversationId };
  return owner.current.conversationId === conversationId ? reading : null;
}

/** Local estimate of the conversation; frozen while a turn streams (it would re-run per delta). */
function useConversationEstimate(messages: readonly ChatMessage[], frozen: boolean): number {
  const estimate = useRef(0);
  return useMemo(() => {
    if (!frozen) estimate.current = estimateConversationTokens(messages as ChatMessage[]);
    return estimate.current;
  }, [messages, frozen]);
}

// Over 60 lines: the refs below must be read and written by the same closures.
export function useContextMemory(params: UseContextMemoryParams): UseContextMemoryReturn {
  const { conversationId, messages, liveUsage, agentIsExecuting, executionStatus } = params;
  const { locale, t } = useLocale();
  const { settings, refresh, setAutoCompact } = useCompactionSettings();
  const [compactingAfter, setCompactingAfter] = useState<string | null>(null);
  const latest = useRef(params);
  latest.current = params;
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true;
    return () => { mounted.current = false; }; }, []);
  const abort = useRef<AbortController | null>(null);
  const discardedUsage = useRef<ContextUsageReading | null>(null);
  const usageOwner = useRef<UsageClaim | null>(null);
  const copyRef = useRef(t.agentContext);
  copyRef.current = t.agentContext;

  const usage = trustedUsage(liveUsage, discardedUsage.current, usageOwner, conversationId, messages.length);
  const estimated = useConversationEstimate(messages, agentIsExecuting);
  const reading = agentIsExecuting && usage ? usage : idleReading(estimated, usage);
  const ratio = contextRatio(reading);

  /** Write the digest unless the conversation moved on while it was being made. */
  const commit = useCallback((
    conversation: string, plan: FoldPlan, outcome: CompactionOutcome, auto: boolean,
    scope?: ConversationWriteScope | null,
  ): CompactionResult => {
    if (!outcome.success) {
      console.warn('[useContextMemory] compaction produced no summary', outcome.error_code);
      return 'failed';
    }
    const { conversationId: currentId, liveUsage: reading } = latest.current;
    const fresh = latest.current.getConversation?.(conversation)?.messages
      ?? latest.current.messages;
    if (currentId !== conversation || !isFoldStillValid(fresh, plan)) return 'discarded';
    const message = buildCompactionMessage(plan, {
      id: newCompactionId(),
      summaryText: outcome.text,
      tokensBefore: outcome.tokensBefore,
      tokensAfter: outcome.tokensAfter,
      auto,
      content: copyRef.current.divider.replace('{n}', String(plan.coveredCount))
        .replace('{pct}', String(savedPercent(outcome.tokensBefore, outcome.tokensAfter))),
      now: new Date(),
    });
    discardedUsage.current = reading;
    const next = insertCompaction(fresh, plan, message);
    if (scope && latest.current.writeScopedMessages) {
      if (!latest.current.writeScopedMessages(scope, next)) return 'discarded';
    } else latest.current.writeMessages(conversation, next);
    return 'compacted';
  }, []);

  const compact = useCallback(async (auto: boolean): Promise<CompactionResult> => {
    const { conversationId: id, agentIsExecuting: running } = latest.current;
    if (!id || running || inFlight.current ||
        latest.current.canStartCompaction?.() === false) return 'busy';
    const current = latest.current.getConversation?.(id)?.messages
      ?? latest.current.messages;
    const scope = latest.current.captureWriteScope?.(id);
    if (latest.current.captureWriteScope && !scope) return 'discarded';
    const plan = planFold(current);
    if (typeof plan === 'string') return plan;
    inFlight.current = true;
    setCompactingAfter(plan.coveredThroughMessageId);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const outcome = await requestConversationCompaction({
        messages: stripHistoryForRequest(plan.segment),
        previousSummary: plan.previous?.metadata?.compaction?.summaryText,
        locale,
      }, controller.signal);
      if (!mounted.current || controller.signal.aborted ||
          (scope && latest.current.isScopeValid?.(scope) === false)) {
        return 'discarded';
      }
      return commit(id, plan, outcome, auto, scope);
    } catch (error) {
      if (controller.signal.aborted || !mounted.current) return 'discarded';
      console.warn('[useContextMemory] compaction request failed', error);
      return 'failed';
    } finally {
      inFlight.current = false;
      abort.current = null;
      if (mounted.current) setCompactingAfter(null);
    }
  }, [locale, commit]);

  // Auto trigger: only on the falling edge of a turn that completed normally.
  const wasExecuting = useRef(agentIsExecuting);
  useEffect(() => {
    const finished = wasExecuting.current && !agentIsExecuting;
    wasExecuting.current = agentIsExecuting;
    if (!finished || executionStatus !== 'completed') return;
    const origin = latest.current;
    const epoch = origin.getSelectionEpoch?.();
    const snapshot = origin.getConversation?.(origin.conversationId ?? '')
      ?.messages ?? origin.messages;
    void (async () => {
      const fresh = await refresh();
      const state = latest.current;
      if (!mounted.current || state.conversationId !== origin.conversationId ||
          state.getSelectionEpoch?.() !== epoch ||
          (state.getConversation?.(state.conversationId ?? '')?.messages
            ?? state.messages) !== snapshot ||
          state.canStartCompaction?.() === false) return;
      if (!fresh.autoCompact || state.agentIsExecuting || state.hasPendingSteers) return;
      const afterTurn = idleReading(
        estimateConversationTokens(state.messages as ChatMessage[]), state.liveUsage);
      if (contextRatio(afterTurn) < fresh.autoCompactRatio) return;
      await compact(true);
    })();
  }, [agentIsExecuting, executionStatus, refresh, compact]);

  const cancelInFlight = useCallback(() => abort.current?.abort(), []);
  useEffect(() => cancelInFlight, [conversationId, cancelInFlight]);

  const undoCompaction = useCallback((compactionId: string): boolean => {
    const { conversationId: id, messages: current, agentIsExecuting: running } = latest.current;
    if (!id || running || inFlight.current ||
        latest.current.canStartCompaction?.() === false ||
        !current.some(message => message.id === compactionId)) return false;
    discardedUsage.current = latest.current.liveUsage;
    latest.current.writeMessages(id, removeCompaction(current, compactionId));
    return true;
  }, []);
  const isCompactingNow = useCallback(() => inFlight.current, []);

  return {
    reading, ratio, percent: ratioPercent(ratio), level: contextLevel(ratio, reading.dropped),
    isCompacting: compactingAfter !== null, isCompactingNow,
    compactingAfterMessageId: compactingAfter,
    canCompact: Boolean(conversationId) && !agentIsExecuting &&
      compactingAfter === null && params.canStartCompaction?.() !== false,
    settings, setAutoCompact, compactNow: () => compact(false), undoCompaction,
  };
}
