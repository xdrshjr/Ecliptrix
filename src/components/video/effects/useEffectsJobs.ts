import { useEffect, useRef, useState } from 'react';
import { cancelEffectJob, getEffectJob, listEffectJobs } from '@/lib/api/effects';
import { ApiError, RateLimitError, TimeoutError } from '@/lib/api/http-client';
import type { EffectAsset, EffectJobQueryError,
  EffectRenderJob } from '@/types/effects';
import { EffectError } from '@/types/effects';
import { isEffectJobActive, mergeEffectJob } from './mergeEffectJob';

export { isEffectJobActive } from './mergeEffectJob';
type ListKind = 'history' | 'active' | 'more';
interface JobControl {
  seq: number; failures: number; inFlight: boolean;
  missing: boolean; needsVerification: boolean;
  timer?: ReturnType<typeof setTimeout>;
  controller?: AbortController;
  cancelController?: AbortController;
}
interface JobsOwner {
  isCurrent: () => boolean; publish: () => void;
  register: (asset: EffectAsset) => void;
}

/** Bound delivery even when a transport fails to settle on AbortSignal. */
function requestWithDeadline<T>(controller: AbortController,
  operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => { cleanup(); reject(controller.signal.reason
      ?? new DOMException('Request aborted', 'AbortError')); };
    const timer = setTimeout(() => controller.abort(new TimeoutError()), 10000);
    controller.signal.addEventListener('abort', onAbort, { once: true });
    if (controller.signal.aborted) onAbort();
    else Promise.resolve().then(() => operation(controller.signal)).then(value => {
      cleanup(); resolve(value);
    }, failure => { cleanup(); reject(failure); });
  });
}

function retryDelay(failures: number, error?: Error): number {
  let delay = Math.min(8000, 1000 * 2 ** Math.max(0, failures - 1));
  if (document.hidden) delay = Math.max(5000, delay);
  if (error instanceof ApiError && error.status === 429) {
    const seconds = error instanceof RateLimitError ? error.retryAfter
      : Number(error.details?.retryAfter ?? 0);
    const milliseconds = Number(error.details?.retry_after_ms ?? 0);
    delay = Math.max(delay, Number.isFinite(seconds) ? seconds * 1000 : 0,
      Number.isFinite(milliseconds) ? milliseconds : 0);
  }
  return Math.min(60000, delay);
}

/** One project epoch owns independent timers, GET sequences and page chains. */
class EffectsJobsOwner {
  jobs = new Map<string, EffectRenderJob>();
  jobErrors: Record<string, EffectJobQueryError> = {};
  listErrors: Partial<Record<ListKind, Error>> = {};
  cancelling = new Set<string>();
  nextCursor?: string;
  loadingMore = false;
  private isMounted = false;
  private controls = new Map<string, JobControl>();
  private authorized = new Set<string>();
  private delivered = new Set<string>();
  private listSeq = { history: 0, active: 0, more: 0 };
  private listControllers = new Map<ListKind, AbortController>();

  constructor(readonly projectId: string | undefined,
    private readonly owner: JobsOwner) {}

  private isCurrent = () => this.isMounted && this.owner.isCurrent();
  private publish = () => { if (this.isCurrent()) this.owner.publish(); };
  private getControl(id: string): JobControl {
    let control = this.controls.get(id);
    if (!control) {
      control = { seq: 0, failures: 0, inFlight: false,
        missing: false, needsVerification: false };
      this.controls.set(id, control);
    }
    return control;
  }

  start(): void {
    this.isMounted = true;
    document.addEventListener('visibilitychange', this.changeVisibility);
    if (this.projectId) void this.retryLists();
  }

  stop(): void {
    this.isMounted = false;
    document.removeEventListener('visibilitychange', this.changeVisibility);
    for (const control of Array.from(this.controls.values())) {
      control.seq++; clearTimeout(control.timer); control.timer = undefined;
      control.controller?.abort(); control.controller = undefined;
      control.inFlight = false; control.cancelController?.abort();
    }
    for (const controller of Array.from(this.listControllers.values())) controller.abort();
    this.listSeq.history++; this.listSeq.active++; this.listSeq.more++;
  }

  watch = (incoming: EffectRenderJob, register = false): void => {
    if (!this.isCurrent() || incoming.projectId !== this.projectId) return;
    if (register) this.authorized.add(incoming.id);
    this.merge(incoming, true); this.scheduleActive(); this.publish();
  };

