'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SetStateAction } from 'react';
import { videoCoverV2 } from '@/lib/api/videoCoverV2';
import type { CoverJob, CoverJobConnection } from '@/types/videoCover';
export type { CoverJobConnection } from '@/types/videoCover';

export const isCoverJobActive = (job: CoverJob) =>
  job.status === 'queued' || job.status === 'running';

// 状态先限定合法阶段，排队响应不能凭异常phase推进正在运行的任务。
function activePhase(job: CoverJob) {
  if (job.status === 'queued') return 'queued';
  return job.phase === 'downloading' ? 'downloading' : 'generating';
}

function mergeJob(previous: CoverJob | undefined, incoming: CoverJob) {
  if (!previous) return incoming;
  if (!isCoverJobActive(previous)) {
    if (isCoverJobActive(incoming)) return previous;
    if (previous.status !== incoming.status) {
      console.warn('[CoverStudio] conflicting terminal job status',
        incoming.jobId, previous.status, incoming.status);
      return previous;
    }
  }
  // 终态由服务端负责收敛集合，活跃期间才保留已观察到的候选与警告。
  if (!isCoverJobActive(incoming)) return incoming;
  const phases = ['queued', 'generating', 'downloading'];
  const previousPhase = phases.indexOf(activePhase(previous));
  const incomingPhase = phases.indexOf(activePhase(incoming));
  const phase = previousPhase > incomingPhase
    ? activePhase(previous) : activePhase(incoming);
  const assets = new Map(previous.assets.map(asset => [asset.assetId, asset]));
  for (const asset of incoming.assets) assets.set(asset.assetId, asset);
  return { ...previous, ...incoming,
    status: previous.status === 'running' ? 'running' : incoming.status,
    phase, assets: Array.from(assets.values()),
    warnings: Array.from(new Set([
      ...(previous.warnings ?? []), ...(incoming.warnings ?? []),
    ])),
  };
}

/** 20条限制仅影响终态展示，不能丢掉仍需要订阅的任务。 */
export function mergeCoverJobs(previous: CoverJob[], incoming: CoverJob[]) {
  const known = new Map(previous.map(job => [job.jobId, job]));
  for (const job of incoming) {
    known.set(job.jobId, mergeJob(known.get(job.jobId), job));
  }
  const order = new Set([...incoming, ...previous].map(job => job.jobId));
  let ended = 0;
  return Array.from(order).map(id => known.get(id)!).filter(job =>
    isCoverJobActive(job) || ++ended <= 20);
}

interface JobObservation {
  failures: number;
  nextAt: number;
  unavailable: boolean;
  error?: unknown;
}
interface JobState {
  jobs: CoverJob[];
  error?: unknown;
  connection: CoverJobConnection;
}
const initialState = (): JobState => ({ jobs: [], connection: {
  status: 'idle', failedJobIds: [], unavailableJobIds: [],
} });
const interval = () => document.hidden ? 3000 : 1000;

/** 每个会话独占计时器和abort；业务状态与观察失败分别维护。 */
class CoverJobSubscription {
  private jobs: CoverJob[] = [];
  // 展示裁剪不代表遗忘终态，否则旧快照会把已取消任务重新订阅。
  private terminalJobs = new Map<string, CoverJob>();
  private observations = new Map<string, JobObservation>();
  private abort = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  private inFlight = false;
  private pending = false;

  constructor(private projectId: string | undefined,
    private publish: (state: JobState) => void) {}

  merge = (update: SetStateAction<CoverJob[]>) => {
    if (this.abort.signal.aborted) return;
    const incoming = typeof update === 'function' ? update(this.jobs) : update;
    const guarded = incoming.map(job => {
      const next = mergeJob(this.terminalJobs.get(job.jobId), job);
      if (!isCoverJobActive(next)) this.terminalJobs.set(next.jobId, next);
      return next;
    });
    this.jobs = mergeCoverJobs(this.jobs, guarded);
    this.syncObservations();
    this.emit();
    this.schedule();
  };

