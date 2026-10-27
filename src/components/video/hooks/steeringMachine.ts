import type { QueuedFollowUp, SteerNote } from '@/types/agentSteering';
import type { SteerOutcome, SteerRequest } from '@/lib/api/agentSteer';

/**
 * 运行中插话/排队的状态机（框架无关，便于单测）。
 *
 * 设计基线：docs/plans/agent-steering-and-skills/spec.md §3.2.4。
 *
 *   Enter（运行中）  → local（尚无 runId）/ sent（POST /steer 已受理）
 *   sent → applied    （steer_applied）
 *   sent → queued     （steer_dropped / 404 / 409 run_closed / 回合结束）
 *   sent → local      （SSE 自动重连 = 新 run、新 runId；待新 run_started 后补发）
 *   Alt+Enter         → queued（纯客户端）
 *
 * 绝不丢用户输入：任何无法送达的文本最终要么自动作为下一轮发出，要么放回输入框。
 */

/** 待送达插话 + 排队的总上限（与服务端 `MAX_PENDING_STEERS` 对齐）。 */
export const MAX_PENDING_TOTAL = 3;

export type SteeringNotice = 'queue_full' | 'restored_after_stop' | 'restored_after_question';

export interface SteeringHost {
  postSteer: (request: SteerRequest) => Promise<SteerOutcome>;
  /** 已送达的插话随该回合的 agent 消息持久化。 */
  persistApplied: (notes: SteerNote[]) => void;
  /** 回合已结束且空闲：把合并后的文本作为新一轮用户消息发出。 */
  sendFollowUp: (text: string) => void;
  /** 把文本放回输入框（不丢输入）。 */
  restoreDraft: (text: string) => void;
  notify: (notice: SteeringNotice) => void;
  /** 请求停止当前回合（`cancelByUser`）。 */
  cancelTurn: () => void;
  newId: () => string;
  now: () => number;
}

export interface SteeringSnapshot {
  notes: readonly SteerNote[];
  queued: readonly QueuedFollowUp[];
  runId: string | null;
}

export type SubmitResult = 'accepted' | 'full' | 'empty';

export interface TurnEnd {
  reason: 'completed' | 'cancelled' | 'error';
  /** 回合以未回答的 `ask_user` 收尾（排队文本不能当作对提问的回答）。 */
  endedWithAskUser: boolean;
}

/** 合并多条文本为一条用户消息：以空行连接。 */
export function mergeTexts(texts: readonly string[]): string {
  return texts.map(text => text.trim()).filter(Boolean).join('\n\n');
}

export class SteeringMachine {
  private notes: SteerNote[] = [];
  private queued: QueuedFollowUp[] = [];
  private runId: string | null = null;
  private resendAfterStop = false;
  private snapshot: SteeringSnapshot = { notes: [], queued: [], runId: null };
  private listeners = new Set<() => void>();

  constructor(private readonly host: SteeringHost) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  getSnapshot(): SteeringSnapshot {
    return this.snapshot;
  }

  // ---- queries ----

  private pendingNotes(): SteerNote[] {
    return this.notes.filter(note => note.status === 'local' || note.status === 'sent');
  }

  private totalPending(): number {
    return this.pendingNotes().length + this.queued.length;
  }

  // ---- lifecycle ----

  /** 新回合开始：插话记录归零（上一轮已送达的已随其消息持久化）。 */
  startTurn(): void {
    this.notes = [];
    this.runId = null;
    this.resendAfterStop = false;
    this.emit();
  }

  onRunStarted(runId: string): void {
    this.runId = runId;
    for (const note of this.notes.filter(item => item.status === 'local')) {
      this.dispatch(note);
    }
    this.emit();
  }

  /** SSE 自动重连：新 run、新 runId，旧 run 上的一切都要重新来过。 */
  onRestart(): void {
    this.runId = null;
    this.notes = this.notes.map(note =>
      note.status === 'sent' || note.status === 'applied'
        ? { ...note, status: 'local', afterToolCallId: undefined } : note);
    this.host.persistApplied([]);
    this.emit();
  }

  onSteerApplied(event: { steerId: string; afterToolCallId: string | null }): void {
    const index = this.notes.findIndex(note => note.id === event.steerId);
    if (index === -1) return;
    this.notes[index] = {
      ...this.notes[index], status: 'applied', afterToolCallId: event.afterToolCallId };
    this.host.persistApplied(this.notes.filter(note => note.status === 'applied'));
    this.emit();
  }