  private merge(incoming: EffectRenderJob, prepend = false): void {
    if (incoming.projectId !== this.projectId) return;
    const current = this.jobs.get(incoming.id);
    const result = mergeEffectJob(current ?? incoming, incoming);
    if (result.error) {
      this.getControl(incoming.id).needsVerification = true;
      this.recordError(incoming.id, result.error);
      return;
    }
    if (prepend && !current) this.jobs = new Map([[incoming.id, result.job],
      ...Array.from(this.jobs)]);
    else this.jobs.set(incoming.id, result.job);
    this.deliver(result.job);
  }

  private deliver(job: EffectRenderJob): void {
    if (!job.outputAsset || job.status !== 'succeeded'
      || !this.authorized.has(job.id) || this.delivered.has(job.id)
      || job.outputAsset.projectId !== this.projectId) return;
    try { this.owner.register(job.outputAsset); this.delivered.add(job.id); }
    catch (error) { this.recordError(job.id, error); }
  }

  private recordError(id: string, failure: unknown, allowMissing = false): void {
    const error = failure instanceof Error ? failure : new Error(String(failure));
    const control = this.getControl(id);
    control.failures++;
    control.missing = allowMissing && error instanceof ApiError
      && error.status === 404;
    this.jobErrors = { ...this.jobErrors, [id]: { error,
      missing: control.missing,
      retryAt: Date.now() + retryDelay(control.failures, error) } };
  }

  private clearError(id: string): void {
    this.jobErrors = { ...this.jobErrors }; delete this.jobErrors[id];
    const control = this.getControl(id);
    control.failures = 0; control.missing = false;
    control.needsVerification = false;
  }

  private scheduleActive(): void {
    const chosen = new Set(Array.from(this.controls.entries())
      .filter(([, control]) => control.inFlight).map(([id]) => id));
    const candidates = Array.from(this.jobs.values()).filter(job =>
      (isEffectJobActive(job) || this.getControl(job.id).needsVerification)
      && !this.getControl(job.id).missing && !this.cancelling.has(job.id));
    for (const job of candidates) {
      if (chosen.size < 5) chosen.add(job.id);
    }
    for (const [id, control] of Array.from(this.controls)) {
      if (!chosen.has(id)) {
        clearTimeout(control.timer); control.timer = undefined;
      }
    }
    for (const id of Array.from(chosen)) this.schedule(id);
  }

  private changeVisibility = (): void => {
    for (const control of Array.from(this.controls.values())) {
      clearTimeout(control.timer); control.timer = undefined;
    }
    this.scheduleActive();
  };

  private schedule(id: string): void {
    const control = this.getControl(id);
    if (!this.isCurrent() || control.timer || control.inFlight || control.missing
      || this.cancelling.has(id)) return;
    const error = this.jobErrors[id];
    const delay = error ? Math.max(document.hidden ? 5000 : 0,
      error.retryAt - Date.now())
      : document.hidden ? 5000 : 1000;
    control.timer = setTimeout(() => {
      control.timer = undefined; void this.query(id);
    }, delay);
  }

  private query = async (id: string): Promise<void> => {
    const control = this.getControl(id);
    if (!this.isCurrent() || !this.projectId || control.inFlight
      || this.cancelling.has(id)) return;
    if (Array.from(this.controls.values()).filter(item => item.inFlight).length >= 5) {
      control.needsVerification = true; this.scheduleActive(); return;
    }
    const seq = control.seq, controller = new AbortController();
    control.controller = controller; control.inFlight = true;
    const isCurrent = () => this.isCurrent() && control.seq === seq;
    try {
      const job = await requestWithDeadline(controller, signal =>
        getEffectJob(this.projectId!, id, { signal, timeoutMs: 10000 }));
      if (!isCurrent()) return;
      if (job.id !== id || job.projectId !== this.projectId) {
        throw new EffectError('EFFECT_IDEMPOTENCY_CONFLICT');
      }
      this.clearError(id); this.merge(job);
    } catch (error) {
      if (isCurrent()) this.recordError(id, error, true);
    } finally {
      if (control.controller === controller) {
        control.controller = undefined; control.inFlight = false;
      }
      if (this.isCurrent()) { this.scheduleActive(); this.publish(); }
    }
  };

  retry = (id: string): Promise<void> => {
    if (!this.jobs.has(id) || !this.isCurrent()) return Promise.resolve();
    const control = this.getControl(id);
    clearTimeout(control.timer); control.timer = undefined;
    control.missing = false;
    return this.query(id);
  };

  removeMissing = (id: string): void => {
    if (!this.isCurrent() || !this.jobErrors[id]?.missing) return;
    this.jobs.delete(id); this.controls.delete(id);
    this.jobErrors = { ...this.jobErrors }; delete this.jobErrors[id];
    this.scheduleActive(); this.publish();
  };