  private syncObservations() {
    const active = new Set(this.jobs.filter(isCoverJobActive)
      .map(job => job.jobId));
    for (const id of Array.from(this.observations.keys())) {
      if (!active.has(id)) this.observations.delete(id);
    }
    for (const id of Array.from(active)) {
      if (!this.observations.has(id)) this.observations.set(id, {
        failures: 0, nextAt: Date.now() + interval(), unavailable: false,
      });
    }
  }

  private emit() {
    const failedJobIds: string[] = [];
    const unavailableJobIds: string[] = [];
    let error: unknown;
    for (const [id, observation] of Array.from(this.observations)) {
      if (!observation.failures) continue;
      error ??= observation.error;
      if (observation.unavailable) unavailableJobIds.push(id);
      else failedJobIds.push(id);
    }
    const hasErrors = failedJobIds.length + unavailableJobIds.length > 0;
    this.publish({ jobs: this.jobs, error, connection: {
      status: hasErrors ? 'retrying'
        : this.observations.size ? 'connected' : 'idle',
      failedJobIds, unavailableJobIds,
    } });
  }

  private clearTimer() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule() {
    this.clearTimer();
    if (!this.projectId || this.abort.signal.aborted || this.inFlight) return;
    const available = Array.from(this.observations.values())
      .filter(observation => !observation.unavailable);
    if (!available.length) return;
    const nextAt = Math.min(...available.map(observation => observation.nextAt));
    this.timer = setTimeout(() => { void this.poll(false); },
      Math.max(0, nextAt - Date.now()));
  }

  refreshNow = () => {
    this.clearTimer();
    if (this.inFlight) { this.pending = true; return; }
    void this.poll(true);
  };

  private async read(job: CoverJob) {
    try {
      const next = await videoCoverV2.getJob(this.projectId!, job.jobId,
        this.abort.signal);
      if (this.abort.signal.aborted) return;
      const observation = this.observations.get(job.jobId);
      if (observation) Object.assign(observation, { failures: 0,
        error: undefined, unavailable: false, nextAt: Date.now() + interval() });
      this.merge([next]);
    } catch (error) {
      if (this.abort.signal.aborted) return;
      const observation = this.observations.get(job.jobId);
      // 请求期间任务可能已经取消，迟到的连接错误没有观察对象。
      if (!observation) return;
      observation.error = error;
      observation.failures++;
      observation.unavailable = typeof error === 'object' && error !== null
        && 'status' in error && error.status === 404;
      observation.nextAt = Date.now()
        + Math.min(10000, 1000 * 2 ** observation.failures);
      this.emit();
    }
  }

  private async poll(force: boolean) {
    this.clearTimer();
    if (!this.projectId || this.abort.signal.aborted) return;
    this.inFlight = true;
    const eligible = this.jobs.filter(job => {
      const observation = this.observations.get(job.jobId);
      return observation && (force || (!observation.unavailable
        && observation.nextAt <= Date.now()));
    });
    await Promise.all(eligible.map(job => this.read(job)));
    this.inFlight = false;
    if (this.abort.signal.aborted) return;
    if (this.pending) {
      this.pending = false;
      void this.poll(true);
    } else this.schedule();
  }

  close() {
    this.abort.abort();
    this.clearTimer();
    this.pending = false;
  }
}

/** Subscriptions never submit generation; re-entry only displays saved results. */
export function useCoverJobs(projectId?: string) {
  const [state, setState] = useState<JobState>(initialState);
  const subscription = useRef<CoverJobSubscription | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const token = ++generation.current;
    setState(initialState());
    const current = new CoverJobSubscription(projectId, next => {
      if (generation.current === token) setState(next);
    });
    subscription.current = current;
    return () => {
      generation.current++;
      current.close();
      subscription.current = null;
    };
  }, [projectId]);
  const setJobs = useCallback((update: SetStateAction<CoverJob[]>) => {
    subscription.current?.merge(update);
  }, []);
  const putJob = useCallback((job: CoverJob) => {
    subscription.current?.merge([job]);
  }, []);
  const refreshNow = useCallback(() => {
    subscription.current?.refreshNow();
  }, []);
  return { ...state, setJobs, putJob, refreshNow };
}