  onSteerDropped(event: { steerIds: readonly string[] }): void {
    for (const steerId of event.steerIds) this.demoteToQueue(steerId);
    this.emit();
  }

  // ---- user actions ----

  submit(text: string, mode: 'steer' | 'queue'): SubmitResult {
    const trimmed = text.trim();
    if (!trimmed) return 'empty';
    if (this.totalPending() >= MAX_PENDING_TOTAL) {
      this.host.notify('queue_full');
      return 'full';
    }
    const id = this.host.newId();
    const createdAt = this.host.now();
    if (mode === 'queue') {
      this.queued = [...this.queued, { id, text: trimmed, createdAt }];
    } else {
      const note: SteerNote = { id, text: trimmed, status: 'local', createdAt };
      this.notes = [...this.notes, note];
      if (this.runId) this.dispatch(note);
    }
    this.emit();
    return 'accepted';
  }

  /** ✕：只有 `local` 与 `queued` 能撤回；`sent` 已进入 pi 的队列，无取消接口。 */
  cancelNote(id: string): boolean {
    if (this.notes.some(note => note.id === id && note.status === 'local')) {
      this.notes = this.notes.filter(note => note.id !== id);
      this.emit();
      return true;
    }
    if (this.queued.some(item => item.id === id)) {
      this.queued = this.queued.filter(item => item.id !== id);
      this.emit();
      return true;
    }
    return false;
  }

  /** 「改为停止并重发」：停止当前回合，随后把该文本（与其余排队）作为新一轮发出。 */
  promoteToStop(id: string): void {
    this.demoteToQueue(id);
    this.queued = [...this.queued].sort((a, b) => a.createdAt - b.createdAt);
    this.resendAfterStop = true;
    this.emit();
    this.host.cancelTurn();
  }

  /** 回合结束（执行态落回空闲）后调用；决定「自动发送」还是「回填输入框」。 */
  onTurnEnd(end: TurnEnd): void {
    const wantsResend = this.resendAfterStop && end.reason === 'cancelled';
    this.resendAfterStop = false;
    for (const note of this.pendingNotes()) this.demoteToQueue(note.id);
    const text = mergeTexts(this.queued
      .slice().sort((a, b) => a.createdAt - b.createdAt).map(item => item.text));
    this.queued = [];
    this.runId = null;
    this.emit();
    if (!text) return;
    if (wantsResend || (end.reason === 'completed' && !end.endedWithAskUser)) {
      this.host.sendFollowUp(text);
      return;
    }
    this.host.restoreDraft(text);
    this.host.notify(end.reason === 'completed' ? 'restored_after_question' : 'restored_after_stop');
  }

  // ---- internals ----

  private dispatch(note: SteerNote): void {
    const runId = this.runId;
    if (!runId) return;
    this.replaceNote({ ...note, status: 'sent' });
    void this.host.postSteer({ runId, steerId: note.id, text: note.text })
      .then(outcome => this.onOutcome(note.id, runId, outcome));
  }

  private onOutcome(steerId: string, runIdAtSend: string, outcome: SteerOutcome): void {
    // 响应属于已被 onRestart 作废的旧 run：该插话已退回 local，等新 run 补发。
    if (this.runId !== runIdAtSend) return;
    const note = this.notes.find(item => item.id === steerId);
    if (!note || note.status !== 'sent') return;
    if (outcome.kind === 'accepted') return;
    if (outcome.kind === 'queue_full') {
      this.notes = this.notes.filter(item => item.id !== steerId);
      this.host.restoreDraft(note.text);
      this.host.notify('queue_full');
    } else {
      this.demoteToQueue(steerId);
    }
    this.emit();
  }

  private replaceNote(next: SteerNote): void {
    this.notes = this.notes.map(note => (note.id === next.id ? next : note));
  }

  private demoteToQueue(id: string): void {
    const note = this.notes.find(item => item.id === id);
    if (!note || note.status === 'applied') return;
    this.notes = this.notes.filter(item => item.id !== id);
    this.queued = [...this.queued,
      { id: note.id, text: note.text, createdAt: note.createdAt }];
  }

  private emit(): void {
    this.snapshot = {
      notes: [...this.notes], queued: [...this.queued], runId: this.runId };
    this.listeners.forEach(listener => listener());
  }
}