  cancel = async (job: EffectRenderJob): Promise<void> => {
    const latest = this.jobs.get(job.id);
    if (!this.isCurrent() || job.projectId !== this.projectId
      || !latest || !isEffectJobActive(latest) || this.cancelling.has(job.id)) return;
    const control = this.getControl(job.id), seq = ++control.seq;
    control.controller?.abort(); clearTimeout(control.timer);
    control.timer = undefined;
    const controller = new AbortController(); control.cancelController = controller;
    this.cancelling.add(job.id); this.publish();
    try {
      const result = await requestWithDeadline(controller,
        () => cancelEffectJob(job.projectId, job.id));
      if (!this.isCurrent() || control.seq !== seq) return;
      if (result.id !== job.id || result.projectId !== this.projectId
        || (result.status !== 'cancelling' && isEffectJobActive(result))) {
        throw new EffectError('EFFECT_RUNTIME_UNAVAILABLE');
      }
      this.clearError(job.id); this.merge(result);
    } catch (error) {
      if (this.isCurrent() && control.seq === seq) this.recordError(job.id, error);
    } finally {
      if (this.isCurrent() && control.seq === seq) {
        this.cancelling.delete(job.id); control.cancelController = undefined;
        this.scheduleActive(); this.publish();
      }
    }
  };

  private loadList = async (kind: ListKind, cursor?: string): Promise<void> => {
    if (!this.isCurrent() || !this.projectId) return;
    const seq = ++this.listSeq[kind], chain = this.listSeq.history;
    this.listControllers.get(kind)?.abort();
    const controller = new AbortController();
    this.listControllers.set(kind, controller);
    const isCurrent = () => this.isCurrent() && this.listSeq[kind] === seq
      && (kind !== 'more' || this.listSeq.history === chain);
    try {
      const page = await requestWithDeadline(controller, signal => listEffectJobs(
        this.projectId!, cursor, kind === 'active' ? 'active' : undefined,
        { signal, timeoutMs: 10000 }));
      if (!isCurrent()) return;
      delete this.listErrors[kind];
      for (const job of page.items) this.merge(job);
      if (kind !== 'active') this.nextCursor = page.nextCursor;
      this.scheduleActive(); this.publish();
    } catch (error) {
      if (isCurrent()) {
        this.listErrors = { ...this.listErrors,
          [kind]: error instanceof Error ? error : new Error(String(error)) };
        this.publish();
      }
    } finally {
      if (isCurrent() && kind === 'more') {
        this.loadingMore = false; this.publish();
      }
      if (this.listControllers.get(kind) === controller) {
        this.listControllers.delete(kind);
      }
    }
  };

  retryLists = async (): Promise<void> => {
    this.listControllers.get('more')?.abort();
    this.listSeq.more++; this.loadingMore = false;
    this.publish();
    // Each load publishes its own outcome; allSettled only closes the batch.
    await Promise.allSettled([this.loadList('history'), this.loadList('active')]);
  };

  loadMore = async (): Promise<void> => {
    if (!this.isCurrent() || this.loadingMore || !this.nextCursor) return;
    this.loadingMore = true; this.publish();
    await this.loadList('more', this.nextCursor);
  };
}

/** Persisted jobs survive modal close; the mounted project owns all delivery. */
export function useEffectsJobs(options: {
  projectId?: string; onRegister: (asset: EffectAsset) => void;
}) {
  const [, setRevision] = useState(0);
  const owner = useRef(options); owner.current = options;
  const current = useRef<EffectsJobsOwner | undefined>(undefined);
  if (!current.current || current.current.projectId !== options.projectId) {
    const engine: EffectsJobsOwner = new EffectsJobsOwner(options.projectId, {
      isCurrent: () => current.current === engine
        && owner.current.projectId === engine.projectId,
      publish: () => setRevision(revision => revision + 1),
      register: asset => owner.current.onRegister(asset),
    });
    current.current = engine;
  }
  const engine = current.current;
  useEffect(() => { engine.start(); return () => engine.stop(); }, [engine]);
  const jobs = Array.from(engine.jobs.values());
  return { jobs, error: Object.values(engine.listErrors)[0],
    jobErrors: engine.jobErrors, listErrors: engine.listErrors,
    cancelling: engine.cancelling, nextCursor: engine.nextCursor,
    loadingMore: engine.loadingMore, watch: engine.watch, cancel: engine.cancel,
    retry: engine.retry, removeMissing: engine.removeMissing,
    loadMore: engine.loadMore, retryLists: engine.retryLists,
    activeCount: jobs.filter(isEffectJobActive).length };
}
