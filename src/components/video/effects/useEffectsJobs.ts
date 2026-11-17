import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelEffectJob, getEffectJob, listEffectJobs } from '@/lib/api/effects';
import type { EffectAsset, EffectRenderJob } from '@/types/effects';

export const isEffectJobActive = (job: EffectRenderJob) =>
  ['queued', 'running', 'cancelling'].includes(job.status);

/** Persisted jobs survive modal close; the mounted project owns all delivery. */
export function useEffectsJobs(options: {
  projectId?: string; onRegister: (asset: EffectAsset) => void;
}) {
  const [jobs, setJobs] = useState<EffectRenderJob[]>([]);
  const [error, setError] = useState<Error>();
  const owner = useRef(options); owner.current = options;
  const authorized = useRef(new Set<string>());
  const delivered = useRef(new Set<string>());
  const watch = useCallback((job: EffectRenderJob, register = false) => {
    if (job.projectId !== owner.current.projectId) return;
    if (register) authorized.current.add(job.id);
    setJobs(previous => [job, ...previous.filter(item => item.id !== job.id)]);
  }, []);
  useEffect(() => {
    let active = true;
    setJobs([]); authorized.current.clear(); delivered.current.clear();
    if (options.projectId) {
      Promise.all([listEffectJobs(options.projectId),
        listEffectJobs(options.projectId, undefined, 'active')]).then(([page, pending]) => {
        if (active) {
          setJobs(previous => [...previous, ...pending.items, ...page.items]
            .filter((job, index, all) => all.findIndex(item => item.id === job.id) === index));
          setError(undefined);
        }
      }).catch(error => { if (active) setError(error); });
    }
    return () => { active = false; };
  }, [options.projectId]);
  useEffect(() => {
    let active = true;
    const pending = jobs.filter(isEffectJobActive);
    if (!pending.length || !options.projectId) return;
    const timer = setTimeout(() => {
      Promise.all(pending.map(job => getEffectJob(job.projectId, job.id)))
        .then(results => {
          if (!active) return;
          setError(undefined);
          setJobs(previous => previous.map(job =>
            results.find(result => result.id === job.id) ?? job));
        }).catch(error => {
          if (active) { setError(error); setJobs(previous => [...previous]); }
        });
    }, error ? 8000 : document.hidden ? 5000 : 1000);
    return () => { active = false; clearTimeout(timer); };
  }, [jobs, options.projectId, error]);
  useEffect(() => {
    for (const job of jobs) {
      if (job.outputAsset && authorized.current.has(job.id)
        && !delivered.current.has(job.id)
        && job.projectId === options.projectId) {
        owner.current.onRegister(job.outputAsset); delivered.current.add(job.id);
      }
    }
  }, [jobs, options.projectId]);
  const cancel = async (job: EffectRenderJob) => {
    watch(await cancelEffectJob(job.projectId, job.id));
  };
  return { jobs, error, watch, cancel,
    activeCount: jobs.filter(isEffectJobActive).length };
}
